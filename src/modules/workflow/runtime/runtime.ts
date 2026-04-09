import { randomUUID } from 'node:crypto';
import type { BrainDB } from '../../../services/brain-db.js';
import type { BrainConfig, Embedder } from '../../../types.js';
import type { WorkflowFn, WorkflowRun, AgentSlot, StepResult } from './types.js';
import { WorkflowContext } from './context.js';
import { findAgentByTask, getAgentContext, getAgent } from '../../agents/data.js';
import { parseSignals } from './signals.js';
import { releaseWorkflowTasks } from './failure-cleanup.js';

/** Row shape returned from the workflow_runs table. */
interface WorkflowRunRow {
  id: string;
  workflow_name: string;
  context: string;
  status: string;
  current_step: string | null;
  step_results: string;
  active_agent: string | null;
  started_at: string;
  completed_at: string | null;
  error: string | null;
}

interface RunningWorkflow {
  ctx: WorkflowContext;
  promise: Promise<void>;
}

type ChannelPushFn = (event: string, meta: Record<string, string>) => void;

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Get the full agent output for signal parsing. Falls back to summary. */
function getAgentOutput(db: BrainDB, agentId: string, summary: string | null): string {
  const fullOutput = getAgentContext(db, agentId, 'full_output') as string | undefined;
  return fullOutput ?? summary ?? '';
}

/**
 * Migrate old scalar active_agent rows to the new Record<string, AgentSlot> format.
 * Old format: { pid, taskId, agentId?, stepId }
 * New format: { [stepId]: { pid, taskId, agentId?, stepId } }
 */
function parseActiveAgents(raw: string | null): Record<string, AgentSlot> {
  if (!raw) return {};
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  // Old scalar format has a top-level `pid` field
  if (typeof parsed.pid === 'number' && typeof parsed.stepId === 'string') {
    const slot = parsed as unknown as AgentSlot;
    return { [slot.stepId]: slot };
  }
  return parsed as Record<string, AgentSlot>;
}

function deserializeRun(row: WorkflowRunRow): WorkflowRun {
  return {
    id: row.id,
    workflowName: row.workflow_name,
    context: JSON.parse(row.context) as Record<string, string>,
    status: row.status as WorkflowRun['status'],
    currentStep: row.current_step,
    stepResults: JSON.parse(row.step_results) as Record<string, StepResult>,
    activeAgents: parseActiveAgents(row.active_agent),
    startedAt: row.started_at,
    completedAt: row.completed_at,
    error: row.error,
  };
}

export interface WorkflowRuntimeOptions {
  db: BrainDB;
  config: BrainConfig;
  channelPush?: ChannelPushFn;
  embedder?: Embedder;
  model?: string;
  maxBudgetUsd?: number;
}

export class WorkflowRuntime {
  private registry = new Map<string, WorkflowFn>();
  private active = new Map<string, RunningWorkflow>();
  private reconcileTimer: ReturnType<typeof setInterval> | null = null;

  private db: BrainDB;
  private config: BrainConfig;
  private channelPush: ChannelPushFn | undefined;
  private embedder: Embedder | undefined;
  private model: string | undefined;
  private maxBudgetUsd: number | undefined;

  constructor(options: WorkflowRuntimeOptions) {
    this.db = options.db;
    this.config = options.config;
    this.channelPush = options.channelPush;
    this.embedder = options.embedder;
    this.model = options.model;
    this.maxBudgetUsd = options.maxBudgetUsd;
  }

  register(name: string, fn: WorkflowFn): void {
    this.registry.set(name, fn);
  }

  hasWorkflow(name: string): boolean {
    return this.registry.has(name);
  }

  registeredWorkflows(): string[] {
    return [...this.registry.keys()];
  }

  async start(
    name: string,
    params: Record<string, string>,
    _options?: { model?: string; maxBudgetUsd?: number }
  ): Promise<string> {
    const fn = this.registry.get(name);
    if (!fn) throw new Error(`Unknown workflow: ${name}`);

    const runId = randomUUID();
    const now = new Date().toISOString();

    const rawDb = this.db.rawDb;
    rawDb
      .prepare(
        `INSERT INTO workflow_runs (id, workflow_name, context, status, step_results, started_at)
         VALUES (?, ?, ?, 'running', '{}', ?)`
      )
      .run(runId, name, JSON.stringify(params), now);

    const run: WorkflowRun = {
      id: runId,
      workflowName: name,
      context: params,
      status: 'running',
      currentStep: null,
      stepResults: {},
      activeAgents: {},
      startedAt: now,
      completedAt: null,
      error: null,
    };

    const ctx = new WorkflowContext(run, this.db, this.config, this.channelPush, {
      embedder: this.embedder,
      model: this.model,
      maxBudgetUsd: this.maxBudgetUsd,
    });
    const promise = fn(ctx).then(
      () => this.onComplete(runId),
      (err: unknown) => this.onFailed(runId, err)
    );
    this.active.set(runId, { ctx, promise });

    // Ensure the reconciler is running — it's the only mechanism that detects
    // agent completion and resolves workflow waitpoints for headless dispatch.
    this.startReconciler();

    return runId;
  }

