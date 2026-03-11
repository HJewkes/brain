import type { BrainDB } from '../../../services/brain-db.js';
import type { BrainConfig } from '../../../types.js';
import type { Result } from '../../../errors.js';
import { ok, fail } from '../../../errors.js';
import type { WorkflowDefinition } from '../types.js';
import { getInstanceByDisplayId, getInstanceStepStates } from '../data/queries.js';
import { getPredecessors, getUnreachableSteps } from './dag.js';
import { evaluateGates } from './gates.js';

interface AdvanceResult {
  advanced: string[];
  pruned: string[];
  warnings: string[];
  completed: boolean;
}

export async function advanceWorkflow(
  db: BrainDB,
  config: BrainConfig,
  instanceDisplayId: string
): Promise<Result<AdvanceResult>> {
  const instanceResult = getInstanceByDisplayId(db, instanceDisplayId);
  if (!instanceResult.ok) return instanceResult;

  const { note: instanceNote } = instanceResult.data;

  const stepsResult = getInstanceStepStates(db, instanceDisplayId);
  if (!stepsResult.ok) return stepsResult;

  const { steps } = stepsResult.data;
  if (steps.length === 0) {
    return ok({ advanced: [], pruned: [], warnings: [], completed: true });
  }

  const definition = resolveDefinition(db, instanceNote);
  if (!definition) {
    return fail('DEFINITION_NOT_FOUND', 'Could not resolve workflow definition');
  }

  const statusMap = new Map(steps.map((s) => [s.stepId, s.status]));
  const taskDisplayIdMap = new Map(steps.map((s) => [s.stepId, s.taskDisplayId]));
  const allStepIds = steps.map((s) => s.stepId);

  const readySteps = buildReadySet(allStepIds, steps, definition);
  const advanced = await findAdvancedSteps(
    allStepIds,
    statusMap,
    taskDisplayIdMap,
    definition,
    readySteps,
    db,
    config
  );
  const { pruned, warnings } = pruneUnreachableSteps(
    db,
    allStepIds,
    statusMap,
    taskDisplayIdMap,
    definition,
    readySteps,
    advanced
  );

  const prunedSet = new Set(pruned);
  const completed = allStepIds.every((stepId) => {
    const status = statusMap.get(stepId);
    if (status === 'pruned' || status === 'cancelled' || prunedSet.has(stepId)) return true;
    return readySteps.has(stepId);
  });

  if (completed) {
    updateInstanceStatus(db, instanceNote.id, 'completed');
  }

  return ok({ advanced, pruned, warnings, completed });
}

function buildReadySet(
  allStepIds: string[],
  steps: Array<{ stepId: string; status: string }>,
  definition: WorkflowDefinition
): Set<string> {
  const ready = new Set<string>();

  for (const s of steps) {
    if (s.status === 'done') {
      ready.add(s.stepId);
    }
  }

  // Entry nodes have no unconditional predecessors. Conditional edges represent
  // optional feedback loops and don't count as structural dependencies.
  const unconditionalEdges = definition.edges.filter((e) => !e.condition);
  for (const stepId of allStepIds) {
    const preds = getPredecessors(stepId, unconditionalEdges);
    if (preds.length === 0) {
      ready.add(stepId);
    }
  }

  return ready;
}

async function findAdvancedSteps(
  allStepIds: string[],
  statusMap: Map<string, string>,
  taskDisplayIdMap: Map<string, string>,
  definition: WorkflowDefinition,
  readySteps: Set<string>,
  db: BrainDB,
  config: BrainConfig
): Promise<string[]> {
  const advanced: string[] = [];

  // Only unconditional edges define advancement prerequisites
  const unconditional = definition.edges.filter((e) => !e.condition);

  for (const stepId of allStepIds) {
    const status = statusMap.get(stepId);
    if (status === 'done' || status === 'pruned' || status === 'cancelled') continue;

    const preds = getPredecessors(stepId, unconditional);
    if (preds.length === 0) continue;

    const allPredsReady = preds.every((p) => readySteps.has(p));
    if (!allPredsReady) continue;

    const stepDef = definition.steps.find((s) => s.id === stepId);
    const gates = stepDef?.gates ?? [];
    if (gates.length > 0) {
      const taskMeta = lookupTaskMetadata(db, taskDisplayIdMap.get(stepId));
      const gateResult = await evaluateGates(gates, db, config, taskMeta);
      if (!gateResult.allPassed) continue;
    }

    advanced.push(stepId);
  }

  return advanced;
}

