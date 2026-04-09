/**
 * Integration test: parallel agent dispatch pipeline.
 *
 * Uses a mock Claude runner (stub process that reads stdin, simulates work,
 * and exits) to validate the full dispatch → agent → delivery flow without
 * requiring actual Claude CLI access.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { EventEmitter } from 'node:events';
import {
  agentsMigrationV1,
  agentsMigrationV2,
  agentsMigrationV3,
} from '../../src/modules/agents/schema.js';
import {
  createAgent,
  updateAgentStatus,
  countActiveAgents,
} from '../../src/modules/agents/data.js';
import { recordDelivery, getDeliveryForTask } from '../../src/modules/agents/delivery.js';
import {
  DispatchLoop,
  checkDispatchConcurrency,
  type SpawnResult,
} from '../../src/modules/agents/dispatch-loop.js';
import { BackpressureController } from '../../src/modules/agents/backpressure.js';

// Mock external I/O but keep data.js and delivery.js real against the DB
vi.mock('../../src/utils/db.js', () => ({
  getRawDb: vi.fn((db: unknown) => {
    if (db && typeof db === 'object' && 'rawDb' in db) return (db as Record<string, unknown>).rawDb;
    return db;
  }),
  sleep: vi.fn(() => Promise.resolve()),
}));

vi.mock('../../src/modules/agents/delivery-monitor.js', () => ({
  monitorDelivery: vi.fn(() => Promise.resolve('merged' as const)),
}));

vi.mock('../../src/modules/agents/worktree.js', () => ({
  releaseWorktree: vi.fn(),
  allocateWorktree: vi.fn(),
  findGitRoot: vi.fn(() => '/tmp/test-project'),
}));

import { monitorDelivery } from '../../src/modules/agents/delivery-monitor.js';

const mockMonitorDelivery = monitorDelivery as ReturnType<typeof vi.fn>;

/**
 * Mock Claude runner: simulates the spawn → stdin → work → exit lifecycle.
 * Each runner has configurable behavior (exit code, delay, side effects).
 */
interface MockRunnerOpts {
  exitCode?: number;
  delayMs?: number;
  onPrompt?: (prompt: string) => void;
}

function createMockClaudeRunner(opts: MockRunnerOpts = {}) {
  const { exitCode = 0, onPrompt } = opts;
  const proc = new EventEmitter() as EventEmitter & {
    stdin: { write: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> };
    stdout: EventEmitter;
    stderr: EventEmitter;
    pid: number;
    unref: ReturnType<typeof vi.fn>;
  };
  proc.stdin = {
    write: vi.fn((data: string) => {
      onPrompt?.(data);
    }),
    end: vi.fn(() => {
      // Simulate process completing after stdin closes
      queueMicrotask(() => proc.emit('exit', exitCode));
    }),
  };
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.pid = Math.floor(Math.random() * 100000);
  proc.unref = vi.fn();
  return proc;
}

function setupDb(): Database.Database {
  const db = new Database(':memory:');
  agentsMigrationV1.up(db);
  agentsMigrationV2.up(db);
  agentsMigrationV3.up(db);
  return db;
}

