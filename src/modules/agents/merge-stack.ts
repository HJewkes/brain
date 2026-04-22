import type Database from 'better-sqlite3';
import type { BrainDB } from '../../services/brain-db.js';
import { getRawDb, sleep } from '../../utils/db.js';
import { getPrForBranch, mergePr, type MergeStrategy, type PrStatus } from './auto-merge.js';
import { rebaseInIsolation } from './rebase-isolation.js';
import { spawnFixAgent } from './fix-agent.js';
import { getDelivery, type DeliveryRecord } from './delivery.js';

export type ConflictPolicy = 'fix-agent' | 'flag' | 'abort';

export interface StackMergeItem {
  prNumber: number;
  branch: string;
  taskId?: string | null;
  agentId?: string | null;
  /** Branch names this PR depends on being merged first. */
  dependsOn?: string[];
}

export type StackItemOutcome =
  | 'merged'
  | 'ci-failed'
  | 'conflicted-flagged'
  | 'timeout'
  | 'skipped'
  | 'rebase-failed';

export interface StackItemResult {
  prNumber: number;
  branch: string;
  taskId: string | null;
  outcome: StackItemOutcome;
  failedChecks?: string[];
  error?: string;
}

export interface StackMergeResult {
  merged: number;
  stopped: boolean;
  stopReason?: string;
  items: StackItemResult[];
}

export interface StackMergeOptions {
  projectDir: string;
  /** Merge strategy (default: squash). */
  strategy?: MergeStrategy;
  /** Poll interval for CI status in ms (default: 15000). */
  ciPollInterval?: number;
  /** Maximum time to wait for CI per PR in ms (default: 30 min). */
  ciMaxWait?: number;
  /** How to handle merge conflicts that rebase can't fix (default: 'flag'). */
  onConflict?: ConflictPolicy;
  /** Stop the stack on first CI failure after rebase (default: true). */
  stopOnCiFailure?: boolean;
}

const DEFAULT_CI_POLL = 15_000;
const DEFAULT_CI_MAX_WAIT = 30 * 60 * 1000;

/**
 * Topological sort of stack items by dependsOn (branch names).
 * Items with unresolved dependencies are preserved in input order.
 */
export function sortStackByDependency(items: StackMergeItem[]): StackMergeItem[] {
  const byBranch = new Map(items.map((i) => [i.branch, i]));
  const visited = new Set<string>();
  const result: StackMergeItem[] = [];

  const visit = (item: StackMergeItem, stack: Set<string>): void => {
    if (visited.has(item.branch) || stack.has(item.branch)) return;
    stack.add(item.branch);
    for (const dep of item.dependsOn ?? []) {
      const depItem = byBranch.get(dep);
      if (depItem) visit(depItem, stack);
    }
    stack.delete(item.branch);
    visited.add(item.branch);
    result.push(item);
  };

  for (const item of items) visit(item, new Set());
  return result;
}

/** CI is resolved when every check has a conclusion (pass or fail). */
function isCiResolved(pr: PrStatus): boolean {
  if (pr.checksPass) return true;
  return (pr.failedChecks?.length ?? 0) > 0;
}

/** Wait until CI for a PR resolves to pass/fail, or the deadline passes. */
async function waitForCi(
  item: StackMergeItem,
  opts: Required<Pick<StackMergeOptions, 'projectDir' | 'ciPollInterval' | 'ciMaxWait'>>
): Promise<{ pr: PrStatus | null; timedOut: boolean }> {
  const deadline = Date.now() + opts.ciMaxWait;
  while (Date.now() < deadline) {
    const pr = getPrForBranch(item.branch, opts.projectDir);
    if (pr && pr.state !== 'open') return { pr, timedOut: false };
    if (pr && isCiResolved(pr)) return { pr, timedOut: false };
    await sleep(opts.ciPollInterval);
  }
  const final = getPrForBranch(item.branch, opts.projectDir);
  return { pr: final, timedOut: true };
}

async function handleConflict(
  db: BrainDB | Database.Database | null,
  item: StackMergeItem,
  policy: ConflictPolicy
): Promise<{ resolved: boolean; error?: string }> {
  if (policy === 'abort') return { resolved: false, error: 'conflict policy=abort' };
  if (policy === 'flag') return { resolved: false, error: 'flagged for human review' };

  if (policy === 'fix-agent' && db && 'rawDb' in db && item.agentId) {
    const delivery = getDelivery(getRawDb(db), item.agentId);
    if (!delivery) return { resolved: false, error: 'delivery record not found' };
    const fixed = await spawnFixAgent(db as BrainDB, delivery);
    if (fixed) return { resolved: true };
    return { resolved: false, error: 'fix agent failed' };
  }
  return { resolved: false, error: 'fix agent unavailable (no db or agentId)' };
}

