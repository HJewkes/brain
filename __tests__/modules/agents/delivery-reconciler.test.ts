import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import {
  reconcileDeliveries,
  cleanupAfterMerge,
} from '../../../src/modules/agents/delivery-reconciler.js';
import { recordDelivery, getDelivery } from '../../../src/modules/agents/delivery.js';
import {
  createAgent,
  updateAgentStatus,
  allocateWorktree,
} from '../../../src/modules/agents/data.js';
import {
  agentsMigrationV1,
  agentsMigrationV2,
  agentsMigrationV3,
} from '../../../src/modules/agents/schema.js';

vi.mock('node:child_process', () => ({
  execFileSync: vi.fn(),
  spawnSync: vi.fn(),
}));

import { execFileSync, spawnSync } from 'node:child_process';

const mockExecFileSync = vi.mocked(execFileSync);
const mockSpawnSync = vi.mocked(spawnSync);

function setupDb(): Database.Database {
  const db = new Database(':memory:');
  agentsMigrationV1.up(db);
  agentsMigrationV2.up(db);
  agentsMigrationV3.up(db);
  return db;
}

function makeCompletedAgent(
  db: Database.Database,
  opts: { brain_task?: string; branch?: string } = {}
): string {
  const id = createAgent(db, {
    name: 'worker',
    parent: 'orch',
    brain_task: opts.brain_task ?? 'VNM-48.01',
    branch: opts.branch ?? 'agent/vnm-48/VNM-48.01',
  });
  updateAgentStatus(db, id, 'active');
  updateAgentStatus(db, id, 'completed');
  return id;
}

// ---------------------------------------------------------------------------
// AC-13: Reconciler detects externally merged PR
// ---------------------------------------------------------------------------

describe('reconcileDeliveries', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = setupDb();
  });

  afterEach(() => {
    db.close();
    vi.restoreAllMocks();
  });

  it('transitions pr-open agent to merged when PR is merged externally (AC-13)', () => {
    const agentId = makeCompletedAgent(db, { brain_task: 'VNM-48.02' });
    recordDelivery(db, agentId, {
      status: 'pr-open',
      task_id: 'VNM-48.02',
      branch: 'agent/vnm-48/VNM-48.02',
      pr_number: 42,
      pr_url: 'https://github.com/org/repo/pull/42',
    });

    // gh pr view returns merged state
    mockSpawnSync.mockReturnValue({
      status: 0,
      stdout: JSON.stringify({ state: 'MERGED', mergedAt: '2026-04-08T10:00:00Z' }),
      stderr: '',
    } as ReturnType<typeof spawnSync>);

    // git worktree remove (cleanup)
    mockExecFileSync.mockReturnValue('');

    reconcileDeliveries(db, '/project');

    const state = getDelivery(db, agentId);
    expect(['merged', 'delivered']).toContain(state!.status);
  });

  it('does not touch agents with non-delivery states', () => {
    const agentId = makeCompletedAgent(db);
    // No delivery state recorded

    reconcileDeliveries(db, '/project');

    const state = getDelivery(db, agentId);
    expect(state).toBeNull();
  });

  it('leaves pr-open agents unchanged when PR is still open', () => {
    const agentId = makeCompletedAgent(db, { brain_task: 'VNM-48.03' });
    recordDelivery(db, agentId, {
      status: 'pr-open',
      task_id: 'VNM-48.03',
      branch: 'agent/vnm-48/VNM-48.03',
      pr_number: 10,
      pr_url: 'https://github.com/org/repo/pull/10',
    });

    // gh pr view returns open state
    mockSpawnSync.mockReturnValue({
      status: 0,
      stdout: JSON.stringify({ state: 'OPEN', mergedAt: null }),
      stderr: '',
    } as ReturnType<typeof spawnSync>);

    reconcileDeliveries(db, '/project');

    const state = getDelivery(db, agentId);
    expect(state!.status).toBe('pr-open');
  });
});

// ---------------------------------------------------------------------------
// AC-14: cleanupAfterMerge — task done, state delivered, worktree removed
// ---------------------------------------------------------------------------

describe('cleanupAfterMerge', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = setupDb();
  });

  afterEach(() => {
    db.close();
    vi.restoreAllMocks();
  });

  it('transitions delivery state to delivered with delivered_at timestamp (AC-14)', () => {
    const agentId = makeCompletedAgent(db, { brain_task: 'VNM-48.04' });
    allocateWorktree(db, {
      task_id: 'VNM-48.04',
      worktree_path: '/tmp/wt-48-04',
      branch: 'agent/vnm-48/VNM-48.04',
    });
    recordDelivery(db, agentId, {
      status: 'merged',
      task_id: 'VNM-48.04',
      branch: 'agent/vnm-48/VNM-48.04',
      pr_number: 99,
      pr_url: 'https://github.com/org/repo/pull/99',
      pr_merged_at: '2026-04-08T10:00:00Z',
    });

    const agent = db.prepare('SELECT * FROM agents WHERE id = ?').get(agentId) as Parameters<
      typeof cleanupAfterMerge
    >[1];

    mockExecFileSync.mockReturnValue('');

    cleanupAfterMerge(db, agent, '/project');

    const state = getDelivery(db, agentId);
    expect(state!.status).toBe('delivered');
    expect(state!.delivered_at).toBeTruthy();
  });

  it('removes worktree_allocations row after merge (AC-14)', () => {
    const agentId = makeCompletedAgent(db, { brain_task: 'VNM-48.05' });
    allocateWorktree(db, {
      task_id: 'VNM-48.05',
      worktree_path: '/tmp/wt-48-05',
      branch: 'agent/vnm-48/VNM-48.05',
    });
    recordDelivery(db, agentId, {
      status: 'merged',
      task_id: 'VNM-48.05',
      branch: 'agent/vnm-48/VNM-48.05',
      pr_number: 100,
      pr_url: 'https://github.com/org/repo/pull/100',
      pr_merged_at: '2026-04-08T10:00:00Z',
    });

    const agent = db.prepare('SELECT * FROM agents WHERE id = ?').get(agentId) as Parameters<
      typeof cleanupAfterMerge
    >[1];

    mockExecFileSync.mockReturnValue('');

    cleanupAfterMerge(db, agent, '/project');

    const row = db
      .prepare('SELECT COUNT(*) as n FROM worktree_allocations WHERE task_id = ?')
      .get('VNM-48.05') as { n: number };
    expect(row.n).toBe(0);
  });

  it('is a no-op when agent has no brain_task', () => {
    const id = createAgent(db, { name: 'worker', parent: 'orch' });
    updateAgentStatus(db, id, 'active');
    updateAgentStatus(db, id, 'completed');
    const agent = db.prepare('SELECT * FROM agents WHERE id = ?').get(id) as Parameters<
      typeof cleanupAfterMerge
    >[1];

    // Should not throw
    expect(() => cleanupAfterMerge(db, agent, '/project')).not.toThrow();
  });
});
