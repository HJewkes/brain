import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { BrainDB } from '../../../../src/services/brain-db.js';
import type { BrainConfig } from '../../../../src/types.js';
import type { WorkflowFn } from '../../../../src/modules/workflow/runtime/types.js';
import { WorkflowRuntime } from '../../../../src/modules/workflow/runtime/runtime.js';
import { AgentDeathError } from '../../../../src/modules/workflow/runtime/context.js';
import { createTestDb, createMockEmbedder } from '../../../helpers.js';

const embedder = createMockEmbedder();

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

let spawnCallCount = 0;

vi.mock('../../../../src/server/dispatch.js', () => ({
  dispatchTask: vi.fn().mockImplementation(() => {
    spawnCallCount++;
    return Promise.resolve({
      pid: 99999,
      taskId: 'TST-01.001',
      agentId: `agent-${spawnCallCount}`,
      sessionId: 'sess-mock',
      model: 'sonnet',
      prompt: 'test',
    });
  }),
}));

vi.mock('../../../../src/modules/agents/data.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    findAgentByTask: vi.fn().mockReturnValue(null),
    getAgentContext: vi.fn().mockReturnValue(undefined),
  };
});

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
  notesDir = join(tmpdir(), `wf-sv-${randomUUID()}`);
  mkdirSync(notesDir, { recursive: true });
  config = {
    notesDir,
    dbPath,
    embedder: 'local',
    fusionWeights: { bm25: 0.3, vector: 0.7 },
  };
  spawnCallCount = 0;
  vi.clearAllMocks();
});

afterEach(() => {
  db.close();
  if (existsSync(notesDir)) {
    rmSync(notesDir, { recursive: true, force: true });
  }
});

describe('Agent death detection', () => {
  test('reconcile() detects dead PID and triggers retry then fails on second death', async () => {
    const runtime = new WorkflowRuntime({ db, config, embedder });

    let caughtError: unknown = null;
    const fn: WorkflowFn = async (ctx) => {
      try {
        await ctx.dispatch('build', 'build-template');
      } catch (err) {
        caughtError = err;
      }
    };
    runtime.register('death-detect', fn);

    const runId = await runtime.start('death-detect', {});

    // Wait for first agent
    await vi.waitFor(() => {
      const running = runtime.activeRuns.get(runId);
      expect(running).toBeDefined();
      expect(running!.ctx.activeAgent).not.toBeNull();
    });

    const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => {
      throw new Error('No such process');
    });

    // First death triggers retry
    (runtime as unknown as { reconcile: () => void }).reconcile();

    // Wait for retry agent to spawn
    await vi.waitFor(() => {
      const running = runtime.activeRuns.get(runId);
      expect(running).toBeDefined();
      expect(running!.ctx.activeAgent).not.toBeNull();
    });

    // Second death exhausts retries, propagates AgentDeathError
    (runtime as unknown as { reconcile: () => void }).reconcile();

    await vi.waitFor(() => {
      expect(caughtError).toBeInstanceOf(AgentDeathError);
    });

    killSpy.mockRestore();
  });

  test('reconcile() skips alive PIDs', async () => {
    const runtime = new WorkflowRuntime({ db, config, embedder });

    const fn: WorkflowFn = async (ctx) => {
      await ctx.dispatch('build', 'build-template');
    };
    runtime.register('alive-test', fn);

    const runId = await runtime.start('alive-test', {});

    await vi.waitFor(() => {
      const running = runtime.activeRuns.get(runId);
      expect(running).toBeDefined();
      expect(running!.ctx.activeAgent).not.toBeNull();
    });

    // process.kill(pid, 0) succeeds for alive processes — mock returns true
    const killSpy = vi.spyOn(process, 'kill').mockReturnValue(true);

    (runtime as unknown as { reconcile: () => void }).reconcile();

    // Agent should still be active
    const running = runtime.activeRuns.get(runId);
    expect(running!.ctx.activeAgent).not.toBeNull();

    killSpy.mockRestore();

    // Clean up: resolve the agent so the workflow completes
    running!.ctx.resolveAgent('build', 'done');
  });

  test('reconcile() skips workflows with no active agent', async () => {
    const runtime = new WorkflowRuntime({ db, config });

    let resolveWf: () => void;
    const blockingPromise = new Promise<void>((r) => {
      resolveWf = r;
    });
    runtime.register('no-agent', async () => blockingPromise);

    await runtime.start('no-agent', {});

    const killSpy = vi.spyOn(process, 'kill');

    (runtime as unknown as { reconcile: () => void }).reconcile();

    expect(killSpy).not.toHaveBeenCalled();

    killSpy.mockRestore();
    resolveWf!();
  });
});

