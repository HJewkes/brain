import type { BrainDB } from '../../../services/brain-db.js';
import type { SessionMetadata, SessionListFilters } from '../types.js';
import { getSession, getSessionBySessionId, listSessions } from '../data/session-ops.js';

export type SessionRef =
  | { type: 'uuid'; sessionId: string }
  | { type: 'display_id'; displayId: string }
  | { type: 'task'; taskId: string }
  | { type: 'yesterday' }
  | { type: 'last' }
  | { type: 'keyword'; query: string };

export function parseSessionRef(raw: string): SessionRef {
  // UUID pattern
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(raw)) {
    return { type: 'uuid', sessionId: raw };
  }
  // Display ID pattern (SNS-NNN)
  if (/^SNS-\d{3,}$/i.test(raw)) {
    return { type: 'display_id', displayId: raw.toUpperCase() };
  }
  // PM task ID pattern
  if (/^[A-Z]{2,6}-\d{2}\.\d{2,3}$/.test(raw)) {
    return { type: 'task', taskId: raw };
  }
  if (raw.toLowerCase() === 'yesterday') return { type: 'yesterday' };
  if (raw.toLowerCase() === 'last') return { type: 'last' };
  return { type: 'keyword', query: raw };
}

export function resolveSessionRef(
  db: BrainDB,
  raw: string,
  opts?: { projectDir?: string }
): SessionMetadata[] {
  const ref = parseSessionRef(raw);

  switch (ref.type) {
    case 'uuid': {
      const s = getSessionBySessionId(db, ref.sessionId);
      return s ? [s] : [];
    }
    case 'display_id': {
      const s = getSession(db, ref.displayId);
      return s ? [s] : [];
    }
    case 'task': {
      const filters: SessionListFilters = {};
      if (opts?.projectDir) filters.projectDir = opts.projectDir;
      const sessions = listSessions(db, filters);
      return sessions.filter(
        (s) => s.tasks_worked?.includes(ref.taskId) || s.tasks_completed?.includes(ref.taskId)
      );
    }
    case 'yesterday': {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      yesterday.setHours(0, 0, 0, 0);
      const filters: SessionListFilters = {
        since: yesterday.toISOString(),
      };
      if (opts?.projectDir) filters.projectDir = opts.projectDir;
      return listSessions(db, filters);
    }
    case 'last': {
      const filters: SessionListFilters = {};
      if (opts?.projectDir) filters.projectDir = opts.projectDir;
      const sessions = listSessions(db, filters);
      return sessions.length > 0 ? [sessions[0]] : [];
    }
    case 'keyword': {
      const all = listSessions(db, opts?.projectDir ? { projectDir: opts.projectDir } : undefined);
      const q = ref.query.toLowerCase();
      return all.filter(
        (s) => s.summary?.toLowerCase().includes(q) || s.branch?.toLowerCase().includes(q)
      );
    }
  }
}
