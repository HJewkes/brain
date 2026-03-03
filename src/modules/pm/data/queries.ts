import type { BrainDB } from '../../../services/brain-db.js';
import type { NoteRecord } from '../../../types.js';
import type { Result } from '../errors.js';
import { ok, fail } from '../errors.js';

const PM_ACTIVE_PROJECT_KEY = 'pm_active_project';

export function resolveDisplayId(db: BrainDB, displayId: string): Result<string> {
  const noteIds = db.getModuleNoteIds({ module: 'pm' });
  if (noteIds.length === 0) {
    return fail('NOT_FOUND', `No PM notes found. Run "brain pm list" to check projects.`);
  }

  const notes = db.getNotesByIds(noteIds);
  const knownPrefixes = new Set<string>();

  for (const [, note] of notes) {
    if (!note.metadata) continue;
    const meta = JSON.parse(note.metadata) as Record<string, unknown>;
    if (meta.display_id === displayId) {
      return ok(note.id);
    }
    if (typeof meta.prefix === 'string') {
      knownPrefixes.add(meta.prefix);
    }
  }

  const prefixList = [...knownPrefixes].sort().join(', ');
  const hint = prefixList
    ? ` Known projects: ${prefixList}. Run "brain pm list" to see all projects.`
    : ' Run "brain pm list" to check available projects.';
  return fail('NOT_FOUND', `No PM note found with display ID "${displayId}".${hint}`);
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

export function resolveProject(
  db: BrainDB,
  explicit: string | undefined
): Result<string> {
  if (explicit) {
    const upper = explicit.toUpperCase();
    const projectNotes = getPmNotes(db, 'project', { prefix: upper });
    if (projectNotes.length === 0) {
      const allProjects = getPmNotes(db, 'project');
      if (allProjects.length > 0) {
        const available = allProjects.map((p) => {
          const m = JSON.parse(p.metadata!) as Record<string, unknown>;
          return m.prefix as string;
        });
        return fail(
          'NOT_FOUND',
          `Project "${upper}" not found. Available projects: ${available.sort().join(', ')}.`
        );
      }
      return fail('NOT_FOUND', `Project "${upper}" not found. No projects exist yet.`);
    }
    return ok(upper);
  }
  const active = getActiveProject(db);
  if (active) return ok(active);

  // Auto-resolve when exactly one project exists
  const projects = getPmNotes(db, 'project');
  if (projects.length === 1) {
    const meta = JSON.parse(projects[0].metadata!) as Record<string, unknown>;
    const prefix = meta.prefix as string;
    setActiveProject(db, prefix);
    return ok(prefix);
  }

  if (projects.length > 1) {
    const prefixes = projects.map((p) => {
      const m = JSON.parse(p.metadata!) as Record<string, unknown>;
      return m.prefix as string;
    });
    return fail(
      'INVALID_INPUT',
      `Multiple projects found: ${prefixes.join(', ')}. Use --project <prefix> or "brain pm use <prefix>".`
    );
  }

  return fail(
    'INVALID_INPUT',
    'No projects found. Run "brain pm onboard <name>" to create one.'
  );
}

export function enrichNotFoundError(
  db: BrainDB,
  displayId: string
): Result<never> {
  // Check if it's a workstream display ID (PREFIX-NN without .MM)
  if (/^[A-Z]+-\d{2}$/.test(displayId)) {
    const wsNotes = getPmNotes(db, 'workstream', { display_id: displayId });
    if (wsNotes.length > 0) {
      return fail(
        'NOT_FOUND',
        `"${displayId}" is a workstream, not a task. Try: brain pm workstream show ${displayId}`
      );
    }
  }
  return fail('NOT_FOUND', `Task "${displayId}" not found`);
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
    const matches = Object.entries(filters).every(([key, value]) => {
      const stored = meta[key];
      if (stored === value) return true;
      // Coerce for numeric fields stored as strings
      if (typeof value === 'number' && String(stored) === String(value)) return true;
      if (typeof stored === 'number' && String(stored) === String(value)) return true;
      return false;
    });
    if (matches) {
      results.push(note);
    }
  }

  return results;
}
