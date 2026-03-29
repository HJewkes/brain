import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import type Database from 'better-sqlite3';
import type { BrainDB } from '../../../services/brain-db.js';
import {
  discoverSessions,
  type DiscoveredSession,
  type DiscoveryOptions,
} from '../../sessions/ingestion/discovery.js';

function getRawDb(db: BrainDB): Database.Database {
  return (db as unknown as { db: Database.Database }).db;
}

export interface UnreviewedSession extends DiscoveredSession {
  ageHours: number;
}

/**
 * Find sessions that have JSONL files but have NOT been committed to the brain.
 * These are the sessions the autoloop should review.
 */
export function findUnreviewedSessions(
  db: BrainDB,
  opts?: DiscoveryOptions & { minAgeHours?: number }
): UnreviewedSession[] {
  const all = discoverSessions(opts);
  const now = Date.now();
  const minAgeMs = (opts?.minAgeHours ?? 1) * 60 * 60 * 1000;

  const committed = getCommittedSessionIds(db);

  return all
    .filter((s) => {
      if (committed.has(s.sessionId)) return false;
      const age = now - s.mtimeMs;
      return age >= minAgeMs;
    })
    .map((s) => ({
      ...s,
      ageHours: Math.round((now - s.mtimeMs) / (60 * 60 * 1000)),
    }))
    .sort((a, b) => a.mtimeMs - b.mtimeMs);
}

/**
 * Find sessions committed to the brain but not yet reviewed by the autoloop.
 */
export function findUnreviewedCommittedSessions(
  db: BrainDB,
  opts?: { since?: Date; limit?: number }
): Array<{ sessionId: string; displayId: string; startedAt: string }> {
  const rawDb = getRawDb(db);
  const sinceStr = opts?.since?.toISOString() ?? '1970-01-01T00:00:00Z';
  const limit = opts?.limit ?? 50;

  const rows = rawDb
    .prepare(
      `SELECT
         json_extract(metadata, '$.session_id') as session_id,
         json_extract(metadata, '$.display_id') as display_id,
         json_extract(metadata, '$.started_at') as started_at
       FROM notes
       WHERE module = 'sessions'
         AND type = 'session'
         AND json_extract(metadata, '$.started_at') > ?
         AND id NOT IN (
           SELECT target_id FROM relations
           WHERE type = 'reviewed-in'
         )
       ORDER BY json_extract(metadata, '$.started_at') ASC
       LIMIT ?`
    )
    .all(sinceStr, limit) as Array<{
    session_id: string;
    display_id: string;
    started_at: string;
  }>;

  return rows.map((r) => ({
    sessionId: r.session_id,
    displayId: r.display_id,
    startedAt: r.started_at,
  }));
}

function getCommittedSessionIds(db: BrainDB): Set<string> {
  const rawDb = getRawDb(db);
  const rows = rawDb
    .prepare(
      `SELECT json_extract(metadata, '$.session_id') as sid
       FROM notes
       WHERE module = 'sessions' AND type = 'session'`
    )
    .all() as Array<{ sid: string }>;

  return new Set(rows.map((r) => r.sid));
}

/** Conversation turn extracted from a JSONL session file */
export interface TranscriptTurn {
  role: 'user' | 'assistant' | 'tool_use' | 'tool_result';
  content: string;
  toolName?: string;
  timestamp?: string;
}

/**
 * Read a session JSONL file and extract a simplified transcript
 * suitable for LLM-based insight extraction.
 * Caps output to maxTokenEstimate characters (~4 chars per token).
 */
export async function readSessionTranscript(
  filePath: string,
  opts?: { maxTokenEstimate?: number }
): Promise<TranscriptTurn[]> {
  const maxChars = (opts?.maxTokenEstimate ?? 8000) * 4;
  const turns: TranscriptTurn[] = [];
  let totalChars = 0;

  const rl = createInterface({
    input: createReadStream(filePath, { encoding: 'utf-8' }),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    if (totalChars >= maxChars) break;

    const trimmed = line.trim();
    if (!trimmed) continue;

    let event: Record<string, unknown>;
    try {
      event = JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      continue;
    }

    const turn = extractTurn(event);
    if (!turn) continue;

    // Truncate long content
    if (turn.content.length > 2000) {
      turn.content = turn.content.slice(0, 2000) + '…';
    }

    totalChars += turn.content.length;
    turns.push(turn);
  }

  return turns;
}

function extractTurn(event: Record<string, unknown>): TranscriptTurn | null {
  const type = event.type as string | undefined;
  const role = event.role as string | undefined;

  if (type === 'human' || role === 'human' || role === 'user') {
    const content = extractContent(event);
    if (!content) return null;
    return { role: 'user', content, timestamp: event.timestamp as string };
  }

  if (type === 'assistant' || role === 'assistant') {
    const content = extractContent(event);
    if (!content) return null;
    return { role: 'assistant', content, timestamp: event.timestamp as string };
  }

  if (type === 'tool_use') {
    const name = (event.name ?? event.tool_name ?? 'unknown') as string;
    const input = event.input as Record<string, unknown> | undefined;
    const summary = input
      ? Object.entries(input)
          .map(([k, v]) => `${k}: ${String(v).slice(0, 100)}`)
          .join(', ')
      : '';
    return {
      role: 'tool_use',
      content: `[${name}] ${summary}`.slice(0, 500),
      toolName: name,
      timestamp: event.timestamp as string,
    };
  }

  if (type === 'tool_result') {
    const content = extractContent(event);
    if (!content) return null;
    return {
      role: 'tool_result',
      content: content.slice(0, 500),
      timestamp: event.timestamp as string,
    };
  }

  return null;
}

function extractContent(event: Record<string, unknown>): string | null {
  if (typeof event.content === 'string') return event.content;
  if (typeof event.message === 'string') return event.message;

  if (Array.isArray(event.content)) {
    const texts = (event.content as Array<{ type?: string; text?: string }>)
      .filter((c) => c.type === 'text' && c.text)
      .map((c) => c.text!);
    return texts.length > 0 ? texts.join('\n') : null;
  }

  return null;
}