function pruneUnreachableSteps(
  db: BrainDB,
  allStepIds: string[],
  statusMap: Map<string, string>,
  taskDisplayIdMap: Map<string, string>,
  definition: WorkflowDefinition,
  readySteps: Set<string>,
  advanced: string[]
): { pruned: string[]; warnings: string[] } {
  const pruned: string[] = [];
  const warnings: string[] = [];

  const unreachable = getUnreachableSteps([...readySteps], definition.edges, allStepIds);

  const conditionalTargets = new Set(definition.edges.filter((e) => e.condition).map((e) => e.to));

  for (const stepId of allStepIds) {
    if (unreachable.includes(stepId)) continue;
    if (!conditionalTargets.has(stepId)) continue;

    const status = statusMap.get(stepId);
    if (status === 'done' || status === 'pruned' || status === 'cancelled') continue;

    const incoming = definition.edges.filter((e) => e.to === stepId);
    const allConditional = incoming.every((e) => e.condition);
    if (!allConditional) continue;

    const allSourcesReady = incoming.every((e) => readySteps.has(e.from));
    if (allSourcesReady && !advanced.includes(stepId)) {
      unreachable.push(stepId);
    }
  }

  for (const stepId of unreachable) {
    const status = statusMap.get(stepId);
    const displayId = taskDisplayIdMap.get(stepId);

    if (status === 'pending' || status === 'blocked') {
      pruneTask(db, displayId!);
      pruned.push(stepId);
    } else if (status === 'claimed' || status === 'in-progress') {
      warnings.push(`Step "${stepId}" (${displayId}) should be pruned but is ${status}`);
    }
  }

  return { pruned, warnings };
}

function lookupTaskMetadata(
  db: BrainDB,
  taskDisplayId: string | undefined
): Record<string, unknown> | undefined {
  if (!taskDisplayId) return undefined;
  const noteIds = db.getModuleNoteIds({ module: 'pm', type: 'task' });
  const notes = db.getNotesByIds(noteIds);
  for (const [, note] of notes) {
    if (!note.metadata) continue;
    const meta = JSON.parse(note.metadata) as Record<string, unknown>;
    if (meta.display_id === taskDisplayId) return meta;
  }
  return undefined;
}

function resolveDefinition(db: BrainDB, instanceNote: { id: string }): WorkflowDefinition | null {
  const relations = db.getRelationsFrom(instanceNote.id);
  const instanceOfRel = relations.find((r) => r.type === 'instance-of');
  if (!instanceOfRel) return null;

  const defNote = db.getNoteById(instanceOfRel.targetId);
  if (!defNote) return null;

  const chunk = db.getFirstChunkForNote(defNote.id);
  if (!chunk) return null;

  try {
    const jsonMatch = chunk.content.match(/({[\s\S]*})/);
    return JSON.parse(jsonMatch ? jsonMatch[1] : chunk.content) as WorkflowDefinition;
  } catch {
    return null;
  }
}

function pruneTask(db: BrainDB, targetDisplayId: string): void {
  const noteIds = db.getModuleNoteIds({ module: 'pm', type: 'task' });
  const notes = db.getNotesByIds(noteIds);
  for (const [, note] of notes) {
    if (!note.metadata) continue;
    const meta = JSON.parse(note.metadata) as Record<string, unknown>;
    if (meta.display_id === targetDisplayId) {
      const updated = { ...meta, status: 'pruned' };
      db.upsertNote({ ...note, metadata: JSON.stringify(updated) });
      break;
    }
  }
}

function updateInstanceStatus(db: BrainDB, noteId: string, status: string): void {
  const note = db.getNoteById(noteId);
  if (!note?.metadata) return;
  const meta = JSON.parse(note.metadata) as Record<string, unknown>;
  const updated = { ...meta, instance_status: status };
  db.upsertNote({ ...note, metadata: JSON.stringify(updated) });
}
