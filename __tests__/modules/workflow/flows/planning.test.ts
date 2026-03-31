import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { BrainDB } from '../../../../src/services/brain-db.js';
import type { BrainConfig } from '../../../../src/types.js';
import type {
  WorkflowContext as WorkflowContextInterface,
  StepResult,
  WorkflowRun,
} from '../../../../src/modules/workflow/runtime/types.js';
import { planningWorkflow } from '../../../../src/modules/workflow/flows/planning.js';
import { WorkflowRuntime } from '../../../../src/modules/workflow/runtime/runtime.js';
import { WorkflowContext } from '../../../../src/modules/workflow/runtime/context.js';
import { createTestDb, createMockEmbedder } from '../../../helpers.js';

// ---------------------------------------------------------------------------
// TestableContext — lightweight stub of WorkflowContext for flow-logic tests
// ---------------------------------------------------------------------------

type SignalKey = `${string}:${number}`;

interface DispatchCall {
  method: 'dispatch' | 'assisted';
  stepId: string;
  template: string;
}

class TestableContext implements WorkflowContextInterface {
  readonly runId = `test-${randomUUID().slice(0, 8)}`;
  readonly workflowName = 'planning';
  readonly project = 'TST';
  readonly projectDir = '/tmp/test';

  calls: DispatchCall[] = [];

  private params: Record<string, string>;
  private iterations: Record<string, number> = {};
  private signalMap = new Map<SignalKey, string | null>();
  private cachedResults: Record<string, StepResult> = {};

  constructor(params: Record<string, string> = {}) {
    this.params = params;
  }

  /** Pre-configure what signal a step returns at a given iteration index. */
  configureSignal(stepId: string, iterationIndex: number, signal: string | null): void {
    this.signalMap.set(`${stepId}:${iterationIndex}` as SignalKey, signal);
  }

  /** Pre-populate cached results to simulate hydration/restart. */
  setCachedResult(stepId: string, iterationIndex: number, result: StepResult): void {
    this.cachedResults[`${stepId}:${iterationIndex}`] = result;
  }

  /** Pre-populate cached result for assisted steps (keyed by bare stepId). */
  setCachedAssisted(stepId: string, result: StepResult): void {
    this.cachedResults[stepId] = result;
  }

  param(key: string): string | undefined {
    return this.params[key];
  }

  iteration(stepId: string): number {
    return this.iterations[stepId] ?? 0;
  }

  async dispatch(stepId: string, template: string): Promise<StepResult> {
    const iter = this.iterations[stepId] ?? 0;
    const cacheKey = `${stepId}:${iter}`;

    // Return cached result if present (simulates memoization)
    const cached = this.cachedResults[cacheKey];
    if (cached) {
      this.iterations[stepId] = iter + 1;
      return cached;
    }

    this.calls.push({ method: 'dispatch', stepId, template });
    const signal = this.signalMap.get(cacheKey as SignalKey) ?? null;
    this.iterations[stepId] = iter + 1;

    return {
      stepId,
      taskId: `TST-${stepId}-${iter}`,
      agentId: `agent-${stepId}-${iter}`,
      signal,
      completedAt: new Date().toISOString(),
    };
  }

  async assisted(stepId: string, template: string): Promise<StepResult> {
    const cached = this.cachedResults[stepId];
    if (cached) return cached;

    this.calls.push({ method: 'assisted', stepId, template });

    return {
      stepId,
      taskId: `TST-${stepId}`,
      agentId: null,
      signal: null,
      completedAt: new Date().toISOString(),
    };
  }

  signal(_stepId: string, _data?: Record<string, string>): void {
    // no-op for tests
  }
}

// ---------------------------------------------------------------------------
// Flow logic tests using TestableContext
// ---------------------------------------------------------------------------

