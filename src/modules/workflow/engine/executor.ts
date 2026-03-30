import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { BrainServiceClass } from '../../../services/brain-service.js';
import type { Result } from '../../../errors.js';
import type { WorkflowDefinition } from '../types.js';
import type { DispatchResult, DryRunResult } from '../../../server/dispatch.js';
import { ok, fail } from '../../../errors.js';
import { instantiateWorkflow, expandWorkflow } from '../data/workflow-ops.js';
import { advanceWorkflow } from './lifecycle.js';
import { dispatchTemplate } from './dispatch.js';
import { signalCondition } from './condition.js';
import {
  getWorkflowDefinition,
  getInstanceByDisplayId,
  getInstanceStepStates,
} from '../data/queries.js';
import { getPmNotes } from '../../pm/data/queries.js';
import { findAgentByTask } from '../../agents/data.js';
import { buildResumptionPrompt, type ResumeContext } from '../../agents/resume.js';
import type { SessionMetadata } from '../../sessions/types.js';

// --- Types ---

export interface StepExecutionResult {
  stepId: string;
  taskId: string;
  mode: 'agent' | 'assisted' | 'skipped';
  dispatch?: DispatchResult | DryRunResult;
  rendered?: string;
}

export interface AdvanceDispatchResult {
  advanced: string[];
  dispatched: StepExecutionResult[];
  assisted: StepExecutionResult[];
  pruned: string[];
  warnings: string[];
  completed: boolean;
}

export interface StartWorkflowResult {
  instanceId: string;
  workflowId: string;
  workflowVersion: number;
  tasksCreated: number;
  edges: number;
  dispatched: StepExecutionResult[];
  assisted: StepExecutionResult[];
}

export interface StartWorkflowOptions {
  workstream?: number;
  dryRun?: boolean;
  model?: string;
  maxBudgetUsd?: number;
}

type ExecutorErrorCode =
  | 'NOT_FOUND'
  | 'MISSING_PARAMETER'
  | 'DISPATCH_FAILED'
  | 'ALREADY_EXPANDED'
  | 'ADVANCE_FAILED';

// --- Condition Signal Parsing ---

