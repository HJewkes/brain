/**
 * Failure cleanup — releases stuck tasks when a workflow fails.
 *
 * Tasks created by workflow steps that are in 'claimed' status get
 * moved back to 'pending' so they don't stay locked forever.
 */

import type { BrainDB } from '../../../services/brain-db.js';
import type { BrainConfig, Embedder } from '../../../types.js';
import type { WorkflowRun } from './types.js';
import { updateTaskStatus } from '../../pm/data/task-ops.js';

/** Extract task display IDs from workflow step results. */
function extractTaskIds(run: WorkflowRun): string[] {
  const taskIds: string[] = [];
  for (const result of Object.values(run.stepResults)) {
    if (result.taskId && !result.taskId.startsWith('seed:')) {
      taskIds.push(result.taskId);
    }
  }
  for (const slot of Object.values(run.activeAgents)) {
    if (slot.taskId) taskIds.push(slot.taskId);
  }
  return [...new Set(taskIds)];
}

/** Release claimed tasks back to pending for a failed workflow run. */
export async function releaseWorkflowTasks(
  db: BrainDB,
  config: BrainConfig,
  embedder: Embedder | undefined,
  run: WorkflowRun
): Promise<number> {
  if (!embedder) return 0;

  const taskIds = extractTaskIds(run);
  let released = 0;

  for (const taskId of taskIds) {
    try {
      const result = await updateTaskStatus(db, config, embedder, taskId, 'pending');
      if (result.ok) released++;
    } catch {
      // Individual task release failure is non-fatal
    }
  }

  return released;
}
