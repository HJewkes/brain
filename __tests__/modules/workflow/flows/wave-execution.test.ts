import { describe, test, expect, vi, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import type {
  WorkflowContext as WorkflowContextInterface,
  StepResult,
  SeedResult,
} from '../../../../src/modules/workflow/runtime/types.js';
import { waveExecutionWorkflow } from '../../../../src/modules/workflow/flows/wave-execution.js';

// Mock child_process.execSync for gate checks
vi.mock('node:child_process', () => ({
  execSync: vi.fn(),
}));

// Mock the dependency module for seed step
vi.mock('../../../../src/modules/pm/engine/dependency.js', () => ({
  computeWaves: vi.fn(),
}));

// ---------------------------------------------------------------------------
// TestableContext — stub of WorkflowContext for wave execution tests
// ---------------------------------------------------------------------------

interface DispatchCall {
  method: 'dispatch' | 'assisted' | 'seed';
  stepId: string;
  template: string;
}

class TestableContext implements WorkflowContextInterface {
  readonly runId = `test-${randomUUID().slice(0, 8)}`;
  readonly workflowName = 'wave-execution';
  readonly project = 'TST';
  readonly projectDir = '/tmp/test';
  readonly db = {} as WorkflowContextInterface['db'];

  calls: DispatchCall[] = [];

  private params: Record<string, string>;
  private iterations: Record<string, number> = {};
  private failingSteps = new Set<string>();

  constructor(params: Record<string, string> = {}) {
    this.params = {
      workstream: '1',
      project: 'TST',
      ...params,
    };
  }

  /** Configure a step to throw on dispatch (simulates agent failure). */
  configureFailure(stepId: string): void {
    this.failingSteps.add(stepId);
  }

  param(key: string): string | undefined {
    return this.params[key];
  }

  iteration(stepId: string): number {
    return this.iterations[stepId] ?? 0;
  }

  async dispatch(stepId: string, template: string, _taskId?: string): Promise<StepResult> {
    const iter = this.iterations[stepId] ?? 0;
    this.calls.push({ method: 'dispatch', stepId, template });
    this.iterations[stepId] = iter + 1;

    if (this.failingSteps.has(stepId)) {
      throw new Error(`Agent failed for ${stepId}`);
    }

    return {
      stepId,
      taskId: `TST-${stepId}-${iter}`,
      agentId: `agent-${stepId}-${iter}`,
      signal: null,
      completedAt: new Date().toISOString(),
    };
  }

  async assisted(stepId: string, template: string): Promise<StepResult> {
    this.calls.push({ method: 'assisted', stepId, template });
    return {
      stepId,
      taskId: `TST-${stepId}`,
      agentId: null,
      signal: null,
      completedAt: new Date().toISOString(),
    };
  }

  async seed(stepId: string, fn: () => Promise<SeedResult>): Promise<StepResult> {
    this.calls.push({ method: 'seed', stepId, template: '' });

    const seedResult = await fn();

    for (const [key, value] of Object.entries(seedResult.data)) {
      this.params[key] = value;
    }

    return {
      stepId,
      taskId: `seed:${stepId}`,
      agentId: null,
      signal: null,
      completedAt: new Date().toISOString(),
      output: seedResult.output,
    };
  }

  signal(): void {}
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('waveExecutionWorkflow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('missing workstream throws', async () => {
    const ctx = new TestableContext({});
    (ctx as unknown as { params: Record<string, string> }).params = { project: 'TST' };

    await expect(waveExecutionWorkflow(ctx)).rejects.toThrow('requires "workstream" and "project"');
  });

  test('missing project throws', async () => {
    const ctx = new TestableContext({});
    (ctx as unknown as { params: Record<string, string> }).params = { workstream: '1' };

    await expect(waveExecutionWorkflow(ctx)).rejects.toThrow('requires "workstream" and "project"');
  });

  test('compute-waves seed calls computeWaves and stores structure', async () => {
    const { computeWaves } = await import('../../../../src/modules/pm/engine/dependency.js');
    vi.mocked(computeWaves).mockReturnValue([
      { wave: 0, taskIds: ['TST-1.01', 'TST-1.02'] },
      { wave: 1, taskIds: ['TST-1.03'] },
    ]);

    const { execSync } = await import('node:child_process');
    vi.mocked(execSync).mockReturnValue(Buffer.from(''));

    const ctx = new TestableContext();

    await waveExecutionWorkflow(ctx);

    // Seed step should have been called
    const seedCalls = ctx.calls.filter((c) => c.method === 'seed');
    expect(seedCalls[0].stepId).toBe('compute-waves');

    // Wave structure should be stored in params
    expect(ctx.param('waveCount')).toBe('2');
    expect(ctx.param('totalTasks')).toBe('3');
  });

  test('sequential dispatch per wave with correct step IDs', async () => {
    const { computeWaves } = await import('../../../../src/modules/pm/engine/dependency.js');
    vi.mocked(computeWaves).mockReturnValue([
      { wave: 0, taskIds: ['TST-1.01', 'TST-1.02'] },
      { wave: 1, taskIds: ['TST-1.03'] },
    ]);

    const { execSync } = await import('node:child_process');
    vi.mocked(execSync).mockReturnValue(Buffer.from(''));

    const ctx = new TestableContext();

    await waveExecutionWorkflow(ctx);

    const dispatchCalls = ctx.calls.filter((c) => c.method === 'dispatch');
    expect(dispatchCalls.map((c) => c.stepId)).toEqual([
      'wave-0-task-TST-1.01',
      'wave-0-task-TST-1.02',
      'wave-1-task-TST-1.03',
    ]);

    // All dispatches use the default template
    expect(dispatchCalls.every((c) => c.template === 'implementation-compact')).toBe(true);
  });

  test('custom template is passed to dispatch', async () => {
    const { computeWaves } = await import('../../../../src/modules/pm/engine/dependency.js');
    vi.mocked(computeWaves).mockReturnValue([{ wave: 0, taskIds: ['TST-1.01'] }]);

    const { execSync } = await import('node:child_process');
    vi.mocked(execSync).mockReturnValue(Buffer.from(''));

    const ctx = new TestableContext({ template: 'ops' });

    await waveExecutionWorkflow(ctx);

    const dispatchCalls = ctx.calls.filter((c) => c.method === 'dispatch');
    expect(dispatchCalls[0].template).toBe('ops');
  });

  test('gate check runs after each wave', async () => {
    const { computeWaves } = await import('../../../../src/modules/pm/engine/dependency.js');
    vi.mocked(computeWaves).mockReturnValue([
      { wave: 0, taskIds: ['TST-1.01'] },
      { wave: 1, taskIds: ['TST-1.02'] },
    ]);

    const { execSync } = await import('node:child_process');
    vi.mocked(execSync).mockReturnValue(Buffer.from(''));

    const ctx = new TestableContext();

    await waveExecutionWorkflow(ctx);

    const seedCalls = ctx.calls.filter((c) => c.method === 'seed');
    const gateSteps = seedCalls.filter((c) => c.stepId.startsWith('gate-wave-'));
    expect(gateSteps.map((c) => c.stepId)).toEqual(['gate-wave-0', 'gate-wave-1']);

    // execSync should have been called for gate checks
    expect(execSync).toHaveBeenCalledTimes(2);
  });

  test('gate check failure triggers assisted intervention', async () => {
    const { computeWaves } = await import('../../../../src/modules/pm/engine/dependency.js');
    vi.mocked(computeWaves).mockReturnValue([{ wave: 0, taskIds: ['TST-1.01'] }]);

    const { execSync } = await import('node:child_process');
    vi.mocked(execSync).mockImplementation(() => {
      throw new Error('Tests failed');
    });

    const ctx = new TestableContext();

    await waveExecutionWorkflow(ctx);

    // Gate failed, so an assisted intervention step should follow
    const assistedCalls = ctx.calls.filter((c) => c.method === 'assisted');
    expect(assistedCalls).toHaveLength(1);
    expect(assistedCalls[0].stepId).toBe('intervention-wave-0');
  });

  test('gate check pass does not trigger intervention', async () => {
    const { computeWaves } = await import('../../../../src/modules/pm/engine/dependency.js');
    vi.mocked(computeWaves).mockReturnValue([{ wave: 0, taskIds: ['TST-1.01'] }]);

    const { execSync } = await import('node:child_process');
    vi.mocked(execSync).mockReturnValue(Buffer.from(''));

    const ctx = new TestableContext();

    await waveExecutionWorkflow(ctx);

    const assistedCalls = ctx.calls.filter((c) => c.method === 'assisted');
    expect(assistedCalls).toHaveLength(0);
  });

  test('empty workstream produces summary with no dispatches', async () => {
    const { computeWaves } = await import('../../../../src/modules/pm/engine/dependency.js');
    vi.mocked(computeWaves).mockReturnValue([]);

    const ctx = new TestableContext();

    await waveExecutionWorkflow(ctx);

    const dispatchCalls = ctx.calls.filter((c) => c.method === 'dispatch');
    expect(dispatchCalls).toHaveLength(0);

    const seedCalls = ctx.calls.filter((c) => c.method === 'seed');
    const summaryStep = seedCalls.find((c) => c.stepId === 'summary');
    expect(summaryStep).toBeDefined();
  });

  test('wipLimit trims tasks per wave', async () => {
    const { computeWaves } = await import('../../../../src/modules/pm/engine/dependency.js');
    vi.mocked(computeWaves).mockReturnValue([
      { wave: 0, taskIds: ['TST-1.01', 'TST-1.02', 'TST-1.03', 'TST-1.04'] },
    ]);

    const { execSync } = await import('node:child_process');
    vi.mocked(execSync).mockReturnValue(Buffer.from(''));

    const ctx = new TestableContext({ wipLimit: '2' });

    await waveExecutionWorkflow(ctx);

    const dispatchCalls = ctx.calls.filter((c) => c.method === 'dispatch');
    expect(dispatchCalls).toHaveLength(2);
    expect(dispatchCalls.map((c) => c.stepId)).toEqual([
      'wave-0-task-TST-1.01',
      'wave-0-task-TST-1.02',
    ]);
  });

  test('failed dispatch increments failedCount in summary', async () => {
    const { computeWaves } = await import('../../../../src/modules/pm/engine/dependency.js');
    vi.mocked(computeWaves).mockReturnValue([{ wave: 0, taskIds: ['TST-1.01', 'TST-1.02'] }]);

    const { execSync } = await import('node:child_process');
    vi.mocked(execSync).mockReturnValue(Buffer.from(''));

    const ctx = new TestableContext();
    ctx.configureFailure('wave-0-task-TST-1.02');

    await waveExecutionWorkflow(ctx);

    expect(ctx.param('completedTasks')).toBe('1');
    expect(ctx.param('failedTasks')).toBe('1');
  });

  test('summary reports correct counts across multiple waves', async () => {
    const { computeWaves } = await import('../../../../src/modules/pm/engine/dependency.js');
    vi.mocked(computeWaves).mockReturnValue([
      { wave: 0, taskIds: ['TST-1.01'] },
      { wave: 1, taskIds: ['TST-1.02', 'TST-1.03'] },
    ]);

    const { execSync } = await import('node:child_process');
    vi.mocked(execSync).mockReturnValue(Buffer.from(''));

    const ctx = new TestableContext();

    await waveExecutionWorkflow(ctx);

    expect(ctx.param('completedTasks')).toBe('3');
    expect(ctx.param('failedTasks')).toBe('0');
  });

  test('wave ordering ensures wave 1 tasks run after wave 0', async () => {
    const { computeWaves } = await import('../../../../src/modules/pm/engine/dependency.js');
    vi.mocked(computeWaves).mockReturnValue([
      { wave: 0, taskIds: ['TST-1.01'] },
      { wave: 1, taskIds: ['TST-1.02'] },
      { wave: 2, taskIds: ['TST-1.03'] },
    ]);

    const { execSync } = await import('node:child_process');
    vi.mocked(execSync).mockReturnValue(Buffer.from(''));

    const ctx = new TestableContext();

    await waveExecutionWorkflow(ctx);

    // Verify ordering: dispatch calls should be wave-0, gate-0, wave-1, gate-1, wave-2, gate-2
    const nonSummarySteps = ctx.calls
      .filter((c) => c.stepId !== 'compute-waves' && c.stepId !== 'summary')
      .map((c) => c.stepId);

    expect(nonSummarySteps).toEqual([
      'wave-0-task-TST-1.01',
      'gate-wave-0',
      'wave-1-task-TST-1.02',
      'gate-wave-1',
      'wave-2-task-TST-1.03',
      'gate-wave-2',
    ]);
  });
});
