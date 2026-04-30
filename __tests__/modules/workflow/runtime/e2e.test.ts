/**
 * Workflow Executor V2 — in-process E2E tests.
 *
 * Covers AC-01 through AC-10 and EC-01 through EC-04 from
 * .plans/v2-e2e-low-01/acceptance-criteria.md.
 *
 * Uses a real BrainDB + WorkflowRuntime with mocked infrastructure
 * (no actual agent subprocesses spawned).
 */
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { BrainDB } from '../../../../src/services/brain-db.js';
import type { BrainConfig } from '../../../../src/types.js';
import type { WorkflowFn } from '../../../../src/modules/workflow/runtime/types.js';
import { WorkflowRuntime } from '../../../../src/modules/workflow/runtime/runtime.js';
import { planningWorkflow } from '../../../../src/modules/workflow/flows/planning.js';
import { createTestDb, createMockEmbedder } from '../../../helpers.js';
import { createWorkflowRunsTable, resolveAllAgents } from '../helpers.js';

// ---------------------------------------------------------------------------
// Module-level mocks
// ---------------------------------------------------------------------------

vi.mock('../../../../src/modules/pm/data/task-ops.js', () => ({
  createTask: vi.fn().mockResolvedValue({
    ok: true,
    data: { display_id: 'VNM-01.001' },
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
    pid: 55555,
    taskId: 'VNM-01.001',
    agentId: 'agent-mock',
    sessionId: 'sess-mock',
    model: 'sonnet',
    prompt: 'x',
  }),
}));

// ---------------------------------------------------------------------------
// Inline workflow fixtures
// ---------------------------------------------------------------------------

const minimalWorkflow: WorkflowFn = async (ctx) => {
  await ctx.dispatch('step-a', 'template-a');
  await ctx.dispatch('step-b', 'template-b');
};

const assistedWorkflow: WorkflowFn = async (ctx) => {
  await ctx.dispatch('step-a', 'template-a');
  await ctx.assisted('review', 'template-review');
  await ctx.dispatch('step-b', 'template-b');
};

const criticLoopWorkflow: WorkflowFn = async (ctx) => {
  await ctx.dispatch('design', 'template-design');
  const critic = await ctx.dispatch('critic', 'template-critic');
  if (critic.signal === 'needs_revision') {
    await ctx.dispatch('design', 'template-design');
    await ctx.dispatch('critic', 'template-critic');
  }
  await ctx.dispatch('finalize', 'template-finalize');
};

// ---------------------------------------------------------------------------
// Shared test setup
// ---------------------------------------------------------------------------

const embedder = createMockEmbedder();

let db: BrainDB;
let dbPath: string;
let notesDir: string;
let config: BrainConfig;

