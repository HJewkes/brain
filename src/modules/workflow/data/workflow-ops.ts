import { readFileSync, existsSync } from 'node:fs';
import type { BrainDB } from '../../../services/brain-db.js';
import type { BrainConfig, Embedder } from '../../../types.js';
import type {
  WorkflowDefinition,
  WorkflowNoteMetadata,
  WorkflowInstanceMetadata,
  WorkflowEdge,
} from '../types.js';
import type { TaskStatus } from '../../pm/types.js';
import { validateDag, topologicalSort } from '../engine/dag.js';
import { ok, fail, type Result } from '../../../errors.js';
import { getWorkflowDefinition, getInstanceByDisplayId, getInstanceStepStates } from './queries.js';
import { createTask } from '../../pm/data/task-ops.js';
import { getPmNotes } from '../../pm/data/queries.js';

const COMPLEXITY_EXCLUSIONS: Record<string, Set<string>> = {
  low: new Set(['research', 'interview', 'design', 'critic', 'spec-tests', 'decompose']),
  medium: new Set(['interview']),
  high: new Set(),
};

/**
 * For each included step, traces backwards through excluded predecessors to find
 * the nearest included predecessor, returning bridge edges to close the gap.
 * Only generates edges for paths that traverse at least one excluded step.
 */
export function computeTransitiveBridges(
  edges: WorkflowEdge[],
  includedSteps: Set<string>,
  excludedSteps: Set<string>
): WorkflowEdge[] {
  if (excludedSteps.size === 0) return [];

  const bridges: WorkflowEdge[] = [];

  // Build predecessor map using only unconditional edges (matches topological sort logic)
  const predecessors = new Map<string, Set<string>>();
  for (const e of edges) {
    if (e.condition) continue;
    if (!predecessors.has(e.to)) predecessors.set(e.to, new Set());
    predecessors.get(e.to)!.add(e.from);
  }

  // For each included step that has at least one excluded direct predecessor,
  // walk back through excluded nodes to find the nearest included predecessor
  for (const step of includedSteps) {
    const directPreds = predecessors.get(step) ?? new Set<string>();
    const excludedPreds = [...directPreds].filter((p) => excludedSteps.has(p));
    if (excludedPreds.length === 0) continue;

    const visited = new Set<string>();
    const queue = [...excludedPreds];
    while (queue.length > 0) {
      const pred = queue.shift()!;
      if (visited.has(pred)) continue;
      visited.add(pred);
      for (const pp of predecessors.get(pred) ?? []) {
        if (includedSteps.has(pp)) {
          bridges.push({ from: pp, to: step });
        } else if (excludedSteps.has(pp)) {
          queue.push(pp);
        }
      }
    }
  }

  return bridges;
}

type RegisterErrorCode =
  | 'NOT_FOUND'
  | 'INVALID_NOTE_TYPE'
  | 'PARSE_ERROR'
  | 'INVALID_DEFINITION'
  | 'CYCLE_DETECTED';

function extractNoteBody(filePath: string): string {
  if (!existsSync(filePath)) return '';
  const content = readFileSync(filePath, 'utf-8');
  const fmEnd = content.indexOf('\n---', 4);
  if (fmEnd === -1) return '';
  let body = content.slice(fmEnd + 4).trim();
  if (body.startsWith('#')) {
    const headingEnd = body.indexOf('\n');
    if (headingEnd === -1) return '';
    body = body.slice(headingEnd + 1).trim();
  }
  return body;
}

