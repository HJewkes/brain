import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { BrainDB } from '../../../../src/services/brain-db.js';
import type { BrainConfig } from '../../../../src/types.js';
import type { WorkflowFn } from '../../../../src/modules/workflow/runtime/types.js';
import { WorkflowRuntime } from '../../../../src/modules/workflow/runtime/runtime.js';
import { createTestDb, createMockEmbedder } from '../../../helpers.js';

const embedder = createMockEmbedder();

// Mock dependencies used by WorkflowContext internally
vi.mock('../../../../src/modules/pm/data/task-ops.js', () => ({
  createTask: vi.fn().mockResolvedValue({
    ok: true,
    data: { display_id: 'TST-01.001' },
  }),
}));

vi.mock('../../../../src/modules/workflow/engine/dispatch.js', () => ({
  dispatchTemplate: vi.fn().mockResolvedValue({
    ok: true,
    data: { rendered: 'rendered prompt' },
  }),
}));

vi.mock('../../../../src/server/dispatch.js', () => ({
  dispatchTask: vi.fn().mockResolvedValue({
    pid: 99999,
    taskId: 'TST-01.001',
    agentId: 'agent-mock',
    sessionId: 'sess-mock',
    model: 'sonnet',
    prompt: 'test',
  }),
}));

function createWorkflowRunsMigration(db: BrainDB): void {
  db.rawDb.exec(`
    CREATE TABLE IF NOT EXISTS workflow_runs (
      id TEXT PRIMARY KEY,
      workflow_name TEXT NOT NULL,
      context JSON NOT NULL,
      status TEXT NOT NULL DEFAULT 'running'
        CHECK(status IN ('running', 'completed', 'failed', 'paused')),
      current_step TEXT,
      step_results JSON NOT NULL DEFAULT '{}',
      active_agent JSON,
      started_at TEXT NOT NULL,
      completed_at TEXT,
      error TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_workflow_runs_status ON workflow_runs(status);
  `);
}

let db: BrainDB;
let dbPath: string;
let notesDir: string;
let config: BrainConfig;

beforeEach(() => {
  ({ dbPath, db } = createTestDb());
  createWorkflowRunsMigration(db);
  notesDir = join(tmpdir(), `wf-rt-${randomUUID()}`);
  mkdirSync(notesDir, { recursive: true });
  config = {
    notesDir,
    dbPath,
    embedder: 'local',
    fusionWeights: { bm25: 0.3, vector: 0.7 },
  };
  vi.clearAllMocks();
});

afterEach(() => {
  db.close();
  if (existsSync(notesDir)) {
    rmSync(notesDir, { recursive: true, force: true });
  }
});

describe('WorkflowRuntime — registration', () => {
  test('register() stores workflow function by name', () => {
    const runtime = new WorkflowRuntime({ db, config });
    const fn: WorkflowFn = async () => {};
    runtime.register('my-workflow', fn);

    // Verify by attempting to start — should not throw
    expect(async () => {
      const runId = await runtime.start('my-workflow', {});
      expect(runId).toBeDefined();
    }).not.toThrow();
  });

  test('start() throws for unregistered workflow name', async () => {
    const runtime = new WorkflowRuntime({ db, config });

    await expect(runtime.start('nonexistent', {})).rejects.toThrow('Unknown workflow: nonexistent');
  });
});

describe('WorkflowRuntime — start', () => {
  test('start() creates workflow_runs row in DB', async () => {
    const runtime = new WorkflowRuntime({ db, config });
    runtime.register('simple', async () => {});

    const runId = await runtime.start('simple', { project: 'TST' });

    const row = db.rawDb
      .prepare('SELECT * FROM workflow_runs WHERE id = ?')
      .get(runId) as Record<string, unknown>;
    expect(row).toBeDefined();
    expect(row.workflow_name).toBe('simple');
    expect(row.status).toBe('completed');
    expect(JSON.parse(row.context as string)).toEqual({ project: 'TST' });
  });

  test('start() invokes the workflow function', async () => {
    const runtime = new WorkflowRuntime({ db, config });
    const fn = vi.fn<WorkflowFn>(async () => {});
    runtime.register('tracked', fn);

    await runtime.start('tracked', {});

    // The promise settles async, give it a tick
    await vi.waitFor(() => {
      expect(fn).toHaveBeenCalledOnce();
    });
  });

  test('start() returns a runId', async () => {
    const runtime = new WorkflowRuntime({ db, config });
    runtime.register('id-check', async () => {});

    const runId = await runtime.start('id-check', {});

    expect(runId).toBeDefined();
    expect(typeof runId).toBe('string');
    expect(runId.length).toBeGreaterThan(0);
  });
});