beforeEach(() => {
  ({ dbPath, db } = createTestDb());
  createWorkflowRunsTable(db);
  notesDir = join(tmpdir(), `wf-e2e-v2-${randomUUID()}`);
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

// ---------------------------------------------------------------------------
// AC-01: Minimal workflow runs to completion
// ---------------------------------------------------------------------------

describe('AC-01: minimal workflow runs to completion', () => {
  test('start() drives minimalWorkflow to completed with both step results', async () => {
    const runtime = new WorkflowRuntime({ db, config, embedder });
    runtime.register('minimal', minimalWorkflow);

    const runId = await runtime.start('minimal', { project: 'VNM', projectDir: '/tmp' });
    await resolveAllAgents(runtime, runId);

    await vi.waitFor(() => {
      const row = db.rawDb
        .prepare('SELECT status, step_results FROM workflow_runs WHERE id = ?')
        .get(runId) as Record<string, unknown>;
      expect(row.status).toBe('completed');
      const results = JSON.parse(row.step_results as string) as Record<string, unknown>;
      expect(results['step-a:0']).toBeDefined();
      expect(results['step-b:0']).toBeDefined();
    });

    const status = runtime.getStatus(runId);
    expect(status).not.toBeNull();
    expect(status!.status).toBe('completed');
  });
});

// ---------------------------------------------------------------------------
// AC-02: Memoized replay skips completed steps
// ---------------------------------------------------------------------------

describe('AC-02: memoized replay skips completed steps', () => {
  test('hydrate() with pre-seeded step-a:0 skips step-a dispatch', async () => {
    const { dispatchTask } = await import('../../../../src/server/dispatch.js');
    const dispatchMock = vi.mocked(dispatchTask);

    const runId = randomUUID();
    const stepResults = {
      'step-a:0': {
        stepId: 'step-a',
        taskId: 'VNM-01.001',
        agentId: 'agent-1',
        signal: null,
        completedAt: '2026-01-01T00:00:00Z',
        output: 'cached step-a output',
      },
    };
    db.rawDb
      .prepare(
        `INSERT INTO workflow_runs (id, workflow_name, context, status, step_results, started_at)
         VALUES (?, ?, ?, 'running', ?, ?)`
      )
      .run(
        runId,
        'minimal',
        JSON.stringify({ project: 'VNM', projectDir: '/tmp' }),
        JSON.stringify(stepResults),
        new Date().toISOString()
      );

    const runtime = new WorkflowRuntime({ db, config, embedder });
    runtime.register('minimal', minimalWorkflow);
    await runtime.hydrate();

    await resolveAllAgents(runtime, runId);

    await vi.waitFor(() => {
      const row = db.rawDb
        .prepare('SELECT status FROM workflow_runs WHERE id = ?')
        .get(runId) as Record<string, unknown>;
      expect(row.status).toBe('completed');
    });

    // dispatchTask called exactly once: only for step-b
    expect(dispatchMock).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// AC-03: Hydration resumes from first uncached step
// ---------------------------------------------------------------------------

describe('AC-03: hydration resumes from first uncached step', () => {
  test('hydrate() with step-a:0 in DB dispatches only step-b', async () => {
    const { dispatchTask } = await import('../../../../src/server/dispatch.js');
    const dispatchMock = vi.mocked(dispatchTask);

    const runId = randomUUID();
    const stepResults = {
      'step-a:0': {
        stepId: 'step-a',
        taskId: 'VNM-01.001',
        agentId: 'agent-1',
        signal: null,
        completedAt: '2026-01-01T00:00:00Z',
      },
    };
    db.rawDb
      .prepare(
        `INSERT INTO workflow_runs (id, workflow_name, context, status, current_step, step_results, started_at)
         VALUES (?, ?, ?, 'running', 'step-b', ?, ?)`
      )
      .run(
        runId,
        'minimal',
        JSON.stringify({ project: 'VNM', projectDir: '/tmp' }),
        JSON.stringify(stepResults),
        new Date().toISOString()
      );

    const runtime = new WorkflowRuntime({ db, config, embedder });
    runtime.register('minimal', minimalWorkflow);
    await runtime.hydrate();

    await resolveAllAgents(runtime, runId);

    await vi.waitFor(() => {
      const row = db.rawDb
        .prepare('SELECT status FROM workflow_runs WHERE id = ?')
        .get(runId) as Record<string, unknown>;
      expect(row.status).toBe('completed');
    });

    expect(dispatchMock).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// AC-04: Assisted step pauses the workflow
// ---------------------------------------------------------------------------

describe('AC-04: assisted step pauses the workflow', () => {
  test('status is paused after step-a resolves and review is reached', async () => {
    const runtime = new WorkflowRuntime({ db, config, embedder });
    runtime.register('assisted', assistedWorkflow);

    const runId = await runtime.start('assisted', { project: 'VNM', projectDir: '/tmp' });

    // Resolve step-a so the workflow advances to the assisted step
    await vi.waitFor(() => {
      const running = runtime.activeRuns.get(runId);
      expect(running?.ctx.activeAgent?.stepId).toBe('step-a');
    });
    runtime.activeRuns.get(runId)!.ctx.resolveAgent('step-a', 'step-a done');

    // Wait for the workflow to pause at the assisted step
    await vi.waitFor(() => {
      const status = runtime.getStatus(runId);
      expect(status?.status).toBe('paused');
    });
  });
});

// ---------------------------------------------------------------------------
// AC-05: Signal unblocks an assisted step
// ---------------------------------------------------------------------------

describe('AC-05: signal unblocks an assisted step', () => {
  test('signal resumes paused workflow to completion with review result stored', async () => {
    const runtime = new WorkflowRuntime({ db, config, embedder });
    runtime.register('assisted', assistedWorkflow);

    const runId = await runtime.start('assisted', { project: 'VNM', projectDir: '/tmp' });

    // Resolve step-a
    await vi.waitFor(() => {
      expect(runtime.activeRuns.get(runId)?.ctx.activeAgent?.stepId).toBe('step-a');
    });
    runtime.activeRuns.get(runId)!.ctx.resolveAgent('step-a', 'step-a output');

    // Wait for pause at review
    await vi.waitFor(() => {
      expect(runtime.getStatus(runId)?.status).toBe('paused');
    });

    // Signal the review step to unblock
    runtime.signal(runId, 'review', { signal: 'approved' });

    // Resolve step-b and wait for completion
    await resolveAllAgents(runtime, runId);

    await vi.waitFor(() => {
      expect(runtime.getStatus(runId)?.status).toBe('completed');
    });

    // Assisted step result stored under bare stepId (not stepId:0)
    const status = runtime.getStatus(runId);
    expect(status!.stepResults['review']).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// AC-06: Critic revision loop re-dispatches design step
// ---------------------------------------------------------------------------

describe('AC-06: critic revision loop re-dispatches design step', () => {
  test('needs_revision on first critic triggers re-design; 5 total dispatches', async () => {
    const { dispatchTask } = await import('../../../../src/server/dispatch.js');
    const dispatchMock = vi.mocked(dispatchTask);

    const runtime = new WorkflowRuntime({ db, config, embedder });
    runtime.register('critic-loop', criticLoopWorkflow);

    const runId = await runtime.start('critic-loop', { project: 'VNM', projectDir: '/tmp' });

    let criticCallCount = 0;
    const outputFn = (stepId: string): string => {
      if (stepId === 'critic') {
        // First critic returns needs_revision, second approves
        return criticCallCount++ === 0 ? '## Verdict: NEEDS REVISION\n' : `output for ${stepId}`;
      }
      return `output for ${stepId}`;
    };

    await resolveAllAgents(runtime, runId, outputFn);

    await vi.waitFor(() => {
      expect(runtime.getStatus(runId)?.status).toBe('completed');
    });

    // design×2, critic×2, finalize×1 = 5 total dispatches
    expect(dispatchMock).toHaveBeenCalledTimes(5);
  });
});

// ---------------------------------------------------------------------------
// AC-07: Process supervision retries on first agent death
// ---------------------------------------------------------------------------

describe('AC-07: process supervision retries on first agent death', () => {
  test('first handleAgentDeath triggers retry; status remains running', async () => {
    const { dispatchTask } = await import('../../../../src/server/dispatch.js');
    const dispatchMock = vi.mocked(dispatchTask);

    const runtime = new WorkflowRuntime({ db, config, embedder });
    runtime.register('minimal', minimalWorkflow);

    const runId = await runtime.start('minimal', { project: 'VNM', projectDir: '/tmp' });

    // Wait for step-a to be active
    await vi.waitFor(() => {
      expect(runtime.activeRuns.get(runId)?.ctx.activeAgent?.stepId).toBe('step-a');
    });

    const agent = runtime.activeRuns.get(runId)!.ctx.activeAgent!;

    // First death — should trigger retry
    const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => {
      throw new Error('No such process');
    });
    (runtime as unknown as { reconcile(): void }).reconcile();

    // After retry, a new agent should be active
    await vi.waitFor(() => {
      expect(runtime.activeRuns.get(runId)?.ctx.activeAgent).not.toBeNull();
    });

    expect(runtime.getStatus(runId)?.status).toBe('running');
    // dispatchTask was called twice: original + retry for step-a
    expect(dispatchMock).toHaveBeenCalledTimes(2);

    killSpy.mockRestore();

    // Cleanup: resolve remaining steps
    await resolveAllAgents(runtime, runId);
    void agent; // suppress unused warning
  });
});

// ---------------------------------------------------------------------------
// AC-08: Process supervision fails on second agent death
// ---------------------------------------------------------------------------

describe('AC-08: process supervision fails on second agent death', () => {
  test('second handleAgentDeath exhausts retries; status becomes failed', async () => {
    const runtime = new WorkflowRuntime({ db, config, embedder });
    runtime.register('minimal', minimalWorkflow);

    const runId = await runtime.start('minimal', { project: 'VNM', projectDir: '/tmp' });

    await vi.waitFor(() => {
      expect(runtime.activeRuns.get(runId)?.ctx.activeAgent?.stepId).toBe('step-a');
    });

    const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => {
      throw new Error('No such process');
    });

    // First death — retry
    (runtime as unknown as { reconcile(): void }).reconcile();

    await vi.waitFor(() => {
      expect(runtime.activeRuns.get(runId)?.ctx.activeAgent).not.toBeNull();
    });

    // Second death — exhausts retries → failed
    (runtime as unknown as { reconcile(): void }).reconcile();

    await vi.waitFor(() => {
      const row = db.rawDb
        .prepare('SELECT status, error FROM workflow_runs WHERE id = ?')
        .get(runId) as Record<string, unknown>;
      expect(row.status).toBe('failed');
      expect(row.error).toContain('Agent died');
    });

    killSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// AC-09: Channel push emits step_complete and workflow_complete events
// ---------------------------------------------------------------------------

describe('AC-09: channel push emits correct events', () => {
  test('minimalWorkflow completion emits step_complete×2 then workflow_complete×1', async () => {
    const channelPush = vi.fn();
    const runtime = new WorkflowRuntime({ db, config, embedder, channelPush });
    runtime.register('minimal', minimalWorkflow);

    const runId = await runtime.start('minimal', { project: 'VNM', projectDir: '/tmp' });
    await resolveAllAgents(runtime, runId);

    await vi.waitFor(() => {
      expect(runtime.getStatus(runId)?.status).toBe('completed');
    });

    const stepCompleteEvents = channelPush.mock.calls.filter((c) => c[0] === 'step_complete');
    const workflowCompleteEvents = channelPush.mock.calls.filter(
      (c) => c[0] === 'workflow_complete'
    );

    expect(stepCompleteEvents).toHaveLength(2);
    expect(workflowCompleteEvents).toHaveLength(1);
    expect(channelPush).toHaveBeenCalledTimes(3);
  });
});

// ---------------------------------------------------------------------------
// AC-10: Full planningWorkflow runs to completion with low complexity
// ---------------------------------------------------------------------------

describe('AC-10: planningWorkflow low complexity runs to completion', () => {
  test('all low-complexity steps complete and step results are stored', async () => {
    const runtime = new WorkflowRuntime({ db, config, embedder });
    runtime.register('planning', planningWorkflow);

    const runId = await runtime.start('planning', {
      project: 'VNM',
      projectDir: '/tmp',
      complexity: 'low',
      brief: 'Test AC-10 low complexity',
    });

    // Resolve dispatch agents up to the assisted review step
    await resolveAllAgents(runtime, runId);

    // The workflow pauses at the assisted review step — signal it to continue
    await vi.waitFor(() => {
      expect(runtime.getStatus(runId)?.status).toBe('paused');
    });
    runtime.signal(runId, 'review', { signal: 'approved' });

    // Resolve the remaining dispatch agent (decompose)
    await resolveAllAgents(runtime, runId);

    await vi.waitFor(() => {
      expect(runtime.getStatus(runId)?.status).toBe('completed');
    });

    const status = runtime.getStatus(runId)!;
    expect(status.stepResults['design:0']).toBeDefined();
    expect(status.stepResults['critic:0']).toBeDefined();
    expect(status.stepResults['spec-tests:0']).toBeDefined();
    expect(status.stepResults['review']).toBeDefined();
    expect(status.stepResults['decompose:0']).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// EC-01: Start with unknown workflow name
// ---------------------------------------------------------------------------

describe('EC-01: start with unknown workflow name', () => {
  test('start() rejects with unknown workflow error', async () => {
    const runtime = new WorkflowRuntime({ db, config });

    await expect(runtime.start('nonexistent', {})).rejects.toThrow('Unknown workflow: nonexistent');
  });
});

// ---------------------------------------------------------------------------
// EC-02: Signal on non-paused workflow is a no-op (status remains running)
// ---------------------------------------------------------------------------

describe('EC-02: signal on non-paused workflow', () => {
  test('signal on running (not paused) workflow leaves status unchanged', async () => {
    const runtime = new WorkflowRuntime({ db, config, embedder });

    let resolveWf!: () => void;
    const blockingPromise = new Promise<void>((r) => {
      resolveWf = r;
    });
    runtime.register('blocking', async () => blockingPromise);

    const runId = await runtime.start('blocking', {});

    // Signal on a running (non-paused) workflow — no waitpoint registered
    expect(() => runtime.signal(runId, 'some-step', {})).not.toThrow();

    const status = runtime.getStatus(runId);
    expect(status?.status).toBe('running');

    // Cleanup
    resolveWf();
    await vi.waitFor(() => {
      expect(runtime.getStatus(runId)?.status).toBe('completed');
    });
  });
});

// ---------------------------------------------------------------------------
// EC-03: Hydrate on completed run does not re-run
// ---------------------------------------------------------------------------

describe('EC-03: hydrate on completed run', () => {
  test('hydrate() skips completed rows; no new activeRuns entry created', async () => {
    const runId = randomUUID();
    db.rawDb
      .prepare(
        `INSERT INTO workflow_runs (id, workflow_name, context, status, step_results, started_at, completed_at)
         VALUES (?, ?, '{}', 'completed', '{}', ?, ?)`
      )
      .run(runId, 'minimal', new Date().toISOString(), new Date().toISOString());

    const runtime = new WorkflowRuntime({ db, config, embedder });
    runtime.register('minimal', minimalWorkflow);

    await runtime.hydrate();

    // No active run should have been created
    expect(runtime.activeRuns.has(runId)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// EC-04: resolveAllAgents maxSteps guard
// ---------------------------------------------------------------------------

describe('EC-04: resolveAllAgents maxSteps guard', () => {
  test('resolveAllAgents exits after maxSteps without throwing', async () => {
    const runtime = new WorkflowRuntime({ db, config, embedder });

    let resolveWf!: () => void;
    const blockingPromise = new Promise<void>((r) => {
      resolveWf = r;
    });
    // A workflow that blocks indefinitely (no dispatch so no agent to resolve)
    runtime.register('noop-blocker', async () => blockingPromise);

    const runId = await runtime.start('noop-blocker', {});

    // resolveAllAgents with maxSteps=5 should return without throwing
    await expect(resolveAllAgents(runtime, runId, undefined, 5)).resolves.toBeUndefined();

    // Status is still running
    expect(runtime.getStatus(runId)?.status).toBe('running');

    // Cleanup
    resolveWf();
  });
});
