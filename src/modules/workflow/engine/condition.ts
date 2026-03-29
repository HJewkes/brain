import type { BrainDB } from '../../../services/brain-db.js';
import { ok, fail, type Result } from '../../../errors.js';
import { getInstanceByDisplayId } from '../data/queries.js';

export interface ConditionSignal {
  instanceDisplayId: string;
  stepId: string;
  condition: string;
}

function findStepTaskNote(
  db: BrainDB,
  instanceDisplayId: string,
  stepId: string
): { id: string; meta: Record<string, unknown> } | undefined {
  const instanceResult = getInstanceByDisplayId(db, instanceDisplayId);
  if (!instanceResult.ok) return undefined;

  const instanceNote = instanceResult.data.note;
  const relations = db.getRelationsFrom(instanceNote.id);
  const childIds = relations.filter((r) => r.type === 'expands-to').map((r) => r.targetId);
  const childNotes = db.getNotesByIds(childIds);

  for (const [, note] of childNotes) {
    if (!note.metadata) continue;
    const meta = JSON.parse(note.metadata) as Record<string, unknown>;
    if ((meta.step_id as string) === stepId) {
      return { id: note.id, meta };
    }
  }
  return undefined;
}

/** Write a condition signal to step task metadata */
export function signalCondition(
  db: BrainDB,
  instanceDisplayId: string,
  stepId: string,
  condition: string
): Result<ConditionSignal> {
  const found = findStepTaskNote(db, instanceDisplayId, stepId);
  if (!found) {
    return fail('NOT_FOUND', `Step "${stepId}" not found in instance "${instanceDisplayId}"`);
  }

  const { id, meta } = found;
  if (meta.status === 'done' || meta.status === 'pruned' || meta.status === 'cancelled') {
    return fail('INVALID_STATE', `Cannot signal condition on a completed step "${stepId}"`);
  }

  const existing = Array.isArray(meta.condition_signals)
    ? (meta.condition_signals as string[])
    : [];
  const updated = existing.includes(condition) ? existing : [...existing, condition];
  db.upsertNote({
    ...db.getNoteById(id)!,
    metadata: JSON.stringify({ ...meta, condition_signals: updated }),
  });

  return ok({ instanceDisplayId, stepId, condition });
}

/** Read active condition signals for a step */
export function getConditionSignals(
  db: BrainDB,
  instanceDisplayId: string,
  stepId: string
): string[] {
  const found = findStepTaskNote(db, instanceDisplayId, stepId);
  if (!found) return [];

  const { meta } = found;
  return Array.isArray(meta.condition_signals) ? (meta.condition_signals as string[]) : [];
}