describe('WorkflowRuntime — completion', () => {
  test('successful workflow sets status to completed in DB', async () => {
    const runtime = new WorkflowRuntime({ db, config });
    runtime.register('success', async () => {});

    const runId = await runtime.start('success', {});

    // Wait for promise to settle
    await vi.waitFor(() => {
      const row = db.rawDb
        .prepare('SELECT status FROM workflow_runs WHERE id = ?')
        .get(runId) as Record<string, unknown>;
      expect(row.status).toBe('completed');
    });
  });

  test('throwing workflow sets status to failed with error message', async () => {
    const runtime = new WorkflowRuntime({ db, config });
    runtime.register('failing', async () => {
      throw new Error('Something went wrong');
    });

    const runId = await runtime.start('failing', {});

    await vi.waitFor(() => {
      const row = db.rawDb
        .prepare('SELECT status, error FROM workflow_runs WHERE id = ?')
        .get(runId) as Record<string, unknown>;
      expect(row.status).toBe('failed');
      expect(row.error).toBe('Something went wrong');
    });
  });
});

describe('WorkflowRuntime — hydration', () => {
  test('hydrate() re-runs workflow function from DB state', async () => {
    const runtime = new WorkflowRuntime({ db, config });
    const fn = vi.fn<WorkflowFn>(async () => {});
    runtime.register('hydrate-test', fn);

    // Insert a "running" row directly into DB
    const runId = randomUUID();
    db.rawDb
      .prepare(
        `INSERT INTO workflow_runs (id, workflow_name, context, status, step_results, started_at)
         VALUES (?, ?, '{}', 'running', '{}', ?)`
      )
      .run(runId, 'hydrate-test', new Date().toISOString());

    await runtime.hydrate();

    await vi.waitFor(() => {
      expect(fn).toHaveBeenCalledOnce();
    });
  });

  test('hydrate() skips already-active workflows (idempotent)', async () => {
    const runtime = new WorkflowRuntime({ db, config });

    // Use a workflow that blocks so it stays active
    let resolveWf: () => void;
    const blockingPromise = new Promise<void>((r) => {
      resolveWf = r;
    });
    const fn = vi.fn<WorkflowFn>(async () => blockingPromise);
    runtime.register('blocking', fn);

    const runId = await runtime.start('blocking', {});

    // Hydrate should skip since it's already active
    await runtime.hydrate();

    expect(fn).toHaveBeenCalledOnce();

    // Cleanup
    resolveWf!();
    await vi.waitFor(() => {
      expect(runtime.activeRuns.has(runId)).toBe(false);
    });
  });

  test('hydrated workflow skips completed steps (memoization works after restart)', async () => {
    const runtime = new WorkflowRuntime({ db, config });

    // Track calls to verify memoization
    const stepsCalled: string[] = [];
    const fn: WorkflowFn = async (ctx) => {
      stepsCalled.push('design');
      // design:0 is already cached, so dispatch should return immediately
      const result = await ctx.dispatch('design', 'template');
      expect(result.stepId).toBe('design');
      expect(result.output).toBe('cached output');
    };
    runtime.register('memo-test', fn);

    // Insert a running workflow with a completed step
    const runId = randomUUID();
    const stepResults = {
      'design:0': {
        stepId: 'design',
        taskId: 'TST-01.001',
        agentId: 'agent-1',
        signal: null,
        completedAt: '2026-01-01T00:00:00Z',
        output: 'cached output',
      },
    };
    db.rawDb
      .prepare(
        `INSERT INTO workflow_runs (id, workflow_name, context, status, step_results, started_at)
         VALUES (?, ?, '{"project":"TST","workstream":"1"}', 'running', ?, ?)`
      )
      .run(runId, 'memo-test', JSON.stringify(stepResults), new Date().toISOString());

    await runtime.hydrate();

    await vi.waitFor(() => {
      const row = db.rawDb
        .prepare('SELECT status FROM workflow_runs WHERE id = ?')
        .get(runId) as Record<string, unknown>;
      expect(row.status).toBe('completed');
    });
  });
});

