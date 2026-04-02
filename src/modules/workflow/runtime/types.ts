/** Workflow runtime type definitions. */

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

export interface WorkflowRun {
  id: string;
  workflowName: string;
  /** planId, complexity, project, workstream, etc. */
  context: Record<string, string>;
  status: WorkflowStatus;
  currentStep: string | null;
  stepResults: Record<string, StepResult>;
  activeAgent: { pid: number; taskId: string; stepId: string } | null;
  startedAt: string;
  completedAt: string | null;
  error: string | null;
}

export interface WorkflowContext {
  runId: string;
  workflowName: string;
  project: string;
  projectDir: string;

  /** Read a workflow parameter. */
  param(key: string): string | undefined;

  /** Dispatch an agent step. Memoized — returns cached result on re-invocation. */
  dispatch(stepId: string, template: string): Promise<StepResult>;

  /** Pause for human/coordinator input. Pushes prompt via channel, awaits signal. */
  assisted(stepId: string, template: string): Promise<StepResult>;

  /** Track iteration count for a step (for loop guards). */
  iteration(stepId: string): number;

  /** Signal the workflow from outside (e.g., coordinator completing an assisted step). */
  signal(stepId: string, data?: Record<string, string>): void;
}

export type WorkflowFn = (ctx: WorkflowContext) => Promise<void>;

export type ChannelPushFn = (event: string, meta: Record<string, string>) => void;
