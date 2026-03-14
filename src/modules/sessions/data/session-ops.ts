import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import type { BrainDB } from '../../../services/brain-db.js';
import type { BrainConfig, Embedder, NoteRecord } from '../../../types.js';
import type {
  SessionMetadata,
  SessionStatus,
  CreateSessionInput,
  SessionListFilters,
} from '../types.js';
import type { StructuralEvent } from '../structural-events.js';
import type { Result } from '../errors.js';
import { ok, fail } from '../errors.js';
import { indexSingleFile } from '../../../services/indexing.js';

let sessionCounter = 0;

function nextDisplayId(db: BrainDB): string {
  const noteIds = db.getModuleNoteIds({ module: 'sessions', type: 'session' });
  const maxNum = noteIds.length > 0 ? noteIds.length : sessionCounter;
  sessionCounter = maxNum + 1;
  return `SNS-${String(sessionCounter).padStart(3, '0')}`;
}

function sessionFilePath(config: BrainConfig, displayId: string): string {
  return join(config.notesDir, 'modules', 'sessions', `${displayId}.md`);
}

function sessionContentDirPath(config: BrainConfig, displayId: string): string {
  return join(config.notesDir, 'modules', 'sessions', displayId);
}

function buildSessionMarkdown(input: CreateSessionInput, displayId: string): string {
  const now = new Date().toISOString().slice(0, 10);
  const errorRate =
    input.analytics?.tool_calls && input.analytics.tool_calls > 0
      ? ((input.analytics?.error_count ?? 0) / input.analytics.tool_calls).toFixed(4)
      : '0';

  const lines = [
    '---',
    `id: ${displayId.toLowerCase()}-session`,
    `title: "Session ${displayId}"`,
    'type: session',
    'tier: slow',
    'module: sessions',
    `session_id: ${input.session_id}`,
    `display_id: ${displayId}`,
    `project_dir: "${input.project_dir}"`,
    `status: ${input.status}`,
    `started_at: "${input.started_at}"`,
  ];

  if (input.completed_at) lines.push(`completed_at: "${input.completed_at}"`);
  if (input.duration_minutes != null) lines.push(`duration_minutes: ${input.duration_minutes}`);
  if (input.branch) lines.push(`branch: ${input.branch}`);
  if (input.worktree_path) lines.push(`worktree_path: "${input.worktree_path}"`);
  if (input.agent_model) lines.push(`agent_model: ${input.agent_model}`);
  if (input.mode) lines.push(`mode: ${input.mode}`);
  if (input.compact_count != null) lines.push(`compact_count: ${input.compact_count}`);
  if (input.summary) lines.push(`summary: "${input.summary.replace(/"/g, '\\"')}"`);

  if (input.analytics) {
    const a = input.analytics;
    if (a.total_turns != null) lines.push(`total_turns: ${a.total_turns}`);
    if (a.tool_calls != null) lines.push(`tool_calls: ${a.tool_calls}`);
    if (a.error_count != null) lines.push(`error_count: ${a.error_count}`);
    lines.push(`error_rate: ${errorRate}`);
    if (a.tokens_input != null) lines.push(`tokens_input: ${a.tokens_input}`);
    if (a.tokens_output != null) lines.push(`tokens_output: ${a.tokens_output}`);
  }

  if (input.tasks_worked?.length) {
    lines.push('tasks_worked:');
    for (const t of input.tasks_worked) lines.push(`  - ${t}`);
  }
  if (input.tasks_completed?.length) {
    lines.push('tasks_completed:');
    for (const t of input.tasks_completed) lines.push(`  - ${t}`);
  }
  if (input.commits?.length) {
    lines.push('commits:');
    for (const c of input.commits) lines.push(`  - ${c}`);
  }
  if (input.plan_id) lines.push(`plan_id: ${input.plan_id}`);

  if (input.l1Content || input.l2Content || input.observationsContent) {
    lines.push(`content-dir: modules/sessions/${displayId}`);
  }

  lines.push(`created: ${now}`, `modified: ${now}`, '---', '', `# Session ${displayId}`, '');

  if (input.summary) {
    lines.push(input.summary, '');
  }

  return lines.join('\n');
}

export async function createSession(
  db: BrainDB,
  config: BrainConfig,
  embedder: Embedder,
  input: CreateSessionInput
): Promise<Result<{ display_id: string; note_id: string }>> {
  if (!input.session_id) {
    return fail('INVALID_INPUT', 'session_id is required');
  }
  if (!input.started_at) {
    return fail('INVALID_INPUT', 'started_at is required');
  }

  // Check for duplicate
  const existing = getSessionBySessionId(db, input.session_id);
  if (existing) {
    return fail(
      'DUPLICATE_SESSION',
      `Session ${input.session_id} already ingested as ${existing.display_id}`
    );
  }

  const displayId = nextDisplayId(db);
  const filePath = sessionFilePath(config, displayId);
  const content = buildSessionMarkdown(input, displayId);

  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, content, 'utf-8');

  // Write L1/L2 content files if provided
  if (input.l1Content || input.l2Content || input.observationsContent) {
    const contentDir = sessionContentDirPath(config, displayId);
    mkdirSync(contentDir, { recursive: true });
    if (input.l1Content)
      writeFileSync(join(contentDir, 'l1-overview.md'), input.l1Content, 'utf-8');
    if (input.l2Content)
      writeFileSync(join(contentDir, 'l2-timeline.md'), input.l2Content, 'utf-8');
    if (input.observationsContent)
      writeFileSync(join(contentDir, 'observations.md'), input.observationsContent, 'utf-8');
  }

  const hash = createHash('sha256').update(content).digest('hex');
  const noteId = await indexSingleFile(db, embedder, filePath, content, hash, Date.now());

  return ok({ display_id: displayId, note_id: noteId });
}