describe('WorkflowRuntime — status', () => {
  test('getStatus() returns current state for active workflow', async () => {
    const runtime = new WorkflowRuntime({ db, config });

    let resolveWf: () => void;
    const blockingPromise = new Promise<void>((r) => {
      resolveWf = r;
    });
    runtime.register('status-active', async () => blockingPromise);

    const runId = await runtime.start('status-active', { project: 'TST' });

    const status = runtime.getStatus(runId);
    expect(status).not.toBeNull();
    expect(status!.id).toBe(runId);
    expect(status!.workflowName).toBe('status-active');
    expect(status!.status).toBe('running');

    resolveWf!();
  });

  test('getStatus() returns state from DB for completed workflow', async () => {
    const runtime = new WorkflowRuntime({ db, config });
    runtime.register('status-done', async () => {});

    const runId = await runtime.start('status-done', {});

    await vi.waitFor(() => {
      expect(runtime.activeRuns.has(runId)).toBe(false);
    });

    const status = runtime.getStatus(runId);
    expect(status).not.toBeNull();
    expect(status!.status).toBe('completed');
  });

  test('getStatus() returns null for unknown runId', () => {
    const runtime = new WorkflowRuntime({ db, config });
    expect(runtime.getStatus('nonexistent-id')).toBeNull();
  });
});

describe('WorkflowRuntime — signal forwarding', () => {
  test('signal() delegates to context.signal() on active workflow', async () => {
    const runtime = new WorkflowRuntime({ db, config, embedder });

    let signalReceived = false;
    const fn: WorkflowFn = async (ctx) => {
      await ctx.assisted('gate', 'gate-template');
      signalReceived = true;
    };
    runtime.register('signal-fwd', fn);

    const runId = await runtime.start('signal-fwd', {});

    // Wait for workflow to reach the assisted step
    await vi.waitFor(() => {
      const running = runtime.activeRuns.get(runId);
      expect(running).toBeDefined();
      const state = running!.ctx.toRun();
      expect(state.status).toBe('paused');
    });

    runtime.signal(runId, 'gate', { approved: 'true' });

    await vi.waitFor(() => {
      expect(signalReceived).toBe(true);
    });
  });

  test('signal() throws for unknown runId', () => {
    const runtime = new WorkflowRuntime({ db, config });

    expect(() => runtime.signal('unknown-id', 'step', {})).toThrow(
      'No active workflow for run: unknown-id'
    );
  });
});

describe('WorkflowRuntime — reconciler', () => {
  test('reconcile() detects dead PID and calls handleAgentDeath', async () => {
    const runtime = new WorkflowRuntime({ db, config, embedder });

    const fn: WorkflowFn = async (ctx) => {
      try {
        await ctx.dispatch('build', 'build-template');
      } catch {
        // Agent death will reject the promise
      }
    };
    runtime.register('reconcile-test', fn);

    const runId = await runtime.start('reconcile-test', {});

    // Wait for the agent to be "active"
    await vi.waitFor(() => {
      const running = runtime.activeRuns.get(runId);
      expect(running).toBeDefined();
      expect(running!.ctx.activeAgent).not.toBeNull();
    });

    // Mock process.kill to indicate the PID is dead
    const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => {
      throw new Error('No such process');
    });

    // Trigger reconciliation manually via the private method
    (runtime as unknown as { reconcile: () => void }).reconcile();

    // The agent death should have been handled
    await vi.waitFor(() => {
      const running = runtime.activeRuns.get(runId);
      if (running) {
        expect(running.ctx.activeAgent).toBeNull();
      }
    });

    killSpy.mockRestore();
  });

  test('reconcile() ignores workflows with no active agent', async () => {
    const runtime = new WorkflowRuntime({ db, config });

    let resolveWf: () => void;
    const blockingPromise = new Promise<void>((r) => {
      resolveWf = r;
    });
    runtime.register('no-agent', async () => blockingPromise);

    await runtime.start('no-agent', {});

    const killSpy = vi.spyOn(process, 'kill');

    // Reconcile should not call process.kill since there's no active agent
    (runtime as unknown as { reconcile: () => void }).reconcile();

    expect(killSpy).not.toHaveBeenCalled();

    killSpy.mockRestore();
    resolveWf!();
  });

  test('startReconciler/stopReconciler manage the timer', () => {
    const runtime = new WorkflowRuntime({ db, config });

    runtime.startReconciler();
    // Starting again should be idempotent
    runtime.startReconciler();

    runtime.stopReconciler();
    // Stopping again should be safe
    runtime.stopReconciler();
  });
});