export async function registerWorkflow(
  db: BrainDB,
  _config: BrainConfig,
  _embedder: Embedder,
  noteId: string
): Promise<Result<WorkflowNoteMetadata, RegisterErrorCode>> {
  const note = db.getNoteById(noteId);
  if (!note) {
    return fail('NOT_FOUND', `Note "${noteId}" not found`);
  }

  if (note.type !== 'workflow') {
    return fail(
      'INVALID_NOTE_TYPE',
      `Note "${noteId}" is type "${note.type}", expected "workflow"`
    );
  }

  const body = extractNoteBody(note.filePath);
  let definition: WorkflowDefinition;
  try {
    definition = JSON.parse(body) as WorkflowDefinition;
  } catch {
    return fail('PARSE_ERROR', `Failed to parse workflow definition as JSON`);
  }

  const dagResult = validateDag(definition);
  if (!dagResult.ok) {
    const code = dagResult.error.code as RegisterErrorCode;
    return fail(code, dagResult.error.message, dagResult.error.details);
  }

  const existingMeta = note.metadata ? (JSON.parse(note.metadata) as Record<string, unknown>) : {};
  const currentVersion =
    existingMeta.registration_status === 'registered' ? ((existingMeta.version as number) ?? 0) : 0;
  const newVersion = currentVersion + 1;

  const updatedMeta: Record<string, unknown> = {
    ...existingMeta,
    registration_status: 'registered',
    version: newVersion,
    step_count: definition.steps.length,
    edge_count: definition.edges.length,
    name: definition.name,
    display_id: existingMeta.display_id ?? noteId,
  };

  const updatedNote = { ...note, metadata: JSON.stringify(updatedMeta) };
  db.upsertNote(updatedNote);

  const workflowMeta: WorkflowNoteMetadata = {
    display_id: (updatedMeta.display_id as string) ?? noteId,
    name: definition.name,
    version: newVersion,
    registration_status: 'registered',
    step_count: definition.steps.length,
    edge_count: definition.edges.length,
  };

  return ok(workflowMeta);
}

type InstantiateErrorCode = 'NOT_FOUND' | 'MISSING_PARAMETER';

interface InstantiateResult {
  display_id: string;
  workflow_id: string;
  workflow_version: number;
  instance_status: 'placeholder';
  context: Record<string, string>;
}

export async function instantiateWorkflow(
  db: BrainDB,
  config: BrainConfig,
  embedder: Embedder,
  workflowId: string,
  project: string,
  context: Record<string, string>,
  options?: { iterationOf?: string; workstream?: number }
): Promise<Result<InstantiateResult, InstantiateErrorCode>> {
  const defResult = getWorkflowDefinition(db, workflowId);
  if (!defResult.ok) {
    return fail('NOT_FOUND', defResult.error.message);
  }

  const { definition, metadata: wfMeta, note: defNote } = defResult.data;

  if (definition.parameters) {
    for (const param of definition.parameters) {
      if (param.required && !(param.name in context)) {
        return fail('MISSING_PARAMETER', `Required parameter "${param.name}" not provided`);
      }
    }
  }

  const workstream =
    options?.workstream ?? (context.workstream ? parseInt(context.workstream, 10) : undefined);
  if (!workstream) {
    return fail(
      'MISSING_PARAMETER',
      'Workstream is required — pass --context "workstream=N" or options.workstream'
    );
  }

  const taskResult = await createTask(db, config, embedder, {
    project,
    workstream,
    name: `[${definition.name}] instance`,
    description: `Workflow instance of ${workflowId}`,
    category: 'implementation',
    priority: 'medium',
  });

  if (!taskResult.ok) {
    return fail('NOT_FOUND', taskResult.error.message);
  }

  const taskDisplayId = taskResult.data.display_id;

  const taskNoteIds = db.getModuleNoteIds({ module: 'pm', type: 'task' });
  const taskNotes = db.getNotesByIds(taskNoteIds);
  let taskNoteId: string | undefined;

  for (const [, note] of taskNotes) {
    if (!note.metadata) continue;
    const meta = JSON.parse(note.metadata) as Record<string, unknown>;
    if (meta.display_id === taskDisplayId) {
      taskNoteId = note.id;

      const updatedMeta = {
        ...meta,
        workflow_id: workflowId,
        workflow_version: wfMeta.version,
        instance_status: 'placeholder' as const,
        context,
      };
      db.upsertNote({ ...note, metadata: JSON.stringify(updatedMeta) });
      break;
    }
  }

  if (taskNoteId) {
    const relations = [{ sourceId: taskNoteId, targetId: defNote.id, type: 'instance-of' }];

    if (options?.iterationOf) {
      const prevInstanceResult = getInstanceByDisplayId(db, options.iterationOf);
      if (prevInstanceResult.ok) {
        relations.push({
          sourceId: taskNoteId,
          targetId: prevInstanceResult.data.note.id,
          type: 'iteration-of',
        });
      }
    }

    db.upsertRelations(taskNoteId, relations);
  }

  return ok({
    display_id: taskDisplayId,
    workflow_id: workflowId,
    workflow_version: wfMeta.version,
    instance_status: 'placeholder',
    context,
  });
}

