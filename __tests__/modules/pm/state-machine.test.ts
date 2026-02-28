import { describe, test, expect } from 'vitest';
import {
  validateTransition,
  computeVirtualState,
  canClaim,
  allowedTransitions,
} from '../../../src/modules/pm/engine/state-machine.js';
import type { TaskStatus } from '../../../src/modules/pm/types.js';

describe('validateTransition', () => {
  const validTransitions: [TaskStatus, TaskStatus][] = [
    ['pending', 'claimed'],
    ['pending', 'blocked'],
    ['pending', 'cancelled'],
    ['claimed', 'in-progress'],
    ['claimed', 'pending'],
    ['claimed', 'cancelled'],
    ['in-progress', 'done'],
    ['in-progress', 'blocked'],
    ['in-progress', 'cancelled'],
    ['in-progress', 'pending'],
    ['blocked', 'pending'],
    ['blocked', 'cancelled'],
  ];

  test.each(validTransitions)('%s -> %s is valid', (from, to) => {
    const result = validateTransition(from, to);
    expect(result.ok).toBe(true);
  });

  const invalidTransitions: [TaskStatus, TaskStatus][] = [
    ['done', 'pending'],
    ['done', 'claimed'],
    ['done', 'in-progress'],
    ['done', 'blocked'],
    ['done', 'cancelled'],
    ['cancelled', 'pending'],
    ['cancelled', 'claimed'],
    ['cancelled', 'in-progress'],
    ['cancelled', 'done'],
    ['cancelled', 'blocked'],
    ['pending', 'done'],
    ['pending', 'in-progress'],
    ['claimed', 'done'],
    ['claimed', 'blocked'],
    ['blocked', 'claimed'],
    ['blocked', 'in-progress'],
    ['blocked', 'done'],
    ['in-progress', 'claimed'],
  ];

  test.each(invalidTransitions)('%s -> %s is invalid', (from, to) => {
    const result = validateTransition(from, to);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('INVALID_TRANSITION');
      expect(result.error.details).toEqual({ from, to });
    }
  });

  test('error lists valid transitions for invalid transition', () => {
    const result = validateTransition('pending', 'done');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain('claimed');
      expect(result.error.message).toContain('blocked');
      expect(result.error.message).toContain('cancelled');
    }
  });

  test('error includes hint for pending -> done', () => {
    const result = validateTransition('pending', 'done');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain('claim');
    }
  });

  test('error includes hint for pending -> in-progress', () => {
    const result = validateTransition('pending', 'in-progress');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain('claim');
    }
  });

  test('error says terminal state for done', () => {
    const result = validateTransition('done', 'pending');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain('none (terminal state)');
    }
  });

  test('self-transitions are invalid', () => {
    const statuses: TaskStatus[] = [
      'pending',
      'claimed',
      'in-progress',
      'done',
      'blocked',
      'cancelled',
    ];
    for (const s of statuses) {
      const result = validateTransition(s, s);
      expect(result.ok).toBe(false);
    }
  });
});