const CONDITION_PATTERNS: Record<string, (content: string) => boolean> = {
  needs_revision: (content) => /##\s*Verdict:\s*NEEDS\s+REVISION/i.test(content),
  has_open_questions: (content) => {
    const match = content.match(/##\s*Open\s+Questions\s*\n([\s\S]*?)(?=\n##\s|\n$|$)/i);
    if (!match) return false;
    const section = match[1].trim();
    return section.length > 0 && section !== '(none)' && section !== 'None';
  },
};

export function parseConditionSignals(
  projectDir: string,
  instanceDisplayId: string,
  stepId: string,
  definition: WorkflowDefinition,
  context: Record<string, string>,
  agentOutput?: string
): string[] {
  const outgoingConditions = definition.edges
    .filter((e) => e.from === stepId && e.condition)
    .map((e) => e.condition!);

  if (outgoingConditions.length === 0) return [];

  const content = readStepArtifact(projectDir, stepId, context) ?? agentOutput ?? '';
  if (!content) return [];

  const signals: string[] = [];
  for (const condition of outgoingConditions) {
    const pattern = CONDITION_PATTERNS[condition];
    if (pattern && pattern(content)) {
      signals.push(condition);
    }
  }

  return signals;
}

function readStepArtifact(
  projectDir: string,
  stepId: string,
  context: Record<string, string>
): string | null {
  const planId = context.planId ?? context.PLAN_ID;
  if (!planId) return null;

  const artifactMap: Record<string, string> = {
    critic: 'critic-report.md',
    research: 'research-brief.md',
    design: 'design.md',
  };

  const filename = artifactMap[stepId];
  if (!filename) return null;

  const path = join(projectDir, '.plans', planId, filename);
  if (!existsSync(path)) return null;
  return readFileSync(path, 'utf-8');
}

// --- Step Execution ---

export async function executeWorkflowStep(
  svc: BrainServiceClass,
  instanceDisplayId: string,
  stepId: string,
  options?: { model?: string; maxBudgetUsd?: number; resumePrefix?: string }
): Promise<Result<StepExecutionResult, ExecutorErrorCode>> {
  const instanceResult = getInstanceByDisplayId(svc.db, instanceDisplayId);
  if (!instanceResult.ok) return fail('NOT_FOUND', instanceResult.error.message);

  const { metadata: instanceMeta } = instanceResult.data;
  const workflowId = instanceMeta.workflow_id;

  const defResult = getWorkflowDefinition(svc.db, workflowId);
  if (!defResult.ok) return fail('NOT_FOUND', defResult.error.message);

  const stepDef = defResult.data.definition.steps.find((s) => s.id === stepId);
  if (!stepDef) return fail('NOT_FOUND', `Step "${stepId}" not found in workflow "${workflowId}"`);

  const stepsResult = getInstanceStepStates(svc.db, instanceDisplayId);
  if (!stepsResult.ok) return fail('NOT_FOUND', stepsResult.error.message);

  const stepState = stepsResult.data.steps.find((s) => s.stepId === stepId);
  if (!stepState) return fail('NOT_FOUND', `Step "${stepId}" has no task in instance`);

  const taskId = stepState.taskDisplayId;
  const status = stepState.status;

  if (status === 'claimed' || status === 'in-progress' || status === 'done') {
    return ok({ stepId, taskId, mode: 'skipped' });
  }

  const templateName = stepDef.template;
  if (!templateName) {
    return fail('NOT_FOUND', `Step "${stepId}" has no template defined`);
  }

  const mode = stepDef.mode ?? 'agent';

  if (mode === 'assisted' || mode === 'human') {
    return handleAssistedStep(svc, instanceDisplayId, stepId, taskId, templateName);
  }

  return handleAgentStep(svc, instanceDisplayId, stepId, taskId, templateName, options);
}

async function handleAssistedStep(
  svc: BrainServiceClass,
  instanceDisplayId: string,
  stepId: string,
  taskId: string,
  templateName: string
): Promise<Result<StepExecutionResult, ExecutorErrorCode>> {
  const rendered = await dispatchTemplate(svc.db, svc.config, svc.embedder, taskId, templateName, {
    claim: false,
    dryRun: true,
  });

  if (!rendered.ok) return fail('DISPATCH_FAILED', rendered.error.message);

  setInstancePaused(svc, instanceDisplayId, stepId);

  return ok({
    stepId,
    taskId,
    mode: 'assisted',
    rendered: rendered.data.rendered,
  });
}

async function handleAgentStep(
  svc: BrainServiceClass,
  instanceDisplayId: string,
  stepId: string,
  taskId: string,
  templateName: string,
  options?: { model?: string; maxBudgetUsd?: number; resumePrefix?: string }
): Promise<Result<StepExecutionResult, ExecutorErrorCode>> {
  const rendered = await dispatchTemplate(svc.db, svc.config, svc.embedder, taskId, templateName, {
    claim: false,
    dryRun: true,
  });

  if (!rendered.ok) return fail('DISPATCH_FAILED', rendered.error.message);

  incrementIterationCount(svc, instanceDisplayId, stepId);

  let prompt = rendered.data.rendered;
  if (options?.resumePrefix) {
    prompt = `${options.resumePrefix}\n\n---\n\n${prompt}`;
  }

  const { dispatchTask } = await import('../../../server/dispatch.js');
  try {
    const dispatch = await dispatchTask(svc, {
      taskId,
      promptOverride: prompt,
      model: options?.model,
      maxBudgetUsd: options?.maxBudgetUsd,
    });

    return ok({ stepId, taskId, mode: 'agent', dispatch });
  } catch (err) {
    return fail('DISPATCH_FAILED', err instanceof Error ? err.message : String(err));
  }
}

// --- Advance and Dispatch (the DAG pump) ---

export async function advanceAndDispatch(
  svc: BrainServiceClass,
  instanceDisplayId: string,
  completedStepId?: string,
  agentOutput?: string,
  options?: { model?: string; maxBudgetUsd?: number }
): Promise<Result<AdvanceDispatchResult, ExecutorErrorCode>> {
  const projectDir = resolveProjectDir(svc);

  if (completedStepId) {
    signalFromOutput(svc, projectDir, instanceDisplayId, completedStepId, agentOutput);
  }

  const advResult = await advanceWorkflow(svc.db, svc.config, instanceDisplayId);
  if (!advResult.ok) return fail('ADVANCE_FAILED', advResult.error.message);

  const { advanced, pruned, warnings, completed } = advResult.data;

  if (completed) {
    return ok({ advanced, dispatched: [], assisted: [], pruned, warnings, completed });
  }

  const dispatched: StepExecutionResult[] = [];
  const assisted: StepExecutionResult[] = [];

  for (const stepId of advanced) {
    const result = await executeWorkflowStep(svc, instanceDisplayId, stepId, options);
    if (!result.ok) {
      warnings.push(`Step "${stepId}" dispatch failed: ${result.error.message}`);
      continue;
    }

    if (result.data.mode === 'assisted') {
      assisted.push(result.data);
    } else if (result.data.mode === 'agent') {
      dispatched.push(result.data);
    }
  }

  return ok({ advanced, dispatched, assisted, pruned, warnings, completed });
}

// --- Start Workflow ---

export async function startWorkflow(
  svc: BrainServiceClass,
  workflowId: string,
  project: string,
  context: Record<string, string>,
  options?: StartWorkflowOptions
): Promise<Result<StartWorkflowResult, ExecutorErrorCode>> {
  const instResult = await instantiateWorkflow(
    svc.db,
    svc.config,
    svc.embedder,
    workflowId,
    project,
    context,
    { workstream: options?.workstream }
  );
  if (!instResult.ok) {
    return fail(instResult.error.code as ExecutorErrorCode, instResult.error.message);
  }

  const instanceId = instResult.data.display_id;

  const expandResult = await expandWorkflow(svc.db, svc.config, svc.embedder, instanceId);
  if (!expandResult.ok) {
    return fail(expandResult.error.code as ExecutorErrorCode, expandResult.error.message);
  }

  setInstanceStatus(svc, instanceId, 'executing');

  const advResult = await advanceAndDispatch(svc, instanceId, undefined, undefined, {
    model: options?.model,
    maxBudgetUsd: options?.maxBudgetUsd,
  });

  const dispatched = advResult.ok ? advResult.data.dispatched : [];
  const assisted = advResult.ok ? advResult.data.assisted : [];

  return ok({
    instanceId,
    workflowId,
    workflowVersion: instResult.data.workflow_version,
    tasksCreated: expandResult.data.tasksCreated,
    edges: expandResult.data.edges,
    dispatched,
    assisted,
  });
}

// --- Failure Handling ---

export async function handleStepFailure(
  svc: BrainServiceClass,
  instanceDisplayId: string,
  stepId: string,
  exitReason: string
): Promise<void> {
  if (exitReason === 'rate_limited') {
    const retried = await tryRetryStep(svc, instanceDisplayId, stepId);
    if (retried) return;
  }

  stallWorkflow(svc, instanceDisplayId, stepId, exitReason);
}

async function tryRetryStep(
  svc: BrainServiceClass,
  instanceDisplayId: string,
  stepId: string
): Promise<boolean> {
  const stepsResult = getInstanceStepStates(svc.db, instanceDisplayId);
  if (!stepsResult.ok) return false;

  const stepState = stepsResult.data.steps.find((s) => s.stepId === stepId);
  if (!stepState) return false;

  const taskNotes = getPmNotes(svc.db, 'task', { display_id: stepState.taskDisplayId });
  if (taskNotes.length === 0) return false;

  const meta = JSON.parse(taskNotes[0].metadata ?? '{}') as Record<string, unknown>;
  const retryCount = (meta.retry_count as number) ?? 0;
  if (retryCount >= 1) return false;

  const updated = { ...meta, retry_count: retryCount + 1, status: 'pending' };
  svc.db.upsertNote({ ...taskNotes[0], metadata: JSON.stringify(updated) });

  setInstanceStatus(svc, instanceDisplayId, 'executing');

  const resumePrefix = buildStepResumptionPrefix(svc, stepState.taskDisplayId);
  const result = await executeWorkflowStep(svc, instanceDisplayId, stepId, { resumePrefix });
  return result.ok && result.data.mode === 'agent';
}

function buildStepResumptionPrefix(
  svc: BrainServiceClass,
  taskDisplayId: string
): string | undefined {
  const agent = findAgentByTask(svc.db, taskDisplayId);
  if (!agent) return undefined;

  const sessions: SessionMetadata[] = [];
  const ctx: ResumeContext = {
    agent,
    sessions,
    reason: 'build-failure',
  };

  try {
    const prompt = buildResumptionPrompt(ctx);
    return prompt.markdown;
  } catch {
    return undefined;
  }
}

function stallWorkflow(
  svc: BrainServiceClass,
  instanceDisplayId: string,
  stepId: string,
  reason: string
): void {
  const instanceResult = getInstanceByDisplayId(svc.db, instanceDisplayId);
  if (!instanceResult.ok) return;

  const { note } = instanceResult.data;
  const meta = JSON.parse(note.metadata!) as Record<string, unknown>;
  const updated = {
    ...meta,
    instance_status: 'stalled',
    stalled_at: stepId,
    stall_reason: reason,
  };
  svc.db.upsertNote({ ...note, metadata: JSON.stringify(updated) });
}

// --- Helpers ---

function resolveProjectDir(svc: BrainServiceClass): string {
  if (svc.instance.isLocal) {
    return dirname(svc.instance.root);
  }
  return process.cwd();
}

function signalFromOutput(
  svc: BrainServiceClass,
  projectDir: string,
  instanceDisplayId: string,
  stepId: string,
  agentOutput?: string
): void {
  const instanceResult = getInstanceByDisplayId(svc.db, instanceDisplayId);
  if (!instanceResult.ok) return;

  const { metadata } = instanceResult.data;
  const defResult = getWorkflowDefinition(svc.db, metadata.workflow_id);
  if (!defResult.ok) return;

  const signals = parseConditionSignals(
    projectDir,
    instanceDisplayId,
    stepId,
    defResult.data.definition,
    metadata.context,
    agentOutput
  );

  for (const condition of signals) {
    signalCondition(svc.db, instanceDisplayId, stepId, condition);

    // Reset conditional loop targets to pending so advanceWorkflow can re-advance them
    const targetEdges = defResult.data.definition.edges.filter(
      (e) => e.from === stepId && e.condition === condition
    );
    for (const edge of targetEdges) {
      resetStepToPending(svc, instanceDisplayId, edge.to);
    }
  }
}

function incrementIterationCount(
  svc: BrainServiceClass,
  instanceDisplayId: string,
  stepId: string
): void {
  const stepsResult = getInstanceStepStates(svc.db, instanceDisplayId);
  if (!stepsResult.ok) return;

  const stepState = stepsResult.data.steps.find((s) => s.stepId === stepId);
  if (!stepState) return;

  const taskNotes = getPmNotes(svc.db, 'task', { display_id: stepState.taskDisplayId });
  if (taskNotes.length === 0) return;

  const meta = JSON.parse(taskNotes[0].metadata ?? '{}') as Record<string, unknown>;
  const current = (meta.iteration_count as number) ?? 0;
  const updated = { ...meta, iteration_count: current + 1 };
  svc.db.upsertNote({ ...taskNotes[0], metadata: JSON.stringify(updated) });
}

function resetStepToPending(
  svc: BrainServiceClass,
  instanceDisplayId: string,
  stepId: string
): void {
  const stepsResult = getInstanceStepStates(svc.db, instanceDisplayId);
  if (!stepsResult.ok) return;

  const stepState = stepsResult.data.steps.find((s) => s.stepId === stepId);
  if (!stepState) return;

  const taskNotes = getPmNotes(svc.db, 'task', { display_id: stepState.taskDisplayId });
  if (taskNotes.length === 0) return;

  const meta = JSON.parse(taskNotes[0].metadata ?? '{}') as Record<string, unknown>;
  if (meta.status !== 'done') return;

  const updated = { ...meta, status: 'pending' };
  svc.db.upsertNote({ ...taskNotes[0], metadata: JSON.stringify(updated) });
}

function setInstanceStatus(
  svc: BrainServiceClass,
  instanceDisplayId: string,
  status: string
): void {
  const instanceResult = getInstanceByDisplayId(svc.db, instanceDisplayId);
  if (!instanceResult.ok) return;

  const { note } = instanceResult.data;
  const meta = JSON.parse(note.metadata!) as Record<string, unknown>;
  const updated = { ...meta, instance_status: status };
  svc.db.upsertNote({ ...note, metadata: JSON.stringify(updated) });
}

function setInstancePaused(
  svc: BrainServiceClass,
  instanceDisplayId: string,
  stepId: string
): void {
  const instanceResult = getInstanceByDisplayId(svc.db, instanceDisplayId);
  if (!instanceResult.ok) return;

  const { note } = instanceResult.data;
  const meta = JSON.parse(note.metadata!) as Record<string, unknown>;
  const updated = { ...meta, instance_status: 'paused', paused_at: stepId };
  svc.db.upsertNote({ ...note, metadata: JSON.stringify(updated) });
}
