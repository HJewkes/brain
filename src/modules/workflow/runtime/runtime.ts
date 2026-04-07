import { randomUUID } from 'node:crypto';
import type { BrainDB } from '../../../services/brain-db.js';
import type { BrainConfig, Embedder } from '../../../types.js';
import type { WorkflowFn, WorkflowRun, StepResult } from './types.js';
import { WorkflowContext } from './context.js';
import { findAgentByTask, getAgentContext } from '../../agents/data.js';
import { parseSignals } from './signals.js';
import { releaseWorkflowTasks } from './failure-cleanup.js';

/** Row shape returned from the workflow_runs table. */
interface WorkflowRunRow {
  id: string;
  workflow_name: string;
  context: string;
  status: string;
  current_step: string | null;
  step_results: string;
  active_agent: string | null;
  started_at: string;
  completed_at: string | null;
  error: string | null;
}

interface RunningWorkflow {
  ctx: WorkflowContext;
  promise: Promise<void>;
}

type ChannelPushFn = (event: string, meta: Record<string, string>) => void;

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Get the full agent output for signal parsing. Falls back to summary. */
function getAgentOutput(db: BrainDB, agentId: string, summary: string | null): string {
  const fullOutput = getAgentContext(db, agentId, 'full_output') as string | undefined;
  return fullOutput ?? summary ?? '';
}

function deserializeRun(row: WorkflowRunRow): WorkflowRun {
  return {
    id: row.id,
    workflowName: row.workflow_name,
    context: JSON.parse(row.context) as Record<string, string>,
    status: row.status as WorkflowRun['status'],
    currentStep: row.current_step,
    stepResults: JSON.parse(row.step_results) as Record<string, StepResult>,
    activeAgent: row.active_agent
      ? (JSON.parse(row.active_agent) as { pid: number; taskId: string; stepId: string })
      : null,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    error: row.error,
  };
}

export interface WorkflowRuntimeOptions {
  db: BrainDB;
  config: BrainConfig;
  channelPush?: ChannelPushFn;
  embedder?: Embedder;
  model?: string;
  maxBudgetUsd?: number;
}

export class WorkflowRuntime {
  private registry = new Map<string, WorkflowFn>();
  private active = new Map<string, RunningWorkflow>();
  private reconcileTimer: ReturnType<typeof setInterval> | null = null;

  private db: BrainDB;
  private config: BrainConfig;
  private channelPush: ChannelPushFn | undefined;
  private embedder: Embedder | undefined;
  private model: string | undefined;
  private maxBudgetUsd: number | undefined;

  constructor(options: WorkflowRuntimeOptions) {
    this.db = options.db;
    this.config = options.config;
    this.channelPush = options.channelPush;
    this.embedder = options.embedder;
    this.model = options.model;
    this.maxBudgetUsd = options.maxBudgetUsd;
  }

  register(name: string, fn: WorkflowFn): void {
    this.registry.set(name, fn);
  }

  async start(
    name: string,
    params: Record<string, string>,
    _options?: { model?: string; maxBudgetUsd?: number }
  ): Promise<string> {
    const fn = this.registry.get(name);
    if (!fn) throw new Error(`Unknown workflow: ${name}`);

    const runId = randomUUID();
    const now = new Date().toISOString();

    const rawDb = this.db.rawDb;
    rawDb
      .prepare(
        `INSERT INTO workflow_runs (id, workflow_name, context, status, step_results, started_at)
         VALUES (?, ?, ?, 'running', '{}', ?)`
      )
      .run(runId, name, JSON.stringify(params), now);

    const run: WorkflowRun = {
      id: runId,
      workflowName: name,
      context: params,
      status: 'running',
      currentStep: null,
      stepResults: {},
      activeAgent: null,
      startedAt: now,
      completedAt: null,
      error: null,
    };

    const ctx = new WorkflowContext(run, this.db, this.config, this.channelPush, {
      embedder: this.embedder,
      model: this.model,
      maxBudgetUsd: this.maxBudgetUsd,
    });
    const promise = fn(ctx).then(
      () => this.onComplete(runId),
      (err: unknown) => this.onFailed(runId, err)
    );
    this.active.set(runId, { ctx, promise });

    // Ensure the reconciler is running — it's the only mechanism that detects
    // agent completion and resolves workflow waitpoints for headless dispatch.
    this.startReconciler();

    return runId;
  }

  async hydrate(): Promise<void> {
    const rawDb = this.db.rawDb;
    const rows = rawDb
      .prepare(`SELECT * FROM workflow_runs WHERE status IN ('running', 'paused')`)
      .all() as WorkflowRunRow[];

    for (const row of rows) {
      const fn = this.registry.get(row.workflow_name);
      if (!fn) continue;

      if (this.active.has(row.id)) continue;

      const run = deserializeRun(row);

      this.resolveStaleAgent(run);

      const ctx = new WorkflowContext(run, this.db, this.config, this.channelPush, {
        embedder: this.embedder,
        model: this.model,
        maxBudgetUsd: this.maxBudgetUsd,
      });
      const promise = fn(ctx).then(
        () => this.onComplete(run.id),
        (err: unknown) => this.onFailed(run.id, err)
      );
      this.active.set(run.id, { ctx, promise });
    }
  }

