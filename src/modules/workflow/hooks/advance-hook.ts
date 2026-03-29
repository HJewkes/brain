import Database from 'better-sqlite3';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolveInstance, loadConfig } from '../../../services/config.js';
import { getAgent } from '../../agents/data.js';
import {
  hookAllow,
  type HookHandler,
  type HookInput,
  type HookConfig,
} from '../../../hooks/types.js';

interface NextResult {
  advanced: string[];
  pruned: string[];
  completed: boolean;
  dispatched: Array<{ stepId: string; taskId: string; template: string }>;
  errors: Array<{ stepId: string; error: string }>;
}

/** Open a writable DB connection. Returns null if DB file does not exist. */
function openDb(cwd: string): Database.Database | null {
  try {
    const instance = resolveInstance({ cwd });
    const config = loadConfig(instance);
    if (!existsSync(config.dbPath)) return null;
    return new Database(config.dbPath);
  } catch {
    return null;
  }
}

/**
 * Resolve a task display ID to its workflow instance display ID.
 * Walks: task note (by display_id) → incoming expands-to relation → instance note → display_id.
 */
function resolveInstanceForTask(db: Database.Database, taskDisplayId: string): string | null {
  try {
    const taskRow = db
      .prepare(`SELECT id FROM notes WHERE json_extract(metadata, '$.display_id') = ? LIMIT 1`)
      .get(taskDisplayId) as { id: string } | undefined;
    if (!taskRow) return null;

    const relRow = db
      .prepare(
        `SELECT n.id, n.metadata FROM notes n
         JOIN relations r ON r.source_id = n.id
         WHERE r.target_id = ? AND r.type = 'expands-to' LIMIT 1`
      )
      .get(taskRow.id) as { id: string; metadata: string | null } | undefined;
    if (!relRow?.metadata) return null;

    const meta = JSON.parse(relRow.metadata) as Record<string, unknown>;
    return (meta.display_id as string) ?? null;
  } catch {
    return null;
  }
}

/** Shell out to `brain workflow next <id> --json`. Returns parsed result or null on failure. */
function tryWorkflowNext(instanceId: string, cwd: string): NextResult | null {
  try {
    const output = execFileSync(
      'node',
      [process.argv[1], 'workflow', 'next', instanceId, '--json'],
      { cwd, encoding: 'utf-8', stdio: 'pipe', timeout: 5000 }
    );
    return JSON.parse(output) as NextResult;
  } catch {
    process.stderr.write(`[workflow:advance] Failed to advance workflow ${instanceId}\n`);
    return null;
  }
}

/** Write dispatch info to stderr and block any assisted/human steps. */
function handleResult(result: NextResult, instanceId: string, cwd: string): void {
  for (const step of result.dispatched) {
    process.stderr.write(
      `[workflow:advance] Dispatched step '${step.stepId}' (task ${step.taskId}) for instance ${instanceId}\n`
    );
  }

  const dispatchedIds = new Set(result.dispatched.map((d) => d.stepId));
  for (const stepId of result.advanced) {
    if (!dispatchedIds.has(stepId)) {
      process.stderr.write(
        `[workflow:advance] Workflow paused at assisted step '${stepId}' in ${instanceId}\n`
      );
      process.stderr.write(`[workflow:advance] Resume with: brain workflow next ${instanceId}\n`);
      blockStepTask(stepId, instanceId, cwd);
    }
  }

  if (result.completed) {
    process.stderr.write(`[workflow:advance] Workflow ${instanceId} completed.\n`);
  }
}

/** Block an undispatched step task to prevent re-advancement. */
function blockStepTask(stepId: string, instanceId: string, cwd: string): void {
  try {
    execFileSync(
      'node',
      [process.argv[1], 'workflow', 'block', instanceId, stepId, '--reason', 'assisted-step'],
      { cwd, encoding: 'utf-8', stdio: 'pipe', timeout: 5000 }
    );
  } catch {
    // Non-fatal — best-effort block
  }
}

export const advanceHook: HookHandler = {
  name: 'workflow:advance',
  event: 'agent-done',
  priority: 80,

  enabled(_config: HookConfig): boolean {
    return true;
  },

  run(input: HookInput, _config: HookConfig): ReturnType<typeof hookAllow> {
    const agentId = (input.parsed.agent_id as string | undefined) ?? process.env.BRAIN_AGENT_ID;
    if (!agentId) return hookAllow();

    const db = openDb(input.cwd);
    if (!db) return hookAllow();

    try {
      const agent = getAgent(db, agentId);
      if (!agent?.brain_task) return hookAllow();
      if (agent.status !== 'completed') return hookAllow();

      // Prefer the instance found via expands-to relation; fall back to using
      // brain_task directly (the task may itself be the instance root).
      const instanceId = resolveInstanceForTask(db, agent.brain_task) ?? agent.brain_task;

      const result = tryWorkflowNext(instanceId, input.cwd);
      if (!result) return hookAllow();

      handleResult(result, instanceId, input.cwd);
      return hookAllow();
    } finally {
      db.close();
    }
  },
};
