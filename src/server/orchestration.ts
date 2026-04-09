import type Database from 'better-sqlite3';
import type { BrainDB } from '../services/brain-db.js';
import type { BackpressureController } from '../modules/agents/backpressure.js';
import type { WorkflowRuntime } from '../modules/workflow/runtime/runtime.js';
import type { BrainServiceClass } from '../services/brain-service.js';
import { monitorDelivery, type DeliveryOutcome } from '../modules/agents/delivery-monitor.js';
import { getDeliveryForTask, type DeliveryRecord } from '../modules/agents/delivery.js';
import { computeWaves } from '../modules/pm/engine/dependency.js';
import { listTasks } from '../modules/pm/data/task-ops.js';
import { DispatchLoop } from '../modules/agents/dispatch-loop.js';
import { dispatchTask, resolveProjectDir, type DispatchResult } from './dispatch.js';

/** Recovery statuses: deliveries that need a monitor restarted after process restart. */
const RECOVERY_STATUSES = ['pr-open', 'push-failed', 'conflicted'] as const;

function getRawDb(db: BrainDB | Database.Database): Database.Database {
  if ('rawDb' in db) return (db as BrainDB).rawDb;
  return db as Database.Database;
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

/**
 * OrchestrationService manages delivery monitors for brain serve.
 *
 * On startup it recovers in-flight deliveries from delivery_states and
 * restarts their monitors. startMonitor() deduplicates by taskId so
 * concurrent calls are safe.
 */
export class OrchestrationService {
  private readonly activeMonitors = new Map<string, Promise<DeliveryOutcome>>();
  private readonly rawDb: Database.Database;

  constructor(
    db: BrainDB | Database.Database,
    private readonly backpressure: BackpressureController,
    private readonly projectDir: string
  ) {
    this.rawDb = getRawDb(db);
  }

  /** On startup: recover in-flight deliveries from DB and respawn monitors. */
  async recover(): Promise<void> {
    const pending = getInFlightDeliveries(this.rawDb);
    for (const delivery of pending) {
      this.startMonitor(delivery);
    }
    if (pending.length > 0) {
      process.stderr.write(`[orchestration] recovered ${pending.length} in-flight deliveries\n`);
    }
  }

  /**
   * Start a delivery monitor, deduped by taskId.
   * No-op if a monitor is already running for this task.
   */
  startMonitor(delivery: DeliveryRecord): void {
    const taskId = delivery.task_id;
    if (!taskId) return;
    if (this.activeMonitors.has(taskId)) return;

    const promise = monitorDelivery(this.rawDb, delivery, this.projectDir).finally(() => {
      this.activeMonitors.delete(taskId);
    });
    this.activeMonitors.set(taskId, promise);
  }

  /** Inspection for dashboard/CLI: returns current delivery state for each active monitor. */
  listActiveDeliveries(): DeliveryRecord[] {
    return [...this.activeMonitors.keys()]
      .map((taskId) => getDeliveryForTask(this.rawDb, taskId))
      .filter((d): d is DeliveryRecord => d !== null);
  }

  /**
   * Execute all pending tasks in a workstream in dependency-ordered waves.
   *
   * Computes waves for the workstream, then runs them sequentially. Tasks within
   * each wave are dispatched concurrently (up to the WIP limit). Resolves when
   * all waves have completed — every task's delivery monitor has finished.
   */
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
      this.backpressure,
      async (taskId) => {
        const result = await dispatchTask(svc, { taskId });
        const r = result as DispatchResult;
        return { agentId: r.agentId, taskId: r.taskId, branch: r.branch };
      },
      projectDir
    );

    process.stderr.write(
      `[orchestration] executing workstream ${workstreamDisplayId}: ${waves.length} wave(s)\n`
    );
    for (const wave of waves) {
      process.stderr.write(`[orchestration] wave ${wave.wave}: [${wave.taskIds.join(', ')}]\n`);
      await loop.executeWave(wave);
      process.stderr.write(`[orchestration] wave ${wave.wave} complete\n`);
    }
    process.stderr.write(`[orchestration] workstream ${workstreamDisplayId} dispatch complete\n`);
  }

  /**
   * Cancel in-flight wave-execution workflows before starting the dispatch loop.
   * Prevents the old workflow runtime and new dispatch loop from competing for
   * the same workstream.
   */
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
