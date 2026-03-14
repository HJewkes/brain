import Database from 'better-sqlite3';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolveInstance, loadConfig } from '../../services/config.js';
import { getAgent, updateAgentStatus, releaseWorktree as dbReleaseWorktree } from './data.js';
import type { AgentRecord } from './types.js';

/**
 * Open a writable DB connection for hook context.
 * Returns null if the DB file does not exist.
 */
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
 * Release worktree allocation in DB for the agent's task.
 * Physical worktree removal is left to cleanup — we only clear the DB record
 * to avoid git operations in a hook that must not fail.
 */
function tryReleaseWorktree(db: Database.Database, agent: AgentRecord): void {
  if (!agent.brain_task) return;
  try {
    dbReleaseWorktree(db, agent.brain_task);
  } catch {
    // Non-fatal: worktree record may not exist
  }
}

/**
 * Mark the PM task as done by shelling out to the CLI.
 * Fire-and-forget — errors are swallowed.
 */
function tryUpdatePmTask(taskId: string, cwd: string): void {
  try {
    execFileSync('node', [process.argv[1], 'pm', 'task', 'status', taskId, 'done'], {
      cwd,
      encoding: 'utf-8',
      stdio: 'pipe',
      timeout: 5000,
    });
  } catch {
    // Fire-and-forget: PM module may not be available
  }
}

/**
 * Fire session commit as a non-blocking side effect.
 */
function trySessionCommit(cwd: string): void {
  try {
    execFileSync('node', [process.argv[1], 'session', 'commit'], {
      cwd,
      encoding: 'utf-8',
      stdio: 'pipe',
      timeout: 5000,
    });
  } catch {
    // Fire-and-forget: session module may not be available
  }
}

export interface AgentDoneInput {
  agent_id?: string;
  exit_code?: number;
  summary?: string;
}

export interface AgentDoneResult {
  agentId: string | null;
  status: 'completed' | 'failed';
  updated: boolean;
  worktreeReleased: boolean;
  taskUpdated: boolean;
}

/**
 * Core agent-done logic, extracted for testability.
 * Accepts a DB instance directly so tests can pass an in-memory DB.
 */
export function handleAgentDone(
  db: Database.Database,
  agentId: string,
  parsed: AgentDoneInput,
  cwd: string
): AgentDoneResult {
  const exitCode = parsed.exit_code ?? 0;
  const status = exitCode === 0 ? 'completed' : 'failed';
  const summary = parsed.summary;

  const result: AgentDoneResult = {
    agentId,
    status,
    updated: false,
    worktreeReleased: false,
    taskUpdated: false,
  };

  const agent = getAgent(db, agentId);
  if (!agent || agent.status !== 'active') {
    return result;
  }

  // Mark agent completed/failed
  updateAgentStatus(db, agentId, status, {
    summary,
    exit_reason: status === 'failed' ? `exit_code=${exitCode}` : undefined,
  });
  result.updated = true;

  // Release worktree allocation (DB record only)
  if (agent.brain_task) {
    tryReleaseWorktree(db, agent);
    result.worktreeReleased = true;
  }

  // Update PM task status
  if (agent.brain_task && status === 'completed') {
    tryUpdatePmTask(agent.brain_task, cwd);
    result.taskUpdated = true;
  }

  // Session commit (fire-and-forget)
  trySessionCommit(cwd);

  return result;
}

/**
 * Hook entry point — opens its own DB connection, delegates to handleAgentDone,
 * and returns a summary string. Never throws.
 */
export function runAgentDoneHook(
  parsed: AgentDoneInput,
  cwd: string
): { status: 'completed' | 'failed'; agentId: string | null; message: string } {
  const agentId = (parsed.agent_id as string | undefined) ?? process.env.BRAIN_AGENT_ID ?? null;

  if (!agentId) {
    return { status: 'completed', agentId: null, message: 'No agent ID available' };
  }

  let db: Database.Database | null = null;
  try {
    db = openDb(cwd);
    if (!db) {
      return { status: 'completed', agentId, message: 'DB not available' };
    }

    const result = handleAgentDone(db, agentId, parsed, cwd);
    const parts = [`agent=${agentId}`, `status=${result.status}`];
    if (result.updated) parts.push('db-updated');
    if (result.worktreeReleased) parts.push('worktree-released');
    if (result.taskUpdated) parts.push('task-updated');

    return { status: result.status, agentId, message: parts.join(', ') };
  } catch {
    return { status: 'completed', agentId, message: 'handler error (swallowed)' };
  } finally {
    db?.close();
  }
}