describe('Retry on agent death', () => {
  test('dispatch() retries once on first agent death', async () => {
    const channelEvents: Array<{ event: string; meta: Record<string, string> }> = [];

    const runtimeWithChannel = new WorkflowRuntime({
      db,
      config,
      embedder,
      channelPush: (event, meta) => channelEvents.push({ event, meta }),
    });

    const fn: WorkflowFn = async (ctx) => {
      await ctx.dispatch('build', 'build-template');
    };
    runtimeWithChannel.register('retry-once', fn);

    const runId = await runtimeWithChannel.start('retry-once', {});

    // Wait for first agent spawn
    await vi.waitFor(() => {
      const running = runtimeWithChannel.activeRuns.get(runId);
      expect(running).toBeDefined();
      expect(running!.ctx.activeAgent).not.toBeNull();
    });

    // Kill the first agent
    const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => {
      throw new Error('No such process');
    });

    (runtimeWithChannel as unknown as { reconcile: () => void }).reconcile();

    // Wait for the retry to spawn a new agent
    await vi.waitFor(() => {
      const running = runtimeWithChannel.activeRuns.get(runId);
      expect(running).toBeDefined();
      expect(running!.ctx.activeAgent).not.toBeNull();
    });

    // Verify step_retry was emitted
    expect(channelEvents.some((e) => e.event === 'step_retry')).toBe(true);

    // Now resolve the retried agent
    const running = runtimeWithChannel.activeRuns.get(runId)!;
    running.ctx.resolveAgent('build', 'success output');

    await vi.waitFor(() => {
      const row = db.rawDb
        .prepare('SELECT status FROM workflow_runs WHERE id = ?')
        .get(runId) as Record<string, unknown>;
      expect(row.status).toBe('completed');
    });

    killSpy.mockRestore();
  });

  test('dispatch() throws after retry exhausted on second death', async () => {
    const channelEvents: Array<{ event: string; meta: Record<string, string> }> = [];

    const runtime = new WorkflowRuntime({
      db,
      config,
      embedder,
      channelPush: (event, meta) => channelEvents.push({ event, meta }),
    });

    let caughtError: unknown = null;
    const fn: WorkflowFn = async (ctx) => {
      try {
        await ctx.dispatch('build', 'build-template');
      } catch (err) {
        caughtError = err;
        throw err;
      }
    };
    runtime.register('retry-exhaust', fn);

    const runId = await runtime.start('retry-exhaust', {});

    // Wait for first agent
    await vi.waitFor(() => {
      const running = runtime.activeRuns.get(runId);
      expect(running).toBeDefined();
      expect(running!.ctx.activeAgent).not.toBeNull();
    });

    const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => {
      throw new Error('No such process');
    });

    // Kill first agent — triggers retry
    (runtime as unknown as { reconcile: () => void }).reconcile();

    // Wait for retry agent to spawn
    await vi.waitFor(() => {
      const running = runtime.activeRuns.get(runId);
      expect(running).toBeDefined();
      expect(running!.ctx.activeAgent).not.toBeNull();
    });

    // Kill the retry agent — should exhaust retries
    (runtime as unknown as { reconcile: () => void }).reconcile();

    await vi.waitFor(() => {
      expect(caughtError).toBeInstanceOf(AgentDeathError);
    });

    // Verify step_failed was emitted
    expect(channelEvents.some((e) => e.event === 'step_failed')).toBe(true);

    // Workflow should be marked as failed
    await vi.waitFor(() => {
      const row = db.rawDb
        .prepare('SELECT status FROM workflow_runs WHERE id = ?')
        .get(runId) as Record<string, unknown>;
      expect(row.status).toBe('failed');
    });

    killSpy.mockRestore();
  });

  test('step_failed channel event includes error details', async () => {
    const channelEvents: Array<{ event: string; meta: Record<string, string> }> = [];

    const runtime = new WorkflowRuntime({
      db,
      config,
      embedder,
      channelPush: (event, meta) => channelEvents.push({ event, meta }),
    });

    const fn: WorkflowFn = async (ctx) => {
      try {
        await ctx.dispatch('build', 'build-template');
      } catch {
        throw new Error('Agent died permanently');
      }
    };
    runtime.register('channel-event', fn);

    const runId = await runtime.start('channel-event', {});

    await vi.waitFor(() => {
      const running = runtime.activeRuns.get(runId);
      expect(running).toBeDefined();
      expect(running!.ctx.activeAgent).not.toBeNull();
    });

    const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => {
      throw new Error('No such process');
    });

    // Kill first agent (triggers retry)
    (runtime as unknown as { reconcile: () => void }).reconcile();

    // Wait for retry agent
    await vi.waitFor(() => {
      const running = runtime.activeRuns.get(runId);
      expect(running).toBeDefined();
      expect(running!.ctx.activeAgent).not.toBeNull();
    });

    // Kill retry agent (exhausts retries)
    (runtime as unknown as { reconcile: () => void }).reconcile();

    await vi.waitFor(() => {
      const failEvent = channelEvents.find((e) => e.event === 'step_failed');
      expect(failEvent).toBeDefined();
      expect(failEvent!.meta.step).toBe('build');
      expect(failEvent!.meta.workflow).toBe(runId);
      expect(failEvent!.meta.error).toContain('Agent died');
    });

    killSpy.mockRestore();
  });
});

