import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import type { BrainDB } from '../../../src/services/brain-db.js';
import { aggregateSessionEvents, parsePrUrl } from '../../../src/modules/sessions/engine/aggregate.js';
import { randomUUID } from 'node:crypto';

type RawDb = {
  exec: (sql: string) => void;
  prepare: (sql: string) => { run: (...args: unknown[]) => void };
};

function wrapDb(raw: Database.Database): BrainDB {
  return { db: raw, close: () => raw.close() } as unknown as BrainDB;
}

function insertEvent(
  raw: Database.Database,
  sessionId: string,
  eventType: string,
  data: Record<string, unknown>,
  timestamp = '2026-04-01T10:00:00Z',
): void {
  raw
    .prepare(
      `INSERT INTO session_events (session_id, event_type, category, data, timestamp, data_hash)
       VALUES (?, ?, NULL, ?, ?, ?)`,
    )
    .run(sessionId, eventType, JSON.stringify(data), timestamp, randomUUID());
}

let raw: Database.Database;
let db: BrainDB;
let sessionId: string;

beforeEach(() => {
  raw = new Database(':memory:');
  raw.exec(`
    CREATE TABLE session_events (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id  TEXT    NOT NULL,
      event_type  TEXT    NOT NULL,
      category    TEXT,
      data        TEXT    NOT NULL,
      timestamp   TEXT    NOT NULL,
      data_hash   TEXT    NOT NULL,
      UNIQUE(session_id, data_hash)
    )
  `);
  db = wrapDb(raw);
  sessionId = randomUUID();
  // seed a metadata event so aggregation returns non-null
  insertEvent(raw, sessionId, 'metadata', { projectDir: '/tmp/project' });
});

afterEach(() => {
  raw.close();
});

describe('parsePrUrl', () => {
  it('parses a valid GitHub PR URL', () => {
    const result = parsePrUrl('https://github.com/owner/repo/pull/42');
    expect(result).toEqual({
      repo: 'owner/repo',
      number: 42,
      url: 'https://github.com/owner/repo/pull/42',
    });
  });

  it('returns null for a non-PR URL', () => {
    expect(parsePrUrl('https://example.com/not-a-pr')).toBeNull();
  });

  it('returns null for an empty string', () => {
    expect(parsePrUrl('')).toBeNull();
  });
});

describe('aggregateSessionEvents — task_ref', () => {
  it('populates taskRefs from task_ref events', () => {
    insertEvent(raw, sessionId, 'task_ref', { taskId: 'VNM-34.108' });
    insertEvent(raw, sessionId, 'task_ref', { taskId: 'VNM-34.109' });

    const result = aggregateSessionEvents(db, sessionId);
    expect(result?.taskRefs).toContain('VNM-34.108');
    expect(result?.taskRefs).toContain('VNM-34.109');
  });

  it('deduplicates taskRefs', () => {
    insertEvent(raw, sessionId, 'task_ref', { taskId: 'VNM-34.108' });
    insertEvent(raw, sessionId, 'task_ref', { taskId: 'VNM-34.108' });

    const result = aggregateSessionEvents(db, sessionId);
    expect(result?.taskRefs.filter((t) => t === 'VNM-34.108')).toHaveLength(1);
  });

  it('ignores task_ref events with no taskId', () => {
    insertEvent(raw, sessionId, 'task_ref', {});

    const result = aggregateSessionEvents(db, sessionId);
    expect(result?.taskRefs).toHaveLength(0);
  });
});

describe('aggregateSessionEvents — pr_created', () => {
  it('populates prLinks from pr_created events with valid URLs', () => {
    insertEvent(raw, sessionId, 'pr_created', {
      pr_url: 'https://github.com/owner/repo/pull/99',
    });

    const result = aggregateSessionEvents(db, sessionId);
    expect(result?.prLinks).toHaveLength(1);
    expect(result?.prLinks[0]).toEqual({
      repo: 'owner/repo',
      number: 99,
      url: 'https://github.com/owner/repo/pull/99',
    });
  });

  it('skips pr_created events with invalid URLs', () => {
    insertEvent(raw, sessionId, 'pr_created', { pr_url: 'not-a-url' });

    const result = aggregateSessionEvents(db, sessionId);
    expect(result?.prLinks).toHaveLength(0);
  });

  it('skips pr_created events with no pr_url', () => {
    insertEvent(raw, sessionId, 'pr_created', {});

    const result = aggregateSessionEvents(db, sessionId);
    expect(result?.prLinks).toHaveLength(0);
  });
});

describe('aggregateSessionEvents — file_touch', () => {
  it('populates filesTouched with tool names', () => {
    insertEvent(raw, sessionId, 'file_touch', {
      filePath: 'src/cli.ts',
      toolName: 'Read',
    });
    insertEvent(raw, sessionId, 'file_touch', {
      filePath: 'src/cli.ts',
      toolName: 'Edit',
    });

    const result = aggregateSessionEvents(db, sessionId);
    const tools = result?.filesTouched.get('src/cli.ts');
    expect(tools?.has('Read')).toBe(true);
    expect(tools?.has('Edit')).toBe(true);
  });

  it('adds to filesWritten when toolName is Write', () => {
    insertEvent(raw, sessionId, 'file_touch', {
      filePath: 'src/new.ts',
      toolName: 'Write',
    });

    const result = aggregateSessionEvents(db, sessionId);
    expect(result?.filesWritten).toContain('src/new.ts');
  });

  it('does not add to filesWritten for non-Write tools', () => {
    insertEvent(raw, sessionId, 'file_touch', {
      filePath: 'src/existing.ts',
      toolName: 'Read',
    });

    const result = aggregateSessionEvents(db, sessionId);
    expect(result?.filesWritten).not.toContain('src/existing.ts');
  });

  it('ignores file_touch events with no filePath', () => {
    insertEvent(raw, sessionId, 'file_touch', { toolName: 'Read' });

    const result = aggregateSessionEvents(db, sessionId);
    expect(result?.filesTouched.size).toBe(0);
  });
});

describe('aggregateSessionEvents — skill_use', () => {
  it('populates skillUsage with counts', () => {
    insertEvent(raw, sessionId, 'skill_use', { name: 'commit', count: 1 });
    insertEvent(raw, sessionId, 'skill_use', { name: 'commit', count: 2 });

    const result = aggregateSessionEvents(db, sessionId);
    expect(result?.skillUsage.get('commit')).toBe(3);
  });

  it('defaults count to 1 when not provided', () => {
    insertEvent(raw, sessionId, 'skill_use', { name: 'spec' });

    const result = aggregateSessionEvents(db, sessionId);
    expect(result?.skillUsage.get('spec')).toBe(1);
  });

  it('ignores skill_use events with no name', () => {
    insertEvent(raw, sessionId, 'skill_use', { count: 5 });

    const result = aggregateSessionEvents(db, sessionId);
    expect(result?.skillUsage.size).toBe(0);
  });
});

describe('aggregateSessionEvents — plan_present', () => {
  it('sets planPresent to true when plan_present event exists', () => {
    insertEvent(raw, sessionId, 'plan_present', {});

    const result = aggregateSessionEvents(db, sessionId);
    expect(result?.planPresent).toBe(true);
  });

  it('planPresent defaults to false when no plan_present event', () => {
    const result = aggregateSessionEvents(db, sessionId);
    expect(result?.planPresent).toBe(false);
  });
});
