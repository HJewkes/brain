import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { BrainDB } from '../../../../src/services/brain-db.js';
import type { BrainConfig } from '../../../../src/types.js';
import type { WorkflowRun, StepResult } from '../../../../src/modules/workflow/runtime/types.js';
import { WorkflowContext } from '../../../../src/modules/workflow/runtime/context.js';
import { createTestDb, createMockEmbedder } from '../../../helpers.js';

// Mock external dependencies that spawn agents or render templates
vi.mock('../../../../src/modules/pm/data/task-ops.js', () => ({
  createTask: vi.fn().mockResolvedValue({
    ok: true,
    data: { display_id: 'TST-01.001' },
  }),
}));

vi.mock('../../../../src/modules/workflow/engine/dispatch.js', () => ({
  dispatchTemplate: vi.fn().mockResolvedValue({
    ok: true,
    data: { rendered: 'rendered prompt content' },
  }),
}));

vi.mock('../../../../src/server/dispatch.js', () => ({
  dispatchTask: vi.fn().mockResolvedValue({
    pid: 12345,
    taskId: 'TST-01.001',
    agentId: 'agent-abc',
    sessionId: 'sess-123',
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

function makeRun(overrides: Partial<WorkflowRun> = {}): WorkflowRun {
  return {
    id: overrides.id ?? randomUUID(),
    workflowName: overrides.workflowName ?? 'test-workflow',
    context: overrides.context ?? { project: 'TST', workstream: '1', projectDir: '/tmp/test' },
    status: overrides.status ?? 'running',
    currentStep: overrides.currentStep ?? null,
    stepResults: overrides.stepResults ?? {},
    activeAgent: overrides.activeAgent ?? null,
    startedAt: overrides.startedAt ?? new Date().toISOString(),
    completedAt: overrides.completedAt ?? null,
    error: overrides.error ?? null,
  };
}

let db: BrainDB;
let dbPath: string;
let notesDir: string;
let config: BrainConfig;
const embedder = createMockEmbedder();

beforeEach(() => {
  ({ dbPath, db } = createTestDb());
  createWorkflowRunsMigration(db);
  notesDir = join(tmpdir(), `wf-ctx-${randomUUID()}`);
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

describe('WorkflowContext — memoization', () => {
  test('dispatch() returns cached StepResult when step already completed', async () => {
    const existingResult: StepResult = {
      stepId: 'design',
      taskId: 'TST-01.001',
      agentId: 'agent-1',
      signal: null,
      completedAt: '2026-01-01T00:00:00Z',
      output: 'design output',
    };

    const run = makeRun({
      stepResults: { 'design:0': existingResult },
    });

    const ctx = new WorkflowContext(run, db, config, undefined, { embedder });
    const result = await ctx.dispatch('design', 'design-template');

    expect(result).toEqual(existingResult);

    const { createTask } = await import('../../../../src/modules/pm/data/task-ops.js');
    expect(createTask).not.toHaveBeenCalled();
  });

  test('dispatch() with different iteration keys are separate cache entries', async () => {
    const result0: StepResult = {
      stepId: 'design',
      taskId: 'TST-01.001',
      agentId: 'agent-1',
      signal: 'needs_revision',
      completedAt: '2026-01-01T00:00:00Z',
    };
    const result1: StepResult = {
      stepId: 'design',
      taskId: 'TST-01.002',
      agentId: 'agent-2',
      signal: null,
      completedAt: '2026-01-01T01:00:00Z',
    };

    const run = makeRun({
      stepResults: { 'design:0': result0, 'design:1': result1 },
    });

    const ctx = new WorkflowContext(run, db, config, undefined, { embedder });

    // After hydration, iteration starts at 0 — replaying through cache hits
    // bumps it to the correct count
    const first = await ctx.dispatch('design', 'template');
    expect(first).toEqual(result0);
    expect(ctx.iteration('design')).toBe(1);

    const second = await ctx.dispatch('design', 'template');
    expect(second).toEqual(result1);
    expect(ctx.iteration('design')).toBe(2);
  });

  test('assisted() returns cached StepResult when step already completed', async () => {
    const existingResult: StepResult = {
      stepId: 'human-review',
      taskId: 'TST-01.002',
      agentId: null,
      signal: null,
      completedAt: '2026-01-01T00:00:00Z',
    };

    const run = makeRun({
      stepResults: { 'human-review': existingResult },
    });

    const ctx = new WorkflowContext(run, db, config, undefined, { embedder });
    const result = await ctx.assisted('human-review', 'review-template');

    expect(result).toEqual(existingResult);
  });
});

describe('WorkflowContext — dispatch flow', () => {
  test('dispatch() creates a PM task before spawning agent', async () => {
    const run = makeRun();
    const ctx = new WorkflowContext(run, db, config, undefined, { embedder });

    // dispatch will block on waitForAgent, so we need to resolve it
    const dispatchPromise = ctx.dispatch('design', 'design-template');

    // Let the microtasks run so the agent is spawned
    await vi.waitFor(() => {
      expect(ctx.activeAgent).not.toBeNull();
    });

    const { createTask } = await import('../../../../src/modules/pm/data/task-ops.js');
    expect(createTask).toHaveBeenCalledOnce();

    // Resolve the agent to complete the dispatch
    ctx.resolveAgent('design', 'agent output');
    await dispatchPromise;
  });

  test('dispatch() persists state to workflow_runs after each step', async () => {
    const runId = randomUUID();
    const run = makeRun({ id: runId });
    const ctx = new WorkflowContext(run, db, config, undefined, { embedder });

    const dispatchPromise = ctx.dispatch('design', 'design-template');

    await vi.waitFor(() => {
      expect(ctx.activeAgent).not.toBeNull();
    });

    // Check the DB row exists mid-flight
    const row = db.rawDb
      .prepare('SELECT * FROM workflow_runs WHERE id = ?')
      .get(runId) as Record<string, unknown> | undefined;
    expect(row).toBeDefined();
    expect(row!.current_step).toBe('design');

    ctx.resolveAgent('design', 'output');
    await dispatchPromise;

    // After completion, activeAgent should be cleared in DB
    const afterRow = db.rawDb
      .prepare('SELECT * FROM workflow_runs WHERE id = ?')
      .get(runId) as Record<string, unknown>;
    expect(afterRow.active_agent).toBeNull();
  });

  test('dispatch() updates currentStep and activeAgent during execution', async () => {
    const run = makeRun();
    const ctx = new WorkflowContext(run, db, config, undefined, { embedder });

    const dispatchPromise = ctx.dispatch('implement', 'impl-template');

    await vi.waitFor(() => {
      expect(ctx.activeAgent).not.toBeNull();
    });

    const state = ctx.toRun();
    expect(state.currentStep).toBe('implement');
    expect(state.activeAgent).toEqual(
      expect.objectContaining({ pid: 12345, stepId: 'implement' })
    );

    ctx.resolveAgent('implement', 'done');
    await dispatchPromise;
  });

  test('dispatch() clears activeAgent after completion', async () => {
    const run = makeRun();
    const ctx = new WorkflowContext(run, db, config, undefined, { embedder });

    const dispatchPromise = ctx.dispatch('build', 'build-template');

    await vi.waitFor(() => {
      expect(ctx.activeAgent).not.toBeNull();
    });

    ctx.resolveAgent('build', 'done');
    const result = await dispatchPromise;

    expect(ctx.activeAgent).toBeNull();
    expect(result.stepId).toBe('build');
  });
});

describe('WorkflowContext — assisted flow', () => {
  test('assisted() sets status to paused and persists', async () => {
    const runId = randomUUID();
    const run = makeRun({ id: runId });
    const ctx = new WorkflowContext(run, db, config, undefined, { embedder });

    const assistedPromise = ctx.assisted('human-review', 'review-template');

    // Wait for the assisted step to persist
    await vi.waitFor(() => {
      const row = db.rawDb
        .prepare('SELECT status FROM workflow_runs WHERE id = ?')
        .get(runId) as Record<string, unknown> | undefined;
      expect(row).toBeDefined();
      expect(row!.status).toBe('paused');
    });

    const state = ctx.toRun();
    expect(state.status).toBe('paused');
    expect(state.currentStep).toBe('human-review');

    // Resolve to unblock
    ctx.signal('human-review', { signal: 'approved' });
    await assistedPromise;
  });

  test('signal() resolves the assisted step promise', async () => {
    const run = makeRun();
    const ctx = new WorkflowContext(run, db, config, undefined, { embedder });

    const assistedPromise = ctx.assisted('review', 'review-template');

    // Wait for the signal waitpoint to be registered
    await vi.waitFor(() => {
      const state = ctx.toRun();
      expect(state.status).toBe('paused');
    });

    ctx.signal('review', { signal: 'needs_revision' });
    const result = await assistedPromise;

    expect(result.stepId).toBe('review');
    expect(result.agentId).toBeNull();
    expect(result.signal).toBe('needs_revision');
  });

  test('assisted() resumes and returns StepResult after signal', async () => {
    const run = makeRun();
    const ctx = new WorkflowContext(run, db, config, undefined, { embedder });

    const assistedPromise = ctx.assisted('gate', 'gate-template');

    await vi.waitFor(() => {
      expect(ctx.toRun().status).toBe('paused');
    });

    ctx.signal('gate', { approved: 'true' });
    const result = await assistedPromise;

    expect(result.stepId).toBe('gate');
    expect(result.completedAt).toBeDefined();
    expect(ctx.toRun().status).toBe('running');
  });
});

describe('WorkflowContext — iteration tracking', () => {
  test('iteration() returns 0 for fresh step', () => {
    const run = makeRun();
    const ctx = new WorkflowContext(run, db, config, undefined, { embedder });

    expect(ctx.iteration('design')).toBe(0);
    expect(ctx.iteration('implement')).toBe(0);
  });

  test('iteration() increments after each dispatch of same stepId', async () => {
    const run = makeRun();
    const ctx = new WorkflowContext(run, db, config, undefined, { embedder });

    expect(ctx.iteration('design')).toBe(0);

    // First dispatch
    const p1 = ctx.dispatch('design', 'template');
    await vi.waitFor(() => expect(ctx.activeAgent).not.toBeNull());
    ctx.resolveAgent('design', 'v1');
    await p1;

    expect(ctx.iteration('design')).toBe(1);

    // Second dispatch
    const p2 = ctx.dispatch('design', 'template');
    await vi.waitFor(() => expect(ctx.activeAgent).not.toBeNull());
    ctx.resolveAgent('design', 'v2');
    await p2;

    expect(ctx.iteration('design')).toBe(2);
  });
});

describe('WorkflowContext — persistence', () => {
  test('persist() writes to workflow_runs table (INSERT or UPDATE)', () => {
    const runId = randomUUID();
    const run = makeRun({ id: runId });
    const ctx = new WorkflowContext(run, db, config);

    // First persist (INSERT)
    ctx.persist();
    const row1 = db.rawDb
      .prepare('SELECT * FROM workflow_runs WHERE id = ?')
      .get(runId) as Record<string, unknown>;
    expect(row1).toBeDefined();
    expect(row1.status).toBe('running');

    // Second persist (UPDATE via UPSERT)
    ctx.persist();
    const count = db.rawDb
      .prepare('SELECT COUNT(*) as c FROM workflow_runs WHERE id = ?')
      .get(runId) as { c: number };
    expect(count.c).toBe(1);
  });

  test('toRun() returns complete serializable state', () => {
    const run = makeRun({
      id: 'run-123',
      workflowName: 'design-review',
      context: { project: 'TST', workstream: '1' },
      currentStep: 'step-a',
    });

    const ctx = new WorkflowContext(run, db, config);
    const serialized = ctx.toRun();

    expect(serialized.id).toBe('run-123');
    expect(serialized.workflowName).toBe('design-review');
    expect(serialized.context).toEqual({ project: 'TST', workstream: '1' });
    expect(serialized.currentStep).toBe('step-a');
    expect(serialized.status).toBe('running');
    expect(serialized.stepResults).toEqual({});
    expect(serialized.activeAgent).toBeNull();
    expect(serialized.startedAt).toBeDefined();
    expect(serialized.completedAt).toBeNull();
    expect(serialized.error).toBeNull();
  });
});

describe('WorkflowContext — signal parsing integration', () => {
  test('dispatch() extracts needs_revision signal from agent output', async () => {
    const run = makeRun();
    const ctx = new WorkflowContext(run, db, config, undefined, { embedder });

    const p = ctx.dispatch('review', 'review-template');

    await vi.waitFor(() => expect(ctx.activeAgent).not.toBeNull());
    ctx.resolveAgent('review', '## Verdict: NEEDS REVISION\n\nPlease fix the issues.');
    const result = await p;

    expect(result.signal).toBe('needs_revision');
  });

  test('dispatch() returns null signal when no pattern matches', async () => {
    const run = makeRun();
    const ctx = new WorkflowContext(run, db, config, undefined, { embedder });

    const p = ctx.dispatch('build', 'build-template');

    await vi.waitFor(() => expect(ctx.activeAgent).not.toBeNull());
    ctx.resolveAgent('build', 'Build completed successfully.');
    const result = await p;

    expect(result.signal).toBeNull();
  });
});
