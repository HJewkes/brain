import { execFileSync } from 'node:child_process';
import type Database from 'better-sqlite3';
import type { BrainDB } from './brain-db.js';
import { getRawDb } from '../utils/db.js';
import { getPrForBranch, rerunPrChecks } from '../modules/agents/auto-merge.js';
import { rebaseInIsolationDetailed } from '../modules/agents/rebase-isolation.js';
import { reclaimTerminatedAllocations } from '../modules/agents/worktree.js';
import {
  enableAutoMerge,
  updateDeliveryStatus,
  type DeliveryRecord,
} from '../modules/agents/delivery.js';
import { recoverBranchForAgent } from '../server/orchestration.js';
import { loadFlakyTests } from '../modules/agents/delivery-monitor.js';
import { updateTaskStatus } from '../modules/pm/data/task-ops.js';
import type { BrainConfig, Embedder } from '../types.js';

export interface ReconcileReport {
  prsScanned: number;
  rebased: string[];
  ciReruns: string[];
  autoMergeArmed: number[];
  worktreesReclaimed: string[];
  branchesRecovered: string[];
  /** Tasks whose delivery+PM state advanced because GitHub reports the PR merged. */
  deliveriesMerged: string[];
  /** Tasks whose delivery state advanced because GitHub reports the PR closed without merge. */
  deliveriesClosed: string[];
  errors: { kind: string; target: string; reason: string }[];
}

/**
 * Optional dependencies needed to advance PM task status when a PR's terminal
 * state is observed. Absent in tests / contexts that only need the
 * delivery_states-level reconcile path.
 */
export interface PmDeps {
  brainDb: BrainDB;
  config: BrainConfig;
  embedder: Embedder;
}

interface OrphanAgentRow {
  id: string;
  brain_task: string;
  branch: string;
}

/** Statuses where the delivery has an open PR worth reconciling. */
const ACTIVE_PR_STATUSES = ['pr-open', 'conflicted', 'review-paused'] as const;

/**
 * Statuses indicating push + PR already happened. Orphan recovery (action e)
 * skips these to avoid re-initiating delivery on branches already in flight.
 */
const DELIVERY_INITIATED_STATUSES = [
  'pushed',
  'pr-open',
  'pr-failed',
  'conflicted',
  'merged',
  'delivered',
  'stalled',
  'redispatched',
  'review-paused',
];

/** Cooldown between CI reruns on the same branch — avoids hammering flaky checks. */
const CI_RERUN_COOLDOWN_MS = 30 * 60 * 1000;

function emptyReport(): ReconcileReport {
  return {
    prsScanned: 0,
    rebased: [],
    ciReruns: [],
    autoMergeArmed: [],
    worktreesReclaimed: [],
    branchesRecovered: [],
    deliveriesMerged: [],
    deliveriesClosed: [],
    errors: [],
  };
}

function getActivePrDeliveries(rawDb: Database.Database): DeliveryRecord[] {
  try {
    const placeholders = ACTIVE_PR_STATUSES.map(() => '?').join(', ');
    return rawDb
      .prepare(`SELECT * FROM delivery_states WHERE status IN (${placeholders})`)
      .all(...ACTIVE_PR_STATUSES) as DeliveryRecord[];
  } catch {
    return [];
  }
}

function findOrphanAgents(rawDb: Database.Database): OrphanAgentRow[] {
  try {
    const placeholders = DELIVERY_INITIATED_STATUSES.map(() => '?').join(', ');
    return rawDb
      .prepare(
        `SELECT a.id, a.brain_task, a.branch
           FROM agents a
           LEFT JOIN delivery_states d ON d.agent_id = a.id
          WHERE a.status IN ('completed', 'failed', 'abandoned')
            AND a.branch IS NOT NULL
            AND a.brain_task IS NOT NULL
            AND a.branch LIKE 'agent/%'
            AND (d.status IS NULL OR d.status NOT IN (${placeholders}))`
      )
      .all(...DELIVERY_INITIATED_STATUSES) as OrphanAgentRow[];
  } catch {
    return [];
  }
}

/**
 * Query the GitHub auto-merge state for a PR. Returns true when armed,
 * false when disarmed, and null when the lookup itself fails (e.g. gh
 * authentication issue) so the caller can skip the arm action rather
 * than enable auto-merge against an indeterminate state.
 */
export function isAutoMergeArmed(branch: string, projectDir: string): boolean | null {
  try {
    const json = execFileSync('gh', ['pr', 'view', branch, '--json', 'autoMergeRequest'], {
      cwd: projectDir,
      encoding: 'utf-8',
      stdio: 'pipe',
    });
    const data = JSON.parse(json) as { autoMergeRequest: unknown };
    return data.autoMergeRequest != null;
  } catch {
    return null;
  }
}