type ExpandErrorCode = 'NOT_FOUND' | 'ALREADY_EXPANDED' | 'DEFINITION_NOT_FOUND';

interface ExpandResult {
  tasksCreated: number;
  edges: number;
}

export async function expandWorkflow(
  db: BrainDB,
  config: BrainConfig,
  embedder: Embedder,
  instanceDisplayId: string
): Promise<Result<ExpandResult, ExpandErrorCode>> {
  const instanceResult = getInstanceByDisplayId(db, instanceDisplayId);
  if (!instanceResult.ok) {
    return fail('NOT_FOUND', instanceResult.error.message);
  }

  const { note: instanceNote, metadata: instanceMeta } = instanceResult.data;

  if (
    instanceMeta.instance_status === 'expanded' ||
    instanceMeta.instance_status === 'executing' ||
    instanceMeta.instance_status === 'completed' ||
    instanceMeta.instance_status === 'collapsed'
  ) {
    return fail('ALREADY_EXPANDED', `Instance "${instanceDisplayId}" is already expanded`);
  }

  const relations = db.getRelationsFrom(instanceNote.id);
  const instanceOfRel = relations.find((r) => r.type === 'instance-of');
  if (!instanceOfRel) {
    return fail('DEFINITION_NOT_FOUND', `No instance-of relation found for "${instanceDisplayId}"`);
  }

  const defNote = db.getNoteById(instanceOfRel.targetId);
  if (!defNote) {
    return fail('DEFINITION_NOT_FOUND', `Workflow definition note not found`);
  }

  const chunk = db.getFirstChunkForNote(defNote.id);
  if (!chunk) {
    return fail('DEFINITION_NOT_FOUND', `Workflow definition has no content`);
  }

  let definition: WorkflowDefinition;
  try {
    const jsonMatch = chunk.content.match(/({[\s\S]*})/);
    definition = JSON.parse(jsonMatch ? jsonMatch[1] : chunk.content) as WorkflowDefinition;
  } catch {
    return fail('DEFINITION_NOT_FOUND', `Failed to parse workflow definition`);
  }

  const instanceParsedMeta = JSON.parse(instanceNote.metadata!) as Record<string, unknown>;
  const instanceContext = (instanceParsedMeta.context as Record<string, string>) ?? {};
  const complexity = instanceContext.complexity ?? 'high';
  const exclusions = COMPLEXITY_EXCLUSIONS[complexity] ?? COMPLEXITY_EXCLUSIONS['high'];

  const includedSteps = new Set(
    definition.steps.map((s) => s.id).filter((id) => !exclusions.has(id))
  );
  const excludedSteps = new Set(
    definition.steps.map((s) => s.id).filter((id) => exclusions.has(id))
  );

  const directEdges = definition.edges.filter(
    (e) => includedSteps.has(e.from) && includedSteps.has(e.to)
  );
  const bridgeEdges = computeTransitiveBridges(definition.edges, includedSteps, excludedSteps);
  const filteredEdges = [...directEdges, ...bridgeEdges];

  const filteredSteps = definition.steps.filter((s) => includedSteps.has(s.id));
  const sortResult = topologicalSort(filteredSteps, filteredEdges);
  if (!sortResult.ok) {
    return fail('DEFINITION_NOT_FOUND', `Failed to sort workflow steps`);
  }

  const topoOrder = sortResult.data;
  const stepToTaskNoteId = new Map<string, string>();
  const stepToDisplayId = new Map<string, string>();
  const instanceProject = (instanceParsedMeta.project as string) ?? 'TST';
  const instanceWorkstream = instanceParsedMeta.workstream as number;
  if (!instanceWorkstream) {
    return fail('DEFINITION_NOT_FOUND', 'Instance missing workstream metadata');
  }

  for (const stepId of topoOrder) {
    const stepDef = definition.steps.find((s) => s.id === stepId);
    const stepName = stepDef?.name ?? stepId;

    const taskResult = await createTask(db, config, embedder, {
      project: instanceProject,
      workstream: instanceWorkstream,
      name: `[${definition.name}] ${stepName}`,
      description: `Step "${stepId}" of workflow ${instanceDisplayId}`,
      category: stepDef?.category ?? 'implementation',
      priority: stepDef?.priority ?? 'medium',
    });

    if (!taskResult.ok) continue;

    const childDisplayId = taskResult.data.display_id;
    stepToDisplayId.set(stepId, childDisplayId);

    const matchingNotes = getPmNotes(db, 'task', { display_id: childDisplayId });
    if (matchingNotes.length > 0) {
      const childNote = matchingNotes[0];
      const meta = childNote.metadata
        ? (JSON.parse(childNote.metadata) as Record<string, unknown>)
        : {};
      const updatedChildMeta = { ...meta, step_id: stepId };
      db.upsertNote({ ...childNote, metadata: JSON.stringify(updatedChildMeta) });
      stepToTaskNoteId.set(stepId, childNote.id);
    }
  }

  // Collect all instance relations (preserve instance-of, add expands-to)
  const existingInstanceRelations = db.getRelationsFrom(instanceNote.id);
  const instanceRelations = [...existingInstanceRelations];
  for (const [, childNoteId] of stepToTaskNoteId) {
    instanceRelations.push({
      sourceId: instanceNote.id,
      targetId: childNoteId,
      type: 'expands-to',
    });
  }
  db.upsertRelations(instanceNote.id, instanceRelations);

  // Only unconditional edges create structural dependencies;
  // conditional edges are optional paths that don't block execution
  const unconditionalEdges = filteredEdges.filter((e) => !e.condition);

  // Build edge relations, grouping by source note to avoid overwriting
  const edgesBySource = new Map<
    string,
    Array<{ sourceId: string; targetId: string; type: string }>
  >();
  let edgeCount = 0;
  for (const edge of unconditionalEdges) {
    const fromNoteId = stepToTaskNoteId.get(edge.from);
    const toNoteId = stepToTaskNoteId.get(edge.to);
    if (fromNoteId && toNoteId) {
      if (!edgesBySource.has(toNoteId)) {
        edgesBySource.set(toNoteId, []);
      }
      edgesBySource.get(toNoteId)!.push({
        sourceId: toNoteId,
        targetId: fromNoteId,
        type: 'depends_on',
      });
      edgeCount++;
    }
  }
  for (const [sourceNoteId, rels] of edgesBySource) {
    const existing = db.getRelationsFrom(sourceNoteId);
    db.upsertRelations(sourceNoteId, [...existing, ...rels]);
  }

  const currentMeta = JSON.parse(instanceNote.metadata!) as Record<string, unknown>;
  const expandedMeta = { ...currentMeta, instance_status: 'expanded' };
  db.upsertNote({ ...instanceNote, metadata: JSON.stringify(expandedMeta) });

  return ok({ tasksCreated: stepToTaskNoteId.size, edges: edgeCount });
}

