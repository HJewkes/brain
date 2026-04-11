import type { BrainDB } from '../../../services/brain-db.js';
import type { BrainConfig, Embedder } from '../../../types.js';
import { createActivityNote } from '../../pm/engine/activity.js';
import type { LinkResult } from './linker.js';

export interface TaskUpdateResult {
  updatedTasks: string[];
  contextNotes: string[];
}

interface SessionOutcomeContext {
  sessionId: string;
  outcome: 'success' | 'partial' | 'abandoned' | 'unknown';
  summary?: string;
  errorRate: number;
}

/**
 * After session commit, update PM tasks with context from the session outcome.
 * For tasks worked but not completed:
 * - Success outcome: add context note indicating work appears complete
 * - Partial/abandoned: add context note explaining friction or abandonment
 */
export async function updateTasksFromSessionOutcome(
  db: BrainDB,
  config: BrainConfig,
  embedder: Embedder,
  links: LinkResult,
  context: SessionOutcomeContext
): Promise<TaskUpdateResult> {
  const result: TaskUpdateResult = { updatedTasks: [], contextNotes: [] };

  const incompleteTasks = links.tasksWorked.filter((id) => !links.tasksCompleted.includes(id));

  if (incompleteTasks.length === 0) return result;

  for (const taskDisplayId of incompleteTasks) {
    const taskInfo = resolveTaskNote(db, taskDisplayId);
    if (!taskInfo) continue;

    const summary = buildContextSummary(context);
    if (!summary) continue;

    const noteId = await createActivityNote(db, config, embedder, {
      project: taskInfo.project,
      activityType: 'session-update',
      taskDisplayId,
      taskNoteId: taskInfo.noteId,
      fromState: taskInfo.status,
      toState: taskInfo.status,
      summary,
    });

    result.updatedTasks.push(taskDisplayId);
    result.contextNotes.push(noteId);
  }

  return result;
}

function buildContextSummary(context: SessionOutcomeContext): string | null {
  const sessionRef = `Session ${context.sessionId.slice(0, 16)}`;

  switch (context.outcome) {
    case 'success':
      return [
        `${sessionRef} worked on this task and ended successfully.`,
        context.summary ? `Summary: ${context.summary}` : '',
        'Task was not explicitly marked done — verify completion and update status.',
      ]
        .filter(Boolean)
        .join('\n');

    case 'partial':
      return [
        `${sessionRef} worked on this task but only achieved partial progress.`,
        context.summary ? `Summary: ${context.summary}` : '',
        context.errorRate > 0.1 ? `Error rate: ${(context.errorRate * 100).toFixed(0)}%` : '',
      ]
        .filter(Boolean)
        .join('\n');

    case 'abandoned':
      return [
        `${sessionRef} attempted this task but the session was abandoned.`,
        context.summary ? `Summary: ${context.summary}` : '',
        context.errorRate > 0.1 ? `Error rate: ${(context.errorRate * 100).toFixed(0)}%` : '',
        'Review what blocked progress before resuming.',
      ]
        .filter(Boolean)
        .join('\n');

    case 'unknown':
      return null;
  }
}

interface TaskNoteInfo {
  noteId: string;
  project: string;
  status: string;
}

function resolveTaskNote(db: BrainDB, displayId: string): TaskNoteInfo | null {
  const noteIds = db.getModuleNoteIds({ module: 'pm', type: 'task' });
  if (noteIds.length === 0) return null;

  const notes = db.getNotesByIds(noteIds);
  for (const [, note] of notes) {
    if (!note.metadata) continue;
    const meta = JSON.parse(note.metadata) as Record<string, unknown>;
    if (meta.display_id === displayId) {
      return {
        noteId: note.id,
        project: meta.project as string,
        status: meta.status as string,
      };
    }
  }
  return null;
}
