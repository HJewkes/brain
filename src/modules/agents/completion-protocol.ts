import type { BrainDB } from '../../services/brain-db.js';
import type { BrainConfig, Embedder } from '../../types.js';
import { updateTaskStatus, getTask } from '../pm/data/task-ops.js';
import { computeImpact } from '../pm/engine/dependency.js';
import type { TaskStatus } from '../pm/types.js';

export type CompletionStatus = 'done' | 'failed';

export interface CompletionMessage {
  status: CompletionStatus;
  taskId: string;
  summary: string;
}

export interface CompletionResult {
  taskId: string;
  status: CompletionStatus;
  summary: string;
  newlyEligible: string[];
}

/**
 * Parse a worker completion message.
 * Expected formats:
 *   DONE <TASK_ID> [summary]
 *   FAILED <TASK_ID> [reason]
 */
export function parseCompletionMessage(message: string): CompletionMessage | null {
  const trimmed = message.trim();

  const doneMatch = trimmed.match(/^DONE\s+(\S+)\s*(.*)/s);
  if (doneMatch) {
    return {
      status: 'done',
      taskId: doneMatch[1],
      summary: doneMatch[2].trim(),
    };
  }

  const failedMatch = trimmed.match(/^FAILED\s+(\S+)\s*(.*)/s);
  if (failedMatch) {
    return {
      status: 'failed',
      taskId: failedMatch[1],
      summary: failedMatch[2].trim(),
    };
  }

  return null;
}

/**
 * Handle a parsed completion message: update task state and compute impact.
 */
export async function handleCompletion(
  db: BrainDB,
  config: BrainConfig,
  embedder: Embedder,
  message: CompletionMessage
): Promise<CompletionResult> {
  const taskResult = getTask(db, message.taskId);
  if (!taskResult.ok) {
    return {
      taskId: message.taskId,
      status: message.status,
      summary: `Task not found: ${message.taskId}`,
      newlyEligible: [],
    };
  }

  if (message.status === 'done') {
    return handleDone(db, config, embedder, message, taskResult.data.project);
  }

  return handleFailed(db, config, embedder, message);
}

async function handleDone(
  db: BrainDB,
  config: BrainConfig,
  embedder: Embedder,
  message: CompletionMessage,
  project: string
): Promise<CompletionResult> {
  const result = await updateTaskStatus(db, config, embedder, message.taskId, 'done' as TaskStatus);

  if (!result.ok) {
    return {
      taskId: message.taskId,
      status: 'done',
      summary: `Failed to mark done: ${result.error.message}`,
      newlyEligible: [],
    };
  }

  const newlyEligible = computeImpact(db, project, message.taskId);

  return {
    taskId: message.taskId,
    status: 'done',
    summary: message.summary,
    newlyEligible,
  };
}

async function handleFailed(
  db: BrainDB,
  config: BrainConfig,
  embedder: Embedder,
  message: CompletionMessage
): Promise<CompletionResult> {
  await updateTaskStatus(db, config, embedder, message.taskId, 'blocked' as TaskStatus);

  return {
    taskId: message.taskId,
    status: 'failed',
    summary: message.summary,
    newlyEligible: [],
  };
}

/**
 * Check if a message looks like a completion protocol message.
 */
export function isCompletionMessage(message: string): boolean {
  return /^(DONE|FAILED)\s+\S+/i.test(message.trim());
}
