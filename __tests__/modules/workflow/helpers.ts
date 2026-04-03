import type { BrainDB } from '../../../src/services/brain-db.js';
import type { WorkflowRuntime } from '../../../src/modules/workflow/runtime/runtime.js';

/**
 * Creates the workflow_runs table using the same DDL as workflowRuntimeMigrationV1.
 * Safe to call in beforeEach — uses CREATE TABLE IF NOT EXISTS.
 */
export function createWorkflowRunsTable(db: BrainDB): void {
  db.rawDb.exec(`
    CREATE TABLE IF NOT EXISTS workflow_runs (
      id TEXT PRIMARY KEY,
      workflow_name TEXT NOT NULL,
      context JSON NOT NULL,
      status TEXT NOT NULL DEFAULT 'running'
        CHECK(status IN ('running', 'completed', 'failed', 'paused')),
      current_step TEXT,
      step_results JSON NOT NULL DEFAULT '{}',
      active_agent JSON,
      started_at TEXT NOT NULL,
      completed_at TEXT,
      error TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_workflow_runs_status ON workflow_runs(status);
  `);
}

/**
 * Drives a workflow run to completion by polling activeAgent and calling
 * resolveAgent for each pending dispatch.
 *
 * @param outputFn - Per-step output string generator. Default: `output for ${stepId}`.
 *                   The `iter` param tracks invocation count per stepId.
 *                   Return a string containing 'needs_revision' to trigger critic loops.
 * @param maxSteps - Guard against infinite loops. Default: 20.
 */
export async function resolveAllAgents(
  runtime: WorkflowRuntime,
  runId: string,
  outputFn: (stepId: string, iter: number) => string = (s) => `output for ${s}`,
  maxSteps = 20
): Promise<void> {
  const callCounts = new Map<string, number>();
  for (let i = 0; i < maxSteps; i++) {
    const running = runtime.activeRuns.get(runId);
    if (!running) break;
    const agent = running.ctx.activeAgent;
    if (!agent) {
      await new Promise<void>((r) => setImmediate(r));
      continue;
    }
    const iter = callCounts.get(agent.stepId) ?? 0;
    callCounts.set(agent.stepId, iter + 1);
    running.ctx.resolveAgent(agent.stepId, outputFn(agent.stepId, iter));
    await new Promise<void>((r) => setImmediate(r));
  }
}
