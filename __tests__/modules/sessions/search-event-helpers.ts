import type { BrainDB } from '../../../src/services/brain-db.js';
import type { SessionEvent } from '../../../src/modules/sessions/types.js';

/** Mirrors sessions module migration v2 so tests can use a template DB. */
export function createSessionEventsTable(db: BrainDB): void {
  db.rawDb.exec(`
    CREATE TABLE IF NOT EXISTS session_events (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id  TEXT    NOT NULL,
      event_type  TEXT    NOT NULL,
      category    TEXT,
      data        TEXT    NOT NULL,
      timestamp   TEXT    NOT NULL,
      data_hash   TEXT    NOT NULL,
      UNIQUE(session_id, data_hash)
    );
  `);
}

/** Same query BrainServiceClass.sessionEvents runs once it resolves the session id. */
export function readSessionEvents(db: BrainDB, sessionId: string): SessionEvent[] {
  return db.rawDb
    .prepare('SELECT * FROM session_events WHERE session_id = ? ORDER BY timestamp ASC')
    .all(sessionId) as SessionEvent[];
}
