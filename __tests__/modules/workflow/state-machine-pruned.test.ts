import { describe, test, expect } from 'vitest';
import {
  validateTransition,
  allowedTransitions,
} from '../../../src/modules/pm/engine/state-machine.js';
import type { TaskStatus } from '../../../src/modules/pm/types.js';

// --- AC-02: Pruned Task State ---

describe('pruned state transitions', () => {
  describe('valid transitions to pruned', () => {
    test('AC-02: pending -> pruned is valid', () => {
      const result = validateTransition('pending' as TaskStatus, 'pruned' as TaskStatus);
      expect(result.ok).toBe(true);
    });

    test('AC-02: blocked -> pruned is valid', () => {
      const result = validateTransition('blocked' as TaskStatus, 'pruned' as TaskStatus);
      expect(result.ok).toBe(true);
    });
  });

  describe('invalid transitions to pruned', () => {
    test('AC-02: claimed -> pruned is rejected (must release claim first)', () => {
      const result = validateTransition('claimed' as TaskStatus, 'pruned' as TaskStatus);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INVALID_TRANSITION');
      }
    });

    test('AC-02: in-progress -> pruned is rejected', () => {
      const result = validateTransition('in-progress' as TaskStatus, 'pruned' as TaskStatus);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INVALID_TRANSITION');
      }
    });

    test('AC-02: done -> pruned is rejected', () => {
      const result = validateTransition('done' as TaskStatus, 'pruned' as TaskStatus);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INVALID_TRANSITION');
      }
    });

    test('AC-02: cancelled -> pruned is rejected', () => {
      const result = validateTransition('cancelled' as TaskStatus, 'pruned' as TaskStatus);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INVALID_TRANSITION');
      }
    });
  });

  describe('pruned is terminal', () => {
    const allStatuses: TaskStatus[] = [
      'pending',
      'claimed',
      'in-progress',
      'done',
      'blocked',
      'cancelled',
    ];

    test.each(allStatuses)('AC-02: pruned -> %s is rejected (terminal state)', (targetStatus) => {
      const result = validateTransition('pruned' as TaskStatus, targetStatus);
      expect(result.ok).toBe(false);
    });

    test('AC-02: pruned -> pruned is rejected', () => {
      const result = validateTransition('pruned' as TaskStatus, 'pruned' as TaskStatus);
      expect(result.ok).toBe(false);
    });
  });

  describe('pruned has no outgoing transitions', () => {
    test('AC-02: allowedTransitions for pruned returns empty array', () => {
      const transitions = allowedTransitions('pruned' as TaskStatus);
      expect(transitions).toEqual([]);
    });
  });
});