type StatusErrorCode = 'NOT_FOUND';

interface StatusResult {
  instance: WorkflowInstanceMetadata;
  steps: Array<{ stepId: string; taskDisplayId: string; status: TaskStatus }>;
  progress: { total: number; done: number; pruned: number; active: number; pending: number };
}

export function getWorkflowStatus(
  db: BrainDB,
  instanceDisplayId: string
): Result<StatusResult, StatusErrorCode> {
  const instanceResult = getInstanceByDisplayId(db, instanceDisplayId);
  if (!instanceResult.ok) {
    return fail('NOT_FOUND', instanceResult.error.message);
  }

  const stepsResult = getInstanceStepStates(db, instanceDisplayId);
  if (!stepsResult.ok) {
    return fail('NOT_FOUND', stepsResult.error.message);
  }

  const { steps } = stepsResult.data;

  const defResult = getWorkflowDefinition(db, instanceResult.data.metadata.workflow_id);
  if (defResult.ok) {
    const { definition } = defResult.data;
    const sortResult = topologicalSort(definition.steps, definition.edges);
    if (sortResult.ok) {
      const orderIndex = new Map(sortResult.data.map((id, i) => [id, i]));
      steps.sort((a, b) => {
        const ai = orderIndex.get(a.stepId) ?? Infinity;
        const bi = orderIndex.get(b.stepId) ?? Infinity;
        return ai - bi;
      });
    }
  }

  return ok({
    instance: instanceResult.data.metadata,
    steps,
    progress: stepsResult.data.progress,
  });
}