describe('planningWorkflow — flow logic', () => {
  test('high complexity: full pipeline with approved critic', async () => {
    const ctx = new TestableContext({ complexity: 'high' });

    await planningWorkflow(ctx);

    const stepIds = ctx.calls.map((c) => c.stepId);
    expect(stepIds).toEqual([
      'research',
      'interview',
      'design',
      'critic',
      'spec-tests',
      'decompose',
      'implement',
      'review',
    ]);

    // Verify correct methods
    expect(ctx.calls[0]).toEqual({ method: 'dispatch', stepId: 'research', template: 'planning-research' });
    expect(ctx.calls[1]).toEqual({ method: 'assisted', stepId: 'interview', template: 'planning-interview' });
    expect(ctx.calls[2]).toEqual({ method: 'dispatch', stepId: 'design', template: 'planning-design' });
    expect(ctx.calls[3]).toEqual({ method: 'dispatch', stepId: 'critic', template: 'planning-critic' });
    expect(ctx.calls[7]).toEqual({ method: 'dispatch', stepId: 'review', template: 'review-agent' });
  });

  test('medium complexity: skips interview', async () => {
    const ctx = new TestableContext({ complexity: 'medium' });

    await planningWorkflow(ctx);

    const stepIds = ctx.calls.map((c) => c.stepId);
    expect(stepIds).toEqual([
      'research',
      'design',
      'critic',
      'spec-tests',
      'decompose',
      'implement',
      'review',
    ]);

    // No assisted calls
    expect(ctx.calls.every((c) => c.method === 'dispatch')).toBe(true);
  });

  test('low complexity: skips research and interview', async () => {
    const ctx = new TestableContext({ complexity: 'low' });

    await planningWorkflow(ctx);

    const stepIds = ctx.calls.map((c) => c.stepId);
    expect(stepIds).toEqual([
      'design',
      'critic',
      'spec-tests',
      'decompose',
      'implement',
      'review',
    ]);
  });

  test('defaults to high complexity when param is missing', async () => {
    const ctx = new TestableContext({});

    await planningWorkflow(ctx);

    const stepIds = ctx.calls.map((c) => c.stepId);
    expect(stepIds).toContain('research');
    expect(stepIds).toContain('interview');
  });

  test('critic signals needs_revision: design-critic loop runs twice', async () => {
    const ctx = new TestableContext({ complexity: 'low' });

    // First critic returns needs_revision, second approves
    ctx.configureSignal('critic', 0, 'needs_revision');
    // critic iteration 1 returns null (approved) by default

    await planningWorkflow(ctx);

    const stepIds = ctx.calls.map((c) => c.stepId);
    expect(stepIds).toEqual([
      'design',   // initial design (iter 0)
      'critic',   // initial critic (iter 0) -> needs_revision
      'design',   // loop design (iter 1)
      'critic',   // loop critic (iter 1) -> null (approved)
      'spec-tests',
      'decompose',
      'implement',
      'review',
    ]);

    expect(ctx.iteration('design')).toBe(2);
    expect(ctx.iteration('critic')).toBe(2);
  });

  test('critic loop respects iteration guard (max 3 designs)', async () => {
    const ctx = new TestableContext({ complexity: 'low' });

    // Every critic returns needs_revision
    ctx.configureSignal('critic', 0, 'needs_revision');
    ctx.configureSignal('critic', 1, 'needs_revision');
    ctx.configureSignal('critic', 2, 'needs_revision');

    await planningWorkflow(ctx);

    const designCalls = ctx.calls.filter((c) => c.stepId === 'design');
    const criticCalls = ctx.calls.filter((c) => c.stepId === 'critic');

    // Initial design (iter 0), then loop: design iter 1 + critic iter 1,
    // design iter 2 + critic iter 2. At that point iteration('design') = 3,
    // so the while condition (< 3) fails.
    expect(designCalls).toHaveLength(3);
    expect(criticCalls).toHaveLength(3);
    expect(ctx.iteration('design')).toBe(3);
  });

  test('critic signals has_open_questions: re-research branch', async () => {
    const ctx = new TestableContext({ complexity: 'low' });

    // First critic returns has_open_questions
    ctx.configureSignal('critic', 0, 'has_open_questions');

    await planningWorkflow(ctx);

    const stepIds = ctx.calls.map((c) => c.stepId);
    expect(stepIds).toEqual([
      'design',       // initial
      'critic',       // -> has_open_questions
      'research',     // re-research
      'design',       // re-design
      'critic',       // re-critic
      'spec-tests',
      'decompose',
      'implement',
      'review',
    ]);

    // research ran once (low complexity skipped it initially, then re-research)
    expect(ctx.iteration('research')).toBe(1);
    // design ran twice
    expect(ctx.iteration('design')).toBe(2);
  });

  test('high complexity has_open_questions: research runs twice', async () => {
    const ctx = new TestableContext({ complexity: 'high' });

    ctx.configureSignal('critic', 0, 'has_open_questions');

    await planningWorkflow(ctx);

    const researchCalls = ctx.calls.filter((c) => c.stepId === 'research');
    expect(researchCalls).toHaveLength(2);
    expect(ctx.iteration('research')).toBe(2);
  });

  test('needs_revision then has_open_questions: combined loop and re-research', async () => {
    const ctx = new TestableContext({ complexity: 'low' });

    // First critic: needs_revision -> loop
    ctx.configureSignal('critic', 0, 'needs_revision');
    // Second critic: has_open_questions -> re-research branch
    ctx.configureSignal('critic', 1, 'has_open_questions');

    await planningWorkflow(ctx);

    const stepIds = ctx.calls.map((c) => c.stepId);
    expect(stepIds).toEqual([
      'design',       // initial (iter 0)
      'critic',       // iter 0 -> needs_revision
      'design',       // loop (iter 1)
      'critic',       // iter 1 -> has_open_questions, exits while loop
      'research',     // re-research
      'design',       // re-design (iter 2)
      'critic',       // re-critic (iter 2)
      'spec-tests',
      'decompose',
      'implement',
      'review',
    ]);
  });

  test('restart recovery: memoized steps skip on re-invocation', async () => {
    const ctx = new TestableContext({ complexity: 'high' });

    // Pre-populate research and interview as cached
    ctx.setCachedResult('research', 0, {
      stepId: 'research',
      taskId: 'TST-research-0',
      agentId: 'agent-research',
      signal: null,
      completedAt: '2026-01-01T00:00:00Z',
    });
    ctx.setCachedAssisted('interview', {
      stepId: 'interview',
      taskId: 'TST-interview-0',
      agentId: null,
      signal: null,
      completedAt: '2026-01-01T00:00:00Z',
    });

    await planningWorkflow(ctx);

    // dispatch/assisted should NOT have been called for research or interview
    const calledSteps = ctx.calls.map((c) => c.stepId);
    expect(calledSteps).not.toContain('research');
    expect(calledSteps).not.toContain('interview');

    // But design onwards should have been dispatched
    expect(calledSteps).toContain('design');
    expect(calledSteps).toContain('critic');
    expect(calledSteps).toContain('spec-tests');
    expect(calledSteps).toContain('decompose');
    expect(calledSteps).toContain('implement');
    expect(calledSteps).toContain('review');
  });

  test('restart recovery: cached design+critic skip, remaining steps run', async () => {
    const ctx = new TestableContext({ complexity: 'low' });

    // Cache design:0 and critic:0
    ctx.setCachedResult('design', 0, {
      stepId: 'design',
      taskId: 'TST-design-0',
      agentId: 'agent-design',
      signal: null,
      completedAt: '2026-01-01T00:00:00Z',
    });
    ctx.setCachedResult('critic', 0, {
      stepId: 'critic',
      taskId: 'TST-critic-0',
      agentId: 'agent-critic',
      signal: null,
      completedAt: '2026-01-01T00:00:00Z',
    });

    await planningWorkflow(ctx);

    const calledSteps = ctx.calls.map((c) => c.stepId);
    expect(calledSteps).not.toContain('design');
    expect(calledSteps).not.toContain('critic');
    expect(calledSteps).toEqual(['spec-tests', 'decompose', 'implement', 'review']);
  });
});