  async hydrate(): Promise<void> {
    const rawDb = this.db.rawDb;
    const rows = rawDb
      .prepare(`SELECT * FROM workflow_runs WHERE status IN ('running', 'paused')`)
      .all() as WorkflowRunRow[];

    for (const row of rows) {
      const fn = this.registry.get(row.workflow_name);
      if (!fn) continue;

      if (this.active.has(row.id)) continue;

      const run = deserializeRun(row);

      this.resolveStaleAgent(run);

      const ctx = new WorkflowContext(run, this.db, this.config, this.channelPush, {
        embedder: this.embedder,
        model: this.model,
        maxBudgetUsd: this.maxBudgetUsd,
      });
      const promise = fn(ctx).then(
        () => this.onComplete(run.id),
        (err: unknown) => this.onFailed(run.id, err)
      );
      this.active.set(run.id, { ctx, promise });
    }
  }

  /**
   * Check if any active agents completed or died while the runtime was down.
   * Mutates the run in-place so the hydrated context picks up the result.
   */
  private resolveStaleAgent(run: WorkflowRun): void {
    const slots = Object.entries(run.activeAgents);
    if (slots.length === 0) return;

    let changed = false;
    for (const [stepId, slot] of slots) {
      const agent = slot.agentId
        ? getAgent(this.db, slot.agentId)
        : findAgentByTask(this.db, slot.taskId);
      if (!agent) {
        delete run.activeAgents[stepId];
        changed = true;
        continue;
      }

      if (agent.status === 'completed') {
        const iter = this.currentIteration(run, stepId);
        const iterKey = `${stepId}:${iter}`;
        const output = getAgentOutput(this.db, agent.id, agent.summary);

        run.stepResults[iterKey] = {
          stepId,
          taskId: slot.taskId,
          agentId: agent.id,
          signal: parseSignals(stepId, run.workflowName, output),
          completedAt: agent.completed_at ?? new Date().toISOString(),
          output,
        };
        delete run.activeAgents[stepId];
        changed = true;

        this.channelPush?.('step_complete', {
          workflow: run.id,
          step: stepId,
          signal: run.stepResults[iterKey].signal ?? '',
          taskId: run.stepResults[iterKey].taskId,
        });
      } else if (agent.status === 'failed' || agent.status === 'abandoned') {
        delete run.activeAgents[stepId];
        changed = true;
      }
      // If agent is still active/pending, leave slot in place —
      // the reconciler will monitor it after hydration.
    }

    if (changed) this.persistRun(run);
  }

  private currentIteration(run: WorkflowRun, stepId: string): number {
    let maxIter = -1;
    for (const key of Object.keys(run.stepResults)) {
      const colonIdx = key.lastIndexOf(':');
      if (colonIdx === -1) continue;
      const id = key.slice(0, colonIdx);
      if (id !== stepId) continue;
      const iter = parseInt(key.slice(colonIdx + 1), 10);
      if (!Number.isNaN(iter) && iter > maxIter) maxIter = iter;
    }
    return maxIter + 1;
  }

  private persistRun(run: WorkflowRun): void {
    const rawDb = this.db.rawDb;
    const hasSlots = Object.keys(run.activeAgents).length > 0;
    rawDb
      .prepare(
        `UPDATE workflow_runs SET status = ?, current_step = ?, step_results = ?,
         active_agent = ?, completed_at = ?, error = ? WHERE id = ?`
      )
      .run(
        run.status,
        run.currentStep,
        JSON.stringify(run.stepResults),
        hasSlots ? JSON.stringify(run.activeAgents) : null,
        run.completedAt,
        run.error,
        run.id
      );
  }

  getStatus(runId: string): WorkflowRun | null {
    const running = this.active.get(runId);
    if (running) {
      return running.ctx.toRun();
    }

    const rawDb = this.db.rawDb;
    const row = rawDb.prepare(`SELECT * FROM workflow_runs WHERE id = ?`).get(runId) as
      | WorkflowRunRow
      | undefined;

    if (!row) return null;
    return deserializeRun(row);
  }