type CollapseErrorCode = 'NOT_FOUND' | 'NOT_EXPANDED' | 'INCOMPLETE_WORKFLOW';

interface CollapseResult {
  summaryNoteId: string;
  tasksArchived: number;
}

export async function collapseWorkflow(
  db: BrainDB,
  config: BrainConfig,
  embedder: Embedder,
  instanceDisplayId: string
): Promise<Result<CollapseResult, CollapseErrorCode>> {
  const instanceResult = getInstanceByDisplayId(db, instanceDisplayId);
  if (!instanceResult.ok) {
    return fail('NOT_FOUND', instanceResult.error.message);
  }

  const { note: instanceNote, metadata: instanceMeta } = instanceResult.data;

  if (instanceMeta.instance_status === 'placeholder') {
    return fail('NOT_EXPANDED', `Instance "${instanceDisplayId}" has not been expanded`);
  }

  const stepsResult = getInstanceStepStates(db, instanceDisplayId);
  if (!stepsResult.ok) {
    return fail('NOT_FOUND', stepsResult.error.message);
  }

  const { steps } = stepsResult.data;
  const incomplete = steps.filter(
    (s) => s.status !== 'done' && s.status !== 'pruned' && s.status !== 'cancelled'
  );
  if (incomplete.length > 0) {
    return fail('INCOMPLETE_WORKFLOW', `${incomplete.length} tasks are not done/pruned`, {
      incomplete: incomplete.map((s) => s.taskDisplayId),
    });
  }

  let tasksArchived = 0;
  const relations = db.getRelationsFrom(instanceNote.id);
  const expandsToRelations = relations.filter((r) => r.type === 'expands-to');
  const childIds = expandsToRelations.map((r) => r.targetId);
  const childNotes = db.getNotesByIds(childIds);

  for (const [, childNote] of childNotes) {
    if (!childNote.metadata) continue;
    const meta = JSON.parse(childNote.metadata) as Record<string, unknown>;
    if (meta.status !== 'done') {
      const updatedMeta = { ...meta, status: 'done' };
      db.upsertNote({ ...childNote, metadata: JSON.stringify(updatedMeta) });
    }
    tasksArchived++;
  }

  const currentMeta = JSON.parse(instanceNote.metadata!) as Record<string, unknown>;
  const collapsedMeta = { ...currentMeta, instance_status: 'collapsed' };
  db.upsertNote({ ...instanceNote, metadata: JSON.stringify(collapsedMeta) });

  const summaryNoteId = `${instanceDisplayId}-summary`;

  return ok({ summaryNoteId, tasksArchived });
}
