import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { createAgent, setAgentContext } from '../../../src/modules/agents/data.js';
import {
  findAgentByTask,
  findAgentByBranch,
  findAgentByPR,
  findAgentBySession,
} from '../../../src/modules/agents/data.js';
import { agentsMigrationV1, agentsMigrationV2 } from '../../../src/modules/agents/schema.js';

function setupDb(): Database.Database {
  const db = new Database(':memory:');
  agentsMigrationV1.up(db);
  agentsMigrationV2.up(db);
  return db;
}

describe('findAgentByTask', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = setupDb();
  });

  afterEach(() => {
    db.close();
  });

  it('returns the agent matching the task display_id', () => {
    const id = createAgent(db, { name: 'worker', parent: 'orch', brain_task: 'VNM-15.01' });

    const found = findAgentByTask(db, 'VNM-15.01');

    expect(found).not.toBeNull();
    expect(found!.id).toBe(id);
    expect(found!.brain_task).toBe('VNM-15.01');
  });

  it('returns null when no agent has that task', () => {
    createAgent(db, { name: 'other', parent: 'orch', brain_task: 'VNM-99.99' });

    expect(findAgentByTask(db, 'VNM-15.01')).toBeNull();
  });

  it('returns null when agents table does not exist', () => {
    const emptyDb = new Database(':memory:');
    expect(findAgentByTask(emptyDb, 'VNM-15.01')).toBeNull();
    emptyDb.close();
  });
});

describe('findAgentByBranch', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = setupDb();
  });

  afterEach(() => {
    db.close();
  });

  it('returns the agent on the given branch', () => {
    const id = createAgent(db, { name: 'worker', parent: 'orch', branch: 'feat/dashboard' });

    const found = findAgentByBranch(db, 'feat/dashboard');

    expect(found).not.toBeNull();
    expect(found!.id).toBe(id);
    expect(found!.branch).toBe('feat/dashboard');
  });

  it('returns the most recent agent when multiple match', () => {
    createAgent(db, { name: 'old-worker', parent: 'orch', branch: 'feat/shared' });
    const newest = createAgent(db, { name: 'new-worker', parent: 'orch', branch: 'feat/shared' });

    const found = findAgentByBranch(db, 'feat/shared');

    expect(found!.id).toBe(newest);
  });

  it('returns null when no agent is on that branch', () => {
    createAgent(db, { name: 'worker', parent: 'orch', branch: 'feat/other' });

    expect(findAgentByBranch(db, 'feat/missing')).toBeNull();
  });

  it('returns null when agents table does not exist', () => {
    const emptyDb = new Database(':memory:');
    expect(findAgentByBranch(emptyDb, 'feat/dashboard')).toBeNull();
    emptyDb.close();
  });
});

describe('findAgentByPR', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = setupDb();
  });

  afterEach(() => {
    db.close();
  });

  it('returns the agent whose context has the matching pr_url', () => {
    const id = createAgent(db, { name: 'worker', parent: 'orch' });
    setAgentContext(db, id, 'pr_url', 'https://github.com/org/repo/pull/42');

    const found = findAgentByPR(db, 'https://github.com/org/repo/pull/42');

    expect(found).not.toBeNull();
    expect(found!.id).toBe(id);
  });

  it('returns null when no agent has that pr_url', () => {
    const id = createAgent(db, { name: 'worker', parent: 'orch' });
    setAgentContext(db, id, 'pr_url', 'https://github.com/org/repo/pull/1');

    expect(findAgentByPR(db, 'https://github.com/org/repo/pull/99')).toBeNull();
  });

  it('returns null when agents have no pr_url in context', () => {
    createAgent(db, { name: 'worker', parent: 'orch' });

    expect(findAgentByPR(db, 'https://github.com/org/repo/pull/1')).toBeNull();
  });

  it('returns null when agents table does not exist', () => {
    const emptyDb = new Database(':memory:');
    expect(findAgentByPR(emptyDb, 'https://github.com/org/repo/pull/1')).toBeNull();
    emptyDb.close();
  });
});

describe('findAgentBySession', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = setupDb();
  });

  afterEach(() => {
    db.close();
  });

  it('returns the agent whose context has the matching session_id', () => {
    const id = createAgent(db, { name: 'worker', parent: 'orch' });
    setAgentContext(db, id, 'session_id', 'sess-abc-123');

    const found = findAgentBySession(db, 'sess-abc-123');

    expect(found).not.toBeNull();
    expect(found!.id).toBe(id);
  });

  it('returns null when no agent has that session_id', () => {
    const id = createAgent(db, { name: 'worker', parent: 'orch' });
    setAgentContext(db, id, 'session_id', 'sess-xyz');

    expect(findAgentBySession(db, 'sess-abc-123')).toBeNull();
  });

  it('returns null when agents have no session_id in context', () => {
    createAgent(db, { name: 'worker', parent: 'orch' });

    expect(findAgentBySession(db, 'sess-abc-123')).toBeNull();
  });

  it('returns null when agents table does not exist', () => {
    const emptyDb = new Database(':memory:');
    expect(findAgentBySession(emptyDb, 'sess-abc-123')).toBeNull();
    emptyDb.close();
  });
});