  async waitForCompletion(runId: string): Promise<void> {
    const running = this.active.get(runId);
    if (running) await running.promise;
  }

  signal(runId: string, stepId: string, data?: Record<string, string>): void {
    const running = this.active.get(runId);
    if (!running) throw new Error(`No active workflow for run: ${runId}`);
    running.ctx.signal(stepId, data);
  }

  get activeRuns(): Map<string, RunningWorkflow> {
    return this.active;
  }

  /** List all workflow runs currently in 'running' status from DB. */
  listRunning(): WorkflowRun[] {
    const rawDb = this.db.rawDb;
    try {
      const rows = rawDb
        .prepare(`SELECT * FROM workflow_runs WHERE status = 'running'`)
        .all() as WorkflowRunRow[];
      return rows.map(deserializeRun);
    } catch {
      return [];
    }
  }

  /**
   * Cancel a workflow run, marking it cancelled with the given reason.
   * Releases any claimed tasks and removes from the active map.
   */
  cancel(runId: string, reason: string): void {
    this.releaseStuckTasks(runId);
    this.active.delete(runId);

    const rawDb = this.db.rawDb;
    const now = new Date().toISOString();
    try {
      rawDb
        .prepare(
          `UPDATE workflow_runs SET status = 'cancelled', completed_at = ?, error = ? WHERE id = ?`
        )
        .run(now, reason, runId);
    } catch {
      // Non-fatal — DB may be closed during shutdown
    }

    this.channelPush?.('workflow_cancelled', { workflow: runId, reason });
  }

  startReconciler(): void {
    if (this.reconcileTimer) return;
    this.reconcileTimer = setInterval(() => this.reconcile(), 10_000);
  }

  stopReconciler(): void {
    if (this.reconcileTimer) {
      clearInterval(this.reconcileTimer);
      this.reconcileTimer = null;
    }
  }

  private reconcile(): void {
    for (const [_runId, workflow] of this.active) {
      const slots = Object.values(workflow.ctx.activeAgents);

      for (const agent of slots) {
        // Check DB status first — handles both normal completion and PID reuse.
        // A dead process may have its PID reused by the OS; checking the DB first
        // lets us resolve the agent correctly regardless of PID state.
        // Use agentId for precise lookup when available; fall back to taskId for old runs.
        const agentRecord = agent.agentId
          ? getAgent(this.db, agent.agentId)
          : findAgentByTask(this.db, agent.taskId);

        if (agentRecord?.status === 'completed') {
          // Agent completed — resolve even if PID appears alive (handles PID reuse after exit)
          const output = getAgentOutput(this.db, agentRecord.id, agentRecord.summary);
          workflow.ctx.resolveAgent(agent.stepId, output);
        } else if (!isProcessAlive(agent.pid)) {
          // Process is dead and agent is not marked completed — treat as death.
          // This covers: failed, abandoned, or still 'active' (handleProcessExit
          // may have run but didn't mark success).
          workflow.ctx.handleAgentDeath(agent);
        }
        // PID alive and not completed in DB — keep waiting
      }
    }
  }

  private onComplete(runId: string): void {
    this.active.delete(runId);
    try {
      const rawDb = this.db.rawDb;
      const now = new Date().toISOString();
      rawDb
        .prepare(`UPDATE workflow_runs SET status = 'completed', completed_at = ? WHERE id = ?`)
        .run(now, runId);
    } catch {
      // DB may be closed during shutdown — non-fatal
    }

    this.channelPush?.('workflow_complete', { workflow: runId });
  }

  private onFailed(runId: string, error: unknown): void {
    const rawDb = this.db.rawDb;
    const now = new Date().toISOString();
    const errMsg = error instanceof Error ? error.message : String(error);
    rawDb
      .prepare(
        `UPDATE workflow_runs SET status = 'failed', completed_at = ?, error = ? WHERE id = ?`
      )
      .run(now, errMsg, runId);

    this.releaseStuckTasks(runId);
    this.active.delete(runId);

    this.channelPush?.('step_failed', {
      workflow: runId,
      error: errMsg,
    });
  }

  /** Release any claimed tasks from a failed workflow so they don't stay stuck. */
  private releaseStuckTasks(runId: string): void {
    const running = this.active.get(runId);
    if (!running) return;

    const run = running.ctx.toRun();
    try {
      releaseWorkflowTasks(this.db, this.config, this.embedder, run);
    } catch {
      // Non-fatal — cleanup failure shouldn't mask the original error
    }
  }
}