describe('Hydration with stale agents', () => {
  test('hydrate() caches result when agent completed while server was down', async () => {
    const { findAgentByTask } = await import('../../../../src/modules/agents/data.js');
    const findMock = vi.mocked(findAgentByTask);

    findMock.mockReturnValue({
      id: 'agent-completed',
      name: 'test-agent',
      parent: 'workflow',
      status: 'completed',
      brain_task: 'TST-01.001',
      claim_token: null,
      branch: null,
      worktree_path: null,
      ownership: null,
      dod_spec: null,
      pid: 12345,
      created_at: '2026-01-01T00:00:00Z',
      started_at: '2026-01-01T00:00:00Z',
      completed_at: '2026-01-01T00:01:00Z',
      summary: 'Agent completed successfully',
      exit_reason: null,
      context: '{}',
    });

    const runtime = new WorkflowRuntime({ db, config, embedder });

    const fn: WorkflowFn = async (ctx) => {
      await ctx.dispatch('design', 'design-template');
    };
    runtime.register('hydrate-completed', fn);

    // Insert a running workflow with an active agent
    const runId = randomUUID();
    const activeAgent = { pid: 12345, taskId: 'TST-01.001', stepId: 'design' };
    db.rawDb
      .prepare(
        `INSERT INTO workflow_runs (id, workflow_name, context, status, step_results, active_agent, started_at)
         VALUES (?, ?, '{"project":"TST","workstream":"1"}', 'running', '{}', ?, ?)`
      )
      .run(runId, 'hydrate-completed', JSON.stringify(activeAgent), new Date().toISOString());

    await runtime.hydrate();

    await vi.waitFor(() => {
      const row = db.rawDb
        .prepare('SELECT status, step_results FROM workflow_runs WHERE id = ?')
        .get(runId) as Record<string, unknown>;
      expect(row.status).toBe('completed');
      const results = JSON.parse(row.step_results as string) as Record<string, unknown>;
      expect(results['design:0']).toBeDefined();
    });

    findMock.mockReset();
  });

  test('hydrate() clears activeAgent when agent died while server was down', async () => {
    const { findAgentByTask } = await import('../../../../src/modules/agents/data.js');
    const findMock = vi.mocked(findAgentByTask);

    findMock.mockReturnValue({
      id: 'agent-failed',
      name: 'test-agent',
      parent: 'workflow',
      status: 'failed',
      brain_task: 'TST-01.001',
      claim_token: null,
      branch: null,
      worktree_path: null,
      ownership: null,
      dod_spec: null,
      pid: 12345,
      created_at: '2026-01-01T00:00:00Z',
      started_at: '2026-01-01T00:00:00Z',
      completed_at: '2026-01-01T00:01:00Z',
      summary: null,
      exit_reason: 'crashed',
      context: '{}',
    });

    const runtime = new WorkflowRuntime({ db, config, embedder });
    runtime.register('hydrate-dead', async () => {});

    const runId = randomUUID();
    const activeAgent = { pid: 12345, taskId: 'TST-01.001', stepId: 'build' };
    db.rawDb
      .prepare(
        `INSERT INTO workflow_runs (id, workflow_name, context, status, step_results, active_agent, started_at)
         VALUES (?, ?, '{}', 'running', '{}', ?, ?)`
      )
      .run(runId, 'hydrate-dead', JSON.stringify(activeAgent), new Date().toISOString());

    await runtime.hydrate();

    // activeAgent should have been cleared in DB
    const row = db.rawDb
      .prepare('SELECT active_agent FROM workflow_runs WHERE id = ?')
      .get(runId) as Record<string, unknown>;
    expect(row.active_agent).toBeNull();

    findMock.mockReset();
  });

  test('hydrate() clears activeAgent when agent record not found', async () => {
    const { findAgentByTask } = await import('../../../../src/modules/agents/data.js');
    const findMock = vi.mocked(findAgentByTask);
    findMock.mockReturnValue(null);

    const runtime = new WorkflowRuntime({ db, config, embedder });
    runtime.register('hydrate-missing', async () => {});

    const runId = randomUUID();
    const activeAgent = { pid: 12345, taskId: 'TST-01.001', stepId: 'build' };
    db.rawDb
      .prepare(
        `INSERT INTO workflow_runs (id, workflow_name, context, status, step_results, active_agent, started_at)
         VALUES (?, ?, '{}', 'running', '{}', ?, ?)`
      )
      .run(runId, 'hydrate-missing', JSON.stringify(activeAgent), new Date().toISOString());

    await runtime.hydrate();

    const row = db.rawDb
      .prepare('SELECT active_agent FROM workflow_runs WHERE id = ?')
      .get(runId) as Record<string, unknown>;
    expect(row.active_agent).toBeNull();

    findMock.mockReset();
  });

  test('hydrate() leaves activeAgent when agent is still active', async () => {
    const { findAgentByTask } = await import('../../../../src/modules/agents/data.js');
    const findMock = vi.mocked(findAgentByTask);

    findMock.mockReturnValue({
      id: 'agent-active',
      name: 'test-agent',
      parent: 'workflow',
      status: 'active',
      brain_task: 'TST-01.001',
      claim_token: null,
      branch: null,
      worktree_path: null,
      ownership: null,
      dod_spec: null,
      pid: 12345,
      created_at: '2026-01-01T00:00:00Z',
      started_at: '2026-01-01T00:00:00Z',
      completed_at: null,
      summary: null,
      exit_reason: null,
      context: '{}',
    });

    const runtime = new WorkflowRuntime({ db, config, embedder });

    let resolveWf: () => void;
    const blockingPromise = new Promise<void>((r) => {
      resolveWf = r;
    });
    const fn: WorkflowFn = async () => blockingPromise;
    runtime.register('hydrate-active', fn);

    const runId = randomUUID();
    const activeAgent = { pid: 12345, taskId: 'TST-01.001', stepId: 'build' };
    db.rawDb
      .prepare(
        `INSERT INTO workflow_runs (id, workflow_name, context, status, step_results, active_agent, started_at)
         VALUES (?, ?, '{}', 'running', '{}', ?, ?)`
      )
      .run(runId, 'hydrate-active', JSON.stringify(activeAgent), new Date().toISOString());

    await runtime.hydrate();

    // activeAgent should still be present in the run
    const running = runtime.activeRuns.get(runId);
    expect(running).toBeDefined();
    expect(running!.ctx.activeAgent).not.toBeNull();

    findMock.mockReset();
    resolveWf!();
  });
});
