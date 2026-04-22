import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import type { BrainDB } from '../../services/brain-db.js';
import type { BrainConfig, Embedder, InboxItem } from '../../types.js';
import type { WaveAssignment } from '../pm/engine/dependency.js';
import type { TaskStatus } from '../pm/types.js';
import { getRawDb, sleep } from '../../utils/db.js';
import { findAgentByTask, getAgent } from './data.js';
import { getDeliveryForTask, initiateDelivery, type DeliveryRecord } from './delivery.js';
import { releaseWorktree } from './worktree.js';
import { monitorDelivery, type DeliveryOutcome } from './delivery-monitor.js';
import { updateTaskStatus } from '../pm/data/task-ops.js';

const AGENT_POLL_INTERVAL = 5_000; // 5s

export interface SpawnResult {
  agentId: string;
  taskId: string;
  branch?: string;
}

export interface WaveExecutionResult {
  settled: PromiseSettledResult<void>[];
  /** Tasks whose agent failed, was abandoned, or failed to spawn. */
  failedTaskIds: string[];
}

/** Inject the spawn function to avoid circular server ↔ modules dependency. */
export type SpawnFn = (taskId: string) => Promise<SpawnResult>;

function isBrainDb(db: BrainDB | Database.Database): db is BrainDB {
  return typeof db === 'object' && db !== null && 'rawDb' in db;
}

const TASK_STATUS_FOR_OUTCOME: Record<DeliveryOutcome, TaskStatus | undefined> = {
  merged: 'done',
  stalled: 'blocked',
  redispatched: 'pending',
};

/**
 * Async semaphore for WIP control. Callers acquire a slot before spawning
 * an agent and release it when the agent completes — delivery monitoring
 * runs independently without holding a slot.
 */
class Semaphore {
  private queue: (() => void)[] = [];
  private count: number;

  constructor(max: number) {
    this.count = max;
  }

  async acquire(): Promise<void> {
    if (this.count > 0) {
      this.count--;
      return;
    }
    return new Promise<void>((resolve) => this.queue.push(resolve));
  }

  release(): void {
    const next = this.queue.shift();
    if (next) next();
    else this.count++;
  }
}

export interface DispatchLoopPmDeps {
  brainDb: BrainDB;
  config: BrainConfig;
  embedder: Embedder;
}

export class DispatchLoop {
  private readonly rawDb: Database.Database;
  private readonly brainDb: BrainDB | null;
  private readonly pmDeps: DispatchLoopPmDeps | null;

  constructor(
    db: BrainDB | Database.Database,
    private readonly wipLimit: number,
    private readonly spawnAgent: SpawnFn,
    private readonly projectDir: string,
    pmDeps?: DispatchLoopPmDeps
  ) {
    this.rawDb = getRawDb(db);
    this.brainDb = pmDeps?.brainDb ?? (isBrainDb(db) ? db : null);
    this.pmDeps = pmDeps ?? null;
  }

  /** Poll the DB until the agent reaches a terminal status. */
  private async waitForAgent(agentId: string): Promise<boolean> {
    while (true) {
      await sleep(AGENT_POLL_INTERVAL);
      const agent = getAgent(this.rawDb, agentId);
      if (!agent) return false;
      if (agent.status === 'completed') return true;
      if (agent.status === 'failed' || agent.status === 'abandoned') return false;
    }
  }

  /** Terminal delivery statuses that don't need a retry. */
  private static DELIVERED_STATUSES = new Set([
    'pushed',
    'pr-open',
    'conflicted',
    'merged',
    'delivered',
    'stalled',
    'redispatched',
  ]);

  /** Delivery statuses where all work (including monitoring) is finished. */
  private static FINAL_STATUSES = new Set(['merged', 'delivered', 'stalled', 'redispatched']);

  /**
   * Check whether a task can be skipped or fast-forwarded based on existing
   * agent/delivery state. Returns:
   *  - 'skip': task is already fully delivered; do nothing
   *  - { agentId, branch }: completed agent exists; skip spawn and deliver
   *  - null: no completed agent; proceed with normal spawn
   */
  private idempotentCheck(
    taskId: string
  ): 'skip' | { agentId: string; branch: string | undefined } | null {
    const delivery = getDeliveryForTask(this.rawDb, taskId);
    if (delivery && DispatchLoop.FINAL_STATUSES.has(delivery.status)) {
      return 'skip';
    }

    const agent = findAgentByTask(this.rawDb, taskId);
    if (agent && agent.status === 'completed' && agent.branch) {
      return { agentId: agent.id, branch: agent.branch };
    }

    return null;
  }

