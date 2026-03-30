import type { TaskStatus, VirtualState } from '../types.js';
import type { Result } from '../errors.js';
import { ok, fail } from '../errors.js';

const TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  pending: ['claimed', 'blocked', 'cancelled', 'pruned', 'skipped'],
  claimed: ['in-progress', 'pending', 'cancelled'],
  'in-progress': ['done', 'blocked', 'cancelled', 'pending'],
  done: ['pending'],
  blocked: ['pending', 'cancelled', 'pruned'],
  cancelled: [],
  pruned: [],
  skipped: ['pending'],
};

const DEFAULT_STALE_MS = 7 * 24 * 60 * 60 * 1000;

export function validateTransition(from: TaskStatus, to: TaskStatus): Result<void> {
  const allowed = TRANSITIONS[from];
  if (allowed.includes(to)) {
    return ok(undefined);
  }
  const validList = allowed.length > 0 ? allowed.join(', ') : 'none (terminal state)';
  const hint = buildTransitionHint(from, to);
  const message = `Cannot transition from '${from}' to '${to}'. Valid: ${validList}.${hint}`;
  return fail('INVALID_TRANSITION', message, { from, to });
}

function buildTransitionHint(from: TaskStatus, to: TaskStatus): string {
  if (from === 'pending' && to === 'done') {
    return " Hint: run 'brain pm task claim <id>' first, then start and complete.";
  }
  if (from === 'pending' && to === 'in-progress') {
    return " Hint: run 'brain pm task claim <id>' first.";
  }
  if (from === 'done' && to !== 'pending') {
    return " Hint: use 'brain pm task reset <id>' to return a completed task to pending.";
  }
  return '';
}

export interface VirtualStateInput {
  status: TaskStatus;
  dependenciesComplete: boolean;
  hasDependencies: boolean;
  claimedAt?: string;
  dueDate?: string;
  now?: Date;
  staleThresholdMs?: number;
}

export function computeVirtualState(input: VirtualStateInput): VirtualState[] {
  const states: VirtualState[] = [];
  const { status, dependenciesComplete, hasDependencies, claimedAt, dueDate } = input;

  if (status === 'pruned' || status === 'skipped') return states;

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

  if (dueDate && !['done', 'cancelled', 'pruned', 'skipped'].includes(status)) {
    const now = input.now ?? new Date();
    const due = new Date(dueDate + 'T23:59:59');
    if (due < now) {
      states.push('+OVERDUE');
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

export function isTerminalStatus(status: TaskStatus): boolean {
  // done allows reset→pending but is still considered terminal for workflow purposes
  // (tasks don't auto-transition out of done, cancelled, or pruned)
  if (status === 'done' || status === 'cancelled' || status === 'pruned') return true;
  return TRANSITIONS[status].length === 0;
}

export function allowedTransitions(from: TaskStatus): TaskStatus[] {
  return [...TRANSITIONS[from]];
}
