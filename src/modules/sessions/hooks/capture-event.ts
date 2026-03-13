import { createHash } from 'node:crypto';
import type { BrainDB } from '../../../services/brain-db.js';

export interface CaptureEventInput {
  session_id: string;
  event_type: string;
  category?: string;
  data: Record<string, unknown>;
  timestamp: string;
}

export function captureSessionEvent(db: BrainDB, input: CaptureEventInput): void {
  const dataStr = JSON.stringify(input.data);
  const dataHash = createHash('sha256')
    .update(`${input.session_id}:${input.event_type}:${dataStr}`)
    .digest('hex');

  const rawDb = (
    db as unknown as {
      db: {
        prepare: (sql: string) => {
          run: (...args: unknown[]) => void;
        };
      };
    }
  ).db;

  try {
    rawDb
      .prepare(
        `INSERT OR IGNORE INTO session_events (session_id, event_type, category, data, timestamp, data_hash)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(
        input.session_id,
        input.event_type,
        input.category ?? null,
        dataStr,
        input.timestamp,
        dataHash
      );
  } catch {
    // Silently ignore — hook capture should never block
  }
}

export function captureSessionChunk(
  db: BrainDB,
  sessionId: string,
  content: string,
  source: 'compaction' | 'periodic' | 'manual'
): void {
  const rawDb = (
    db as unknown as {
      db: {
        prepare: (sql: string) => {
          get: (...args: unknown[]) => { max_idx: number | null } | undefined;
          run: (...args: unknown[]) => void;
        };
      };
    }
  ).db;

  try {
    const row = rawDb
      .prepare('SELECT MAX(chunk_index) as max_idx FROM session_chunks WHERE session_id = ?')
      .get(sessionId) as { max_idx: number | null } | undefined;

    const nextIndex = (row?.max_idx ?? -1) + 1;

    rawDb
      .prepare(
        `INSERT OR IGNORE INTO session_chunks (session_id, chunk_index, content, source, timestamp)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(sessionId, nextIndex, content, source, new Date().toISOString());
  } catch {
    // Silently ignore
  }
}
