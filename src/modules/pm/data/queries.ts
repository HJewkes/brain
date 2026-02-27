import type { BrainDB } from '../../../services/brain-db.js';
import type { NoteRecord } from '../../../types.js';
import type { Result } from '../errors.js';
import { ok, fail } from '../errors.js';

const PM_ACTIVE_PROJECT_KEY = 'pm_active_project';

export function resolveDisplayId(db: BrainDB, displayId: string): Result<string> {
  const noteIds = db.getModuleNoteIds({ module: 'pm' });
  if (noteIds.length === 0) {
    return fail('NOT_FOUND', `No PM note found with display ID "${displayId}"`);
  }

  const notes = db.getNotesByIds(noteIds);
  for (const [, note] of notes) {
    if (!note.metadata) continue;
    const meta = JSON.parse(note.metadata) as Record<string, unknown>;
    if (meta.display_id === displayId) {
      return ok(note.id);
    }
  }

  return fail('NOT_FOUND', `No PM note found with display ID "${displayId}"`);
}

export function getProjectNotes(db: BrainDB, prefix: string): NoteRecord[] {
  const noteIds = db.getModuleNoteIds({ module: 'pm' });
  if (noteIds.length === 0) return [];

  const notes = db.getNotesByIds(noteIds);
  const results: NoteRecord[] = [];

  for (const [, note] of notes) {
    if (!note.metadata) continue;
    const meta = JSON.parse(note.metadata) as Record<string, unknown>;
    // Project notes store the prefix in `prefix`; child notes (tasks, workstreams) reference
    // the parent project via `project`. Check both to collect all notes belonging to a project.
    if (meta.project === prefix || meta.prefix === prefix) {
      results.push(note);
    }
  }

  return results;
}

export function getTasksByStatus(db: BrainDB, prefix: string, status: string): NoteRecord[] {
  const noteIds = db.getModuleNoteIds({ module: 'pm', type: 'task' });
  if (noteIds.length === 0) return [];

  const notes = db.getNotesByIds(noteIds);
  const results: NoteRecord[] = [];

  for (const [, note] of notes) {
    if (!note.metadata) continue;
    const meta = JSON.parse(note.metadata) as Record<string, unknown>;
    if (meta.project === prefix && meta.status === status) {
      results.push(note);
    }
  }

  return results;
}

export function getEligibleTasks(db: BrainDB, prefix: string): NoteRecord[] {
  const pendingTasks = getTasksByStatus(db, prefix, 'pending');
  if (pendingTasks.length === 0) return [];

  const allTaskIds = db.getModuleNoteIds({ module: 'pm', type: 'task' });
  const allTaskNotes =
    allTaskIds.length > 0 ? db.getNotesByIds(allTaskIds) : new Map<string, NoteRecord>();

  const doneIds = new Set<string>();
  for (const [, note] of allTaskNotes) {
    if (!note.metadata) continue;
    const meta = JSON.parse(note.metadata) as Record<string, unknown>;
    if (meta.status === 'done') {
      doneIds.add(meta.display_id as string);
    }
  }

  return pendingTasks.filter((task) => {
    const meta = JSON.parse(task.metadata!) as Record<string, unknown>;
    const deps = meta.depends_on as string[] | undefined;
    if (!deps || deps.length === 0) return true;
    return deps.every((dep) => doneIds.has(dep));
  });
}

export function getActiveProject(db: BrainDB): string | null {
  return db.getMetaValue(PM_ACTIVE_PROJECT_KEY);
}

export function setActiveProject(db: BrainDB, prefix: string): void {
  db.setMetaValue(PM_ACTIVE_PROJECT_KEY, prefix);
}

export function getPmNotes(
  db: BrainDB,
  type: string,
  filters?: Record<string, unknown>
): NoteRecord[] {
  const noteIds = db.getModuleNoteIds({ module: 'pm', type });
  if (noteIds.length === 0) return [];

  const notes = db.getNotesByIds(noteIds);

  if (!filters || Object.keys(filters).length === 0) {
    return [...notes.values()];
  }

  const results: NoteRecord[] = [];
  for (const [, note] of notes) {
    if (!note.metadata) continue;
    const meta = JSON.parse(note.metadata) as Record<string, unknown>;
    const matches = Object.entries(filters).every(([key, value]) => meta[key] === value);
    if (matches) {
      results.push(note);
    }
  }

  return results;
}