  /**
   * Push branch and create PR for a completed agent.
   * Returns the delivery record if successful, null on failure.
   */
  private async ensureDelivery(
    agentId: string,
    taskId: string,
    branch: string | undefined
  ): Promise<import('./delivery.js').DeliveryRecord | null> {
    const existing = getDeliveryForTask(this.rawDb, taskId);
    if (existing && DispatchLoop.DELIVERED_STATUSES.has(existing.status)) {
      return existing;
    }

    if (!branch) {
      process.stderr.write(`[dispatch-loop] no branch for ${taskId}, cannot deliver\n`);
      return null;
    }

    try {
      return await initiateDelivery(this.rawDb, agentId, taskId, branch, this.projectDir);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`[dispatch-loop] delivery failed for ${taskId}: ${msg}\n`);
      return null;
    }
  }

  /**
   * Deliver a completed agent's work: push branch, create PR, monitor until
   * merged or stalled, then release the worktree. Runs independently of the
   * WIP semaphore — delivery monitoring is cheap (polling gh) and should not
   * block new agent spawns.
   */
  private async deliverAndCleanup(
    agentId: string,
    taskId: string,
    branch: string | undefined
  ): Promise<void> {
    const delivery = await this.ensureDelivery(agentId, taskId, branch);
    if (!delivery) {
      process.stderr.write(
        `[dispatch-loop] preserving worktree for ${taskId} — manual recovery needed\n`
      );
      return;
    }

    const outcome = await monitorDelivery(this.rawDb, delivery, this.projectDir);
    process.stderr.write(`[dispatch-loop] ${taskId} delivery: ${outcome}\n`);

    const refreshed = getDeliveryForTask(this.rawDb, taskId) ?? delivery;
    await this.advanceTaskStatus(taskId, outcome, refreshed);

    releaseWorktree(this.rawDb, this.projectDir, taskId);
  }

  /**
   * Translate a delivery outcome into a PM task status transition. On stall,
   * also drop an inbox notification so the user is alerted with the PR URL
   * and the reason captured by the delivery monitor.
   */
  private async advanceTaskStatus(
    taskId: string,
    outcome: DeliveryOutcome,
    delivery: DeliveryRecord
  ): Promise<void> {
    const nextStatus = TASK_STATUS_FOR_OUTCOME[outcome];
    if (!nextStatus) return;

    if (outcome === 'stalled') {
      this.notifyStall(taskId, delivery);
    }

    if (!this.pmDeps) {
      process.stderr.write(
        `[dispatch-loop] ${taskId} skipping task status update (no PM deps); outcome=${outcome}\n`
      );
      return;
    }

    try {
      const result = await updateTaskStatus(
        this.pmDeps.brainDb,
        this.pmDeps.config,
        this.pmDeps.embedder,
        taskId,
        nextStatus
      );
      if (!result.ok) {
        process.stderr.write(
          `[dispatch-loop] ${taskId} updateTaskStatus(${nextStatus}) failed: ${result.error.message}\n`
        );
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`[dispatch-loop] ${taskId} advanceTaskStatus error: ${msg}\n`);
    }
  }

  private notifyStall(taskId: string, delivery: DeliveryRecord): void {
    if (!this.brainDb) return;
    const reason = (delivery as { stall_reason?: string | null }).stall_reason ?? 'unknown';
    const prUrl = delivery.pr_url;
    const content =
      `Delivery stalled for ${taskId}\n` + `Reason: ${reason}\n` + (prUrl ? `PR: ${prUrl}\n` : '');
    const item: InboxItem = {
      id: randomUUID(),
      content,
      title: `Delivery stalled: ${taskId}`,
      source: 'alert',
      sourceUrl: prUrl,
      sourceMeta: JSON.stringify({ taskId, prUrl, reason }),
      status: 'pending',
      createdAt: new Date().toISOString(),
      processedAt: null,
    };
    this.brainDb.addInboxItem(item);
  }

  /**
   * Execute all tasks in a wave. Agent slots are gated by a semaphore —
   * slots are released when the agent finishes, not when its PR merges.
   * Delivery monitoring runs in the background without holding a slot.
   */
  async executeWave(wave: WaveAssignment): Promise<WaveExecutionResult> {
    const semaphore = new Semaphore(this.wipLimit);
    const deliveries: Promise<void>[] = [];
    const failedTaskIds: string[] = [];

    const agentTasks = wave.taskIds.map(async (taskId) => {
      const existing = this.idempotentCheck(taskId);
      if (existing === 'skip') {
        process.stderr.write(`[dispatch-loop] ${taskId} already delivered, skipping\n`);
        return;
      }
      if (existing) {
        process.stderr.write(
          `[dispatch-loop] ${taskId} has completed agent ${existing.agentId}, skipping spawn\n`
        );
        deliveries.push(this.deliverAndCleanup(existing.agentId, taskId, existing.branch));
        return;
      }

      await semaphore.acquire();

      let spawnResult: SpawnResult;
      try {
        spawnResult = await this.spawnAgent(taskId);
      } catch (err) {
        semaphore.release();
        const msg = err instanceof Error ? err.message : String(err);
        process.stderr.write(`[dispatch-loop] spawn failed for ${taskId}: ${msg}\n`);
        failedTaskIds.push(taskId);
        return;
      }

      const { agentId, branch } = spawnResult;
      const success = await this.waitForAgent(agentId);
      semaphore.release();

      if (!success) {
        process.stderr.write(`[dispatch-loop] agent ${agentId} failed for ${taskId}\n`);
        releaseWorktree(this.rawDb, this.projectDir, taskId);
        failedTaskIds.push(taskId);
        return;
      }

      deliveries.push(this.deliverAndCleanup(agentId, taskId, branch));
    });

    const settled = await Promise.allSettled(agentTasks);
    await Promise.allSettled(deliveries);
    process.stderr.write(
      `[dispatch-loop] wave ${wave.wave} complete: ${settled.length} task(s), ${failedTaskIds.length} failed\n`
    );

    return { settled, failedTaskIds };
  }
}