  /**
   * Check if the active agent completed or died while the runtime was down.
   * Mutates the run in-place so the hydrated context picks up the result.
   */
  private resolveStaleAgent(run: WorkflowRun): void {
    if (!run.activeAgent) return;

    const agent = findAgentByTask(this.db, run.activeAgent.taskId);
    if (!agent) {
      run.activeAgent = null;
      this.persistRun(run);
      return;
    }

    if (agent.status === 'completed') {
      const stepId = run.activeAgent.stepId;
      const iter = this.currentIteration(run, stepId);
      const iterKey = `${stepId}:${iter}`;
      const output = getAgentOutput(this.db, agent.id, agent.summary);

      run.stepResults[iterKey] = {
        stepId,
        taskId: run.activeAgent.taskId,
        agentId: agent.id,
        signal: parseSignals(stepId, run.workflowName, output),
        completedAt: agent.completed_at ?? new Date().toISOString(),
        output,
      };
      run.activeAgent = null;
      this.persistRun(run);

      this.channelPush?.('step_complete', {
        workflow: run.id,
        step: stepId,
        signal: run.stepResults[iterKey].signal ?? '',
        taskId: run.stepResults[iterKey].taskId,
      });
    } else if (agent.status === 'failed' || agent.status === 'abandoned') {
      run.activeAgent = null;
      this.persistRun(run);
    }
    // If agent is still active/pending, leave activeAgent in place —
    // the reconciler will monitor it after hydration.
  }

  private currentIteration(run: WorkflowRun, stepId: string): number {
    let maxIter = -1;
    for (const key of Object.keys(run.stepResults)) {
      const colonIdx = key.lastIndexOf(':');
      if (colonIdx === -1) continue;
      const id = key.slice(0, colonIdx);
      if (id !== stepId) continue;
      const iter = parseInt(key.slice(colonIdx + 1), 10);
      if (!Number.isNaN(iter) && iter > maxIter) maxIter = iter;
    }
    return maxIter + 1;
  }

  private persistRun(run: WorkflowRun): void {
    const rawDb = this.db.rawDb;
    rawDb
      .prepare(
        `UPDATE workflow_runs SET status = ?, current_step = ?, step_results = ?,
         active_agent = ?, completed_at = ?, error = ? WHERE id = ?`
      )
      .run(
        run.status,
        run.currentStep,
        JSON.stringify(run.stepResults),
        run.activeAgent ? JSON.stringify(run.activeAgent) : null,
        run.completedAt,
        run.error,
        run.id
      );
  }

  getStatus(runId: string): WorkflowRun | null {
    const running = this.active.get(runId);
    if (running) {
      return running.ctx.toRun();
    }

    const rawDb = this.db.rawDb;
    const row = rawDb.prepare(`SELECT * FROM workflow_runs WHERE id = ?`).get(runId) as
      | WorkflowRunRow
      | undefined;

    if (!row) return null;
    return deserializeRun(row);
  }

  async waitForCompletion(runId: string): Promise<void> {
    const running = this.active.get(runId);
    if (running) await running.promise;
  }

  signal(runId: string, stepId: string, data?: Record<string, string>): void {
    const running = this.active.get(runId);
    if (!running) throw new Error(`No active workflow for run: ${runId}`);
    running.ctx.signal(stepId, data);
  }

  get activeRuns(): Map<string, RunningWorkflow> {
    return this.active;
  }

  startReconciler(): void {
    if (this.reconcileTimer) return;
    this.reconcileTimer = setInterval(() => this.reconcile(), 10_000);
  }

  stopReconciler(): void {
    if (this.reconcileTimer) {
      clearInterval(this.reconcileTimer);
      this.reconcileTimer = null;
    }
  }

  private reconcile(): void {
    for (const [_runId, workflow] of this.active) {
      const agent = workflow.ctx.activeAgent;
      if (!agent) continue;

      if (!isProcessAlive(agent.pid)) {
        // Check if the agent actually completed successfully before declaring death.
        // The PID disappears on normal exit too — don't confuse success with failure.
        const agentRecord = findAgentByTask(this.db, agent.taskId);
        if (agentRecord?.status === 'completed') {
          const output = getAgentOutput(this.db, agentRecord.id, agentRecord.summary);
          workflow.ctx.resolveAgent(agent.stepId, output);
        } else {
          // Process is dead and agent is not marked completed — treat as death.
          // This covers: failed, abandoned, or still 'active' (handleProcessExit
          // may have run but didn't mark success).
          workflow.ctx.handleAgentDeath(agent);
        }
      }
    }
  }

  private onComplete(runId: string): void {
    this.active.delete(runId);
    try {
      const rawDb = this.db.rawDb;
      const now = new Date().toISOString();
      rawDb
        .prepare(`UPDATE workflow_runs SET status = 'completed', completed_at = ? WHERE id = ?`)
        .run(now, runId);
    } catch {
      // DB may be closed during shutdown — non-fatal
    }

    this.channelPush?.('workflow_complete', { workflow: runId });
  }

  private onFailed(runId: string, error: unknown): void {
    const rawDb = this.db.rawDb;
    const now = new Date().toISOString();
    const errMsg = error instanceof Error ? error.message : String(error);
    rawDb
      .prepare(
        `UPDATE workflow_runs SET status = 'failed', completed_at = ?, error = ? WHERE id = ?`
      )
      .run(now, errMsg, runId);

    this.releaseStuckTasks(runId);
    this.active.delete(runId);

    this.channelPush?.('step_failed', {
      workflow: runId,
      error: errMsg,
    });
  }

  /** Release any claimed tasks from a failed workflow so they don't stay stuck. */
  private releaseStuckTasks(runId: string): void {
    const running = this.active.get(runId);
    if (!running) return;

    const run = running.ctx.toRun();
    try {
      releaseWorkflowTasks(this.db, this.config, this.embedder, run);
    } catch {
      // Non-fatal — cleanup failure shouldn't mask the original error
    }
  }
}