function makeItemResult(
  item: StackMergeItem,
  outcome: StackItemOutcome,
  extra: Partial<StackItemResult> = {}
): StackItemResult {
  return {
    prNumber: item.prNumber,
    branch: item.branch,
    taskId: item.taskId ?? null,
    outcome,
    ...extra,
  };
}

async function mergeStackItem(
  db: BrainDB | Database.Database | null,
  item: StackMergeItem,
  opts: {
    projectDir: string;
    strategy: MergeStrategy;
    ciPollInterval: number;
    ciMaxWait: number;
    onConflict: ConflictPolicy;
  }
): Promise<StackItemResult> {
  const rebased = await rebaseInIsolation(item.branch, opts.projectDir);
  if (!rebased) {
    const conflict = await handleConflict(db, item, opts.onConflict);
    if (!conflict.resolved) {
      return makeItemResult(item, 'conflicted-flagged', { error: conflict.error });
    }
  }

  const { pr, timedOut } = await waitForCi(item, opts);
  if (timedOut) return makeItemResult(item, 'timeout', { error: 'CI did not resolve in time' });
  if (!pr) return makeItemResult(item, 'rebase-failed', { error: 'PR not found after rebase' });

  if (pr.state === 'merged') return makeItemResult(item, 'merged');
  if (pr.state !== 'open') {
    return makeItemResult(item, 'skipped', { error: `PR state=${pr.state}` });
  }

  if (!pr.checksPass) {
    return makeItemResult(item, 'ci-failed', { failedChecks: pr.failedChecks });
  }

  if (!pr.mergeable) {
    const conflict = await handleConflict(db, item, opts.onConflict);
    if (!conflict.resolved) {
      return makeItemResult(item, 'conflicted-flagged', { error: conflict.error });
    }
    const refreshed = getPrForBranch(item.branch, opts.projectDir);
    if (!refreshed || !refreshed.mergeable) {
      return makeItemResult(item, 'conflicted-flagged', { error: 'still not mergeable' });
    }
  }

  const mergeResult = mergePr(item.prNumber, {
    projectDir: opts.projectDir,
    strategy: opts.strategy,
  });
  if (!mergeResult.merged) {
    return makeItemResult(item, 'conflicted-flagged', { error: mergeResult.error });
  }
  return makeItemResult(item, 'merged');
}

/**
 * Sequentially merge a stack of PRs in dependency order.
 *
 * For each PR: (1) rebase onto origin/main, (2) wait for CI to resolve,
 * (3) squash-merge. On conflict, dispatches per onConflict policy. On CI
 * failure after rebase, stops the stack if stopOnCiFailure is true.
 *
 * This is the sequential counterpart to monitorDelivery's single-PR loop —
 * call mergeStack after all agents in a wave have pushed PRs and need to
 * land in order without racing on main.
 */
export async function mergeStack(
  db: BrainDB | Database.Database | null,
  items: StackMergeItem[],
  options: StackMergeOptions
): Promise<StackMergeResult> {
  const opts = {
    projectDir: options.projectDir,
    strategy: options.strategy ?? ('squash' as MergeStrategy),
    ciPollInterval: options.ciPollInterval ?? DEFAULT_CI_POLL,
    ciMaxWait: options.ciMaxWait ?? DEFAULT_CI_MAX_WAIT,
    onConflict: options.onConflict ?? ('flag' as ConflictPolicy),
    stopOnCiFailure: options.stopOnCiFailure ?? true,
  };

  const ordered = sortStackByDependency(items);
  const result: StackMergeResult = { merged: 0, stopped: false, items: [] };

  for (const item of ordered) {
    if (result.stopped) {
      result.items.push(makeItemResult(item, 'skipped', { error: 'stack stopped' }));
      continue;
    }

    const itemResult = await mergeStackItem(db, item, opts);
    result.items.push(itemResult);

    if (itemResult.outcome === 'merged') {
      result.merged++;
      continue;
    }

    if (itemResult.outcome === 'ci-failed' && opts.stopOnCiFailure) {
      result.stopped = true;
      result.stopReason = `CI failed on PR #${item.prNumber}: ${(itemResult.failedChecks ?? []).join(', ')}`;
    } else if (itemResult.outcome === 'conflicted-flagged' && opts.onConflict === 'abort') {
      result.stopped = true;
      result.stopReason = `conflict on PR #${item.prNumber}`;
    }
  }

  return result;
}

/**
 * Build stack items from a list of delivery records.
 * Skips records without an open PR.
 */
export function deliveriesToStackItems(deliveries: DeliveryRecord[]): StackMergeItem[] {
  return deliveries
    .filter((d) => d.branch && d.pr_number)
    .map((d) => ({
      prNumber: d.pr_number as number,
      branch: d.branch as string,
      taskId: d.task_id,
      agentId: d.agent_id,
    }));
}
