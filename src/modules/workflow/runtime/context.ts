/**
 * WorkflowContext — memoized dispatch and assisted step management.
 *
 * Each workflow run gets a WorkflowContext instance. On restart/hydration,
 * the workflow function re-runs from the top and dispatch() returns cached
 * results for completed steps instead of re-dispatching.
 */

import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { BrainDB } from '../../../services/brain-db.js';
import type { BrainConfig, Embedder } from '../../../types.js';
import type { WorkflowRun, StepResult, WorkflowStatus, ChannelPushFn } from './types.js';
import { parseSignals } from './signals.js';
import { createTask } from '../../pm/data/task-ops.js';
import { dispatchTemplate } from '../engine/dispatch.js';
import { dispatchTask } from '../../../server/dispatch.js';

// Re-export the interface for use by runtime.ts
export type { WorkflowContext as WorkflowContextInterface } from './types.js';

/** Thrown when an agent process dies unexpectedly. */
export class AgentDeathError extends Error {
  constructor(
    public readonly pid: number,
    public readonly taskId: string,
    public readonly stepId: string
  ) {
    super(`Agent died: pid=${pid} task=${taskId}`);
    this.name = 'AgentDeathError';
  }
}

interface AgentWaitpoint {
  resolve: (output: string) => void;
  reject: (err: Error) => void;
}

interface SignalWaitpoint {
  resolve: (data: Record<string, string> | undefined) => void;
}

interface WorkflowContextOptions {
  embedder?: Embedder;
  model?: string;
  maxBudgetUsd?: number;
}

export class WorkflowContext {
  readonly runId: string;
  readonly workflowName: string;

  private _status: WorkflowStatus;
  private _currentStep: string | null;
  private _stepResults: Record<string, StepResult>;
  private _activeAgent: { pid: number; taskId: string; stepId: string } | null;
  private _context: Record<string, string>;
  private _iterations: Record<string, number> = {};
  private _startedAt: string;
  private _completedAt: string | null;
  private _error: string | null;

  private agentWaitpoints = new Map<string, AgentWaitpoint>();
  private signalWaitpoints = new Map<string, SignalWaitpoint>();
  private _retries = new Map<string, number>();

  private db: BrainDB;
  private config: BrainConfig;
  private embedder: Embedder | undefined;
  private channel: ChannelPushFn | undefined;
  private model: string;
  private maxBudgetUsd: number;

  constructor(
    run: WorkflowRun,
    db: BrainDB,
    config: BrainConfig,
    channelPush?: ChannelPushFn,
    options?: WorkflowContextOptions
  ) {
    this.runId = run.id;
    this.workflowName = run.workflowName;
    this._status = run.status;
    this._currentStep = run.currentStep;
    this._stepResults = { ...run.stepResults };
    this._activeAgent = run.activeAgent ? { ...run.activeAgent } : null;
    this._context = { ...run.context };
    this._startedAt = run.startedAt;
    this._completedAt = run.completedAt;
    this._error = run.error;
    this.db = db;
    this.config = config;
    this.embedder = options?.embedder;
    this.channel = channelPush;
    this.model = options?.model ?? 'sonnet';
    this.maxBudgetUsd = options?.maxBudgetUsd ?? 2.0;

    this.rebuildIterationCounts();
  }

  // --- Public interface (implements WorkflowContext from types.ts) ---

  get project(): string {
    return this._context.project ?? '';
  }

  get projectDir(): string {
    return this._context.projectDir ?? process.cwd();
  }

  get activeAgent(): { pid: number; taskId: string; stepId: string } | null {
    return this._activeAgent;
  }

  param(key: string): string | undefined {
    return this._context[key];
  }

  iteration(stepId: string): number {
    return this._iterations[stepId] ?? 0;
  }

  async dispatch(stepId: string, template: string): Promise<StepResult> {
    const iterKey = `${stepId}:${this._iterations[stepId] ?? 0}`;

    const cached = this._stepResults[iterKey];
    if (cached) {
      this._iterations[stepId] = (this._iterations[stepId] ?? 0) + 1;
      return cached;
    }

    return this.dispatchWithRetry(stepId, template, iterKey);
  }

  /** Maximum number of automatic retries when an agent dies. */
  static readonly MAX_RETRIES = 1;

