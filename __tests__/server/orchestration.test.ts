import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import {
  agentsMigrationV1,
  agentsMigrationV2,
  agentsMigrationV3,
} from '../../src/modules/agents/schema.js';

vi.mock('../../src/modules/agents/delivery-monitor.js', () => ({
  monitorDelivery: vi.fn(() => Promise.resolve('merged' as const)),
}));

vi.mock('../../src/modules/agents/delivery.js', () => ({
  getDeliveryForTask: vi.fn(),
}));

vi.mock('../../src/modules/pm/engine/dependency.js', () => ({
  computeWaves: vi.fn(),
  buildDependencyGraph: vi.fn(() => new Map()),
}));

vi.mock('../../src/modules/pm/data/task-ops.js', () => ({
  listTasks: vi.fn(),
  updateTaskStatus: vi.fn(() => Promise.resolve({ ok: true, data: {} })),
}));

vi.mock('../../src/modules/agents/dispatch-loop.js', () => {
  return {
    DispatchLoop: vi.fn().mockImplementation(() => ({
      executeWave: vi.fn(() =>
        Promise.resolve({
          settled: [],
          failedTaskIds: [],
          review: {
            wave: 1,
            taskCount: 0,
            branches: [],
            conflicts: [],
            hasConflicts: false,
            typecheckPassed: null,
            lintPassed: null,
            summary: 'CLEAN',
          },
        })
      ),
    })),
  };
});

vi.mock('../../src/server/dispatch.js', () => ({
  dispatchTask: vi.fn(),
  resolveProjectDir: vi.fn(() => '/tmp/test-project'),
}));

import { OrchestrationService } from '../../src/server/orchestration.js';
import { monitorDelivery } from '../../src/modules/agents/delivery-monitor.js';
import { getDeliveryForTask } from '../../src/modules/agents/delivery.js';
import { buildDependencyGraph, computeWaves } from '../../src/modules/pm/engine/dependency.js';
import { listTasks, updateTaskStatus } from '../../src/modules/pm/data/task-ops.js';
import { DispatchLoop } from '../../src/modules/agents/dispatch-loop.js';

const mockMonitorDelivery = monitorDelivery as ReturnType<typeof vi.fn>;
const mockGetDelivery = getDeliveryForTask as ReturnType<typeof vi.fn>;
const mockComputeWaves = computeWaves as ReturnType<typeof vi.fn>;
const mockBuildDependencyGraph = buildDependencyGraph as ReturnType<typeof vi.fn>;
const mockListTasks = listTasks as ReturnType<typeof vi.fn>;
const mockUpdateTaskStatus = updateTaskStatus as ReturnType<typeof vi.fn>;

const projectDir = '/tmp/test-project';

function setupDb(): Database.Database {
  const db = new Database(':memory:');
  agentsMigrationV1.up(db);
  agentsMigrationV2.up(db);
  agentsMigrationV3.up(db);
  return db;
}

/** Drop the CHECK constraint on delivery_states.status so tests can insert 'review-paused' rows. */
function dropDeliveryStatusCheck(db: Database.Database): void {
  db.exec(`
    CREATE TABLE delivery_states_tmp (
      agent_id     TEXT PRIMARY KEY REFERENCES agents(id),
      task_id      TEXT NOT NULL,
      branch       TEXT NOT NULL,
      status       TEXT NOT NULL DEFAULT 'in-progress',
      pr_number    INTEGER,
      pr_url       TEXT,
      pr_merged_at TEXT,
      delivered_at TEXT,
      retry_count  INTEGER NOT NULL DEFAULT 0,
      session_id   TEXT,
      created_at   TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
    );
    INSERT INTO delivery_states_tmp SELECT * FROM delivery_states;
    DROP TABLE delivery_states;
    ALTER TABLE delivery_states_tmp RENAME TO delivery_states;
  `);
}

function makeBackpressure() {
  return {
    computeEffectiveWip: vi.fn(() => ({ effectiveWip: 3, reason: 'nominal' })),
    recordMerge: vi.fn(),
    recordStall: vi.fn(),
    setMergeQueueDepth: vi.fn(),
    getState: vi.fn(),
  };
}