export function getSessionBySessionId(db: BrainDB, sessionId: string): SessionMetadata | null {
  const noteIds = db.getModuleNoteIds({ module: 'sessions', type: 'session' });
  if (noteIds.length === 0) return null;

  const notes = db.getNotesByIds(noteIds);
  for (const [, note] of notes) {
    if (!note.metadata) continue;
    const meta = JSON.parse(note.metadata) as Record<string, unknown>;
    if (meta.session_id === sessionId) {
      return noteToSessionMetadata(meta);
    }
  }
  return null;
}

export function getSession(db: BrainDB, displayId: string): SessionMetadata | null {
  const noteIds = db.getModuleNoteIds({ module: 'sessions', type: 'session' });
  if (noteIds.length === 0) return null;

  const notes = db.getNotesByIds(noteIds);
  for (const [, note] of notes) {
    if (!note.metadata) continue;
    const meta = JSON.parse(note.metadata) as Record<string, unknown>;
    if (meta.display_id === displayId) {
      return noteToSessionMetadata(meta);
    }
  }
  return null;
}

export function listSessions(db: BrainDB, filters?: SessionListFilters): SessionMetadata[] {
  const noteIds = db.getModuleNoteIds({ module: 'sessions', type: 'session' });
  if (noteIds.length === 0) return [];

  const notes = db.getNotesByIds(noteIds);
  const results: SessionMetadata[] = [];

  for (const [, note] of notes) {
    if (!note.metadata) continue;
    const meta = JSON.parse(note.metadata) as Record<string, unknown>;

    if (filters) {
      if (filters.status && meta.status !== filters.status) continue;
      if (filters.projectDir && meta.project_dir !== filters.projectDir) continue;
      if (filters.project && meta.project !== filters.project) continue;
      if (filters.since && (meta.started_at as string) < filters.since) continue;
    }

    results.push(noteToSessionMetadata(meta));
  }

  return results.sort(
    (a, b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime()
  );
}

export function updateSessionStatus(
  db: BrainDB,
  displayId: string,
  status: SessionStatus,
  updates?: Partial<Pick<SessionMetadata, 'completed_at' | 'duration_minutes' | 'summary'>>
): Result<SessionMetadata> {
  const noteIds = db.getModuleNoteIds({ module: 'sessions', type: 'session' });
  const notes = db.getNotesByIds(noteIds);

  for (const [, note] of notes) {
    if (!note.metadata) continue;
    const meta = JSON.parse(note.metadata) as Record<string, unknown>;
    if (meta.display_id !== displayId) continue;

    meta.status = status;
    if (updates?.completed_at) meta.completed_at = updates.completed_at;
    if (updates?.duration_minutes != null) meta.duration_minutes = updates.duration_minutes;
    if (updates?.summary) meta.summary = updates.summary;
    meta.modified = new Date().toISOString().slice(0, 10);

    const updated = { ...note, metadata: JSON.stringify(meta) };
    db.upsertNote(updated);
    return ok(noteToSessionMetadata(meta));
  }

  return fail('NOT_FOUND', `Session ${displayId} not found`);
}

export function getSessionsForTask(db: BrainDB, taskDisplayId: string): SessionMetadata[] {
  const noteIds = db.getModuleNoteIds({ module: 'sessions', type: 'session' });
  if (noteIds.length === 0) return [];

  const notes = db.getNotesByIds(noteIds);
  const results: SessionMetadata[] = [];

  for (const [, note] of notes) {
    if (!note.metadata) continue;
    const meta = JSON.parse(note.metadata) as Record<string, unknown>;
    const worked = meta.tasks_worked as string[] | undefined;
    const completed = meta.tasks_completed as string[] | undefined;
    if (worked?.includes(taskDisplayId) || completed?.includes(taskDisplayId)) {
      results.push(noteToSessionMetadata(meta));
    }
  }

  return results;
}

export function linkSessionToTask(
  db: BrainDB,
  sessionDisplayId: string,
  taskDisplayId: string
): Result<void> {
  const sessionNoteIds = db.getModuleNoteIds({ module: 'sessions', type: 'session' });
  const sessionNotes = db.getNotesByIds(sessionNoteIds);
  let sessionNoteId: string | null = null;

  for (const [noteId, note] of sessionNotes) {
    if (!note.metadata) continue;
    const meta = JSON.parse(note.metadata) as Record<string, unknown>;
    if (meta.display_id === sessionDisplayId) {
      sessionNoteId = noteId;

      // Update tasks_worked in metadata
      const worked = (meta.tasks_worked as string[]) ?? [];
      if (!worked.includes(taskDisplayId)) {
        worked.push(taskDisplayId);
        meta.tasks_worked = worked;
        db.upsertNote({ ...note, metadata: JSON.stringify(meta) });
      }
      break;
    }
  }

  if (!sessionNoteId) {
    return fail('NOT_FOUND', `Session ${sessionDisplayId} not found`);
  }

  // Find task note and create relation
  const taskNoteIds = db.getModuleNoteIds({ module: 'pm', type: 'task' });
  const taskNotes = db.getNotesByIds(taskNoteIds);
  for (const [taskNoteId, taskNote] of taskNotes) {
    if (!taskNote.metadata) continue;
    const taskMeta = JSON.parse(taskNote.metadata) as Record<string, unknown>;
    if (taskMeta.display_id === taskDisplayId) {
      db.upsertRelations(sessionNoteId, [
        { sourceId: sessionNoteId, targetId: taskNoteId, type: 'associated-with' },
      ]);
      return ok(undefined);
    }
  }

  // Task not found in PM — still update metadata, just skip relation
  return ok(undefined);
}

function noteToSessionMetadata(meta: Record<string, unknown>): SessionMetadata {
  return {
    session_id: meta.session_id as string,
    display_id: meta.display_id as string,
    project_dir: meta.project_dir as string,
    project: meta.project as string | undefined,
    workstream: meta.workstream as string | undefined,
    status: meta.status as SessionStatus,
    started_at: meta.started_at as string,
    completed_at: meta.completed_at as string | undefined,
    duration_minutes: meta.duration_minutes as number | undefined,
    branch: meta.branch as string | undefined,
    worktree_path: meta.worktree_path as string | undefined,
    agent_model: meta.agent_model as string | undefined,
    mode: meta.mode as string | undefined,
    compact_count: meta.compact_count as number | undefined,
    summary: meta.summary as string | undefined,
    micro_summary_count: meta.micro_summary_count as number | undefined,
    last_captured_at: meta.last_captured_at as string | undefined,
    total_turns: meta.total_turns as number | undefined,
    tool_calls: meta.tool_calls as number | undefined,
    error_count: meta.error_count as number | undefined,
    error_rate: meta.error_rate as number | undefined,
    tokens_input: meta.tokens_input as number | undefined,
    tokens_output: meta.tokens_output as number | undefined,
    tasks_worked: meta.tasks_worked as string[] | undefined,
    tasks_completed: meta.tasks_completed as string[] | undefined,
    notes_created: meta.notes_created as string[] | undefined,
    commits: meta.commits as string[] | undefined,
    memories_extracted: meta.memories_extracted as number | undefined,
    plan_id: meta.plan_id as string | undefined,
  };
}

// --- Structural Events ---

type RawDb = {
  prepare: (sql: string) => {
    run: (...args: unknown[]) => void;
    all: (...args: unknown[]) => unknown[];
  };
};

function getRawDb(db: BrainDB): RawDb {
  return (db as unknown as { db: RawDb }).db;
}

export function upsertStructuralEvent(db: BrainDB, event: StructuralEvent): void {
  getRawDb(db)
    .prepare(
      `INSERT OR IGNORE INTO structural_events (id, session_id, event_type, detail, file_path, timestamp)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(
      event.id,
      event.sessionId,
      event.eventType,
      event.detail,
      event.filePath ?? null,
      event.timestamp
    );
}

interface StructuralEventRow {
  id: string;
  session_id: string;
  event_type: string;
  detail: string;
  file_path: string | null;
  timestamp: string;
}

function rowToStructuralEvent(r: StructuralEventRow): StructuralEvent {
  return {
    id: r.id,
    sessionId: r.session_id,
    eventType: r.event_type as StructuralEvent['eventType'],
    detail: r.detail,
    filePath: r.file_path ?? undefined,
    timestamp: r.timestamp,
  };
}

export function getStructuralEvents(
  db: BrainDB,
  sessionId: string,
  limit?: number
): StructuralEvent[] {
  const sql = limit
    ? 'SELECT * FROM structural_events WHERE session_id = ? ORDER BY timestamp ASC LIMIT ?'
    : 'SELECT * FROM structural_events WHERE session_id = ? ORDER BY timestamp ASC';
  const params = limit ? [sessionId, limit] : [sessionId];
  const rows = getRawDb(db)
    .prepare(sql)
    .all(...params) as StructuralEventRow[];
  return rows.map(rowToStructuralEvent);
}

export function getSessionNotes(db: BrainDB, filters?: Record<string, unknown>): NoteRecord[] {
  const noteIds = db.getModuleNoteIds({ module: 'sessions', type: 'session' });
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
    if (matches) results.push(note);
  }
  return results;
}
