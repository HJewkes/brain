/** Workflow runtime type definitions. */

import type { BrainDB } from '../../../services/brain-db.js';
import type { BrainConfig, Embedder } from '../../../types.js';

export type WorkflowStatus = 'running' | 'completed' | 'failed' | 'paused';

export interface StepResult {
  stepId: string;
  /** PM task display_id */
  taskId: string;
  /** null for assisted steps */
  agentId: string | null;
  /** Parsed condition signal (e.g., 'needs_revision') */
  signal: string | null;
  completedAt: string;
  /** Agent summary or artifact reference */
  output?: string;
}

export interface AgentSlot {
  pid: number;
  taskId: string;
  agentId?: string;
  stepId: string;
}

export interface WorkflowRun {
  id: string;
  workflowName: string;
  /** planId, complexity, project, workstream, etc. */
  context: Record<string, string>;
  status: WorkflowStatus;
  currentStep: string | null;
  stepResults: Record<string, StepResult>;
  /** Active agent slots keyed by stepId. JSON-serializable for DB persistence. */
  activeAgents: Record<string, AgentSlot>;
  /** @deprecated Compat accessor — first slot value or null. Set by toRun(). */
  activeAgent?: AgentSlot | null;
  startedAt: string;
  completedAt: string | null;
  error: string | null;
}

/** Result of a deterministic seed step (no LLM agent). */
export interface SeedResult {
  /** Arbitrary output data from the seed function. */
  data: Record<string, string>;
  /** Optional summary written to step output. */
  output?: string;
}

export interface WorkflowContext {
  runId: string;
  workflowName: string;
  project: string;
  projectDir: string;

  /** Database instance (available in runtime, absent in tests). */
  readonly db?: BrainDB;
  /** Brain configuration (available in runtime, absent in tests). */
  readonly config?: BrainConfig;
  /** Embedder instance (available in runtime, absent in tests). */
  readonly embedder?: Embedder;

  /** Read a workflow parameter. */
  param(key: string): string | undefined;

  /** Dispatch an agent step. Memoized — returns cached result on re-invocation.
   *  Pass taskId to dispatch against an existing PM task instead of creating a new one. */
  dispatch(stepId: string, template: string, taskId?: string): Promise<StepResult>;

  /** Run a deterministic seed step (no LLM). Memoized — returns cached result on re-invocation. */
  seed(stepId: string, fn: () => Promise<SeedResult>): Promise<StepResult>;

  /** Pause for human/coordinator input. Pushes prompt via channel, awaits signal. */
  assisted(stepId: string, template: string): Promise<StepResult>;

  /** Track iteration count for a step (for loop guards). */
  iteration(stepId: string): number;

  /** Signal the workflow from outside (e.g., coordinator completing an assisted step). */
  signal(stepId: string, data?: Record<string, string>): void;
}

export type WorkflowFn = (ctx: WorkflowContext) => Promise<void>;

export type ChannelPushFn = (event: string, meta: Record<string, string>) => void;
