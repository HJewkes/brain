import type { TaskStatus, VirtualState } from '../types.js';
import type { Result } from '../errors.js';
import { ok, fail } from '../errors.js';

const TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  'pending': ['claimed', 'blocked', 'cancelled'],
  'claimed': ['in-progress', 'pending', 'cancelled'],
  'in-progress': ['done', 'blocked', 'cancelled'],
  'done': [],
  'blocked': ['pending', 'cancelled'],
  'cancelled': [],
};

const DEFAULT_STALE_MS = 7 * 24 * 60 * 60 * 1000;

export function validateTransition(from: TaskStatus, to: TaskStatus): Result<void> {
  const allowed = TRANSITIONS[from];
  if (allowed.includes(to)) {
    return ok(undefined);
  }
  return fail('INVALID_TRANSITION', `Cannot transition from '${from}' to '${to}'`, { from, to });
}

export interface VirtualStateInput {
  status: TaskStatus;
  dependenciesComplete: boolean;
  hasDependencies: boolean;
  claimedAt?: string;
  now?: Date;
  staleThresholdMs?: number;
}

export function computeVirtualState(input: VirtualStateInput): VirtualState[] {
  const states: VirtualState[] = [];
  const { status, dependenciesComplete, hasDependencies, claimedAt } = input;

  if (status === 'pending') {
    if (!hasDependencies || dependenciesComplete) {
      states.push('+READY', '+ELIGIBLE');
    } else {
      states.push('+BLOCKED');
    }
  }

  if (status === 'claimed' && hasDependencies && !dependenciesComplete) {
    states.push('+BLOCKED');
  }

  if (status === 'in-progress' && claimedAt) {
    const now = input.now ?? new Date();
    const threshold = input.staleThresholdMs ?? DEFAULT_STALE_MS;
    const claimedTime = new Date(claimedAt).getTime();
    if (now.getTime() - claimedTime > threshold) {
      states.push('+STALE');
    }
  }

  return states;
}

export function canClaim(currentWip: number, wipLimit: number | undefined): Result<void> {
  if (wipLimit === undefined || currentWip < wipLimit) {
    return ok(undefined);
  }
  return fail('WIP_LIMIT', `WIP limit reached (${currentWip}/${wipLimit})`, {
    currentWip,
    wipLimit,
  });
}

export function allowedTransitions(from: TaskStatus): TaskStatus[] {
  return [...TRANSITIONS[from]];
}
