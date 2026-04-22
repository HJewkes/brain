import type { BrainDB } from '../../../services/brain-db.js';
import { getPmNotes } from '../data/queries.js';
import { readTaskBody } from './dispatch.js';
import type { TaskMetadata } from '../types.js';

export interface FileCollision {
  /** The file or directory path two or more tasks reference. */
  pattern: string;
  /** Display IDs of tasks that reference the path. */
  taskIds: string[];
}

/**
 * Extract file/directory path references from task text.
 * Matches top-level dirs like `src/`, `__tests__/`, `docs/`, `scripts/`, `skill/`, `templates/`.
 * Returns sorted unique paths.
 */
export function extractPathReferences(text: string): string[] {
  const pattern = /(?:^|[\s`([])((?:src|__tests__|templates|docs|scripts|skill)\/[\w./-]+)/g;
  const paths = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    // Strip trailing punctuation that shouldn't be part of the path.
    const cleaned = match[1].replace(/[.,;:)\]]+$/, '');
    if (cleaned.length > 0) paths.add(cleaned);
  }
  return [...paths].sort();
}

function getTaskText(db: BrainDB, taskDisplayId: string): string {
  const notes = getPmNotes(db, 'task', { display_id: taskDisplayId });
  if (notes.length === 0) return '';
  const meta = JSON.parse(notes[0].metadata!) as TaskMetadata;
  const body = readTaskBody(notes[0]);
  return [meta.title ?? '', body].join('\n');
}

/**
 * Given a set of concurrent tasks, detect shared file/directory references.
 * Returns one entry per overlapping path, listing the tasks that claim it.
 */
export function detectFileCollisions(db: BrainDB, taskDisplayIds: string[]): FileCollision[] {
  const pathToTasks = new Map<string, Set<string>>();

  for (const taskId of taskDisplayIds) {
    const text = getTaskText(db, taskId);
    if (!text) continue;
    const paths = extractPathReferences(text);
    for (const path of paths) {
      let owners = pathToTasks.get(path);
      if (!owners) {
        owners = new Set<string>();
        pathToTasks.set(path, owners);
      }
      owners.add(taskId);
    }
  }

  const collisions: FileCollision[] = [];
  for (const [pattern, taskSet] of pathToTasks) {
    if (taskSet.size > 1) {
      collisions.push({ pattern, taskIds: [...taskSet].sort() });
    }
  }

  collisions.sort((a, b) => a.pattern.localeCompare(b.pattern));
  return collisions;
}
