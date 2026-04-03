import type { BrainDB } from '../../../services/brain-db.js';
import type { NoteRecord } from '../../../types.js';
import type { Result } from '../../../errors.js';
import { ok, fail } from '../../../errors.js';
// Inline types from deleted types.ts — only used by legacy query functions
// that dispatch.ts calls (returning empty results for V2 tasks)
interface WorkflowStep {
  id: string;
  name: string;
  mode?: string;
}
interface WorkflowEdge {
  from: string;
  to: string;
  condition?: string;
}
interface WorkflowDefinition {
  name: string;
  version: number;
  steps: WorkflowStep[];
  edges: WorkflowEdge[];
}
interface WorkflowNoteMetadata {
  display_id: string;
  name: string;
  version: number;
  registration_status: 'registered' | 'draft' | 'archived';
  step_count: number;
  edge_count: number;
}
interface WorkflowInstanceMetadata {
  workflow_id: string;
  workflow_version: number;
  instance_status: 'placeholder' | 'expanding' | 'active' | 'completed' | 'stalled' | 'collapsed';
  context: Record<string, string>;
}
import type { TaskStatus } from '../../pm/types.js';

export function getWorkflowDefinition(
  db: BrainDB,
  workflowId: string
): Result<{ note: NoteRecord; definition: WorkflowDefinition; metadata: WorkflowNoteMetadata }> {
  const noteIds = db.getModuleNoteIds({ module: 'workflow', type: 'workflow' });
  if (noteIds.length === 0) {
    return fail('NOT_FOUND', `No workflow notes found.`);
  }

  const notes = db.getNotesByIds(noteIds);
  for (const [, note] of notes) {
    if (!note.metadata) continue;
    const meta = JSON.parse(note.metadata) as Record<string, unknown>;
    if (meta.display_id !== workflowId) continue;

    const chunk = db.getFirstChunkForNote(note.id);
    if (!chunk) {
      return fail('NOT_FOUND', `Workflow "${workflowId}" has no content to parse.`);
    }

    let definition: WorkflowDefinition;
    try {
      // Chunk may include markdown heading before JSON; extract the JSON object
      const jsonMatch = chunk.content.match(/({[\s\S]*})/);
      const jsonStr = jsonMatch ? jsonMatch[1] : chunk.content;
      definition = JSON.parse(jsonStr) as WorkflowDefinition;
    } catch {
      return fail('INVALID_INPUT', `Workflow "${workflowId}" body is not valid JSON.`);
    }

    return ok({
      note,
      definition,
      metadata: {
        display_id: (meta.display_id as string) ?? '',
        name: (meta.name as string) ?? (meta.title as string) ?? definition.name ?? '',
        version: (meta.version as number) ?? definition.version ?? 0,
        registration_status:
          (meta.registration_status as WorkflowNoteMetadata['registration_status']) ?? 'draft',
        step_count: (meta.step_count as number) ?? definition.steps.length,
        edge_count: (meta.edge_count as number) ?? definition.edges.length,
      },
    });
  }

  return fail('NOT_FOUND', `Workflow "${workflowId}" not found.`);
}

export function listWorkflows(
  db: BrainDB,
  filters?: { project?: string; status?: string }
): Result<WorkflowNoteMetadata[]> {
  const noteIds = db.getModuleNoteIds({ module: 'workflow', type: 'workflow' });
  if (noteIds.length === 0) {
    return ok([]);
  }

  const notes = db.getNotesByIds(noteIds);
  const results: WorkflowNoteMetadata[] = [];

  for (const [, note] of notes) {
    if (!note.metadata) continue;
    const meta = JSON.parse(note.metadata) as Record<string, unknown>;

    if (filters?.project && meta.project !== filters.project) continue;
    if (filters?.status && meta.registration_status !== filters.status) continue;

    results.push({
      display_id: (meta.display_id as string) ?? '',
      name: (meta.name as string) ?? (meta.title as string) ?? '',
      version: (meta.version as number) ?? 0,
      registration_status:
        (meta.registration_status as WorkflowNoteMetadata['registration_status']) ?? 'draft',
      step_count: (meta.step_count as number) ?? 0,
      edge_count: (meta.edge_count as number) ?? 0,
    });
  }

  return ok(results);
}

export function getInstanceByDisplayId(
  db: BrainDB,
  displayId: string
): Result<{ note: NoteRecord; metadata: WorkflowInstanceMetadata }> {
  const noteIds = db.getModuleNoteIds({ module: 'pm', type: 'task' });
  if (noteIds.length === 0) {
    return fail('NOT_FOUND', `No task notes found.`);
  }

  const notes = db.getNotesByIds(noteIds);
  for (const [, note] of notes) {
    if (!note.metadata) continue;
    const meta = JSON.parse(note.metadata) as Record<string, unknown>;
    if (meta.display_id !== displayId) continue;

    if (!meta.workflow_id) {
      return fail('NOT_FOUND', `Task "${displayId}" is not a workflow instance.`);
    }

    return ok({
      note,
      metadata: {
        workflow_id: meta.workflow_id as string,
        workflow_version: (meta.workflow_version as number) ?? 1,
        instance_status:
          (meta.instance_status as WorkflowInstanceMetadata['instance_status']) ?? 'placeholder',
        context: (meta.context as Record<string, string>) ?? {},
      },
    });
  }

  return fail('NOT_FOUND', `Task "${displayId}" not found.`);
}

export function getInstanceStepStates(
  db: BrainDB,
  instanceDisplayId: string
): Result<{
  steps: Array<{ stepId: string; taskDisplayId: string; status: TaskStatus }>;
  progress: {
    total: number;
    done: number;
    pruned: number;
    skipped: number;
    active: number;
    pending: number;
  };
}> {
  const instanceResult = getInstanceByDisplayId(db, instanceDisplayId);
  if (!instanceResult.ok) return instanceResult;

  const instanceNote = instanceResult.data.note;
  const relations = db.getRelationsFrom(instanceNote.id);
  const expandsToRelations = relations.filter((r) => r.type === 'expands-to');

  if (expandsToRelations.length === 0) {
    return ok({
      steps: [],
      progress: { total: 0, done: 0, pruned: 0, skipped: 0, active: 0, pending: 0 },
    });
  }

  const childIds = expandsToRelations.map((r) => r.targetId);
  const childNotes = db.getNotesByIds(childIds);

  const steps: Array<{ stepId: string; taskDisplayId: string; status: TaskStatus }> = [];
  let done = 0;
  let pruned = 0;
  let skipped = 0;
  let active = 0;
  let pending = 0;

  for (const [, childNote] of childNotes) {
    if (!childNote.metadata) continue;
    const meta = JSON.parse(childNote.metadata) as Record<string, unknown>;
    const status = (meta.status as TaskStatus) ?? 'pending';
    const stepId = (meta.step_id as string) ?? '';
    const taskDisplayId = (meta.display_id as string) ?? '';

    steps.push({ stepId, taskDisplayId, status });

    switch (status) {
      case 'done':
        done++;
        break;
      case 'pruned':
      case 'cancelled':
        pruned++;
        break;
      case 'skipped':
        skipped++;
        break;
      case 'claimed':
      case 'in-progress':
        active++;
        break;
      default:
        pending++;
        break;
    }
  }

  return ok({
    steps,
    progress: { total: steps.length, done, pruned, skipped, active, pending },
  });
}
