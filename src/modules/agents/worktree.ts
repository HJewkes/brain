import { execFileSync } from 'node:child_process';
import { cpSync, existsSync } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';
import {
  allocateWorktree as dbAllocate,
  releaseWorktree as dbRelease,
  getWorktreeAllocations,
  findAgentByTask,
} from './data.js';
import { getDeliveryForTask } from './delivery.js';
import { getRawDb } from '../../utils/db.js';
import type Database from 'better-sqlite3';
import type { BrainDB } from '../../services/brain-db.js';
import type { WorktreeAllocation, AllocateWorktreeInput, AgentStatus } from './types.js';

/**
 * Thrown by {@link allocateWorktree} when no worktree slot is available even
 * after stale and terminated-agent reclaim. Callers can catch this to surface
 * a structured "queued" response instead of treating it as a hard failure.
 */
export class WorktreeBudgetExhaustedError extends Error {
  constructor(
    public readonly allocated: number,
    public readonly budget: number
  ) {
    super(`Worktree budget exhausted: ${allocated}/${budget} allocated`);
    this.name = 'WorktreeBudgetExhaustedError';
  }
}

const TERMINAL_AGENT_STATUSES: ReadonlySet<AgentStatus> = new Set([
  'completed',
  'failed',
  'abandoned',
]);

const ACTIVE_DELIVERY_STATUSES: ReadonlySet<string> = new Set([
  'in-progress',
  'pushed',
  'pr-open',
  'pr-failed',
  'push-failed',
  'conflicted',
  'review-paused',
]);

export interface AllocateWorktreeOptions {
  taskId: string;
  workstream: string;
  claimToken: string;
  basePath?: string;
  budget?: number;
}

export interface AllocateWorktreeResult {
  worktreePath: string;
  branch: string;
  reused: boolean;
}

export interface CheckWorktreeResult {
  inWorktree: boolean;
  expected: string;
  actual: string;
}

const DEFAULT_BUDGET = 3;
const DEFAULT_BASE_PATH = '.worktrees';

/**
 * Find the true git repository root, resolving through worktrees.
 * Uses --git-common-dir to find the main repo even when called
 * from inside a git worktree, preventing nested worktree paths.
 */
export function findGitRoot(): string {
  try {
    const gitCommonDir = execFileSync(
      'git',
      ['rev-parse', '--path-format=absolute', '--git-common-dir'],
      { encoding: 'utf-8', stdio: 'pipe' }
    ).trim();
    return dirname(gitCommonDir);
  } catch {
    return process.cwd();
  }
}

/**
 * Allocate a git worktree for a task.
 * Each task gets its own isolated path (.worktrees/{taskId}).
 * Cleans up stale allocations before checking budget.
 * Budget should match the WIP limit passed to DispatchLoop.
 */
export function allocateWorktree(
  db: unknown,
  projectRoot: string,
  opts: AllocateWorktreeOptions
): AllocateWorktreeResult {
  if (!opts.workstream) {
    throw new Error(
      `Cannot allocate worktree for task ${opts.taskId}: workstream is empty. ` +
        `Ensure the task belongs to a workstream before dispatching with worktree isolation.`
    );
  }

  const budget = opts.budget ?? DEFAULT_BUDGET;
  const basePath = opts.basePath ?? DEFAULT_BASE_PATH;

  // Reclaim slots before checking budget: first stale paths, then allocations
  // whose owning agent has reached a terminal state without an in-flight delivery.
  cleanupStaleAllocations(db, projectRoot);
  reclaimTerminatedAllocations(db, projectRoot);

  const currentAllocations = getWorktreeAllocations(db);
  if (currentAllocations.length >= budget) {
    throw new WorktreeBudgetExhaustedError(currentAllocations.length, budget);
  }

  const branch = `agent/${opts.workstream}/${opts.taskId}`;
  const worktreePath = resolve(projectRoot, basePath, opts.taskId);

  // Clean up stale branch if it exists from a prior run
  try {
    execFileSync('git', ['branch', '-D', branch], {
      cwd: projectRoot,
      encoding: 'utf-8',
      stdio: 'pipe',
    });
  } catch {
    // Branch doesn't exist — expected for fresh allocations
  }

  execFileSync('git', ['worktree', 'add', '-b', branch, worktreePath], {
    cwd: projectRoot,
    encoding: 'utf-8',
    stdio: 'pipe',
  });

  // Copy .claude/ settings so hooks (agent-done, session capture) fire in worktrees
  const claudeDir = resolve(projectRoot, '.claude');
  const targetClaudeDir = resolve(worktreePath, '.claude');
  if (existsSync(claudeDir) && !existsSync(targetClaudeDir)) {
    cpSync(claudeDir, targetClaudeDir, { recursive: true });
  }

  const input: AllocateWorktreeInput = {
    task_id: opts.taskId,
    workstream: opts.workstream,
    worktree_path: worktreePath,
    branch,
    claim_token: opts.claimToken,
  };
  dbAllocate(db, input);

  return { worktreePath, branch, reused: false };
}