  private async dispatchWithRetry(
    stepId: string,
    template: string,
    iterKey: string
  ): Promise<StepResult> {
    const retryCount = this._retries.get(iterKey) ?? 0;

    const taskId = await this.createStepTask(stepId);
    const rendered = await this.renderTemplate(taskId, template);

    this._currentStep = stepId;
    this._activeAgent = null;
    this.persist();

    const agent = await this.spawnAgent(taskId, rendered);
    this._activeAgent = { pid: agent.pid, taskId: agent.taskId, stepId };
    this.persist();

    let output: string;
    try {
      output = await this.waitForAgent(iterKey);
    } catch (err) {
      if (err instanceof AgentDeathError && retryCount < WorkflowContext.MAX_RETRIES) {
        this._retries.set(iterKey, retryCount + 1);
        this.channel?.('step_retry', {
          workflow: this.runId,
          step: stepId,
          taskId: agent.taskId,
          attempt: String(retryCount + 2),
        });
        return this.dispatchWithRetry(stepId, template, iterKey);
      }

      this.channel?.('step_failed', {
        workflow: this.runId,
        step: stepId,
        taskId: agent.taskId,
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }

    const signal = parseSignals(stepId, this.workflowName, output);

    const stepResult: StepResult = {
      stepId,
      taskId: agent.taskId,
      agentId: agent.agentId,
      signal,
      completedAt: new Date().toISOString(),
      output,
    };

    this._stepResults[iterKey] = stepResult;
    this._iterations[stepId] = (this._iterations[stepId] ?? 0) + 1;
    this._activeAgent = null;
    this.persist();

    this.channel?.('step_complete', {
      workflow: this.runId,
      step: stepId,
      signal: signal ?? '',
      taskId: agent.taskId,
    });

    return stepResult;
  }

  async assisted(stepId: string, template: string): Promise<StepResult> {
    const cached = this._stepResults[stepId];
    if (cached) return cached;

    const taskId = await this.createStepTask(stepId);

    const rendered = await this.renderTemplate(taskId, template);

    this._currentStep = stepId;
    this._status = 'paused';
    this.persist();

    this.channel?.('assisted_step', {
      workflow: this.runId,
      step: stepId,
      taskId,
      prompt: rendered,
    });

    const signalData = await this.waitForSignal(stepId);

    const stepResult: StepResult = {
      stepId,
      taskId,
      agentId: null,
      signal: signalData?.signal ?? null,
      completedAt: new Date().toISOString(),
    };

    this._stepResults[stepId] = stepResult;
    this._status = 'running';
    this.persist();

    return stepResult;
  }

  signal(stepId: string, data?: Record<string, string>): void {
    const waitpoint = this.signalWaitpoints.get(stepId);
    if (waitpoint) {
      waitpoint.resolve(data);
      this.signalWaitpoints.delete(stepId);
    }
  }

  /** Resolve a pending agent dispatch (called by agent-done hook or reconciler). */
  resolveAgent(stepId: string, output: string): void {
    const iterKey = this.findActiveAgentKey(stepId);
    if (!iterKey) return;

    const waitpoint = this.agentWaitpoints.get(iterKey);
    if (waitpoint) {
      waitpoint.resolve(output);
      this.agentWaitpoints.delete(iterKey);
    }
  }

  /** Handle agent death detected by reconciler. Rejects with AgentDeathError for retry logic. */
  handleAgentDeath(agent: { pid: number; taskId: string; stepId: string }): void {
    const iterKey = this.findActiveAgentKey(agent.stepId);
    if (!iterKey) return;

    const waitpoint = this.agentWaitpoints.get(iterKey);
    if (waitpoint) {
      waitpoint.reject(new AgentDeathError(agent.pid, agent.taskId, agent.stepId));
      this.agentWaitpoints.delete(iterKey);
    }
    this._activeAgent = null;
    this.persist();
  }

  /** Serialize current state back to a WorkflowRun (for status queries). */
  toRun(): WorkflowRun {
    return {
      id: this.runId,
      workflowName: this.workflowName,
      context: { ...this._context },
      status: this._status,
      currentStep: this._currentStep,
      stepResults: { ...this._stepResults },
      activeAgent: this._activeAgent ? { ...this._activeAgent } : null,
      startedAt: this._startedAt,
      completedAt: this._completedAt,
      error: this._error,
    };
  }

  /** Persist current state to workflow_runs table. */
  persist(): void {
    const rawDb = this.db.rawDb;
    rawDb
      .prepare(
        `INSERT INTO workflow_runs (id, workflow_name, context, status, current_step, step_results, active_agent, started_at, completed_at, error)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           status = excluded.status,
           current_step = excluded.current_step,
           step_results = excluded.step_results,
           active_agent = excluded.active_agent,
           completed_at = excluded.completed_at,
           error = excluded.error`
      )
      .run(
        this.runId,
        this.workflowName,
        JSON.stringify(this._context),
        this._status,
        this._currentStep,
        JSON.stringify(this._stepResults),
        this._activeAgent ? JSON.stringify(this._activeAgent) : null,
        this._startedAt,
        this._completedAt,
        this._error
      );
  }

  // --- Private helpers ---

  private async createStepTask(stepId: string): Promise<string> {
    const project = this._context.project;
    const workstream = parseInt(this._context.workstream ?? '1', 10);

    const result = await createTask(this.db, this.config, this.embedder!, {
      project,
      workstream,
      name: `${this.workflowName}:${stepId} (run ${this.runId.slice(0, 8)})`,
      category: 'implementation',
      description: `Workflow step: ${stepId} for ${this.workflowName}`,
      mode: 'agent',
    });

    if (!result.ok) {
      throw new Error(`Failed to create task for step ${stepId}: ${result.error.message}`);
    }
    return result.data.display_id;
  }

  private async renderTemplate(taskId: string, templateName: string): Promise<string> {
    if (!this.embedder) {
      throw new Error('Embedder required for template rendering');
    }

    const result = await dispatchTemplate(
      this.db,
      this.config,
      this.embedder,
      taskId,
      templateName,
      { dryRun: true }
    );

    if (!result.ok) {
      throw new Error(`Failed to render template "${templateName}": ${result.error.message}`);
    }
    return result.data.rendered;
  }

  private async spawnAgent(
    taskId: string,
    _rendered: string
  ): Promise<{ pid: number; taskId: string; agentId: string }> {
    // Use BrainServiceClass-based dispatch when available.
    // For now, use the server dispatch infrastructure directly.
    // The dispatchTask function needs a BrainServiceClass — we use a
    // lazy import to avoid circular dependencies at module load time.
    const { dispatchTask: dispatch } = await import('../../../server/dispatch.js');

    // dispatchTask requires a BrainServiceClass; build a minimal shim
    // that satisfies the interface. This is intentionally narrow — the
    // full BrainServiceClass.create() path pulls in config resolution
    // that we don't want inside the runtime.
    const svc = this.buildServiceShim();

    const result = await dispatch(svc, {
      taskId,
      model: this.model,
      maxBudgetUsd: this.maxBudgetUsd,
    });

    if ('dryRun' in result) {
      throw new Error('dispatchTask returned dry-run result unexpectedly');
    }

    return { pid: result.pid, taskId: result.taskId, agentId: result.agentId };
  }

  private buildServiceShim(): Parameters<typeof dispatchTask>[0] {
    // Minimal shim satisfying what dispatchTask reads from BrainServiceClass.
    // dispatchTask accesses: svc.db, svc.config, svc.embedder, svc.instance
    // instance.root must be the .brain directory so dirname(root) = project dir
    const brainDir = join(dirname(this.config.dbPath), '..');
    return {
      db: this.db,
      config: this.config,
      embedder: this.embedder!,
      instance: {
        isLocal: true,
        root: existsSync(join(process.cwd(), '.brain')) ? join(process.cwd(), '.brain') : brainDir,
      },
    } as Parameters<typeof dispatchTask>[0];
  }

  private waitForAgent(iterKey: string): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      this.agentWaitpoints.set(iterKey, { resolve, reject });
    });
  }

  private waitForSignal(stepId: string): Promise<Record<string, string> | undefined> {
    return new Promise<Record<string, string> | undefined>((resolve) => {
      this.signalWaitpoints.set(stepId, { resolve });
    });
  }

  private findActiveAgentKey(stepId: string): string | null {
    const iter = (this._iterations[stepId] ?? 1) - 1;
    const iterKey = `${stepId}:${Math.max(0, iter)}`;
    if (this.agentWaitpoints.has(iterKey)) return iterKey;

    // Fall back to scanning all waitpoints for a match
    for (const key of this.agentWaitpoints.keys()) {
      if (key.startsWith(`${stepId}:`)) return key;
    }
    return null;
  }

  /**
   * Rebuild iteration counts from cached step results.
   * Sets each step's iteration to 0 (the first cached entry) so that
   * on hydration, dispatch() replays through all cached results via
   * cache-hit bumping before reaching uncached iterations.
   */
  private rebuildIterationCounts(): void {
    const seen = new Set<string>();
    for (const key of Object.keys(this._stepResults)) {
      const colonIdx = key.lastIndexOf(':');
      if (colonIdx === -1) continue;
      const stepId = key.slice(0, colonIdx);
      const iter = parseInt(key.slice(colonIdx + 1), 10);
      if (!Number.isNaN(iter) && !seen.has(stepId)) {
        seen.add(stepId);
        this._iterations[stepId] = 0;
      }
    }
  }
}
