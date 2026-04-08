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
    ['done', 'pending'],
    ['pending', 'skipped'],
    ['skipped', 'pending'],
  ];

  test.each(validTransitions)('%s -> %s is valid', (from, to) => {
    const result = validateTransition(from, to);
    expect(result.ok).toBe(true);
  });

  const invalidTransitions: [TaskStatus, TaskStatus][] = [
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
    ['skipped', 'done'],
    ['skipped', 'claimed'],
    ['skipped', 'in-progress'],
    ['skipped', 'cancelled'],
    ['skipped', 'blocked'],
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

  test('done -> pending is valid (reset)', () => {
    const result = validateTransition('done', 'pending');
    expect(result.ok).toBe(true);
  });

  test('done -> claimed includes reset hint', () => {
    const result = validateTransition('done', 'claimed');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain('reset');
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

  test('skipped returns []', () => {
    const result = computeVirtualState({
      status: 'skipped',
      dependenciesComplete: false,
      hasDependencies: true,
    });
    expect(result).toEqual([]);
  });

  test('skipped with due date does not return +OVERDUE', () => {
    const result = computeVirtualState({
      status: 'skipped',
      dependenciesComplete: false,
      hasDependencies: false,
      dueDate: '2020-01-01',
      now: new Date('2025-01-01'),
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
  test('pending returns [claimed, blocked, cancelled, pruned, skipped]', () => {
    expect(allowedTransitions('pending')).toEqual([
      'claimed',
      'blocked',
      'cancelled',
      'pruned',
      'skipped',
    ]);
  });

  test('claimed returns [in-progress, pending, cancelled]', () => {
    expect(allowedTransitions('claimed')).toEqual(['in-progress', 'pending', 'cancelled']);
  });

  test('in-progress returns [pending-merge, done, blocked, cancelled, pending]', () => {
    expect(allowedTransitions('in-progress')).toEqual([
      'pending-merge',
      'done',
      'blocked',
      'cancelled',
      'pending',
    ]);
  });

  test('pending-merge returns [done, in-progress, cancelled]', () => {
    expect(allowedTransitions('pending-merge')).toEqual(['done', 'in-progress', 'cancelled']);
  });

  test('done returns [pending]', () => {
    expect(allowedTransitions('done')).toEqual(['pending']);
  });

  test('blocked returns [pending, cancelled]', () => {
    expect(allowedTransitions('blocked')).toEqual(['pending', 'cancelled', 'pruned']);
  });

  test('cancelled returns []', () => {
    expect(allowedTransitions('cancelled')).toEqual([]);
  });

  test('skipped returns [pending]', () => {
    expect(allowedTransitions('skipped')).toEqual(['pending']);
  });

  test('returns a copy, not the original array', () => {
    const first = allowedTransitions('pending');
    const second = allowedTransitions('pending');
    expect(first).toEqual(second);
    expect(first).not.toBe(second);
  });
});
