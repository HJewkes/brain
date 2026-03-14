import { execFileSync } from 'node:child_process';
import type { BrainDB } from '../../services/brain-db.js';
import type { TaskMetadata } from '../pm/types.js';
import { getPmNotes } from '../pm/data/queries.js';

export interface StalledTaskInfo {
  displayId: string;
  lastCommitAge: number;
  stalledSince: string;
}

const DEFAULT_THRESHOLD_MINUTES = 30;

/**
 * Find all in-progress tasks and check if they have recent commits.
 * Tasks without a commit mentioning their display_id within the threshold are stalled.
 */
export function detectStalledTasks(
  db: BrainDB,
  projectDir: string,
  thresholdMinutes: number = DEFAULT_THRESHOLD_MINUTES
): StalledTaskInfo[] {
  const inProgressNotes = getInProgressTasks(db);
  const now = new Date();
  const stalled: StalledTaskInfo[] = [];

  for (const meta of inProgressNotes) {
    const age = getLastCommitAgeMinutes(meta.display_id, projectDir, now);
    if (age === null || age >= thresholdMinutes) {
      stalled.push({
        displayId: meta.display_id,
        lastCommitAge: age ?? Infinity,
        stalledSince: now.toISOString(),
      });
    }
  }

  return stalled;
}

/** Return all tasks currently in stalled status. */
export function getStalledTasks(db: BrainDB): StalledTaskInfo[] {
  const notes = getPmNotes(db, 'task', { status: 'stalled' });
  return notes.map((note) => {
    const meta = JSON.parse(note.metadata!) as Record<string, unknown>;
    return {
      displayId: meta.display_id as string,
      lastCommitAge: Infinity,
      stalledSince: (meta.stalled_since as string) ?? new Date().toISOString(),
    };
  });
}

function getInProgressTasks(db: BrainDB): TaskMetadata[] {
  const notes = getPmNotes(db, 'task', { status: 'in-progress' });
  return notes.map((note) => JSON.parse(note.metadata!) as TaskMetadata);
}

/** Get the age in minutes of the most recent commit mentioning a task display ID. */
function getLastCommitAgeMinutes(displayId: string, projectDir: string, now: Date): number | null {
  try {
    const output = execFileSync(
      'git',
      ['log', '-1', '--format=%aI', '--all', '--grep', displayId],
      { cwd: projectDir, encoding: 'utf-8', stdio: 'pipe' }
    );

    const dateStr = output.trim();
    if (!dateStr) return null;

    const commitDate = new Date(dateStr);
    return (now.getTime() - commitDate.getTime()) / (1000 * 60);
  } catch {
    return null;
  }
}