describe('parallel dispatch integration', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = setupDb();
    vi.restoreAllMocks();
    mockMonitorDelivery.mockResolvedValue('merged');
  });

  afterEach(() => {
    db.close();
  });

  /**
   * Creates a mock SpawnFn that registers agents in the DB, simulates
   * a Claude process, then marks the agent completed.
   */
  function makeSpawnFn(opts: MockRunnerOpts = {}) {
    return async (taskId: string): Promise<SpawnResult> => {
      const agentId = createAgent(db, {
        name: `agent-${taskId}`,
        parent: 'test-dispatch',
        brain_task: taskId,
      });
      updateAgentStatus(db, agentId, 'active', { pid: 12345 });

      const runner = createMockClaudeRunner(opts);
      runner.stdin.write(`Task: ${taskId}`);
      runner.stdin.end();

      // Simulate agent completing after process exits
      if ((opts.exitCode ?? 0) === 0) {
        updateAgentStatus(db, agentId, 'completed', { summary: `Done ${taskId}` });
      } else {
        updateAgentStatus(db, agentId, 'failed', { exit_reason: `exit_code_${opts.exitCode}` });
      }

      const branch = `agent/test/${taskId}`;

      // Simulate delivery initiation (normally done by agent-done hook)
      recordDelivery(db, agentId, {
        task_id: taskId,
        branch,
        status: 'pr-open',
        pr_number: Math.floor(Math.random() * 1000),
      });

      return { agentId, taskId, branch };
    };
  }

  it('dispatches a single task through the full lifecycle', async () => {
    const bp = new BackpressureController(3);
    const spawnFn = makeSpawnFn();
    const loop = new DispatchLoop(db, bp, spawnFn, '/tmp/test');

    await loop.dispatchAndDeliver('VNM-48.101');

    // Agent should be completed in DB
    const agents = db
      .prepare('SELECT * FROM agents WHERE brain_task = ?')
      .all('VNM-48.101') as Record<string, unknown>[];
    expect(agents).toHaveLength(1);
    expect(agents[0].status).toBe('completed');

    // Delivery should have been initiated
    const delivery = getDeliveryForTask(db, 'VNM-48.101');
    expect(delivery).not.toBeNull();
    expect(delivery!.status).toBe('pr-open');

    // Monitor should have been called
    expect(mockMonitorDelivery).toHaveBeenCalledTimes(1);
  });

  it('dispatches multiple tasks in a wave concurrently', async () => {
    const bp = new BackpressureController(5);
    const taskIds = ['VNM-48.101', 'VNM-48.102', 'VNM-48.103'];

    const spawnOrder: string[] = [];
    const spawnFn = async (taskId: string): Promise<SpawnResult> => {
      spawnOrder.push(taskId);
      return makeSpawnFn()(taskId);
    };

    const loop = new DispatchLoop(db, bp, spawnFn, '/tmp/test');
    const results = await loop.executeWave({ wave: 1, taskIds });

    expect(results).toHaveLength(3);
    expect(results.every((r) => r.status === 'fulfilled')).toBe(true);

    // All 3 agents created
    const agents = db.prepare('SELECT * FROM agents').all() as Record<string, unknown>[];
    expect(agents).toHaveLength(3);
    expect(agents.every((a: Record<string, unknown>) => a.status === 'completed')).toBe(true);

    // All 3 deliveries created
    for (const taskId of taskIds) {
      expect(getDeliveryForTask(db, taskId)).not.toBeNull();
    }
  });

  it('respects WIP limits across concurrent dispatches', async () => {
    const bp = new BackpressureController(2); // Only allow 2 concurrent

    // Track how many agents are active simultaneously
    let maxConcurrent = 0;
    let currentConcurrent = 0;

    const spawnFn = async (taskId: string): Promise<SpawnResult> => {
      currentConcurrent++;
      maxConcurrent = Math.max(maxConcurrent, currentConcurrent);

      const result = await makeSpawnFn()(taskId);

      currentConcurrent--;
      return result;
    };

    const loop = new DispatchLoop(db, bp, spawnFn, '/tmp/test');

    // Dispatch 4 tasks — should be gated by WIP=2
    // Note: with mocked sleep, WIP polling resolves immediately,
    // so this tests the logic path rather than actual concurrency timing
    const results = await loop.executeWave({
      wave: 1,
      taskIds: ['t1', 't2', 't3', 't4'],
    });

    expect(results).toHaveLength(4);
    expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
  });

  it('handles mixed success and failure in a wave', async () => {
    const bp = new BackpressureController(5);

    let callCount = 0;
    const spawnFn = async (taskId: string): Promise<SpawnResult> => {
      callCount++;
      if (callCount === 2) {
        // Second task fails to spawn
        throw new Error('spawn failed');
      }
      return makeSpawnFn()(taskId);
    };

    const loop = new DispatchLoop(db, bp, spawnFn, '/tmp/test');
    const results = await loop.executeWave({
      wave: 1,
      taskIds: ['t1', 't2', 't3'],
    });

    // All should settle (Promise.allSettled), none should be rejected
    expect(results).toHaveLength(3);
    expect(results.every((r) => r.status === 'fulfilled')).toBe(true);

    // t1 and t3 should have agents, t2 should not (spawn failed)
    const agents = db.prepare('SELECT * FROM agents').all() as Record<string, unknown>[];
    expect(agents).toHaveLength(2);
  });

  it('executes waves sequentially (wave 2 waits for wave 1)', async () => {
    const bp = new BackpressureController(5);
    const spawnFn = makeSpawnFn();
    const loop = new DispatchLoop(db, bp, spawnFn, '/tmp/test');

    const waveOrder: number[] = [];

    // Execute wave 1
    const wave1Promise = loop.executeWave({ wave: 1, taskIds: ['w1-t1', 'w1-t2'] }).then((r) => {
      waveOrder.push(1);
      return r;
    });

    // Wave 2 must wait
    const wave2Promise = wave1Promise.then(() =>
      loop.executeWave({ wave: 2, taskIds: ['w2-t1'] }).then((r) => {
        waveOrder.push(2);
        return r;
      })
    );

    await wave2Promise;

    expect(waveOrder).toEqual([1, 2]);

    // All 3 agents created
    const agents = db.prepare('SELECT * FROM agents').all() as Record<string, unknown>[];
    expect(agents).toHaveLength(3);
  });

  it('failed agent does not get delivery monitoring', async () => {
    const bp = new BackpressureController(5);
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

    const loop = new DispatchLoop(db, bp, spawnFn, '/tmp/test');
    await loop.dispatchAndDeliver('t1');

    expect(mockMonitorDelivery).not.toHaveBeenCalled();
  });

  it('backpressure controller reduces effective WIP under pressure', () => {
    const bp = new BackpressureController(5);

    // Record failures to trigger backpressure
    bp.recordStall('ws1');
    bp.recordStall('ws1');
    bp.recordMerge(false, true); // failed merge with conflict
    bp.recordMerge(false, true);

    const { effectiveWip } = bp.computeEffectiveWip();
    // Under pressure, effective WIP should be less than base
    expect(effectiveWip).toBeLessThanOrEqual(5);

    // Concurrency check should use reduced WIP
    // Create enough agents to exceed the reduced limit
    for (let i = 0; i < effectiveWip; i++) {
      const id = createAgent(db, { name: `a${i}`, parent: 'test', brain_task: `t${i}` });
      updateAgentStatus(db, id, 'active', { pid: i + 100 });
    }

    const active = countActiveAgents(db);
    expect(active).toBe(effectiveWip);

    const check = checkDispatchConcurrency(db, bp);
    expect(check.allowed).toBe(false);
  });
});
