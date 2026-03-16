import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import Database from 'better-sqlite3';

vi.mock('../../../src/services/config.js', () => ({
  loadConfig: vi.fn(),
}));

vi.mock('../../../src/modules/pm/data/queries.js', () => ({
  getActiveProject: vi.fn(),
}));

import { loadConfig } from '../../../src/services/config.js';
import { getActiveProject } from '../../../src/modules/pm/data/queries.js';

const mockLoadConfig = loadConfig as ReturnType<typeof vi.fn>;
const mockGetActiveProject = getActiveProject as ReturnType<typeof vi.fn>;

const CACHE_DIR = join(homedir(), '.claude', 'status-cache');
const CACHE_PATH = join(CACHE_DIR, 'brain-state.json');

function createTestDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE agents (
      id TEXT PRIMARY KEY, name TEXT, parent TEXT, status TEXT,
      brain_task TEXT, claim_token TEXT, branch TEXT, worktree_path TEXT,
      ownership TEXT, dod_spec TEXT, pid INTEGER, created_at TEXT,
      started_at TEXT, completed_at TEXT, summary TEXT, exit_reason TEXT,
      context TEXT NOT NULL DEFAULT '{}'
    );
    CREATE TABLE session_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL, event_type TEXT NOT NULL,
      category TEXT, data TEXT NOT NULL, timestamp TEXT NOT NULL,
      data_hash TEXT NOT NULL, UNIQUE(session_id, data_hash)
    );
    CREATE TABLE notes (
      id TEXT PRIMARY KEY, title TEXT, content TEXT, tier TEXT,
      type TEXT, module TEXT, metadata TEXT, created_at TEXT, updated_at TEXT
    );
  `);
  return db;
}

/** Wrap a raw better-sqlite3 DB to look like BrainDB (which has a .db property) */
function wrapDb(raw: Database.Database) {
  return { db: raw, close: () => raw.close() } as unknown;
}

describe('writeStatusCache', () => {
  let db: Database.Database;
  let savedAgentId: string | undefined;

  beforeEach(() => {
    db = createTestDb();
    savedAgentId = process.env.BRAIN_AGENT_ID;
    delete process.env.BRAIN_AGENT_ID;

    mockLoadConfig.mockReturnValue({ dbPath: ':memory:' });
    mockGetActiveProject.mockReturnValue(null);
  });

  afterEach(() => {
    db.close();
    if (savedAgentId === undefined) delete process.env.BRAIN_AGENT_ID;
    else process.env.BRAIN_AGENT_ID = savedAgentId;
  });

  it('writes cache file with agent data', async () => {
    db.prepare(
      `INSERT INTO agents (id, name, parent, status, brain_task, branch, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(
      'agent-1',
      'worker-1',
      'orchestrator',
      'active',
      'VNM-01.01',
      'feat/x',
      '2026-03-14T00:00:00Z'
    );

    // Dynamic import to get the real module (not mocked)
    const { writeStatusCache } =
      await import('../../../src/modules/sessions/hooks/status-cache.js');
    writeStatusCache(wrapDb(db), 'sess-test');

    expect(existsSync(CACHE_PATH)).toBe(true);

    const cache = JSON.parse(readFileSync(CACHE_PATH, 'utf-8')) as {
      session_id: string;
      agent_count: number;
      active_agents: number;
      agents: { id: string; name: string; status: string }[];
    };

    expect(cache.session_id).toBe('sess-test');
    expect(cache.agent_count).toBe(1);
    expect(cache.active_agents).toBe(1);
    expect(cache.agents).toHaveLength(1);
    expect(cache.agents[0].name).toBe('worker-1');
  });

  it('includes friction and event counts', async () => {
    db.prepare(
      `INSERT INTO session_events (session_id, event_type, category, data, timestamp, data_hash)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run('sess-test', 'friction:retry', 'friction', '{}', '2026-03-14T00:00:00Z', 'h1');

    db.prepare(
      `INSERT INTO session_events (session_id, event_type, category, data, timestamp, data_hash)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run('sess-test', 'tool:Read', 'read', '{}', '2026-03-14T00:00:01Z', 'h2');

    const { writeStatusCache } =
      await import('../../../src/modules/sessions/hooks/status-cache.js');
    writeStatusCache(wrapDb(db), 'sess-test');

    const cache = JSON.parse(readFileSync(CACHE_PATH, 'utf-8')) as {
      friction_count: number;
      event_count: number;
    };

    expect(cache.friction_count).toBe(1);
    expect(cache.event_count).toBe(2);
  });

  it('includes PR URLs from events', async () => {
    db.prepare(
      `INSERT INTO session_events (session_id, event_type, category, data, timestamp, data_hash)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(
      'sess-test',
      'pr:created',
      'vcs',
      JSON.stringify({ pr_url: 'https://github.com/org/repo/pull/99' }),
      '2026-03-14T00:00:00Z',
      'pr-h1'
    );

    const { writeStatusCache } =
      await import('../../../src/modules/sessions/hooks/status-cache.js');
    writeStatusCache(wrapDb(db), 'sess-test');

    const cache = JSON.parse(readFileSync(CACHE_PATH, 'utf-8')) as {
      prs_created: string[];
    };

    expect(cache.prs_created).toEqual(['https://github.com/org/repo/pull/99']);
  });

  it('handles empty state gracefully', async () => {
    const { writeStatusCache } =
      await import('../../../src/modules/sessions/hooks/status-cache.js');
    writeStatusCache(wrapDb(db), 'sess-empty');

    const cache = JSON.parse(readFileSync(CACHE_PATH, 'utf-8')) as {
      agent_count: number;
      friction_count: number;
      prs_created: string[];
    };

    expect(cache.agent_count).toBe(0);
    expect(cache.friction_count).toBe(0);
    expect(cache.prs_created).toEqual([]);
  });
});
