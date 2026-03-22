import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDb } from '../../helpers.js';
import type { BrainDB } from '../../../src/services/brain-db.js';
import { populateSessionFiles } from '../../../src/modules/sessions/data/session-ops.js';
import { randomUUID } from 'node:crypto';

type RawDb = {
  exec: (sql: string) => void;
  prepare: (sql: string) => { all: (...args: unknown[]) => unknown[] };
};

interface SessionFileRow {
  session_id: string;
  file_path: string;
  operations: string;
  last_touched_at: string | null;
}

function getRawDb(db: BrainDB): RawDb {
  return (db as unknown as { db: RawDb }).db;
}

function querySessionFiles(db: BrainDB, sessionId: string): SessionFileRow[] {
  return getRawDb(db)
    .prepare('SELECT * FROM session_files WHERE session_id = ? ORDER BY file_path')
    .all(sessionId) as SessionFileRow[];
}

let db: BrainDB;

beforeEach(() => {
  ({ db } = createTestDb());
  // Create session_files table — this is a module migration not run by the test DB template
  getRawDb(db).exec(`
    CREATE TABLE IF NOT EXISTS session_files (
      session_id      TEXT NOT NULL,
      file_path       TEXT NOT NULL,
      operations      TEXT NOT NULL DEFAULT '[]',
      last_touched_at TEXT,
      PRIMARY KEY (session_id, file_path)
    )
  `);
});

afterEach(() => {
  db.close();
});

describe('populateSessionFiles', () => {
  it('writes file rows for each file touched', () => {
    const sessionId = randomUUID();
    const filesTouched = new Map([
      ['src/cli.ts', new Set(['Read', 'Edit'])],
      ['src/utils.ts', new Set(['Read'])],
    ]);

    populateSessionFiles(db, sessionId, filesTouched);

    const rows = querySessionFiles(db, sessionId);
    expect(rows).toHaveLength(2);

    const cliRow = rows.find((r) => r.file_path === 'src/cli.ts');
    expect(cliRow).toBeDefined();
    expect(JSON.parse(cliRow!.operations)).toEqual(expect.arrayContaining(['Read', 'Edit']));
    expect(cliRow!.last_touched_at).toBeTruthy();

    const utilsRow = rows.find((r) => r.file_path === 'src/utils.ts');
    expect(utilsRow).toBeDefined();
    expect(JSON.parse(utilsRow!.operations)).toEqual(['Read']);
  });

  it('normalizes absolute paths relative to projectDir', () => {
    const sessionId = randomUUID();
    const projectDir = '/home/user/myproject';
    const filesTouched = new Map([
      ['/home/user/myproject/src/cli.ts', new Set(['Write'])],
      ['relative/path.ts', new Set(['Read'])],
    ]);

    populateSessionFiles(db, sessionId, filesTouched, projectDir);

    const rows = querySessionFiles(db, sessionId);
    const paths = rows.map((r) => r.file_path);
    expect(paths).toContain('src/cli.ts');
    expect(paths).toContain('relative/path.ts');
  });

  it('updates existing rows on re-ingestion (INSERT OR REPLACE)', () => {
    const sessionId = randomUUID();
    const filePath = 'src/main.ts';

    populateSessionFiles(db, sessionId, new Map([[filePath, new Set(['Read'])]]));
    let rows = querySessionFiles(db, sessionId);
    expect(JSON.parse(rows[0].operations)).toEqual(['Read']);

    // Re-ingest with updated operations
    populateSessionFiles(db, sessionId, new Map([[filePath, new Set(['Read', 'Edit'])]]));
    rows = querySessionFiles(db, sessionId);
    expect(rows).toHaveLength(1);
    expect(JSON.parse(rows[0].operations)).toEqual(expect.arrayContaining(['Read', 'Edit']));
  });

  it('does nothing when filesTouched is empty', () => {
    const sessionId = randomUUID();
    populateSessionFiles(db, sessionId, new Map());
    const rows = querySessionFiles(db, sessionId);
    expect(rows).toHaveLength(0);
  });

  it('stores operations for different sessions independently', () => {
    const session1 = randomUUID();
    const session2 = randomUUID();
    const filePath = 'shared/file.ts';

    populateSessionFiles(db, session1, new Map([[filePath, new Set(['Read'])]]));
    populateSessionFiles(db, session2, new Map([[filePath, new Set(['Write'])]]));

    expect(querySessionFiles(db, session1)[0].file_path).toBe(filePath);
    expect(JSON.parse(querySessionFiles(db, session1)[0].operations)).toEqual(['Read']);
    expect(JSON.parse(querySessionFiles(db, session2)[0].operations)).toEqual(['Write']);
  });
});
