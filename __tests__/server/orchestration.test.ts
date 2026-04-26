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
  initiateDelivery: vi.fn(),
}));

vi.mock('../../src/modules/agents/auto-merge.js', () => ({
  getPrForBranch: vi.fn(),
}));

vi.mock('node:child_process', async () => {
  const actual = await vi.importActual<typeof import('node:child_process')>('node:child_process');
  return {
    ...actual,
    execFileSync: vi.fn(),
  };
});

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

import { execFileSync } from 'node:child_process';
import {
  OrchestrationService,
  recoverBranchForAgent,
  resetOrchestrationInitForTests,
} from '../../src/server/orchestration.js';
import { monitorDelivery } from '../../src/modules/agents/delivery-monitor.js';
import { getDeliveryForTask, initiateDelivery } from '../../src/modules/agents/delivery.js';
import { getPrForBranch } from '../../src/modules/agents/auto-merge.js';
import { buildDependencyGraph, computeWaves } from '../../src/modules/pm/engine/dependency.js';
import { listTasks, updateTaskStatus } from '../../src/modules/pm/data/task-ops.js';
import { DispatchLoop } from '../../src/modules/agents/dispatch-loop.js';

const mockMonitorDelivery = monitorDelivery as ReturnType<typeof vi.fn>;
const mockGetDelivery = getDeliveryForTask as ReturnType<typeof vi.fn>;
const mockInitiateDelivery = initiateDelivery as ReturnType<typeof vi.fn>;
const mockGetPrForBranch = getPrForBranch as ReturnType<typeof vi.fn>;
const mockExecFileSync = execFileSync as unknown as ReturnType<typeof vi.fn>;
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
    resetOrchestrationInitForTests();
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

  describe('recoverZombieAgents', () => {
    const DEAD_PID = 424242;
    const ALIVE_PID = 111111;

    function insertActiveAgent(id: string, pid: number | null, brainTask: string | null) {
      db.prepare(
        `INSERT INTO agents (id, name, parent, status, pid, brain_task, created_at, context)
         VALUES (?, 'test', 'root', 'active', ?, ?, '2026-01-01', '{}')`
      ).run(id, pid, brainTask);
    }

    function getAgentStatus(id: string): { status: string; exit_reason: string | null } {
      return db.prepare('SELECT status, exit_reason FROM agents WHERE id = ?').get(id) as {
        status: string;
        exit_reason: string | null;
      };
    }

    beforeEach(() => {
      vi.spyOn(process, 'kill').mockImplementation((pid: number): true => {
        if (pid === ALIVE_PID) return true;
        throw new Error('ESRCH');
      });
    });

    it('abandons active agents whose PID is dead', async () => {
      insertActiveAgent('z1', DEAD_PID, 'VNM-56.99');

      const svc = new OrchestrationService(db, bp as unknown, projectDir);
      await svc.recoverZombieAgents();

      const row = getAgentStatus('z1');
      expect(row.status).toBe('abandoned');
      expect(row.exit_reason).toContain('not alive');
    });

    it('leaves active agents alone when their PID is alive', async () => {
      insertActiveAgent('alive1', ALIVE_PID, 'VNM-56.98');

      const svc = new OrchestrationService(db, bp as unknown, projectDir);
      await svc.recoverZombieAgents();

      expect(getAgentStatus('alive1').status).toBe('active');
    });

    it('treats agents without a recorded PID as zombies', async () => {
      insertActiveAgent('nopid', null, 'VNM-56.97');

      const svc = new OrchestrationService(db, bp as unknown, projectDir);
      await svc.recoverZombieAgents();

      const row = getAgentStatus('nopid');
      expect(row.status).toBe('abandoned');
      expect(row.exit_reason).toContain('No PID');
    });

    it('releases worktree allocations for zombie tasks', async () => {
      insertActiveAgent('z2', DEAD_PID, 'VNM-56.96');
      db.prepare(
        `INSERT INTO worktree_allocations (task_id, worktree_path, branch, created_at)
         VALUES ('VNM-56.96', '/tmp/wt', 'agent/x', '2026-01-01')`
      ).run();

      const svc = new OrchestrationService(db, bp as unknown, projectDir);
      await svc.recoverZombieAgents();

      const alloc = db
        .prepare('SELECT * FROM worktree_allocations WHERE task_id = ?')
        .get('VNM-56.96');
      expect(alloc).toBeUndefined();
    });

    it('resets PM task to pending when svc is provided', async () => {
      insertActiveAgent('z3', DEAD_PID, 'VNM-56.95');
      mockUpdateTaskStatus.mockClear();

      const fakeSvc = { db: 'BRAIN_DB', config: 'CFG', embedder: 'EMB' };
      const svc = new OrchestrationService(db, bp as unknown, projectDir);
      await svc.recoverZombieAgents(fakeSvc as unknown);

      expect(mockUpdateTaskStatus).toHaveBeenCalledWith(
        'BRAIN_DB',
        'CFG',
        'EMB',
        'VNM-56.95',
        'pending'
      );
    });

    it('skips task reset when svc is omitted', async () => {
      insertActiveAgent('z4', DEAD_PID, 'VNM-56.94');
      mockUpdateTaskStatus.mockClear();

      const svc = new OrchestrationService(db, bp as unknown, projectDir);
      await svc.recoverZombieAgents();

      expect(mockUpdateTaskStatus).not.toHaveBeenCalled();
      expect(getAgentStatus('z4').status).toBe('abandoned');
    });

    it('no-ops when there are no active agents', async () => {
      const svc = new OrchestrationService(db, bp as unknown, projectDir);
      await expect(svc.recoverZombieAgents()).resolves.toBeUndefined();
    });

    it('runs as part of recover()', async () => {
      insertActiveAgent('z5', DEAD_PID, null);

      const svc = new OrchestrationService(db, bp as unknown, projectDir);
      await svc.recover();

      expect(getAgentStatus('z5').status).toBe('abandoned');
    });
  });

  describe('recoverOrphanedBranches', () => {
    function insertAgentWithBranch(
      id: string,
      status: string,
      brainTask: string | null,
      branch: string | null
    ) {
      db.prepare(
        `INSERT INTO agents (id, name, parent, status, brain_task, branch, created_at, context)
         VALUES (?, 'test', 'root', ?, ?, ?, '2026-01-01', '{}')`
      ).run(id, status, brainTask, branch);
    }

    beforeEach(() => {
      mockInitiateDelivery.mockReset();
      mockGetPrForBranch.mockReset();
      mockExecFileSync.mockReset();
      mockMonitorDelivery.mockClear();
    });

    function stubGitRevListCount(count: string) {
      mockExecFileSync.mockImplementation((cmd: string, args: string[]) => {
        if (cmd === 'git' && args[0] === 'rev-list') return count;
        throw new Error(`unexpected exec: ${cmd} ${args.join(' ')}`);
      });
    }

    it('pushes and opens PR for completed agents with committed branches and no PR', async () => {
      insertAgentWithBranch('orphan1', 'completed', 'VNM-56.01', 'agent/VNM-56/VNM-56.01');
      stubGitRevListCount('2');
      mockGetPrForBranch.mockReturnValue(null);
      mockInitiateDelivery.mockResolvedValue({
        agent_id: 'orphan1',
        task_id: 'VNM-56.01',
        branch: 'agent/VNM-56/VNM-56.01',
        status: 'pr-open',
        pr_number: 500,
      });

      const svc = new OrchestrationService(db, bp as unknown, projectDir);
      await svc.recoverOrphanedBranches();

      expect(mockInitiateDelivery).toHaveBeenCalledWith(
        db,
        'orphan1',
        'VNM-56.01',
        'agent/VNM-56/VNM-56.01',
        projectDir
      );
      expect(mockMonitorDelivery).toHaveBeenCalledTimes(1);
    });

    it('recovers failed agents whose branch has commits', async () => {
      insertAgentWithBranch('orphan2', 'failed', 'VNM-56.02', 'agent/VNM-56/VNM-56.02');
      stubGitRevListCount('1');
      mockGetPrForBranch.mockReturnValue(null);
      mockInitiateDelivery.mockResolvedValue({
        agent_id: 'orphan2',
        task_id: 'VNM-56.02',
        branch: 'agent/VNM-56/VNM-56.02',
        status: 'pr-open',
        pr_number: 501,
      });

      const svc = new OrchestrationService(db, bp as unknown, projectDir);
      await svc.recoverOrphanedBranches();

      expect(mockInitiateDelivery).toHaveBeenCalledTimes(1);
    });

    it('skips branches with no commits ahead of origin/main', async () => {
      insertAgentWithBranch('orphan3', 'completed', 'VNM-56.03', 'agent/VNM-56/VNM-56.03');
      stubGitRevListCount('0');
      mockGetPrForBranch.mockReturnValue(null);

      const svc = new OrchestrationService(db, bp as unknown, projectDir);
      await svc.recoverOrphanedBranches();

      expect(mockInitiateDelivery).not.toHaveBeenCalled();
    });

    it('skips branches that already have an open PR', async () => {
      insertAgentWithBranch('orphan4', 'completed', 'VNM-56.04', 'agent/VNM-56/VNM-56.04');
      stubGitRevListCount('3');
      mockGetPrForBranch.mockReturnValue({
        number: 42,
        branch: 'agent/VNM-56/VNM-56.04',
        checksPass: true,
        mergeable: true,
        state: 'open',
        failedChecks: [],
      });

      const svc = new OrchestrationService(db, bp as unknown, projectDir);
      await svc.recoverOrphanedBranches();

      expect(mockInitiateDelivery).not.toHaveBeenCalled();
    });

    it('skips agents without a branch', async () => {
      insertAgentWithBranch('nobranch', 'completed', 'VNM-56.05', null);
      stubGitRevListCount('1');

      const svc = new OrchestrationService(db, bp as unknown, projectDir);
      await svc.recoverOrphanedBranches();

      expect(mockInitiateDelivery).not.toHaveBeenCalled();
    });

    it('skips active agents (only scans terminal-status agents)', async () => {
      insertAgentWithBranch('active1', 'active', 'VNM-56.06', 'agent/VNM-56/VNM-56.06');
      stubGitRevListCount('2');
      mockGetPrForBranch.mockReturnValue(null);

      const svc = new OrchestrationService(db, bp as unknown, projectDir);
      await svc.recoverOrphanedBranches();

      expect(mockInitiateDelivery).not.toHaveBeenCalled();
    });

    it('skips branches where delivery already progressed past initiation', async () => {
      insertAgentWithBranch('delivered1', 'completed', 'VNM-56.07', 'agent/VNM-56/VNM-56.07');
      db.exec(`
        INSERT INTO delivery_states (agent_id, task_id, branch, status, created_at, updated_at)
        VALUES ('delivered1', 'VNM-56.07', 'agent/VNM-56/VNM-56.07', 'pr-open',
                '2026-01-01', '2026-01-01')
      `);
      stubGitRevListCount('5');
      mockGetPrForBranch.mockReturnValue(null);

      const svc = new OrchestrationService(db, bp as unknown, projectDir);
      await svc.recoverOrphanedBranches();

      expect(mockInitiateDelivery).not.toHaveBeenCalled();
    });

    it('recovers deliveries stuck in in-progress state', async () => {
      insertAgentWithBranch('stuck1', 'completed', 'VNM-56.08', 'agent/VNM-56/VNM-56.08');
      db.exec(`
        INSERT INTO delivery_states (agent_id, task_id, branch, status, created_at, updated_at)
        VALUES ('stuck1', 'VNM-56.08', 'agent/VNM-56/VNM-56.08', 'in-progress',
                '2026-01-01', '2026-01-01')
      `);
      stubGitRevListCount('1');
      mockGetPrForBranch.mockReturnValue(null);
      mockInitiateDelivery.mockResolvedValue({
        agent_id: 'stuck1',
        task_id: 'VNM-56.08',
        branch: 'agent/VNM-56/VNM-56.08',
        status: 'pr-open',
        pr_number: 502,
      });

      const svc = new OrchestrationService(db, bp as unknown, projectDir);
      await svc.recoverOrphanedBranches();

      expect(mockInitiateDelivery).toHaveBeenCalledTimes(1);
    });

    it('continues after per-candidate failure', async () => {
      insertAgentWithBranch('o1', 'completed', 'VNM-56.10', 'agent/VNM-56/VNM-56.10');
      insertAgentWithBranch('o2', 'completed', 'VNM-56.11', 'agent/VNM-56/VNM-56.11');
      stubGitRevListCount('1');
      mockGetPrForBranch.mockReturnValue(null);
      mockInitiateDelivery
        .mockRejectedValueOnce(new Error('gh auth failed'))
        .mockResolvedValueOnce({
          agent_id: 'o2',
          task_id: 'VNM-56.11',
          branch: 'agent/VNM-56/VNM-56.11',
          status: 'pr-open',
          pr_number: 503,
        });

      const svc = new OrchestrationService(db, bp as unknown, projectDir);
      await svc.recoverOrphanedBranches();

      expect(mockInitiateDelivery).toHaveBeenCalledTimes(2);
    });

    it('runs as part of recover()', async () => {
      insertAgentWithBranch('auto1', 'completed', 'VNM-56.20', 'agent/VNM-56/VNM-56.20');
      stubGitRevListCount('1');
      mockGetPrForBranch.mockReturnValue(null);
      mockInitiateDelivery.mockResolvedValue({
        agent_id: 'auto1',
        task_id: 'VNM-56.20',
        branch: 'agent/VNM-56/VNM-56.20',
        status: 'pr-open',
        pr_number: 504,
      });

      const svc = new OrchestrationService(db, bp as unknown, projectDir);
      await svc.recover();

      expect(mockInitiateDelivery).toHaveBeenCalledTimes(1);
    });

    it('no-ops when no agents match', async () => {
      const svc = new OrchestrationService(db, bp as unknown, projectDir);
      await expect(svc.recoverOrphanedBranches()).resolves.toBeUndefined();
      expect(mockInitiateDelivery).not.toHaveBeenCalled();
    });

    it('ignores non-agent branches', async () => {
      insertAgentWithBranch('weird', 'completed', 'VNM-56.30', 'main');
      stubGitRevListCount('1');

      const svc = new OrchestrationService(db, bp as unknown, projectDir);
      await svc.recoverOrphanedBranches();

      expect(mockInitiateDelivery).not.toHaveBeenCalled();
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

  describe('recoverBranchForAgent', () => {
    function insertAgentWithBranch(
      id: string,
      status: string,
      brainTask: string | null,
      branch: string | null
    ) {
      db.prepare(
        `INSERT INTO agents (id, name, parent, status, brain_task, branch, created_at, context)
         VALUES (?, 'test', 'root', ?, ?, ?, '2026-01-01', '{}')`
      ).run(id, status, brainTask, branch);
    }

    function stubGitRevListCount(count: string) {
      mockExecFileSync.mockImplementation((cmd: string, args: string[]) => {
        if (cmd === 'git' && args[0] === 'rev-list') return count;
        throw new Error(`unexpected exec: ${cmd} ${args.join(' ')}`);
      });
    }

    beforeEach(() => {
      mockInitiateDelivery.mockReset();
      mockGetPrForBranch.mockReset();
      mockExecFileSync.mockReset();
      mockMonitorDelivery.mockClear();
    });

    it('initiates delivery for the named agent when its branch is orphaned', async () => {
      insertAgentWithBranch('exit1', 'completed', 'VNM-56.40', 'agent/VNM-56/VNM-56.40');
      stubGitRevListCount('3');
      mockGetPrForBranch.mockReturnValue(null);
      mockInitiateDelivery.mockResolvedValue({
        agent_id: 'exit1',
        task_id: 'VNM-56.40',
        branch: 'agent/VNM-56/VNM-56.40',
        status: 'pr-open',
        pr_number: 600,
      });

      await recoverBranchForAgent(db, 'exit1', projectDir);

      expect(mockInitiateDelivery).toHaveBeenCalledWith(
        db,
        'exit1',
        'VNM-56.40',
        'agent/VNM-56/VNM-56.40',
        projectDir
      );
    });

    it('does not start a monitor (left to dispatch loop / next-startup recover)', async () => {
      insertAgentWithBranch('exit2', 'completed', 'VNM-56.41', 'agent/VNM-56/VNM-56.41');
      stubGitRevListCount('1');
      mockGetPrForBranch.mockReturnValue(null);
      mockInitiateDelivery.mockResolvedValue({
        agent_id: 'exit2',
        task_id: 'VNM-56.41',
        branch: 'agent/VNM-56/VNM-56.41',
        status: 'pr-open',
        pr_number: 601,
      });

      await recoverBranchForAgent(db, 'exit2', projectDir);

      expect(mockMonitorDelivery).not.toHaveBeenCalled();
    });

    it('skips when delivery already progressed past initiation', async () => {
      insertAgentWithBranch('skip1', 'completed', 'VNM-56.42', 'agent/VNM-56/VNM-56.42');
      db.exec(`
        INSERT INTO delivery_states (agent_id, task_id, branch, status, created_at, updated_at)
        VALUES ('skip1', 'VNM-56.42', 'agent/VNM-56/VNM-56.42', 'pr-open',
                '2026-01-01', '2026-01-01')
      `);
      stubGitRevListCount('2');
      mockGetPrForBranch.mockReturnValue(null);

      await recoverBranchForAgent(db, 'skip1', projectDir);

      expect(mockInitiateDelivery).not.toHaveBeenCalled();
    });

    it('skips when branch has no commits ahead of origin/main', async () => {
      insertAgentWithBranch('skip2', 'completed', 'VNM-56.43', 'agent/VNM-56/VNM-56.43');
      stubGitRevListCount('0');
      mockGetPrForBranch.mockReturnValue(null);

      await recoverBranchForAgent(db, 'skip2', projectDir);

      expect(mockInitiateDelivery).not.toHaveBeenCalled();
    });

    it('skips when branch already has an open PR', async () => {
      insertAgentWithBranch('skip3', 'completed', 'VNM-56.44', 'agent/VNM-56/VNM-56.44');
      stubGitRevListCount('2');
      mockGetPrForBranch.mockReturnValue({
        number: 99,
        branch: 'agent/VNM-56/VNM-56.44',
        checksPass: true,
        mergeable: true,
        state: 'open',
        failedChecks: [],
      });

      await recoverBranchForAgent(db, 'skip3', projectDir);

      expect(mockInitiateDelivery).not.toHaveBeenCalled();
    });

    it('skips agents that are still active', async () => {
      insertAgentWithBranch('active', 'active', 'VNM-56.45', 'agent/VNM-56/VNM-56.45');
      stubGitRevListCount('1');
      mockGetPrForBranch.mockReturnValue(null);

      await recoverBranchForAgent(db, 'active', projectDir);

      expect(mockInitiateDelivery).not.toHaveBeenCalled();
    });

    it('skips agents without a branch', async () => {
      insertAgentWithBranch('nobranch', 'completed', 'VNM-56.46', null);

      await recoverBranchForAgent(db, 'nobranch', projectDir);

      expect(mockInitiateDelivery).not.toHaveBeenCalled();
    });

    it('no-ops when agent is unknown', async () => {
      await expect(recoverBranchForAgent(db, 'missing', projectDir)).resolves.toBeUndefined();
      expect(mockInitiateDelivery).not.toHaveBeenCalled();
    });

    it('swallows initiateDelivery failures', async () => {
      insertAgentWithBranch('fail1', 'completed', 'VNM-56.47', 'agent/VNM-56/VNM-56.47');
      stubGitRevListCount('1');
      mockGetPrForBranch.mockReturnValue(null);
      mockInitiateDelivery.mockRejectedValue(new Error('gh auth failed'));

      await expect(recoverBranchForAgent(db, 'fail1', projectDir)).resolves.toBeUndefined();
    });
  });
});
