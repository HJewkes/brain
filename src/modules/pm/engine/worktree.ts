import { execSync } from 'node:child_process';
import { join, resolve, normalize } from 'node:path';
import type { BrainDB } from '../../../services/brain-db.js';
import type { Result } from '../errors.js';
import { ok, fail } from '../errors.js';

export interface WorktreeAllocation {
  taskId: string;
  workstream: string;
  claimToken: string;
  path: string;
  branch: string;
  allocatedAt: string;
}

export interface WorktreeBudget {
  max: number;
  used: number;
  available: number;
  allocations: WorktreeAllocation[];
}

const META_KEY = 'pm_worktree_allocations';
const DEFAULT_BUDGET = 3;

function readAllocations(db: BrainDB): WorktreeAllocation[] {
  const raw = db.getMetaValue(META_KEY);
  if (!raw) return [];
  return JSON.parse(raw) as WorktreeAllocation[];
}

function writeAllocations(db: BrainDB, allocations: WorktreeAllocation[]): void {
  db.setMetaValue(META_KEY, JSON.stringify(allocations));
}

export function getAllocations(db: BrainDB): WorktreeAllocation[] {
  return readAllocations(db);
}

export function getBudget(db: BrainDB, projectBudget?: number): WorktreeBudget {
  const max = projectBudget ?? DEFAULT_BUDGET;
  const allocations = readAllocations(db);
  const uniqueWorktrees = new Set(allocations.map((a) => a.path)).size;
  return {
    max,
    used: uniqueWorktrees,
    available: Math.max(0, max - uniqueWorktrees),
    allocations,
  };
}

function worktreePath(repoRoot: string, workstream: string): string {
  return join(repoRoot, '.worktrees', workstream);
}

function worktreeBranch(workstream: string): string {
  return `worktree/${workstream}`;
}

function getRepoRoot(): string {
  return execSync('git rev-parse --show-toplevel', { encoding: 'utf-8' }).trim();
}

export function allocateWorktree(
  db: BrainDB,
  taskId: string,
  workstream: string,
  claimToken: string,
  projectBudget?: number,
): Result<WorktreeAllocation> {
  const allocations = readAllocations(db);
  const max = projectBudget ?? DEFAULT_BUDGET;

  const existing = allocations.find((a) => a.taskId === taskId);
  if (existing) {
    return fail('DUPLICATE_ID', `Task "${taskId}" already has a worktree allocation`);
  }

  const sameWorkstream = allocations.find((a) => a.workstream === workstream);
  if (sameWorkstream) {
    const allocation: WorktreeAllocation = {
      taskId,
      workstream,
      claimToken,
      path: sameWorkstream.path,
      branch: sameWorkstream.branch,
      allocatedAt: new Date().toISOString(),
    };
    allocations.push(allocation);
    writeAllocations(db, allocations);
    return ok(allocation);
  }

  const uniqueWorktrees = new Set(allocations.map((a) => a.path));
  if (uniqueWorktrees.size >= max) {
    return fail('WIP_LIMIT', `Worktree budget exceeded: ${uniqueWorktrees.size}/${max} in use`);
  }

  const repoRoot = getRepoRoot();
  const path = worktreePath(repoRoot, workstream);
  const branch = worktreeBranch(workstream);

  execSync(`git worktree add -b "${branch}" "${path}"`, { encoding: 'utf-8' });

  const allocation: WorktreeAllocation = {
    taskId,
    workstream,
    claimToken,
    path,
    branch,
    allocatedAt: new Date().toISOString(),
  };
  allocations.push(allocation);
  writeAllocations(db, allocations);
  return ok(allocation);
}

export function checkWorktreePath(
  expectedWorktree: string,
  targetPath: string,
): Result<void> {
  const normalizedWorktree = normalize(resolve(expectedWorktree)).replace(/\/+$/, '');
  const normalizedTarget = normalize(resolve(targetPath));

  if (normalizedTarget === normalizedWorktree || normalizedTarget.startsWith(normalizedWorktree + '/')) {
    return ok(undefined);
  }

  return fail(
    'INVALID_INPUT',
    `Path "${targetPath}" is outside expected worktree "${expectedWorktree}"`,
  );
}

export function releaseWorktree(
  db: BrainDB,
  taskId: string,
): Result<{ released: boolean; path?: string }> {
  const allocations = readAllocations(db);
  const idx = allocations.findIndex((a) => a.taskId === taskId);

  if (idx === -1) {
    return ok({ released: false });
  }

  const removed = allocations.splice(idx, 1)[0];
  writeAllocations(db, allocations);
  return ok({ released: true, path: removed.path });
}

export function cleanupStaleAllocations(
  db: BrainDB,
  activeTaskIds: Set<string>,
): string[] {
  const allocations = readAllocations(db);
  const stale: string[] = [];
  const kept: WorktreeAllocation[] = [];

  for (const alloc of allocations) {
    if (activeTaskIds.has(alloc.taskId)) {
      kept.push(alloc);
    } else {
      stale.push(alloc.taskId);
    }
  }

  if (stale.length > 0) {
    writeAllocations(db, kept);
  }

  return stale;
}