describe('computeVirtualState', () => {
  test('pending with no dependencies returns [+READY, +ELIGIBLE]', () => {
    const result = computeVirtualState({
      status: 'pending',
      dependenciesComplete: false,
      hasDependencies: false,
    });
    expect(result).toEqual(['+READY', '+ELIGIBLE']);
  });

  test('pending with complete dependencies returns [+READY, +ELIGIBLE]', () => {
    const result = computeVirtualState({
      status: 'pending',
      dependenciesComplete: true,
      hasDependencies: true,
    });
    expect(result).toEqual(['+READY', '+ELIGIBLE']);
  });

  test('pending with incomplete dependencies returns [+BLOCKED]', () => {
    const result = computeVirtualState({
      status: 'pending',
      dependenciesComplete: false,
      hasDependencies: true,
    });
    expect(result).toEqual(['+BLOCKED']);
  });

  test('claimed with incomplete dependencies returns [+BLOCKED]', () => {
    const result = computeVirtualState({
      status: 'claimed',
      dependenciesComplete: false,
      hasDependencies: true,
    });
    expect(result).toEqual(['+BLOCKED']);
  });

  test('claimed with no dependencies returns []', () => {
    const result = computeVirtualState({
      status: 'claimed',
      dependenciesComplete: false,
      hasDependencies: false,
    });
    expect(result).toEqual([]);
  });

  test('claimed with complete dependencies returns []', () => {
    const result = computeVirtualState({
      status: 'claimed',
      dependenciesComplete: true,
      hasDependencies: true,
    });
    expect(result).toEqual([]);
  });

  test('in-progress with stale claim returns [+STALE]', () => {
    const now = new Date('2025-01-15T00:00:00Z');
    const claimedAt = '2025-01-01T00:00:00Z';
    const result = computeVirtualState({
      status: 'in-progress',
      dependenciesComplete: true,
      hasDependencies: false,
      claimedAt,
      now,
    });
    expect(result).toEqual(['+STALE']);
  });

  test('in-progress with recent claim returns []', () => {
    const now = new Date('2025-01-02T00:00:00Z');
    const claimedAt = '2025-01-01T00:00:00Z';
    const result = computeVirtualState({
      status: 'in-progress',
      dependenciesComplete: true,
      hasDependencies: false,
      claimedAt,
      now,
    });
    expect(result).toEqual([]);
  });

  test('in-progress without claimedAt returns []', () => {
    const result = computeVirtualState({
      status: 'in-progress',
      dependenciesComplete: true,
      hasDependencies: false,
    });
    expect(result).toEqual([]);
  });

  test('custom stale threshold is respected', () => {
    const now = new Date('2025-01-02T00:00:00Z');
    const claimedAt = '2025-01-01T00:00:00Z';
    const oneHourMs = 60 * 60 * 1000;

    const result = computeVirtualState({
      status: 'in-progress',
      dependenciesComplete: true,
      hasDependencies: false,
      claimedAt,
      now,
      staleThresholdMs: oneHourMs,
    });
    expect(result).toEqual(['+STALE']);
  });

  test('done returns []', () => {
    const result = computeVirtualState({
      status: 'done',
      dependenciesComplete: true,
      hasDependencies: false,
    });
    expect(result).toEqual([]);
  });

  test('cancelled returns []', () => {
    const result = computeVirtualState({
      status: 'cancelled',
      dependenciesComplete: false,
      hasDependencies: true,
    });
    expect(result).toEqual([]);
  });

  test('blocked returns []', () => {
    const result = computeVirtualState({
      status: 'blocked',
      dependenciesComplete: true,
      hasDependencies: true,
    });
    expect(result).toEqual([]);
  });
});

describe('canClaim', () => {
  test('under WIP limit returns ok', () => {
    const result = canClaim(2, 5);
    expect(result.ok).toBe(true);
  });

  test('at WIP limit returns WIP_LIMIT error', () => {
    const result = canClaim(5, 5);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('WIP_LIMIT');
      expect(result.error.details).toEqual({ currentWip: 5, wipLimit: 5 });
    }
  });

  test('over WIP limit returns WIP_LIMIT error', () => {
    const result = canClaim(6, 5);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('WIP_LIMIT');
    }
  });

  test('undefined limit always returns ok', () => {
    const result = canClaim(100, undefined);
    expect(result.ok).toBe(true);
  });

  test('zero WIP with zero limit returns WIP_LIMIT error', () => {
    const result = canClaim(0, 0);
    expect(result.ok).toBe(false);
  });
});

describe('allowedTransitions', () => {
  test('pending returns [claimed, blocked, cancelled]', () => {
    expect(allowedTransitions('pending')).toEqual(['claimed', 'blocked', 'cancelled']);
  });

  test('claimed returns [in-progress, pending, cancelled]', () => {
    expect(allowedTransitions('claimed')).toEqual(['in-progress', 'pending', 'cancelled']);
  });

  test('in-progress returns [done, blocked, cancelled, pending]', () => {
    expect(allowedTransitions('in-progress')).toEqual(['done', 'blocked', 'cancelled', 'pending']);
  });

  test('done returns []', () => {
    expect(allowedTransitions('done')).toEqual([]);
  });

  test('blocked returns [pending, cancelled]', () => {
    expect(allowedTransitions('blocked')).toEqual(['pending', 'cancelled']);
  });

  test('cancelled returns []', () => {
    expect(allowedTransitions('cancelled')).toEqual([]);
  });

  test('returns a copy, not the original array', () => {
    const first = allowedTransitions('pending');
    const second = allowedTransitions('pending');
    expect(first).toEqual(second);
    expect(first).not.toBe(second);
  });
});
