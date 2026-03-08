import type { BrainDB } from '../../../services/brain-db.js';
import type { NoteRecord } from '../../../types.js';
import type { Result } from '../../../errors.js';
import { ok, fail } from '../../../errors.js';
import type {
  WorkflowDefinition,
  WorkflowNoteMetadata,
  WorkflowInstanceMetadata,
} from '../types.js';
import type { TaskStatus } from '../../pm/types.js';

export function getWorkflowDefinition(
  db: BrainDB,
  workflowId: string,
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
      definition = JSON.parse(chunk.content) as WorkflowDefinition;
    } catch {
      return fail('INVALID_INPUT', `Workflow "${workflowId}" body is not valid JSON.`);
    }

    return ok({
      note,
      definition,
      metadata: meta as unknown as WorkflowNoteMetadata,
    });
  }

  return fail('NOT_FOUND', `Workflow "${workflowId}" not found.`);
}

export function listWorkflows(
  db: BrainDB,
  filters?: { project?: string; status?: string },
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

    results.push(meta as unknown as WorkflowNoteMetadata);
  }

  return ok(results);
}

export function getInstanceByDisplayId(
  db: BrainDB,
  displayId: string,
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
        instance_status: (meta.instance_status as WorkflowInstanceMetadata['instance_status']) ?? 'placeholder',
        context: (meta.context as Record<string, string>) ?? {},
      },
    });
  }

  return fail('NOT_FOUND', `Task "${displayId}" not found.`);
}

export function getInstanceStepStates(
  db: BrainDB,
  instanceDisplayId: string,
): Result<{
  steps: Array<{ stepId: string; taskDisplayId: string; status: TaskStatus }>;
  progress: { total: number; done: number; pruned: number; active: number; pending: number };
}> {
  const instanceResult = getInstanceByDisplayId(db, instanceDisplayId);
  if (!instanceResult.ok) return instanceResult;

  const instanceNote = instanceResult.data.note;
  const relations = db.getRelationsFrom(instanceNote.id);
  const expandsToRelations = relations.filter((r) => r.type === 'expands-to');

  if (expandsToRelations.length === 0) {
    return ok({
      steps: [],
      progress: { total: 0, done: 0, pruned: 0, active: 0, pending: 0 },
    });
  }

  const childIds = expandsToRelations.map((r) => r.targetId);
  const childNotes = db.getNotesByIds(childIds);

  const steps: Array<{ stepId: string; taskDisplayId: string; status: TaskStatus }> = [];
  let done = 0;
  let pruned = 0;
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
    progress: { total: steps.length, done, pruned, active, pending },
  });
}
