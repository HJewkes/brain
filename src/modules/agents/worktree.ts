import { execFileSync } from 'node:child_process';
import { cpSync, existsSync } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';
import {
  allocateWorktree as dbAllocate,
  releaseWorktree as dbRelease,
  getWorktreeAllocations,
} from './data.js';
import type { WorktreeAllocation, AllocateWorktreeInput } from './types.js';

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
 * Budget should be set to BackpressureController.computeEffectiveWip().effectiveWip.
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

  // Clean up stale allocations before checking budget
  cleanupStaleAllocations(db, projectRoot);

  const currentAllocations = getWorktreeAllocations(db);
  if (currentAllocations.length >= budget) {
    throw new Error(`Worktree budget exhausted: ${currentAllocations.length}/${budget} allocated`);
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