function allFailuresAreFlaky(failedChecks: string[], flakyTests: string[]): boolean {
  if (failedChecks.length === 0 || flakyTests.length === 0) return false;
  return failedChecks.every((name) => flakyTests.some((pattern) => name.includes(pattern)));
}

interface ReconcileOptions {
  /** Per-process map of last CI rerun timestamps per branch. Defaults to a fresh map. */
  ciRerunCooldown?: Map<string, number>;
  /** Override for testability — defaults to Date.now(). */
  now?: () => number;
  /** Wire PM task status advance on PR-terminal observations. */
  pmDeps?: PmDeps;
}

/**
 * Run a single pass of merge-lifecycle reconciliation.
 *
 * Acts on each delivery / worktree / orphan-agent in turn. Each action wraps
 * in try/catch so a single failure does not abort the rest of the pass.
 *
 * Actions per pass:
 *   (a) BEHIND -> rebase via rebaseInIsolationDetailed
 *   (b) CI-failed-on-allowlist -> rerun via rerunPrChecks (cooldown)
 *   (c) MERGEABLE-without-auto-merge -> arm via enableAutoMerge
 *   (d) Stale worktree with no active agent -> reclaim via reclaimTerminatedAllocations
 *   (e) Completed agent with branch but no PR -> trigger delivery via recoverBranchForAgent
 */
export async function reconcileMergeLifecycle(
  db: BrainDB | Database.Database,
  projectDir: string,
  opts: ReconcileOptions = {}
): Promise<ReconcileReport> {
  const rawDb = getRawDb(db);
  const report = emptyReport();
  const cooldown = opts.ciRerunCooldown ?? new Map<string, number>();
  const now = opts.now ?? Date.now;
  const flakyTests = loadFlakyTests(projectDir);

  await reconcilePrActions(rawDb, projectDir, report, {
    cooldown,
    now,
    flakyTests,
    pmDeps: opts.pmDeps,
  });
  reconcileWorktrees(rawDb, projectDir, report);
  await reconcileOrphanBranches(rawDb, projectDir, report);

  return report;
}

interface PrActionContext {
  cooldown: Map<string, number>;
  now: () => number;
  flakyTests: string[];
  pmDeps?: PmDeps;
}

async function reconcilePrActions(
  rawDb: Database.Database,
  projectDir: string,
  report: ReconcileReport,
  ctx: PrActionContext
): Promise<void> {
  const deliveries = getActivePrDeliveries(rawDb);
  for (const delivery of deliveries) {
    if (!delivery.branch || !delivery.pr_number) continue;
    report.prsScanned += 1;
    const pr = getPrForBranch(delivery.branch, projectDir);
    if (!pr) continue;
    if (pr.state === 'merged' || pr.state === 'closed') {
      await advanceTerminatedDelivery(rawDb, delivery, pr, report, ctx);
      continue;
    }
    if (pr.state !== 'open') continue;
    await reconcileSinglePr(delivery.branch, delivery.pr_number, pr, projectDir, report, ctx);
  }
}

/**
 * GitHub reports the PR is no longer open: advance delivery_states past its
 * blocking ACTIVE_PR_STATUSES so worktree reclaim (VNM-56.69) can fire, and
 * — when PM dependencies are available — close the PM task. This is what
 * makes standalone `brain_agent_dispatch` ergonomically equivalent to a
 * workstream-dispatch wave: both paths converge on this observer.
 */
async function advanceTerminatedDelivery(
  rawDb: Database.Database,
  delivery: DeliveryRecord,
  pr: NonNullable<ReturnType<typeof getPrForBranch>>,
  report: ReconcileReport,
  ctx: PrActionContext
): Promise<void> {
  const taskId = delivery.task_id;
  if (!taskId) return;

  try {
    if (pr.state === 'merged') {
      const mergedAt = pr.mergedAt ?? new Date(ctx.now()).toISOString();
      updateDeliveryStatus(rawDb, delivery.agent_id, 'merged', { pr_merged_at: mergedAt });
      report.deliveriesMerged.push(taskId);
    } else {
      // closed without merge — stall with explicit reason so reclaim can fire
      updateDeliveryStatus(rawDb, delivery.agent_id, 'stalled', {
        stall_reason: 'pr-closed',
      });
      report.deliveriesClosed.push(taskId);
    }
  } catch (err) {
    report.errors.push({ kind: 'delivery-advance', target: taskId, reason: errMsg(err) });
    return;
  }

  if (!ctx.pmDeps) return;

  const nextStatus = pr.state === 'merged' ? 'done' : 'cancelled';
  try {
    const result = await updateTaskStatus(
      ctx.pmDeps.brainDb,
      ctx.pmDeps.config,
      ctx.pmDeps.embedder,
      taskId,
      nextStatus
    );
    if (!result.ok) {
      report.errors.push({
        kind: 'pm-advance',
        target: taskId,
        reason: result.error.message,
      });
    }
  } catch (err) {
    report.errors.push({ kind: 'pm-advance', target: taskId, reason: errMsg(err) });
  }
}

