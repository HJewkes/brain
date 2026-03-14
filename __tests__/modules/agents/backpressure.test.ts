import { describe, it, expect } from 'vitest';
import { BackpressureController } from '../../../src/modules/agents/backpressure.js';

describe('BackpressureController', () => {
  it('returns base WIP when no pressure signals', () => {
    const ctrl = new BackpressureController(4);
    const result = ctrl.computeEffectiveWip();

    expect(result.effectiveWip).toBe(4);
    expect(result.reason).toBe('nominal');
  });

  it('reduces WIP when merge queue is deep', () => {
    const ctrl = new BackpressureController(4);
    ctrl.setMergeQueueDepth(4);

    const result = ctrl.computeEffectiveWip();

    expect(result.effectiveWip).toBe(2);
    expect(result.reason).toContain('merge queue depth');
  });

  it('reduces WIP on high conflict rate', () => {
    const ctrl = new BackpressureController(4);
    ctrl.recordMerge(true, true);
    ctrl.recordMerge(true, true);
    ctrl.recordMerge(true, false);

    const result = ctrl.computeEffectiveWip();

    // 2/3 = 66% conflict rate > 30% threshold
    expect(result.effectiveWip).toBe(2);
    expect(result.reason).toContain('conflict rate');
  });

  it('reduces WIP on high stall rate', () => {
    const ctrl = new BackpressureController(4);
    ctrl.recordStall('ws-1');
    ctrl.recordStall('ws-1');
    ctrl.recordStall('ws-2');
    ctrl.recordMerge(true, false);

    const result = ctrl.computeEffectiveWip();

    // 3 stalls / 4 total = 75% stall rate > 50% threshold
    expect(result.effectiveWip).toBe(3);
    expect(result.reason).toContain('stall rate');
  });

  it('never goes below WIP of 1', () => {
    const ctrl = new BackpressureController(1);
    ctrl.setMergeQueueDepth(10);
    ctrl.recordMerge(true, true);
    ctrl.recordStall('ws-1');

    const result = ctrl.computeEffectiveWip();

    expect(result.effectiveWip).toBe(1);
  });

  it('combines multiple pressure signals', () => {
    const ctrl = new BackpressureController(4);
    ctrl.setMergeQueueDepth(4); // reduces by 2 → 2
    ctrl.recordMerge(true, true);
    ctrl.recordMerge(true, true); // 100% conflict → halve → 1

    const result = ctrl.computeEffectiveWip();

    expect(result.effectiveWip).toBe(1);
    expect(result.reason).toContain('merge queue');
    expect(result.reason).toContain('conflict rate');
  });

  it('exposes state for monitoring', () => {
    const ctrl = new BackpressureController(4);
    ctrl.setMergeQueueDepth(3);
    ctrl.recordMerge(true, true);

    const state = ctrl.getState();

    expect(state.mergeQueueDepth).toBe(3);
    expect(state.conflictRate).toBe(1);
    expect(state.recentMergeResults).toHaveLength(1);
  });
});