describe('OrchestrationService', () => {
  let db: Database.Database;
  let bp: ReturnType<typeof makeBackpressure>;

  beforeEach(() => {
    db = setupDb();
    bp = makeBackpressure();
  });

  afterEach(() => {
    db.close();
    vi.restoreAllMocks();
  });

  function insertAgent(id: string) {
    db.prepare(
      `INSERT INTO agents (id, name, parent, status, created_at, context)
       VALUES (?, 'test', 'root', 'completed', '2026-01-01', '{}')`
    ).run(id);
  }

  describe('recover', () => {
    it('restarts monitors for in-flight deliveries', async () => {
      insertAgent('a1');
      insertAgent('a2');
      db.exec(`
        INSERT INTO delivery_states (agent_id, task_id, branch, status, created_at, updated_at)
        VALUES ('a1', 't1', 'b1', 'pr-open', '2026-01-01', '2026-01-01'),
               ('a2', 't2', 'b2', 'push-failed', '2026-01-01', '2026-01-01')
      `);

      const svc = new OrchestrationService(db, bp as unknown, projectDir);
      await svc.recover();

      expect(mockMonitorDelivery).toHaveBeenCalledTimes(2);
    });

    it('skips deliveries in non-recoverable states', async () => {
      insertAgent('a1');
      insertAgent('a2');
      insertAgent('a3');
      db.exec(`
        INSERT INTO delivery_states (agent_id, task_id, branch, status, created_at, updated_at)
        VALUES ('a1', 't1', 'b1', 'merged', '2026-01-01', '2026-01-01'),
               ('a2', 't2', 'b2', 'delivered', '2026-01-01', '2026-01-01'),
               ('a3', 't3', 'b3', 'stalled', '2026-01-01', '2026-01-01')
      `);

      const svc = new OrchestrationService(db, bp as unknown, projectDir);
      await svc.recover();

      expect(mockMonitorDelivery).not.toHaveBeenCalled();
    });

    it('recovers zero deliveries on empty table', async () => {
      const svc = new OrchestrationService(db, bp as unknown, projectDir);
      await svc.recover();
      expect(mockMonitorDelivery).not.toHaveBeenCalled();
    });

    it('re-notifies inbox for review-paused deliveries instead of starting monitor', async () => {
      insertAgent('a1');
      insertAgent('a2');
      dropDeliveryStatusCheck(db);
      db.exec(`
        INSERT INTO delivery_states
          (agent_id, task_id, branch, status, pr_number, pr_url, created_at, updated_at)
        VALUES
          ('a1', 't1', 'b1', 'review-paused', 42, 'https://example.com/pr/42',
           '2026-01-01', '2026-01-01'),
          ('a2', 't2', 'b2', 'pr-open', NULL, NULL, '2026-01-01', '2026-01-01')
      `);

      const addInboxItem = vi.fn();
      const brainDbLike = { addInboxItem, rawDb: db } as unknown as {
        addInboxItem: typeof addInboxItem;
      };

      const svc = new OrchestrationService(brainDbLike, bp as unknown, projectDir);
      await svc.recover();

      expect(addInboxItem).toHaveBeenCalledTimes(1);
      const item = addInboxItem.mock.calls[0][0];
      expect(item.source).toBe('alert');
      expect(item.status).toBe('pending');
      expect(item.sourceUrl).toBe('https://example.com/pr/42');
      expect(item.content).toContain('t1');
      expect(JSON.parse(item.sourceMeta)).toMatchObject({
        taskId: 't1',
        agentId: 'a1',
        prNumber: 42,
        action: 'review-renotified',
      });
      // Monitor started for pr-open but not review-paused
      expect(mockMonitorDelivery).toHaveBeenCalledTimes(1);
    });

    it('review-paused recovery is a no-op when brainDb is not provided', async () => {
      insertAgent('a1');
      dropDeliveryStatusCheck(db);
      db.exec(`
        INSERT INTO delivery_states (agent_id, task_id, branch, status, created_at, updated_at)
        VALUES ('a1', 't1', 'b1', 'review-paused', '2026-01-01', '2026-01-01')
      `);

      const svc = new OrchestrationService(db, bp as unknown, projectDir);
      await expect(svc.recover()).resolves.toBeUndefined();
      expect(mockMonitorDelivery).not.toHaveBeenCalled();
    });
  });

  describe('initialize', () => {
    it('runs recover on first call and is idempotent', async () => {
      insertAgent('a1');
      db.exec(`
        INSERT INTO delivery_states (agent_id, task_id, branch, status, created_at, updated_at)
        VALUES ('a1', 't1', 'b1', 'pr-open', '2026-01-01', '2026-01-01')
      `);

      const svc = new OrchestrationService(db, bp as unknown, projectDir);
      await svc.initialize();
      await svc.initialize();

      expect(mockMonitorDelivery).toHaveBeenCalledTimes(1);
    });
  });

  describe('startMonitor', () => {
    it('deduplicates by taskId', () => {
      mockMonitorDelivery.mockReturnValue(new Promise(() => {})); // never resolves

      const svc = new OrchestrationService(db, bp as unknown, projectDir);
      const delivery = { agent_id: 'a1', task_id: 't1', branch: 'b1' } as unknown;

      svc.startMonitor(delivery);
      svc.startMonitor(delivery); // same taskId

      expect(mockMonitorDelivery).toHaveBeenCalledTimes(1);
    });

    it('allows new monitor after previous one completes', async () => {
      let resolveMonitor!: () => void;
      mockMonitorDelivery.mockReturnValueOnce(
        new Promise<string>((r) => {
          resolveMonitor = () => r('merged');
        })
      );

      const svc = new OrchestrationService(db, bp as unknown, projectDir);
      const delivery = { agent_id: 'a1', task_id: 't1', branch: 'b1' } as unknown;

      svc.startMonitor(delivery);
      expect(mockMonitorDelivery).toHaveBeenCalledTimes(1);

      // Resolve first monitor
      resolveMonitor();
      await new Promise((r) => setTimeout(r, 10)); // let .finally() run

      // Now a new monitor should be allowed
      mockMonitorDelivery.mockReturnValueOnce(Promise.resolve('merged'));
      svc.startMonitor(delivery);
      expect(mockMonitorDelivery).toHaveBeenCalledTimes(2);
    });

    it('ignores deliveries without taskId', () => {
      const svc = new OrchestrationService(db, bp as unknown, projectDir);
      svc.startMonitor({ agent_id: 'a1', task_id: null } as unknown);
      expect(mockMonitorDelivery).not.toHaveBeenCalled();
    });
  });

  describe('listActiveDeliveries', () => {
    it('returns delivery records for active monitors', () => {
      mockMonitorDelivery.mockReturnValue(new Promise(() => {}));
      mockGetDelivery.mockReturnValue({ agent_id: 'a1', task_id: 't1' });

      const svc = new OrchestrationService(db, bp as unknown, projectDir);
      svc.startMonitor({ agent_id: 'a1', task_id: 't1', branch: 'b1' } as unknown);

      const active = svc.listActiveDeliveries();
      expect(active).toHaveLength(1);
      expect(active[0].task_id).toBe('t1');
    });

    it('filters out null deliveries', () => {
      mockMonitorDelivery.mockReturnValue(new Promise(() => {}));
      mockGetDelivery.mockReturnValue(null);

      const svc = new OrchestrationService(db, bp as unknown, projectDir);
      svc.startMonitor({ agent_id: 'a1', task_id: 't1', branch: 'b1' } as unknown);

      expect(svc.listActiveDeliveries()).toHaveLength(0);
    });
  });

  describe('executeWorkstream', () => {
    it('throws on invalid workstream display ID', async () => {
      const svc = new OrchestrationService(db, bp as unknown, projectDir);
      await expect(svc.executeWorkstream({} as unknown, 'invalid')).rejects.toThrow(
        'Invalid workstream display ID'
      );
    });

    it('returns early when workstream has no tasks', async () => {
      mockListTasks.mockReturnValue({ ok: true, data: [] });

      const svc = new OrchestrationService(db, bp as unknown, projectDir);
      await svc.executeWorkstream({} as unknown, 'VNM-48');

      expect(mockComputeWaves).not.toHaveBeenCalled();
    });

    it('executes waves sequentially', async () => {
      mockListTasks.mockReturnValue({
        ok: true,
        data: [
          { display_id: 'VNM-48.101' },
          { display_id: 'VNM-48.102' },
          { display_id: 'VNM-48.103' },
        ],
      });
      mockComputeWaves.mockReturnValue([
        { wave: 1, taskIds: ['VNM-48.101', 'VNM-48.102'] },
        { wave: 2, taskIds: ['VNM-48.103'] },
      ]);

      const cleanReview = {
        wave: 1,
        taskCount: 0,
        branches: [],
        conflicts: [],
        hasConflicts: false,
        typecheckPassed: null,
        lintPassed: null,
        summary: 'CLEAN',
      };
      const executeWaveFn = vi.fn(() =>
        Promise.resolve({ settled: [], failedTaskIds: [], review: cleanReview })
      );
      (DispatchLoop as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => ({
        executeWave: executeWaveFn,
      }));

      const svc = new OrchestrationService(db, bp as unknown, projectDir);
      await svc.executeWorkstream({ db } as unknown, 'VNM-48');

      expect(executeWaveFn).toHaveBeenCalledTimes(2);
      // First wave has 2 tasks, second has 1
      expect(executeWaveFn.mock.calls[0][0].taskIds).toEqual(['VNM-48.101', 'VNM-48.102']);
      expect(executeWaveFn.mock.calls[1][0].taskIds).toEqual(['VNM-48.103']);
    });

    it('filters waves to only include tasks from the target workstream', async () => {
      mockListTasks.mockReturnValue({
        ok: true,
        data: [{ display_id: 'VNM-48.101' }],
      });
      mockComputeWaves.mockReturnValue([
        { wave: 1, taskIds: ['VNM-48.101', 'VNM-47.001'] }, // VNM-47.001 is another workstream
      ]);

      const cleanReview = {
        wave: 1,
        taskCount: 0,
        branches: [],
        conflicts: [],
        hasConflicts: false,
        typecheckPassed: null,
        lintPassed: null,
        summary: 'CLEAN',
      };
      const executeWaveFn = vi.fn(() =>
        Promise.resolve({ settled: [], failedTaskIds: [], review: cleanReview })
      );
      (DispatchLoop as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => ({
        executeWave: executeWaveFn,
      }));

      const svc = new OrchestrationService(db, bp as unknown, projectDir);
      await svc.executeWorkstream({ db } as unknown, 'VNM-48');

      expect(executeWaveFn.mock.calls[0][0].taskIds).toEqual(['VNM-48.101']);
    });

    it('throws when listTasks fails', async () => {
      mockListTasks.mockReturnValue({
        ok: false,
        error: { message: 'DB error' },
      });

      const svc = new OrchestrationService(db, bp as unknown, projectDir);
      await expect(svc.executeWorkstream({ db } as unknown, 'VNM-48')).rejects.toThrow(
        'Failed to list tasks'
      );
    });

    it('skips downstream tasks when a dependency fails', async () => {
      mockListTasks.mockReturnValue({
        ok: true,
        data: [
          { display_id: 'VNM-48.101' },
          { display_id: 'VNM-48.102' },
          { display_id: 'VNM-48.103' },
        ],
      });
      mockComputeWaves.mockReturnValue([
        { wave: 1, taskIds: ['VNM-48.101'] },
        { wave: 2, taskIds: ['VNM-48.102'] },
        { wave: 3, taskIds: ['VNM-48.103'] },
      ]);
      // .102 depends on .101; .103 depends on .102 (transitive chain)
      mockBuildDependencyGraph.mockReturnValue(
        new Map([
          ['VNM-48.101', []],
          ['VNM-48.102', ['VNM-48.101']],
          ['VNM-48.103', ['VNM-48.102']],
        ])
      );

      mockUpdateTaskStatus.mockResolvedValue({ ok: true, data: {} });

      const executeWaveFn = vi.fn(() =>
        Promise.resolve({ settled: [], failedTaskIds: ['VNM-48.101'] })
      );
      (DispatchLoop as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => ({
        executeWave: executeWaveFn,
      }));

      const svc = new OrchestrationService(db, bp as unknown, projectDir);
      await svc.executeWorkstream({ db } as unknown, 'VNM-48');

      // Only wave 1 should have been dispatched — waves 2 and 3 are fully skipped
      expect(executeWaveFn).toHaveBeenCalledTimes(1);
      expect(executeWaveFn.mock.calls[0][0].taskIds).toEqual(['VNM-48.101']);

      // All three tasks marked blocked: .101 (failed agent), .102 + .103 (transitive skip)
      const blocked = mockUpdateTaskStatus.mock.calls
        .filter((c) => c[4] === 'blocked')
        .map((c) => c[3]);
      expect(blocked).toEqual(expect.arrayContaining(['VNM-48.101', 'VNM-48.102', 'VNM-48.103']));
    });

    it('runs independent tasks in the same wave as a failure', async () => {
      mockListTasks.mockReturnValue({
        ok: true,
        data: [
          { display_id: 'VNM-48.101' },
          { display_id: 'VNM-48.102' },
          { display_id: 'VNM-48.103' },
        ],
      });
      mockComputeWaves.mockReturnValue([
        { wave: 1, taskIds: ['VNM-48.101', 'VNM-48.102'] },
        { wave: 2, taskIds: ['VNM-48.103'] },
      ]);
      // .103 depends only on .102 (independent of .101's failure)
      mockBuildDependencyGraph.mockReturnValue(
        new Map([
          ['VNM-48.101', []],
          ['VNM-48.102', []],
          ['VNM-48.103', ['VNM-48.102']],
        ])
      );

      mockUpdateTaskStatus.mockResolvedValue({ ok: true, data: {} });

      const executeWaveFn = vi.fn(() =>
        Promise.resolve({ settled: [], failedTaskIds: ['VNM-48.101'] })
      );
      (DispatchLoop as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => ({
        executeWave: executeWaveFn,
      }));

      const svc = new OrchestrationService(db, bp as unknown, projectDir);
      await svc.executeWorkstream({ db } as unknown, 'VNM-48');

      // Wave 1 runs both tasks, wave 2 still runs .103 since its dep .102 succeeded
      expect(executeWaveFn).toHaveBeenCalledTimes(2);
      expect(executeWaveFn.mock.calls[1][0].taskIds).toEqual(['VNM-48.103']);
    });
  });

  describe('migrateInFlightWorkflows', () => {
    it('cancels running wave-execution workflows', () => {
      const mockCancel = vi.fn();
      const runtime = {
        listRunning: vi.fn(() => [
          { id: 'wf-1', workflowName: 'wave-execution' },
          { id: 'wf-2', workflowName: 'planning' }, // different workflow — not cancelled
          { id: 'wf-3', workflowName: 'wave-execution' },
        ]),
        cancel: mockCancel,
      };

      const svc = new OrchestrationService(db, bp as unknown, projectDir);
      svc.migrateInFlightWorkflows(runtime as unknown);

      expect(mockCancel).toHaveBeenCalledTimes(2);
      expect(mockCancel).toHaveBeenCalledWith('wf-1', expect.stringContaining('Migrated'));
      expect(mockCancel).toHaveBeenCalledWith('wf-3', expect.stringContaining('Migrated'));
    });

    it('does nothing when no wave-execution workflows are running', () => {
      const runtime = {
        listRunning: vi.fn(() => []),
        cancel: vi.fn(),
      };

      const svc = new OrchestrationService(db, bp as unknown, projectDir);
      svc.migrateInFlightWorkflows(runtime as unknown);

      expect(runtime.cancel).not.toHaveBeenCalled();
    });
  });
});