async function reconcileSinglePr(
  branch: string,
  prNumber: number,
  pr: NonNullable<ReturnType<typeof getPrForBranch>>,
  projectDir: string,
  report: ReconcileReport,
  ctx: PrActionContext
): Promise<void> {
  // (a) BEHIND -> rebase
  if (pr.mergeStateStatus === 'BEHIND') {
    try {
      const result = await rebaseInIsolationDetailed(branch, projectDir);
      if (result.ok) report.rebased.push(branch);
      else
        report.errors.push({
          kind: 'rebase',
          target: branch,
          reason: result.reason ?? 'unknown',
        });
    } catch (err) {
      report.errors.push({ kind: 'rebase', target: branch, reason: errMsg(err) });
    }
    return;
  }

  // (b) CI failed but every failed check is flaky -> rerun (with cooldown)
  if (!pr.checksPass && allFailuresAreFlaky(pr.failedChecks ?? [], ctx.flakyTests)) {
    const last = ctx.cooldown.get(branch) ?? 0;
    if (ctx.now() - last >= CI_RERUN_COOLDOWN_MS) {
      try {
        if (rerunPrChecks(branch, projectDir)) {
          ctx.cooldown.set(branch, ctx.now());
          report.ciReruns.push(branch);
        }
      } catch (err) {
        report.errors.push({ kind: 'ci-rerun', target: branch, reason: errMsg(err) });
      }
    }
    return;
  }

  // (c) MERGEABLE but auto-merge not armed -> arm it
  if (pr.mergeable && pr.checksPass) {
    const armed = isAutoMergeArmed(branch, projectDir);
    if (armed === false) {
      try {
        enableAutoMerge(prNumber, projectDir);
        report.autoMergeArmed.push(prNumber);
      } catch (err) {
        report.errors.push({ kind: 'arm-auto-merge', target: branch, reason: errMsg(err) });
      }
    }
  }
}

function reconcileWorktrees(
  rawDb: Database.Database,
  projectDir: string,
  report: ReconcileReport
): void {
  try {
    const reclaimed = reclaimTerminatedAllocations(rawDb, projectDir);
    report.worktreesReclaimed.push(...reclaimed);
  } catch (err) {
    report.errors.push({ kind: 'worktree-reclaim', target: projectDir, reason: errMsg(err) });
  }
}

async function reconcileOrphanBranches(
  rawDb: Database.Database,
  projectDir: string,
  report: ReconcileReport
): Promise<void> {
  const orphans = findOrphanAgents(rawDb);
  for (const orphan of orphans) {
    try {
      await recoverBranchForAgent(rawDb, orphan.id, projectDir);
      report.branchesRecovered.push(orphan.brain_task);
    } catch (err) {
      report.errors.push({
        kind: 'orphan-recover',
        target: orphan.brain_task,
        reason: errMsg(err),
      });
    }
  }
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Periodic wrapper around {@link reconcileMergeLifecycle}. One pass per
 * intervalMs; passes do not overlap (a slow tick blocks the next schedule).
 *
 * Webhook callers can also invoke {@link tickNow} directly to force a pass
 * outside the timer — use this when a delivery state change suggests the
 * watchdog should not wait for the next tick.
 */
export class MergeLifecycleReconciler {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private running = false;
  private stopped = false;
  private readonly cooldown = new Map<string, number>();
  private lastReport: ReconcileReport | null = null;

  constructor(
    private readonly db: BrainDB | Database.Database,
    private readonly projectDir: string,
    private readonly intervalMs: number = 60_000,
    private readonly pmDeps?: PmDeps
  ) {}

  start(): void {
    if (this.timer || this.stopped) return;
    this.scheduleNext();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
  }

  /** Force a reconcile pass now. Returns the report or null if a pass is in-flight. */
  async tickNow(): Promise<ReconcileReport | null> {
    if (this.running) return null;
    this.running = true;
    try {
      const report = await reconcileMergeLifecycle(this.db, this.projectDir, {
        ciRerunCooldown: this.cooldown,
        pmDeps: this.pmDeps,
      });
      this.lastReport = report;
      return report;
    } finally {
      this.running = false;
    }
  }

  get last(): ReconcileReport | null {
    return this.lastReport;
  }

  private scheduleNext(): void {
    this.timer = setTimeout(() => {
      void this.runTick();
    }, this.intervalMs);
  }

  private async runTick(): Promise<void> {
    try {
      await this.tickNow();
    } catch (err) {
      process.stderr.write(`[merge-lifecycle-reconciler] tick failed: ${errMsg(err)}\n`);
    } finally {
      if (!this.stopped) this.scheduleNext();
    }
  }
}
