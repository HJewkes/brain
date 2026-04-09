import type Database from 'better-sqlite3';
import type { BrainDB } from '../../services/brain-db.js';
import type { WaveAssignment } from '../pm/engine/dependency.js';
import type { BackpressureController } from './backpressure.js';
import { countActiveAgents, getAgent } from './data.js';
import { getDeliveryForTask, initiateDelivery } from './delivery.js';
import { releaseWorktree } from './worktree.js';
import { monitorDelivery } from './delivery-monitor.js';

const AGENT_POLL_INTERVAL = 5_000; // 5s
const WIP_POLL_INTERVAL = 10_000; // 10s

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function getRawDb(db: BrainDB | Database.Database): Database.Database {
  if ('rawDb' in db) return (db as BrainDB).rawDb;
  return db as Database.Database;
}

export interface ConcurrencyCheck {
  allowed: boolean;
  reason: string;
}

export interface SpawnResult {
  agentId: string;
  taskId: string;
  branch?: string;
}

/** Inject the spawn function to avoid circular server ↔ modules dependency. */
export type SpawnFn = (taskId: string) => Promise<SpawnResult>;

/**
 * Global WIP check: counts active agents against the effective WIP limit.
 * Replaces per-workstream checkWorkstreamConcurrency for the dispatch loop.
 */
export function checkDispatchConcurrency(
  db: Database.Database,
  backpressure: BackpressureController
): ConcurrencyCheck {
  const active = countActiveAgents(db);
  const { effectiveWip } = backpressure.computeEffectiveWip();
  if (active >= effectiveWip) {
    return { allowed: false, reason: `WIP limit: ${active}/${effectiveWip}` };
  }
  return { allowed: true, reason: 'nominal' };
}

export class DispatchLoop {
  private readonly rawDb: Database.Database;

  constructor(
    db: BrainDB | Database.Database,
    private readonly backpressure: BackpressureController,
    private readonly spawnAgent: SpawnFn,
    private readonly projectDir: string
  ) {
    this.rawDb = getRawDb(db);
  }

  private checkWip(): ConcurrencyCheck {
    return checkDispatchConcurrency(this.rawDb, this.backpressure);
  }

  private async waitForWipSlot(): Promise<void> {
    while (true) {
      const check = this.checkWip();
      if (check.allowed) return;
      process.stderr.write(`[dispatch-loop] WIP full (${check.reason}), waiting\n`);
      await sleep(WIP_POLL_INTERVAL);
    }
  }

  /** Poll the DB until the agent reaches a terminal status. */
  private async waitForAgent(agentId: string): Promise<boolean> {
    while (true) {
      await sleep(AGENT_POLL_INTERVAL);
      const agent = getAgent(this.rawDb, agentId);
      if (!agent) return false;
      if (agent.status === 'completed') return true;
      if (agent.status === 'failed' || agent.status === 'abandoned') return false;
      // pending or active — keep polling
    }
  }

  /**
   * Ensure delivery is initiated for a completed agent.
   * The agent-done-handler hook may have already done this; this is a fallback.
   * Returns the delivery record if available, null on failure.
   */
  private ensureDelivery(
    agentId: string,
    taskId: string,
    branch: string | undefined
  ): import('./delivery.js').DeliveryRecord | null {
    const existing = getDeliveryForTask(this.rawDb, taskId);
    if (existing) return existing;

    if (!branch) {
      process.stderr.write(`[dispatch-loop] no branch for ${taskId}, cannot initiate delivery\n`);
      return null;
    }

    try {
      return initiateDelivery(this.rawDb, agentId, taskId, branch, this.projectDir);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`[dispatch-loop] delivery initiation failed for ${taskId}: ${msg}\n`);
      return null;
    }
  }

  /**
   * Full single-task lifecycle: spawn → wait → deliver → release → monitor.
   *
   * WIP gate is enforced before spawn. Wave gate is implicit via Promise.allSettled
   * in executeWave — all per-task monitors must finish before the wave completes.
   */
  async dispatchAndDeliver(taskId: string): Promise<void> {
    await this.waitForWipSlot();

    let spawnResult: SpawnResult;
    try {
      spawnResult = await this.spawnAgent(taskId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`[dispatch-loop] spawn failed for ${taskId}: ${msg}\n`);
      return;
    }

    const { agentId, branch } = spawnResult;
    const success = await this.waitForAgent(agentId);

    if (!success) {
      process.stderr.write(`[dispatch-loop] agent ${agentId} failed for task ${taskId}\n`);
      releaseWorktree(this.rawDb, this.projectDir, taskId);
      return;
    }

    const delivery = this.ensureDelivery(agentId, taskId, branch);

    // Release worktree after push (idempotent — hook may have released it already)
    releaseWorktree(this.rawDb, this.projectDir, taskId);

    if (!delivery) {
      process.stderr.write(`[dispatch-loop] no delivery record for ${taskId}, skipping monitor\n`);
      return;
    }

    const outcome = await monitorDelivery(this.rawDb, delivery, this.projectDir);
    process.stderr.write(`[dispatch-loop] ${taskId} delivery outcome: ${outcome}\n`);
  }

  /**
   * Execute all tasks in a wave concurrently, respecting the WIP limit.
   * Resolves only when all per-task delivery monitors have finished —
   * this is the implicit wave gate: every task is merged, stalled, or redispatched.
   */
  async executeWave(wave: WaveAssignment): Promise<PromiseSettledResult<void>[]> {
    const promises = wave.taskIds.map((taskId) => this.dispatchAndDeliver(taskId));
    return Promise.allSettled(promises);
  }
}