/**
 * Release a worktree by task ID: remove from git, delete branch, remove from DB.
 * Returns false if no allocation exists for the given taskId.
 */
export function releaseWorktree(db: unknown, projectRoot: string, taskId: string): boolean {
  const allocations = getWorktreeAllocations(db);
  const allocation = allocations.find((a) => a.task_id === taskId);
  if (!allocation) return false;

  try {
    execFileSync('git', ['worktree', 'remove', allocation.worktree_path], {
      cwd: projectRoot,
      encoding: 'utf-8',
      stdio: 'pipe',
    });
  } catch {
    try {
      // Force remove if normal remove fails (dirty worktree)
      execFileSync('git', ['worktree', 'remove', '--force', allocation.worktree_path], {
        cwd: projectRoot,
        encoding: 'utf-8',
        stdio: 'pipe',
      });
    } catch {
      // Worktree directory already gone — proceed with DB cleanup
    }
  }

  try {
    execFileSync('git', ['branch', '-D', allocation.branch], {
      cwd: projectRoot,
      encoding: 'utf-8',
      stdio: 'pipe',
    });
  } catch {
    // Branch may already be gone; not fatal
  }

  dbRelease(db, taskId);
  return true;
}

/**
 * Check whether process.cwd() is at or inside expectedPath.
 */
export function checkWorktreePath(expectedPath: string): CheckWorktreeResult {
  const actual = process.cwd();
  const expected = resolve(expectedPath);
  const normalizedActual = resolve(actual);
  const boundary = expected + sep;
  const inWorktree = normalizedActual === expected || normalizedActual.startsWith(boundary);
  return { inWorktree, expected, actual };
}

/**
 * Release allocations whose owning agent has reached a terminal status
 * (completed/failed/abandoned) and has no in-flight delivery. Used to reclaim
 * worktree budget when prior agents finished without the dispatch loop's
 * cleanup hook running (e.g., individual `brain_agent_dispatch` calls or
 * crash recovery).
 *
 * Allocations without an agent record, or whose agent is still pending/active,
 * or whose delivery is mid-flight (push, PR, review) are left alone — releasing
 * them would kill in-progress work.
 */
export function reclaimTerminatedAllocations(db: unknown, projectRoot: string): string[] {
  const allocations = getWorktreeAllocations(db);
  const reclaimed: string[] = [];
  const rawDb = tryGetRawDb(db);

  for (const allocation of allocations) {
    const agent = findAgentByTask(db, allocation.task_id);
    if (!agent) continue;
    if (!TERMINAL_AGENT_STATUSES.has(agent.status)) continue;

    if (rawDb) {
      const delivery = getDeliveryForTask(rawDb, allocation.task_id);
      if (delivery && ACTIVE_DELIVERY_STATUSES.has(delivery.status)) continue;
    }

    if (releaseWorktree(db, projectRoot, allocation.task_id)) {
      reclaimed.push(allocation.task_id);
    }
  }

  return reclaimed;
}

function tryGetRawDb(db: unknown): Database.Database | null {
  try {
    return getRawDb(db as BrainDB | Database.Database);
  } catch {
    return null;
  }
}

/**
 * Remove allocations whose worktree path no longer exists on disk.
 * Returns the task IDs that were cleaned up.
 */
