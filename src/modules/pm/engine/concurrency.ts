import type { BrainDB } from '../../../services/brain-db.js';
import { parseDisplayId } from '../ids.js';
import { listTasks } from '../data/task-ops.js';

export interface ConcurrencyCheck {
  allowed: boolean;
  blockingTask?: string;
}

export function checkWorkstreamConcurrency(db: BrainDB, taskDisplayId: string): ConcurrencyCheck {
  const parsed = parseDisplayId(taskDisplayId);
  if (!parsed || parsed.workstream === undefined) {
    return { allowed: true };
  }

  const result = listTasks(
    db,
    parsed.prefix,
    {
      workstream: parsed.workstream,
      status: 'in-progress',
    },
    'short'
  );

  if (!result.ok) {
    return { allowed: true };
  }

  const blocking = result.data.find((t) => t.display_id !== taskDisplayId);
  if (blocking) {
    return { allowed: false, blockingTask: blocking.display_id };
  }

  return { allowed: true };
}
