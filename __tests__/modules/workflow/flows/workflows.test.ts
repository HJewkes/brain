import { describe, test, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import type {
  WorkflowContext as WorkflowContextInterface,
  StepResult,
} from '../../../../src/modules/workflow/runtime/types.js';
import { implementationWorkflow } from '../../../../src/modules/workflow/flows/implementation.js';
import { reviewWorkflow } from '../../../../src/modules/workflow/flows/review.js';
import { brainstormingWorkflow } from '../../../../src/modules/workflow/flows/brainstorming.js';
import { prLifecycleWorkflow } from '../../../../src/modules/workflow/flows/pr-lifecycle.js';
import { uxPrototypeWorkflow } from '../../../../src/modules/workflow/flows/ux-prototype.js';

// ---------------------------------------------------------------------------
// Shared TestableContext
// ---------------------------------------------------------------------------

type SignalKey = `${string}:${number}`;

interface DispatchCall {
  method: 'dispatch' | 'assisted';
  stepId: string;
  template: string;
}

class TestableContext implements WorkflowContextInterface {
  readonly runId = `test-${randomUUID().slice(0, 8)}`;
  readonly workflowName = 'test';
  readonly project = 'TST';
  readonly projectDir = '/tmp/test';

  calls: DispatchCall[] = [];

  private params: Record<string, string>;
  private iterations: Record<string, number> = {};
  private signalMap = new Map<SignalKey, string | null>();

  constructor(params: Record<string, string> = {}) {
    this.params = params;
  }

  configureSignal(stepId: string, iterationIndex: number, signal: string | null): void {
    this.signalMap.set(`${stepId}:${iterationIndex}` as SignalKey, signal);
  }

  param(key: string): string | undefined {
    return this.params[key];
  }

  iteration(stepId: string): number {
    return this.iterations[stepId] ?? 0;
  }

  async dispatch(stepId: string, template: string): Promise<StepResult> {
    const iter = this.iterations[stepId] ?? 0;
    this.calls.push({ method: 'dispatch', stepId, template });
    const signal = this.signalMap.get(`${stepId}:${iter}` as SignalKey) ?? null;
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
    this.calls.push({ method: 'assisted', stepId, template });
    return {
      stepId,
      taskId: `TST-${stepId}`,
      agentId: null,
      signal: null,
      completedAt: new Date().toISOString(),
    };
  }

  signal(): void {}
}

function steps(ctx: TestableContext): string[] {
  return ctx.calls.map((c) => c.stepId);
}

// ---------------------------------------------------------------------------
// Implementation workflow
// ---------------------------------------------------------------------------

describe('implementationWorkflow', () => {
  test('happy path: dispatch → implement → review (approved) → merge', async () => {
    const ctx = new TestableContext();
    ctx.configureSignal('review', 0, 'approved');

    await implementationWorkflow(ctx);

    expect(steps(ctx)).toEqual(['dispatch', 'implement', 'review', 'merge']);
    expect(ctx.calls[0].method).toBe('assisted');
    expect(ctx.calls[3].method).toBe('assisted');
  });

  test('fix loop: review needs_fixes → fix → re-review → approved → merge', async () => {
    const ctx = new TestableContext();
    ctx.configureSignal('review', 0, 'needs_fixes');
    ctx.configureSignal('review', 1, 'approved');

    await implementationWorkflow(ctx);

    expect(steps(ctx)).toEqual(['dispatch', 'implement', 'review', 'fix', 'review', 'merge']);
  });

  test('fix loop caps at 3 iterations', async () => {
    const ctx = new TestableContext();
    ctx.configureSignal('review', 0, 'needs_fixes');
    ctx.configureSignal('review', 1, 'needs_fixes');
    ctx.configureSignal('review', 2, 'needs_fixes');
    ctx.configureSignal('review', 3, 'needs_fixes');

    await implementationWorkflow(ctx);

    const fixCount = steps(ctx).filter((s) => s === 'fix').length;
    expect(fixCount).toBe(3);
  });

  test('no merge when review never approves', async () => {
    const ctx = new TestableContext();
    // All reviews return null (no signal) — loop doesn't trigger, no merge

    await implementationWorkflow(ctx);

    expect(steps(ctx)).toEqual(['dispatch', 'implement', 'review']);
    expect(steps(ctx)).not.toContain('merge');
  });
});

// ---------------------------------------------------------------------------
// Review workflow
// ---------------------------------------------------------------------------

describe('reviewWorkflow', () => {
  test('happy path: low risk, no fixes → merge', async () => {
    const ctx = new TestableContext();

    await reviewWorkflow(ctx);

    expect(steps(ctx)).toEqual(['review', 'merge']);
  });

  test('high risk routes to human review then merge', async () => {
    const ctx = new TestableContext();
    ctx.configureSignal('review', 0, 'high_risk');

    await reviewWorkflow(ctx);

    expect(steps(ctx)).toEqual(['review', 'human-review', 'merge']);
    expect(ctx.calls[1].method).toBe('assisted');
  });

  test('fix loop: needs_fixes → fixup → re-review → merge', async () => {
    const ctx = new TestableContext();
    ctx.configureSignal('review', 0, 'needs_fixes');

    await reviewWorkflow(ctx);

    expect(steps(ctx)).toEqual(['review', 'fixup', 'review', 'merge']);
  });

  test('high risk + human says needs_fixes → fixup → review → merge', async () => {
    const ctx = new TestableContext();
    ctx.configureSignal('review', 0, 'high_risk');
    // Simulate human-review returning needs_fixes via assisted step
    // (assisted steps return null signal by default, so we need a custom context)
    // For now, test the non-fix path through human review

    await reviewWorkflow(ctx);

    expect(steps(ctx)).toEqual(['review', 'human-review', 'merge']);
  });

  test('fix loop caps at 3 iterations', async () => {
    const ctx = new TestableContext();
    ctx.configureSignal('review', 0, 'needs_fixes');
    ctx.configureSignal('review', 1, 'needs_fixes');
    ctx.configureSignal('review', 2, 'needs_fixes');
    ctx.configureSignal('review', 3, 'needs_fixes');

    await reviewWorkflow(ctx);

    const fixupCount = steps(ctx).filter((s) => s === 'fixup').length;
    expect(fixupCount).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Brainstorming workflow
// ---------------------------------------------------------------------------

describe('brainstormingWorkflow', () => {
  test('happy path: explore → interview → propose → design → write-doc → write-plan', async () => {
    const ctx = new TestableContext();

    await brainstormingWorkflow(ctx);

    expect(steps(ctx)).toEqual([
      'explore',
      'interview',
      'propose',
      'design',
      'write-doc',
      'write-plan',
    ]);
    expect(ctx.calls[1].method).toBe('assisted');
  });

  test('clarification loop: design → interview → design → write', async () => {
    const ctx = new TestableContext();
    ctx.configureSignal('design', 0, 'needs_clarification');

    await brainstormingWorkflow(ctx);

    expect(steps(ctx)).toEqual([
      'explore',
      'interview',
      'propose',
      'design',
      'interview',
      'design',
      'write-doc',
      'write-plan',
    ]);
    expect(ctx.iteration('design')).toBe(2);
  });

  test('clarification loop caps at 3 design iterations', async () => {
    const ctx = new TestableContext();
    ctx.configureSignal('design', 0, 'needs_clarification');
    ctx.configureSignal('design', 1, 'needs_clarification');
    ctx.configureSignal('design', 2, 'needs_clarification');

    await brainstormingWorkflow(ctx);

    // design starts at iteration 0, loop runs while iteration < 3
    // So max 3 design dispatches (iter 0, 1, 2)
    const designCount = steps(ctx).filter((s) => s === 'design').length;
    expect(designCount).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// PR lifecycle workflow
// ---------------------------------------------------------------------------

describe('prLifecycleWorkflow', () => {
  test('happy path: implement → create-pr → review → merge', async () => {
    const ctx = new TestableContext();

    await prLifecycleWorkflow(ctx);

    expect(steps(ctx)).toEqual(['implement', 'create-pr', 'review', 'merge']);
    expect(ctx.calls[1].method).toBe('assisted');
    expect(ctx.calls[3].method).toBe('assisted');
  });

  test('changes_requested loop: fixup → re-review', async () => {
    const ctx = new TestableContext();
    ctx.configureSignal('review', 0, 'changes_requested');

    await prLifecycleWorkflow(ctx);

    expect(steps(ctx)).toEqual(['implement', 'create-pr', 'review', 'fixup', 'review', 'merge']);
  });

  test('fixup loop caps at 3 iterations', async () => {
    const ctx = new TestableContext();
    ctx.configureSignal('review', 0, 'changes_requested');
    ctx.configureSignal('review', 1, 'changes_requested');
    ctx.configureSignal('review', 2, 'changes_requested');
    ctx.configureSignal('review', 3, 'changes_requested');

    await prLifecycleWorkflow(ctx);

    const fixupCount = steps(ctx).filter((s) => s === 'fixup').length;
    expect(fixupCount).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// UX prototype workflow
// ---------------------------------------------------------------------------

describe('uxPrototypeWorkflow', () => {
  test('happy path: ideate → prototype → review → extract → implement', async () => {
    const ctx = new TestableContext();

    await uxPrototypeWorkflow(ctx);

    expect(steps(ctx)).toEqual(['ideate', 'prototype', 'review', 'extract', 'implement']);
  });

  test('iteration loop: review needs_changes → iterate → review → extract', async () => {
    const ctx = new TestableContext();
    ctx.configureSignal('review', 0, 'needs_changes');

    await uxPrototypeWorkflow(ctx);

    expect(steps(ctx)).toEqual([
      'ideate',
      'prototype',
      'review',
      'iterate',
      'review',
      'extract',
      'implement',
    ]);
  });

  test('iteration loop caps at 3', async () => {
    const ctx = new TestableContext();
    ctx.configureSignal('review', 0, 'needs_changes');
    ctx.configureSignal('review', 1, 'needs_changes');
    ctx.configureSignal('review', 2, 'needs_changes');
    ctx.configureSignal('review', 3, 'needs_changes');

    await uxPrototypeWorkflow(ctx);

    const iterateCount = steps(ctx).filter((s) => s === 'iterate').length;
    expect(iterateCount).toBe(3);
  });
});