export function cleanupStaleAllocations(db: unknown, projectRoot: string): string[] {
  const allocations = getWorktreeAllocations(db);
  const removed: string[] = [];

  for (const allocation of allocations) {
    const worktreePath = resolve(projectRoot, allocation.worktree_path);
    if (!existsSync(worktreePath)) {
      dbRelease(db, allocation.task_id);
      removed.push(allocation.task_id);
    }
  }

  return removed;
}

export interface CleanupOrphanBranchesOptions {
  /** Only scan branches under `agent/{workstream}/`. Omit to scan all `agent/*` refs. */
  workstream?: string;
  /** Report orphans without actually deleting them. */
  dryRun?: boolean;
}

export interface OrphanBranchReport {
  branch: string;
  hasOpenPR: boolean;
  hasActiveAgent: boolean;
  deleted: boolean;
}

function listRemoteAgentBranches(projectRoot: string, workstream?: string): string[] {
  const refPrefix = workstream
    ? `refs/remotes/origin/agent/${workstream}/`
    : 'refs/remotes/origin/agent/';
  try {
    const output = execFileSync('git', ['for-each-ref', refPrefix, '--format=%(refname:short)'], {
      cwd: projectRoot,
      encoding: 'utf-8',
      stdio: 'pipe',
    });
    return output
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => line.replace(/^origin\//, ''));
  } catch {
    return [];
  }
}

function hasOpenPullRequest(projectRoot: string, branch: string): boolean {
  try {
    const output = execFileSync(
      'gh',
      ['pr', 'list', '--head', branch, '--state', 'open', '--json', 'number'],
      { cwd: projectRoot, encoding: 'utf-8', stdio: 'pipe' }
    );
    const prs = JSON.parse(output) as unknown;
    return Array.isArray(prs) && prs.length > 0;
  } catch {
    // gh failure: assume PR exists so we don't accidentally delete branches we can't verify
    return true;
  }
}

function deleteRemoteBranch(projectRoot: string, branch: string): boolean {
  try {
    execFileSync('git', ['push', 'origin', '--delete', branch], {
      cwd: projectRoot,
      encoding: 'utf-8',
      stdio: 'pipe',
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Scan remote `agent/*` branches and delete those with no open PR and no
 * active worktree allocation. Intended to run after a workstream dispatch
 * completes to clear stragglers left by failed, abandoned, or redispatched
 * agents. Also releases any local worktree/branch tied to a deleted remote.
 */
export function cleanupOrphanRemoteBranches(
  db: unknown,
  projectRoot: string,
  opts: CleanupOrphanBranchesOptions = {}
): OrphanBranchReport[] {
  const remoteBranches = listRemoteAgentBranches(projectRoot, opts.workstream);
  if (remoteBranches.length === 0) return [];

  const allocations = getWorktreeAllocations(db);
  const activeBranches = new Map(allocations.map((a) => [a.branch, a.task_id]));

  const reports: OrphanBranchReport[] = [];
  for (const branch of remoteBranches) {
    const hasActiveAgent = activeBranches.has(branch);
    const hasOpenPR = hasActiveAgent ? true : hasOpenPullRequest(projectRoot, branch);
    const isOrphan = !hasActiveAgent && !hasOpenPR;

    let deleted = false;
    if (isOrphan && !opts.dryRun) {
      deleted = deleteRemoteBranch(projectRoot, branch);
    }

    reports.push({ branch, hasOpenPR, hasActiveAgent, deleted });
  }

  return reports;
}

/**
 * Verify worktree isolation before dispatching an agent.
 * Returns the allocated worktree path if one exists, or null if this is the only agent.
 * Throws if other agents are active and the current task lacks a worktree.
 */
export function requireWorktreeIsolation(db: unknown, taskId: string): string | null {
  const allocations = getWorktreeAllocations(db);

  const ownAllocation = allocations.find((a) => a.task_id === taskId);
  if (ownAllocation) return ownAllocation.worktree_path;

  const otherAllocations = allocations.filter((a) => a.task_id !== taskId);
  if (otherAllocations.length === 0) return null;

  throw new Error(
    `Worktree isolation required: ${otherAllocations.length} other allocation(s) active. ` +
      `Task "${taskId}" must allocate a worktree before dispatch.`
  );
}

export type { WorktreeAllocation };
