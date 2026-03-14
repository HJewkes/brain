import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve, sep } from 'node:path';
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
 * Allocate a git worktree for a task.
 * Reuses an existing worktree for the same workstream if one exists.
 * Enforces budget limit before creating a new worktree.
 */
export function allocateWorktree(
  db: unknown,
  projectRoot: string,
  opts: AllocateWorktreeOptions
): AllocateWorktreeResult {
  const budget = opts.budget ?? DEFAULT_BUDGET;
  const basePath = opts.basePath ?? DEFAULT_BASE_PATH;

  const allocations = getWorktreeAllocations(db);

  const existing = allocations.find((a) => a.workstream === opts.workstream);
  if (existing) {
    // Insert a new record for the new task pointing to the same physical worktree
    const input: AllocateWorktreeInput = {
      task_id: opts.taskId,
      workstream: opts.workstream,
      worktree_path: existing.worktree_path,
      branch: existing.branch,
      claim_token: opts.claimToken,
    };
    dbAllocate(db, input);
    return { worktreePath: existing.worktree_path, branch: existing.branch, reused: true };
  }

  if (allocations.length >= budget) {
    throw new Error(`Worktree budget exhausted: ${allocations.length}/${budget} allocated`);
  }

  const branch = `agent/${opts.workstream}/${opts.taskId}`;
  const worktreePath = resolve(projectRoot, basePath, opts.workstream);

  execFileSync('git', ['worktree', 'add', '-b', branch, worktreePath], {
    cwd: projectRoot,
    encoding: 'utf-8',
    stdio: 'pipe',
  });

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
    // Force remove if normal remove fails (dirty worktree)
    execFileSync('git', ['worktree', 'remove', '--force', allocation.worktree_path], {
      cwd: projectRoot,
      encoding: 'utf-8',
      stdio: 'pipe',
    });
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

export type { WorktreeAllocation };