// ---------------------------------------------------------------------------
// Integration test via WorkflowRuntime
// ---------------------------------------------------------------------------

// Mock the infrastructure modules that WorkflowContext.dispatch() calls internally
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
    pid: 55555,
    taskId: 'TST-01.001',
    agentId: 'agent-runtime',
    sessionId: 'sess-rt',
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

describe('planningWorkflow — via WorkflowRuntime', () => {
  let db: BrainDB;
  let dbPath: string;
  let notesDir: string;
  let config: BrainConfig;
  const embedder = createMockEmbedder();

  beforeEach(() => {
    ({ dbPath, db } = createTestDb());
    createWorkflowRunsMigration(db);
    notesDir = join(tmpdir(), `wf-plan-${randomUUID()}`);
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

  test('runtime.start() creates workflow_runs row and resolves agents to completion', async () => {
    const runtime = new WorkflowRuntime({ db, config, embedder });
    runtime.register('planning', planningWorkflow);

    const runId = await runtime.start('planning', {
      project: 'TST',
      workstream: '1',
      complexity: 'low',
    });

    // The workflow will block on first dispatch waiting for agent resolution.
    // Get the active context and resolve agents as they appear.
    const resolveAllAgents = async () => {
      const maxSteps = 20;
      let steps = 0;
      while (steps < maxSteps) {
        const running = runtime.activeRuns.get(runId);
        if (!running) break;

        const agent = running.ctx.activeAgent;
        if (agent) {
          running.ctx.resolveAgent(agent.stepId, `output for ${agent.stepId}`);
          steps++;
        }
        // Yield to let the workflow advance
        await new Promise((r) => setTimeout(r, 5));
      }
    };

    await resolveAllAgents();

    // Wait for the workflow to complete
    await vi.waitFor(() => {
      const row = db.rawDb
        .prepare('SELECT status FROM workflow_runs WHERE id = ?')
        .get(runId) as Record<string, unknown> | undefined;
      expect(row).toBeDefined();
      expect(row!.status).toBe('completed');
    });

    const finalStatus = runtime.getStatus(runId);
    expect(finalStatus).not.toBeNull();
    expect(finalStatus!.status).toBe('completed');
    expect(finalStatus!.completedAt).not.toBeNull();
  });

  test('runtime hydration replays cached steps and completes remaining', async () => {
    // Insert a partially-completed planning run (low complexity, design:0 done)
    const runId = randomUUID();
    const stepResults = {
      'design:0': {
        stepId: 'design',
        taskId: 'TST-01.001',
        agentId: 'agent-1',
        signal: null,
        completedAt: '2026-01-01T00:00:00Z',
        output: 'cached design',
      },
      'critic:0': {
        stepId: 'critic',
        taskId: 'TST-01.002',
        agentId: 'agent-2',
        signal: null,
        completedAt: '2026-01-01T00:01:00Z',
        output: 'cached critic',
      },
    };

    db.rawDb
      .prepare(
        `INSERT INTO workflow_runs (id, workflow_name, context, status, step_results, started_at)
         VALUES (?, ?, ?, 'running', ?, ?)`
      )
      .run(
        runId,
        'planning',
        JSON.stringify({ project: 'TST', workstream: '1', complexity: 'low' }),
        JSON.stringify(stepResults),
        new Date().toISOString()
      );

    const runtime = new WorkflowRuntime({ db, config, embedder });
    runtime.register('planning', planningWorkflow);
    await runtime.hydrate();

    // Resolve remaining agents (spec-tests, decompose, implement, review)
    const resolveAllAgents = async () => {
      const maxSteps = 20;
      let steps = 0;
      while (steps < maxSteps) {
        const running = runtime.activeRuns.get(runId);
        if (!running) break;

        const agent = running.ctx.activeAgent;
        if (agent) {
          running.ctx.resolveAgent(agent.stepId, `output for ${agent.stepId}`);
          steps++;
        }
        await new Promise((r) => setTimeout(r, 5));
      }
    };

    await resolveAllAgents();

    await vi.waitFor(() => {
      const row = db.rawDb
        .prepare('SELECT status FROM workflow_runs WHERE id = ?')
        .get(runId) as Record<string, unknown>;
      expect(row.status).toBe('completed');
    });

    // Verify design and critic were NOT re-dispatched (check that createTask
    // was only called for the 4 remaining steps, not 6)
    const { createTask } = await import('../../../../src/modules/pm/data/task-ops.js');
    expect(createTask).toHaveBeenCalledTimes(4);
  });
});
