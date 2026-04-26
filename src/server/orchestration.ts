import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import type Database from 'better-sqlite3';
import type { BrainDB } from '../services/brain-db.js';
import type { WorkflowRuntime } from '../modules/workflow/runtime/runtime.js';
import type { BrainServiceClass } from '../services/brain-service.js';
import { getRawDb } from '../utils/db.js';
import { monitorDelivery, type DeliveryOutcome } from '../modules/agents/delivery-monitor.js';
import {
  getDeliveryForTask,
  initiateDelivery,
  type DeliveryRecord,
} from '../modules/agents/delivery.js';
import { getPrForBranch } from '../modules/agents/auto-merge.js';
import { releaseWorktree, updateAgentStatus } from '../modules/agents/data.js';
import { cleanupOrphanRemoteBranches } from '../modules/agents/worktree.js';
import { buildDependencyGraph, computeWaves } from '../modules/pm/engine/dependency.js';
import { listTasks, updateTaskStatus } from '../modules/pm/data/task-ops.js';
import { DispatchLoop } from '../modules/agents/dispatch-loop.js';
import { dispatchTask, resolveProjectDir, type DispatchResult } from './dispatch.js';
import type { InboxItem } from '../types.js';

async function markTaskBlocked(svc: BrainServiceClass, displayId: string): Promise<void> {
  try {
    const result = await updateTaskStatus(svc.db, svc.config, svc.embedder, displayId, 'blocked');
    if (!result.ok) {
      process.stderr.write(
        `[orchestration] could not mark ${displayId} blocked: ${result.error.message}\n`
      );
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[orchestration] could not mark ${displayId} blocked: ${msg}\n`);
  }
}

/** Recovery statuses: deliveries that need attention after process restart. */
const RECOVERY_STATUSES = ['pr-open', 'push-failed', 'conflicted', 'review-paused'] as const;

/**
 * Delivery statuses indicating push + PR already happened. Orphan recovery
 * skips these to avoid re-initiating delivery on branches already in flight.
 */
const DELIVERY_INITIATED_STATUSES = new Set<string>([
  'pushed',
  'pr-open',
  'pr-failed',
  'conflicted',
  'merged',
  'delivered',
  'stalled',
  'redispatched',
  'review-paused',
]);

interface OrphanedBranchRow {
  id: string;
  brain_task: string;
  branch: string;
  delivery_status: string | null;
}

interface OrphanedBranchCandidate {
  agentId: string;
  taskId: string;
  branch: string;
}

function branchHasNewCommits(branch: string, projectDir: string): boolean {
  try {
    const output = execFileSync('git', ['rev-list', '--count', `origin/main..${branch}`], {
      cwd: projectDir,
      encoding: 'utf-8',
      stdio: 'pipe',
    });
    return parseInt(output.trim(), 10) > 0;
  } catch {
    return false;
  }
}

function branchHasOpenPr(branch: string, projectDir: string): boolean {
  const pr = getPrForBranch(branch, projectDir);
  return pr !== null && pr.state === 'open';
}

function getInFlightDeliveries(rawDb: Database.Database): DeliveryRecord[] {
  try {
    const placeholders = RECOVERY_STATUSES.map(() => '?').join(', ');
    return rawDb
      .prepare(`SELECT * FROM delivery_states WHERE status IN (${placeholders})`)
      .all(...RECOVERY_STATUSES) as DeliveryRecord[];
  } catch {
    // Table may not exist yet on first startup
    return [];
  }
}

interface ZombieCandidate {
  id: string;
  pid: number | null;
  brain_task: string | null;
}

function getActiveAgents(rawDb: Database.Database): ZombieCandidate[] {
  try {
    return rawDb
      .prepare(`SELECT id, pid, brain_task FROM agents WHERE status = 'active'`)
      .all() as ZombieCandidate[];
  } catch {
    return [];
  }
}

function isProcessAlive(pid: number | null): boolean {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function isBrainDb(db: BrainDB | Database.Database): db is BrainDB {
  return typeof (db as BrainDB).addInboxItem === 'function';
}

function formatReviewRenotification(delivery: DeliveryRecord): string {
  const lines = [
    `Review still pending for ${delivery.task_id ?? delivery.agent_id}.`,
    `Agent: ${delivery.agent_id}`,
  ];
  if (delivery.pr_url) lines.push(`PR: ${delivery.pr_url}`);
  lines.push('Signal `approve` or `needs_fixes` via `brain agent approve|reject <taskId>`.');
  return lines.join('\n');
}

// Module-level guard so initialize() runs at most once per process, regardless
// of how many OrchestrationService instances are constructed (e.g. one per
// MCP tool invocation). Test-only reset: `resetOrchestrationInitForTests`.
let _initialized = false;

/** Reset the module-level init guard. Intended for tests only. */
export function resetOrchestrationInitForTests(): void {
  _initialized = false;
}

export class OrchestrationService {
  private readonly activeMonitors = new Map<string, Promise<DeliveryOutcome>>();
  private readonly rawDb: Database.Database;
  private readonly brainDb: BrainDB | null;
  constructor(
    db: BrainDB | Database.Database,
    private readonly wipLimit: number,
    private readonly projectDir: string
  ) {
    this.rawDb = getRawDb(db);
    this.brainDb = isBrainDb(db) ? db : null;
  }

  /** Idempotent startup hook — recovers in-flight deliveries on first call. */
  async initialize(svc?: BrainServiceClass): Promise<void> {
    if (_initialized) return;
    _initialized = true;
    await this.recover(svc);
  }

  async recover(svc?: BrainServiceClass): Promise<void> {
    const pending = getInFlightDeliveries(this.rawDb);
    let monitoring = 0;
    let reNotified = 0;
    let skipped = 0;
    for (const delivery of pending) {
      if (delivery.status === 'review-paused') {
        if (!this.brainDb) {
          skipped++;
          continue;
        }
        this.renotifyHumanReview(delivery);
        reNotified++;
      } else {
        if (!delivery.task_id || this.activeMonitors.has(delivery.task_id)) {
          skipped++;
          continue;
        }
        this.startMonitor(delivery);
        monitoring++;
      }
    }
    if (pending.length > 0) {
      process.stderr.write(
        `[orchestration] recovered ${pending.length} deliveries ` +
          `(${monitoring} monitoring, ${reNotified} re-notified, ${skipped} skipped)\n`
      );
    }

    await this.recoverZombieAgents(svc);
    await this.recoverOrphanedBranches();
  }

  /**
   * Detect branches that have committed work but no open PR, and kick off
   * delivery. This covers agents that exit after committing without triggering
   * the delivery pipeline (e.g. exit_code_1 post-commit, 'completed without
   * protocol message', or crash between commit and push).
   */
  async recoverOrphanedBranches(): Promise<void> {
    const candidates = this.findOrphanedBranches();
    if (candidates.length === 0) return;

    for (const candidate of candidates) {
      try {
        const delivery = await initiateDelivery(
          this.rawDb,
          candidate.agentId,
          candidate.taskId,
          candidate.branch,
          this.projectDir
        );
        this.startMonitor(delivery);
        process.stderr.write(
          `[orchestration] recovered orphaned branch ${candidate.branch} for ${candidate.taskId}: PR #${delivery.pr_number}\n`
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        process.stderr.write(
          `[orchestration] failed to recover orphaned branch ${candidate.branch}: ${msg}\n`
        );
      }
    }
  }

  private findOrphanedBranches(): OrphanedBranchCandidate[] {
    let rows: OrphanedBranchRow[];
    try {
      rows = this.rawDb
        .prepare(
          `SELECT a.id, a.brain_task, a.branch, d.status AS delivery_status
             FROM agents a
             LEFT JOIN delivery_states d ON d.agent_id = a.id
            WHERE a.status IN ('completed', 'failed', 'abandoned')
              AND a.branch IS NOT NULL
              AND a.brain_task IS NOT NULL
              AND a.branch LIKE 'agent/%'`
        )
        .all() as OrphanedBranchRow[];
    } catch {
      return [];
    }

    const candidates: OrphanedBranchCandidate[] = [];
    for (const row of rows) {
      if (row.delivery_status && DELIVERY_INITIATED_STATUSES.has(row.delivery_status)) continue;
      if (!branchHasNewCommits(row.branch, this.projectDir)) continue;
      if (branchHasOpenPr(row.branch, this.projectDir)) continue;
      candidates.push({
        agentId: row.id,
        taskId: row.brain_task,
        branch: row.branch,
      });
    }
    return candidates;
  }

  /** Detect agents marked active whose process is dead, and auto-abandon them. */
  async recoverZombieAgents(svc?: BrainServiceClass): Promise<void> {
    const active = getActiveAgents(this.rawDb);
    const zombies = active.filter((a) => !isProcessAlive(a.pid));
    if (zombies.length === 0) return;

    for (const zombie of zombies) {
      const reason = zombie.pid
        ? `Process ${zombie.pid} not alive at MCP startup recovery`
        : 'No PID recorded at MCP startup recovery';
      updateAgentStatus(this.rawDb, zombie.id, 'abandoned', { exit_reason: reason });

      if (zombie.brain_task) {
        releaseWorktree(this.rawDb, zombie.brain_task);
        if (svc) {
          const result = await updateTaskStatus(
            svc.db,
            svc.config,
            svc.embedder,
            zombie.brain_task,
            'pending'
          );
          if (!result.ok) {
            process.stderr.write(
              `[orchestration] failed to reset task ${zombie.brain_task} for zombie ${zombie.id}: ${result.error.message}\n`
            );
          }
        }
      }
    }

    process.stderr.write(
      `[orchestration] recovered ${zombies.length} zombie agent(s): ${zombies.map((z) => z.id).join(', ')}\n`
    );
  }

  /**
   * Recreates the inbox notification for a review-paused delivery. Intentional:
   * we emit a new inbox row on every process restart so the user can't miss a
   * pending review even if an earlier notification was dismissed or pruned.
   * The old item is left alone; signal handling keys on delivery state, not
   * inbox row identity.
   */
  private renotifyHumanReview(delivery: DeliveryRecord): void {
    if (!this.brainDb) return;
    const item: InboxItem = {
      id: randomUUID(),
      content: formatReviewRenotification(delivery),
      title: `Review pending: ${delivery.task_id ?? delivery.agent_id}`,
      source: 'alert',
      sourceUrl: delivery.pr_url,
      sourceMeta: JSON.stringify({
        taskId: delivery.task_id,
        agentId: delivery.agent_id,
        prNumber: delivery.pr_number,
        prUrl: delivery.pr_url,
        action: 'review-renotified',
      }),
      status: 'pending',
      createdAt: new Date().toISOString(),
      processedAt: null,
    };
    this.brainDb.addInboxItem(item);
  }

  startMonitor(delivery: DeliveryRecord): void {
    const taskId = delivery.task_id;
    if (!taskId) return;
    if (this.activeMonitors.has(taskId)) return;

    const promise = monitorDelivery(this.rawDb, delivery, this.projectDir).finally(() => {
      this.activeMonitors.delete(taskId);
    });
    this.activeMonitors.set(taskId, promise);
  }

  listActiveDeliveries(): DeliveryRecord[] {
    return [...this.activeMonitors.keys()]
      .map((taskId) => getDeliveryForTask(this.rawDb, taskId))
      .filter((d): d is DeliveryRecord => d !== null);
  }

  async executeWorkstream(svc: BrainServiceClass, workstreamDisplayId: string): Promise<void> {
    const match = workstreamDisplayId.match(/^([A-Z]+)-(\d+)$/);
    if (!match) {
      throw new Error(`Invalid workstream display ID: ${workstreamDisplayId}`);
    }
    const prefix = match[1];
    const wsNumber = parseInt(match[2], 10);

    const tasksResult = listTasks(svc.db, prefix, { workstream: wsNumber });
    if (!tasksResult.ok) {
      throw new Error(`Failed to list tasks: ${tasksResult.error.message}`);
    }
    const wsTaskIds = new Set(tasksResult.data.map((t) => t.display_id));

    if (wsTaskIds.size === 0) {
      process.stderr.write(`[orchestration] no tasks in workstream ${workstreamDisplayId}\n`);
      return;
    }

    const allWaves = computeWaves(svc.db, prefix);
    const waves = allWaves
      .map((wave) => ({ ...wave, taskIds: wave.taskIds.filter((id) => wsTaskIds.has(id)) }))
      .filter((wave) => wave.taskIds.length > 0);

    if (waves.length === 0) {
      process.stderr.write(`[orchestration] no pending waves for ${workstreamDisplayId}\n`);
      return;
    }

    const projectDir = resolveProjectDir(svc);
    const loop = new DispatchLoop(
      svc.db,
      this.wipLimit,
      async (taskId, opts) => {
        const result = await dispatchTask(svc, {
          taskId,
          worktreeBudget: this.wipLimit,
          maxBudgetUsd: opts?.maxBudgetUsd,
        });
        const r = result as DispatchResult;
        return { agentId: r.agentId, taskId: r.taskId, branch: r.branch };
      },
      projectDir,
      { brainDb: svc.db, config: svc.config, embedder: svc.embedder }
    );

    process.stderr.write(
      `[orchestration] executing workstream ${workstreamDisplayId}: ${waves.length} wave(s)\n`
    );

    const graph = buildDependencyGraph(svc.db, prefix);
    const failedOrSkipped = new Set<string>();

    for (const wave of waves) {
      const toRun: string[] = [];
      for (const taskId of wave.taskIds) {
        const deps = graph.get(taskId) ?? [];
        const failedDeps = deps.filter((d) => failedOrSkipped.has(d));
        if (failedDeps.length > 0) {
          process.stderr.write(
            `[orchestration] skipping ${taskId}: depends on failed task(s) ${failedDeps.join(', ')}\n`
          );
          failedOrSkipped.add(taskId);
          await markTaskBlocked(svc, taskId);
        } else {
          toRun.push(taskId);
        }
      }

      if (toRun.length === 0) {
        process.stderr.write(
          `[orchestration] wave ${wave.wave} skipped: all tasks blocked by prior failures\n`
        );
        continue;
      }

      process.stderr.write(`[orchestration] wave ${wave.wave}: [${toRun.join(', ')}]\n`);
      const result = await loop.executeWave({ wave: wave.wave, taskIds: toRun });
      for (const failed of result.failedTaskIds ?? []) {
        failedOrSkipped.add(failed);
        await markTaskBlocked(svc, failed);
      }
    }
    process.stderr.write(`[orchestration] workstream ${workstreamDisplayId} dispatch complete\n`);

    try {
      const reports = cleanupOrphanRemoteBranches(svc.db, projectDir, {
        workstream: workstreamDisplayId,
      });
      const deleted = reports.filter((r) => r.deleted);
      if (deleted.length > 0) {
        process.stderr.write(
          `[orchestration] cleaned ${deleted.length} orphan branch(es): ${deleted.map((r) => r.branch).join(', ')}\n`
        );
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`[orchestration] orphan branch cleanup failed: ${msg}\n`);
    }
  }

  migrateInFlightWorkflows(runtime: WorkflowRuntime): void {
    const running = runtime.listRunning().filter((r) => r.workflowName === 'wave-execution');
    for (const run of running) {
      runtime.cancel(run.id, 'Migrated to OrchestrationService dispatch loop');
    }
    if (running.length > 0) {
      process.stderr.write(
        `[orchestration] cancelled ${running.length} wave-execution workflow(s): ${running.map((r) => r.id).join(', ')}\n`
      );
    }
  }
}
