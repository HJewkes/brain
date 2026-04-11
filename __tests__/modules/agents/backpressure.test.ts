import { describe, it, expect } from 'vitest';
import { BackpressureController } from '../../../src/modules/agents/backpressure.js';

describe('BackpressureController', () => {
  it('returns base WIP as effective WIP', () => {
    const ctrl = new BackpressureController(4);
    const result = ctrl.computeEffectiveWip();

    expect(result.effectiveWip).toBe(4);
    expect(result.reason).toBe('nominal');
  });

  it('respects different base WIP values', () => {
    const ctrl = new BackpressureController(1);
    expect(ctrl.computeEffectiveWip().effectiveWip).toBe(1);

    const ctrl2 = new BackpressureController(10);
    expect(ctrl2.computeEffectiveWip().effectiveWip).toBe(10);
  });
});
