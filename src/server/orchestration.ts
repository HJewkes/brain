import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { BrainDB } from '../services/brain-db.js';
import type { WorkflowRuntime } from '../modules/workflow/runtime/runtime.js';
import type { BrainServiceClass } from '../services/brain-service.js';
import { getRawDb } from '../utils/db.js';
import { monitorDelivery, type DeliveryOutcome } from '../modules/agents/delivery-monitor.js';
import { getDeliveryForTask, type DeliveryRecord } from '../modules/agents/delivery.js';
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

export class OrchestrationService {
  private readonly activeMonitors = new Map<string, Promise<DeliveryOutcome>>();
  private readonly rawDb: Database.Database;
  private readonly brainDb: BrainDB | null;
  private initialized = false;
  constructor(
    db: BrainDB | Database.Database,
    private readonly wipLimit: number,
    private readonly projectDir: string
  ) {
    this.rawDb = getRawDb(db);
    this.brainDb = isBrainDb(db) ? db : null;
  }

  /** Idempotent startup hook — recovers in-flight deliveries on first call. */
  async initialize(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;
    await this.recover();
  }

  async recover(): Promise<void> {
    const pending = getInFlightDeliveries(this.rawDb);
    for (const delivery of pending) {
      if (delivery.status === 'review-paused') {
        this.renotifyHumanReview(delivery);
      } else {
        this.startMonitor(delivery);
      }
    }
    if (pending.length > 0) {
      process.stderr.write(`[orchestration] recovered ${pending.length} in-flight deliveries\n`);
    }
  }

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
      async (taskId) => {
        const result = await dispatchTask(svc, { taskId, worktreeBudget: this.wipLimit });
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
