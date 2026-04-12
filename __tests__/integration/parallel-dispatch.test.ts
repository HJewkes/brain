/**
 * Integration test: parallel agent dispatch pipeline.
 *
 * Uses real DB operations with mock delivery monitoring to validate
 * the dispatch → agent → delivery flow.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import {
  agentsMigrationV1,
  agentsMigrationV2,
  agentsMigrationV3,
} from '../../src/modules/agents/schema.js';
import { createAgent, updateAgentStatus } from '../../src/modules/agents/data.js';
import { recordDelivery, getDeliveryForTask } from '../../src/modules/agents/delivery.js';
import { DispatchLoop, type SpawnResult } from '../../src/modules/agents/dispatch-loop.js';

// Mock external I/O but keep data.js and delivery.js real against the DB
vi.mock('../../src/utils/db.js', () => ({
  getRawDb: vi.fn((db: unknown) => {
    if (db && typeof db === 'object' && 'rawDb' in db) return (db as Record<string, unknown>).rawDb;
    return db;
  }),
  sleep: vi.fn(() => Promise.resolve()),
}));

vi.mock('../../src/modules/agents/worktree.js', () => ({
  releaseWorktree: vi.fn(),
}));

const mockMonitorDelivery = vi.fn().mockResolvedValue('merged' as const);
vi.mock('../../src/modules/agents/delivery-monitor.js', () => ({
  monitorDelivery: (...args: unknown[]) => mockMonitorDelivery(...args),
}));

describe('parallel dispatch integration', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    agentsMigrationV1.up(db);
    agentsMigrationV2.up(db);
    agentsMigrationV3.up(db);
    mockMonitorDelivery.mockClear();
  });

  afterEach(() => {
    db.close();
    vi.restoreAllMocks();
  });

  function makeSpawnFn() {
    return async (taskId: string): Promise<SpawnResult> => {
      const agentId = createAgent(db, {
        name: `agent-${taskId}`,
        parent: 'test',
        brain_task: taskId,
      });
      updateAgentStatus(db, agentId, 'active', { pid: Math.floor(Math.random() * 10000) });
      updateAgentStatus(db, agentId, 'completed', { summary: `Done ${taskId}` });

      const branch = `agent/test/${taskId}`;
      recordDelivery(db, agentId, {
        task_id: taskId,
        branch,
        status: 'pr-open',
        pr_number: Math.floor(Math.random() * 1000),
      });

      return { agentId, taskId, branch };
    };
  }

  it('dispatches multiple tasks in a wave', async () => {
    const taskIds = ['VNM-48.101', 'VNM-48.102', 'VNM-48.103'];
    const loop = new DispatchLoop(db, 5, makeSpawnFn(), '/tmp/test');
    const { settled } = await loop.executeWave({ wave: 1, taskIds });

    expect(settled).toHaveLength(3);
    expect(settled.every((r) => r.status === 'fulfilled')).toBe(true);

    const agents = db.prepare('SELECT * FROM agents').all() as Record<string, unknown>[];
    expect(agents).toHaveLength(3);
    expect(agents.every((a) => a.status === 'completed')).toBe(true);

    for (const taskId of taskIds) {
      expect(getDeliveryForTask(db, taskId)).not.toBeNull();
    }
  });

  it('handles mixed success and failure in a wave', async () => {
    let callCount = 0;
    const spawnFn = async (taskId: string): Promise<SpawnResult> => {
      callCount++;
      if (callCount === 2) throw new Error('spawn failed');
      return makeSpawnFn()(taskId);
    };

    const loop = new DispatchLoop(db, 5, spawnFn, '/tmp/test');
    const { settled } = await loop.executeWave({ wave: 1, taskIds: ['t1', 't2', 't3'] });

    expect(settled).toHaveLength(3);
    expect(settled.every((r) => r.status === 'fulfilled')).toBe(true);

    const agents = db.prepare('SELECT * FROM agents').all() as Record<string, unknown>[];
    expect(agents).toHaveLength(2); // t2 failed to spawn
  });

  it('executes waves sequentially', async () => {
    const loop = new DispatchLoop(db, 5, makeSpawnFn(), '/tmp/test');
    const waveOrder: number[] = [];

    await loop.executeWave({ wave: 1, taskIds: ['w1-t1', 'w1-t2'] }).then((r) => {
      waveOrder.push(1);
      return r;
    });

    await loop.executeWave({ wave: 2, taskIds: ['w2-t1'] }).then((r) => {
      waveOrder.push(2);
      return r;
    });

    expect(waveOrder).toEqual([1, 2]);
    const agents = db.prepare('SELECT * FROM agents').all() as Record<string, unknown>[];
    expect(agents).toHaveLength(3);
  });

  it('failed agent does not get delivery monitoring', async () => {
    const spawnFn = async (taskId: string): Promise<SpawnResult> => {
      const agentId = createAgent(db, {
        name: `agent-${taskId}`,
        parent: 'test',
        brain_task: taskId,
      });
      updateAgentStatus(db, agentId, 'active', { pid: 1 });
      updateAgentStatus(db, agentId, 'failed', { exit_reason: 'test_failure' });
      return { agentId, taskId, branch: 'b1' };
    };

    const loop = new DispatchLoop(db, 5, spawnFn, '/tmp/test');
    await loop.executeWave({ wave: 1, taskIds: ['t1'] });

    expect(mockMonitorDelivery).not.toHaveBeenCalled();
  });
});
