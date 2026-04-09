import type Database from 'better-sqlite3';
import type { BrainDB } from '../services/brain-db.js';
import type { BackpressureController } from '../modules/agents/backpressure.js';
import type { WorkflowRuntime } from '../modules/workflow/runtime/runtime.js';
import { monitorDelivery, type DeliveryOutcome } from '../modules/agents/delivery-monitor.js';
import { getDeliveryForTask, type DeliveryRecord } from '../modules/agents/delivery.js';

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
