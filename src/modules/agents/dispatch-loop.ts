import type Database from 'better-sqlite3';
import type { BrainDB } from '../../services/brain-db.js';
import type { WaveAssignment } from '../pm/engine/dependency.js';
import { getRawDb, sleep } from '../../utils/db.js';
import { getAgent } from './data.js';
import { getDeliveryForTask, initiateDelivery } from './delivery.js';
import { releaseWorktree } from './worktree.js';
import { monitorDelivery } from './delivery-monitor.js';

const AGENT_POLL_INTERVAL = 5_000; // 5s

export interface SpawnResult {
  agentId: string;
  taskId: string;
  branch?: string;
}

export interface WaveExecutionResult {
  settled: PromiseSettledResult<void>[];
}

/** Inject the spawn function to avoid circular server ↔ modules dependency. */
export type SpawnFn = (taskId: string) => Promise<SpawnResult>;

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

export class DispatchLoop {
  private readonly rawDb: Database.Database;

  constructor(
    db: BrainDB | Database.Database,
    private readonly wipLimit: number,
    private readonly spawnAgent: SpawnFn,
    private readonly projectDir: string
  ) {
    this.rawDb = getRawDb(db);
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
    releaseWorktree(this.rawDb, this.projectDir, taskId);
  }

  /**
   * Execute all tasks in a wave. Agent slots are gated by a semaphore —
   * slots are released when the agent finishes, not when its PR merges.
   * Delivery monitoring runs in the background without holding a slot.
   */
  async executeWave(wave: WaveAssignment): Promise<WaveExecutionResult> {
    const semaphore = new Semaphore(this.wipLimit);
    const deliveries: Promise<void>[] = [];

    const agentTasks = wave.taskIds.map(async (taskId) => {
      await semaphore.acquire();

      let spawnResult: SpawnResult;
      try {
        spawnResult = await this.spawnAgent(taskId);
      } catch (err) {
        semaphore.release();
        const msg = err instanceof Error ? err.message : String(err);
        process.stderr.write(`[dispatch-loop] spawn failed for ${taskId}: ${msg}\n`);
        return;
      }

      const { agentId, branch } = spawnResult;
      const success = await this.waitForAgent(agentId);
      semaphore.release();

      if (!success) {
        process.stderr.write(`[dispatch-loop] agent ${agentId} failed for ${taskId}\n`);
        releaseWorktree(this.rawDb, this.projectDir, taskId);
        return;
      }

      deliveries.push(this.deliverAndCleanup(agentId, taskId, branch));
    });

    const settled = await Promise.allSettled(agentTasks);
    await Promise.allSettled(deliveries);
    process.stderr.write(`[dispatch-loop] wave ${wave.wave} complete: ${settled.length} task(s)\n`);

    return { settled };
  }
}
