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
import type {
  WorkflowRun,
  AgentSlot,
  StepResult,
  SeedResult,
  WorkflowStatus,
  ChannelPushFn,
} from './types.js';
import { parseSignals } from './signals.js';
import { dispatchTemplate } from '../engine/dispatch.js';
import { dispatchTask } from '../../../server/dispatch.js';
import { captureStepOutput } from '../engine/output-capture.js';
import { classifyWorkflowTurnComplexity } from '../../pm/engine/routing.js';
import { setAgentContext } from '../../agents/data.js';

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
  private _activeAgents: Record<string, AgentSlot>;
  private _context: Record<string, string>;
  private _iterations: Record<string, number> = {};
  private _startedAt: string;
  private _completedAt: string | null;
  private _error: string | null;

  private agentWaitpoints = new Map<string, AgentWaitpoint>();
  private signalWaitpoints = new Map<string, SignalWaitpoint>();
  private _retries = new Map<string, number>();

  private _db: BrainDB;
  private _config: BrainConfig;
  private _embedder: Embedder | undefined;
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
    this._activeAgents = run.activeAgents ? { ...run.activeAgents } : {};
    this._context = { ...run.context };
    this._startedAt = run.startedAt;
    this._completedAt = run.completedAt;
    this._error = run.error;
    this._db = db;
    this._config = config;
    this._embedder = options?.embedder;
    this.channel = channelPush;
    this.model = options?.model ?? 'sonnet';
    this.maxBudgetUsd = options?.maxBudgetUsd ?? 5.0;

    this.rebuildIterationCounts();
  }

  // --- Public interface (implements WorkflowContext from types.ts) ---

  get project(): string {
    return this._context.project ?? '';
  }

  get projectDir(): string {
    return this._context.projectDir ?? process.cwd();
  }

  get db(): BrainDB {
    return this._db;
  }

  get config(): BrainConfig {
    return this._config;
  }

  get embedder(): Embedder | undefined {
    return this._embedder;
  }

  /** All active agent slots keyed by stepId. */
  get activeAgents(): Record<string, AgentSlot> {
    return this._activeAgents;
  }

  /** Convenience — first active slot or null (for reconciler single-agent polling). */
  get activeAgent(): AgentSlot | null {
    const values = Object.values(this._activeAgents);
    return values.length > 0 ? (values[0] ?? null) : null;
  }

  param(key: string): string | undefined {
    return this._context[key];
  }

  iteration(stepId: string): number {
    return this._iterations[stepId] ?? 0;
  }

  async dispatch(stepId: string, template: string, taskId?: string): Promise<StepResult> {
    const iterKey = `${stepId}:${this._iterations[stepId] ?? 0}`;

    const cached = this._stepResults[iterKey];
    if (cached) {
      this._iterations[stepId] = (this._iterations[stepId] ?? 0) + 1;
      return cached;
    }

    return this.dispatchWithRetry(stepId, template, iterKey, taskId);
  }

  async seed(stepId: string, fn: () => Promise<SeedResult>): Promise<StepResult> {
    const cached = this._stepResults[stepId];
    if (cached) return cached;

    this._currentStep = stepId;
    this.persist();

    const seedResult = await fn();

    // Merge seed data into workflow context for downstream templates
    for (const [key, value] of Object.entries(seedResult.data)) {
      this._context[key] = value;
    }

    const stepResult: StepResult = {
      stepId,
      taskId: `seed:${stepId}`,
      agentId: null,
      signal: null,
      completedAt: new Date().toISOString(),
      output: seedResult.output,
    };

    this._stepResults[stepId] = stepResult;
    this.persist();

    if (seedResult.output) {
      this.writeStepOutput(stepId, seedResult.output);
    }

    this.channel?.('step_complete', {
      workflow: this.runId,
      step: stepId,
      signal: '',
      taskId: `seed:${stepId}`,
    });

    return stepResult;
  }

  /** Maximum number of automatic retries when an agent dies. */
  static readonly MAX_RETRIES = 1;

  private async dispatchWithRetry(
    stepId: string,
    template: string,
    iterKey: string,
    existingTaskId?: string
  ): Promise<StepResult> {
    const retryCount = this._retries.get(iterKey) ?? 0;

    // Use the caller's PM task when provided (e.g. wave-execution passes real tasks).
    // Otherwise use a synthetic ID — workflow steps should not auto-create PM tasks
    // because they pile up as unclosed zombies when runs fail or are abandoned.
    const taskId =
      existingTaskId ?? `workflow:${this.workflowName}:${stepId}:${this.runId.slice(0, 8)}`;
    const rendered = await this.renderTemplate(taskId, template);

    this._currentStep = stepId;
    delete this._activeAgents[stepId];
    this.persist();

    const stepModel = classifyWorkflowTurnComplexity(template, this.iteration(stepId));
    const agent = await this.spawnAgent(taskId, rendered, stepModel);
    this._activeAgents[stepId] = {
      pid: agent.pid,
      taskId: agent.taskId,
      agentId: agent.agentId,
      stepId,
    };
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
        return this.dispatchWithRetry(stepId, template, iterKey, existingTaskId);
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
    delete this._activeAgents[stepId];
    this.persist();

    this.writeStepOutput(stepId, output);

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

    // Assisted steps don't need a real PM task — use the workflow's parent
    // task context or a synthetic ID for template rendering.
    const taskId = `assisted:${stepId}`;

    let rendered: string;
    try {
      rendered = await this.renderTemplate(taskId, template);
    } catch {
      // Template rendering may fail without a real task — fall back to raw template name
      rendered = template;
    }

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
  handleAgentDeath(agent: { pid: number; taskId: string; agentId?: string; stepId: string }): void {
    const iterKey = this.findActiveAgentKey(agent.stepId);
    if (!iterKey) return;

    const waitpoint = this.agentWaitpoints.get(iterKey);
    if (waitpoint) {
      waitpoint.reject(new AgentDeathError(agent.pid, agent.taskId, agent.stepId));
      this.agentWaitpoints.delete(iterKey);
    }
    delete this._activeAgents[agent.stepId];
    this.persist();
  }

  /** Serialize current state back to a WorkflowRun (for status queries). */
  toRun(): WorkflowRun {
    const activeAgents = { ...this._activeAgents };
    const slots = Object.values(activeAgents);
    return {
      id: this.runId,
      workflowName: this.workflowName,
      context: { ...this._context },
      status: this._status,
      currentStep: this._currentStep,
      stepResults: { ...this._stepResults },
      activeAgents,
      activeAgent: slots.length > 0 ? { ...slots[0]! } : null,
      startedAt: this._startedAt,
      completedAt: this._completedAt,
      error: this._error,
    };
  }

  /** Persist current state to workflow_runs table. */
  persist(): void {
    const rawDb = this._db.rawDb;
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
        Object.keys(this._activeAgents).length > 0 ? JSON.stringify(this._activeAgents) : null,
        this._startedAt,
        this._completedAt,
        this._error
      );
  }

  // --- Private helpers ---

  private async renderTemplate(taskId: string, templateName: string): Promise<string> {
    if (!this._embedder) {
      throw new Error('Embedder required for template rendering');
    }

    const extraVars = this.buildExtraVars();

    const result = await dispatchTemplate(
      this._db,
      this._config,
      this._embedder!,
      taskId,
      templateName,
      { dryRun: true, extraVars }
    );

    if (!result.ok) {
      throw new Error(`Failed to render template "${templateName}": ${result.error.message}`);
    }
    return result.data.rendered;
  }

  private async spawnAgent(
    taskId: string,
    rendered: string,
    routedModel?: 'opus' | 'sonnet' | 'haiku'
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

    // routedModel comes from classifyWorkflowTurnComplexity; fall back to
    // the workflow-level default for unknown/unclassified templates.
    const model = routedModel ?? this.model;

    const result = await dispatch(svc, {
      taskId,
      model,
      maxBudgetUsd: this.maxBudgetUsd,
      // For synthetic task IDs (workflow:*) there is no PM task, so dispatchTask
      // can't build a prompt from task data. Pass the runtime-rendered prompt
      // explicitly so claude receives the right instructions.
      promptOverride: rendered,
    });

    if ('dryRun' in result) {
      throw new Error('dispatchTask returned dry-run result unexpectedly');
    }
    if ('status' in result) {
      throw new Error(`Dispatch queued for ${taskId}: ${result.reason}`);
    }

    // Store routing metadata so session analytics can track model usage (best-effort)
    try {
      setAgentContext(svc.db, result.agentId, 'model_routed_to', model);
    } catch {
      /* non-critical: DB may not have agents table in all contexts */
    }

    return { pid: result.pid, taskId: result.taskId, agentId: result.agentId };
  }

  private buildServiceShim(): Parameters<typeof dispatchTask>[0] {
    // Minimal shim satisfying what dispatchTask reads from BrainServiceClass.
    // dispatchTask accesses: svc.db, svc.config, svc.embedder, svc.instance
    // instance.root must be the .brain directory so dirname(root) = project dir
    const brainDir = join(dirname(this._config.dbPath), '..');
    return {
      db: this._db,
      config: this._config,
      embedder: this._embedder!,
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

  /** Build extra template variables from V2 runtime state. */
  private buildExtraVars(): Record<string, string> {
    const vars: Record<string, string> = {};

    // Inject workflow params (planId → PLAN_ID, etc.)
    for (const [key, value] of Object.entries(this._context)) {
      vars[key] = value;
      const snakeKey = key
        .replace(/([A-Z])/g, '_$1')
        .toUpperCase()
        .replace(/^_/, '');
      if (!(snakeKey in vars)) vars[snakeKey] = value;
    }

    vars.WORKFLOW_NAME = this.workflowName;
    vars.INSTANCE_ID = this.runId.slice(0, 8);

    // Override TASK_DESCRIPTION and RESEARCH_FOCUS with the brief so templates
    // get the real objective rather than the generic "Workflow step: X" task body
    if (this._context.brief) {
      vars.TASK_DESCRIPTION = this._context.brief;
      vars.RESEARCH_FOCUS = this._context.brief;
    }

    // Inject completed step outputs
    const parts: string[] = [];
    for (const [iterKey, result] of Object.entries(this._stepResults)) {
      if (!result.output) continue;
      const stepId = iterKey.includes(':') ? iterKey.slice(0, iterKey.lastIndexOf(':')) : iterKey;
      const varName = `STEP_OUTPUT_${stepId.toUpperCase().replace(/-/g, '_')}`;
      vars[varName] = result.output;
      parts.push(`### ${stepId}\n\n${result.output}`);
    }
    if (parts.length > 0) {
      vars.PREVIOUS_STEP_OUTPUTS = parts.join('\n\n---\n\n');
    }

    return vars;
  }

  /** Write step output to disk for external consumption and template injection. */
  private writeStepOutput(stepId: string, output: string): void {
    if (!output) return;
    const planId = this._context.planId ?? this.runId.slice(0, 8);
    try {
      captureStepOutput(this.projectDir, planId, stepId, output);
    } catch {
      // Non-fatal — disk write failure shouldn't crash the workflow
    }
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
