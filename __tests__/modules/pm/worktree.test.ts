import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { BrainDB } from '../../../src/services/brain-db.js';
import { tmpDbPath } from '../../helpers.js';
import {
  getAllocations,
  getBudget,
  allocateWorktree,
  checkWorktreePath,
  releaseWorktree,
  cleanupStaleAllocations,
} from '../../../src/modules/pm/engine/worktree.js';
import type { WorktreeAllocation } from '../../../src/modules/pm/engine/worktree.js';

vi.mock('node:child_process', () => ({
  execSync: vi.fn((cmd: string) => {
    if (typeof cmd === 'string' && cmd.includes('rev-parse')) {
      return '/fake/repo\n';
    }
    return '';
  }),
}));

let db: BrainDB;

beforeEach(() => {
  db = new BrainDB(tmpDbPath());
});

afterEach(() => {
  db.close();
});

function seedAllocations(allocations: WorktreeAllocation[]): void {
  db.setMetaValue('pm_worktree_allocations', JSON.stringify(allocations));
}

function makeAllocation(overrides: Partial<WorktreeAllocation> = {}): WorktreeAllocation {
  return {
    taskId: overrides.taskId ?? 'PROJ-01-001',
    workstream: overrides.workstream ?? 'ws-01',
    claimToken: overrides.claimToken ?? 'token-abc',
    path: overrides.path ?? '/fake/repo/.worktrees/ws-01',
    branch: overrides.branch ?? 'worktree/ws-01',
    allocatedAt: overrides.allocatedAt ?? '2026-02-26T00:00:00.000Z',
  };
}

describe('getAllocations', () => {
  test('returns empty array when no allocations exist', () => {
    const result = getAllocations(db);
    expect(result).toEqual([]);
  });

  test('returns stored allocations', () => {
    const allocs = [
      makeAllocation(),
      makeAllocation({
        taskId: 'PROJ-01-002',
        workstream: 'ws-02',
        path: '/fake/repo/.worktrees/ws-02',
        branch: 'worktree/ws-02',
      }),
    ];
    seedAllocations(allocs);

    const result = getAllocations(db);
    expect(result).toHaveLength(2);
    expect(result[0].taskId).toBe('PROJ-01-001');
    expect(result[1].taskId).toBe('PROJ-01-002');
  });
});

describe('getBudget', () => {
  test('returns default budget of 3 with 0 used', () => {
    const budget = getBudget(db);
    expect(budget.max).toBe(3);
    expect(budget.used).toBe(0);
    expect(budget.available).toBe(3);
    expect(budget.allocations).toEqual([]);
  });

  test('reflects custom budget from project', () => {
    const budget = getBudget(db, 5);
    expect(budget.max).toBe(5);
    expect(budget.available).toBe(5);
  });

  test('reflects used count from unique worktree paths', () => {
    seedAllocations([
      makeAllocation({ taskId: 'PROJ-01-001', path: '/fake/repo/.worktrees/ws-01' }),
      makeAllocation({ taskId: 'PROJ-01-002', path: '/fake/repo/.worktrees/ws-02' }),
    ]);

    const budget = getBudget(db);
    expect(budget.used).toBe(2);
    expect(budget.available).toBe(1);
  });

  test('counts shared workstream worktree as one budget slot', () => {
    seedAllocations([
      makeAllocation({ taskId: 'PROJ-01-001', path: '/fake/repo/.worktrees/ws-01' }),
      makeAllocation({ taskId: 'PROJ-01-002', path: '/fake/repo/.worktrees/ws-01' }),
    ]);

    const budget = getBudget(db);
    expect(budget.used).toBe(1);
    expect(budget.available).toBe(2);
  });
});

describe('allocateWorktree', () => {
  test('creates worktree and records allocation', () => {
    const result = allocateWorktree(db, 'PROJ-01-001', 'ws-01', 'token-abc');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.taskId).toBe('PROJ-01-001');
    expect(result.data.workstream).toBe('ws-01');
    expect(result.data.path).toBe('/fake/repo/.worktrees/ws-01');
    expect(result.data.branch).toBe('worktree/ws-01');
    expect(result.data.claimToken).toBe('token-abc');

    const stored = getAllocations(db);
    expect(stored).toHaveLength(1);
    expect(stored[0].taskId).toBe('PROJ-01-001');
  });

  test('reuses worktree for same workstream', () => {
    seedAllocations([makeAllocation()]);

    const result = allocateWorktree(db, 'PROJ-01-002', 'ws-01', 'token-def');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.path).toBe('/fake/repo/.worktrees/ws-01');
    expect(result.data.branch).toBe('worktree/ws-01');

    const stored = getAllocations(db);
    expect(stored).toHaveLength(2);
  });

  test('fails when budget exceeded', () => {
    seedAllocations([
      makeAllocation({ taskId: 'T1', workstream: 'ws-01', path: '/fake/repo/.worktrees/ws-01' }),
      makeAllocation({ taskId: 'T2', workstream: 'ws-02', path: '/fake/repo/.worktrees/ws-02' }),
    ]);

    const result = allocateWorktree(db, 'T3', 'ws-03', 'token-x', 2);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('WIP_LIMIT');
  });

  test('fails when task already has allocation', () => {
    seedAllocations([makeAllocation({ taskId: 'PROJ-01-001' })]);

    const result = allocateWorktree(db, 'PROJ-01-001', 'ws-02', 'token-new');

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('DUPLICATE_ID');
  });

  test('records correct branch name', () => {
    const result = allocateWorktree(db, 'PROJ-02-001', 'stream-alpha', 'token-z');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.branch).toBe('worktree/stream-alpha');
  });
});

describe('checkWorktreePath', () => {
  test('passes when path is within worktree', () => {
    const result = checkWorktreePath(
      '/repo/.worktrees/ws-01',
      '/repo/.worktrees/ws-01/src/file.ts'
    );
    expect(result.ok).toBe(true);
  });

  test('fails when path is outside worktree', () => {
    const result = checkWorktreePath(
      '/repo/.worktrees/ws-01',
      '/repo/.worktrees/ws-02/src/file.ts'
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('INVALID_INPUT');
  });

  test('handles trailing slashes', () => {
    const result = checkWorktreePath(
      '/repo/.worktrees/ws-01/',
      '/repo/.worktrees/ws-01/src/file.ts'
    );
    expect(result.ok).toBe(true);
  });

  test('matches exact worktree path', () => {
    const result = checkWorktreePath('/repo/.worktrees/ws-01', '/repo/.worktrees/ws-01');
    expect(result.ok).toBe(true);
  });

  test('rejects path that is a prefix but not a subdirectory', () => {
    const result = checkWorktreePath(
      '/repo/.worktrees/ws-01',
      '/repo/.worktrees/ws-01-extra/file.ts'
    );
    expect(result.ok).toBe(false);
  });
});

describe('releaseWorktree', () => {
  test('removes allocation from db_meta', () => {
    seedAllocations([
      makeAllocation({ taskId: 'PROJ-01-001' }),
      makeAllocation({ taskId: 'PROJ-01-002', workstream: 'ws-02' }),
    ]);

    const result = releaseWorktree(db, 'PROJ-01-001');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.released).toBe(true);

    const remaining = getAllocations(db);
    expect(remaining).toHaveLength(1);
    expect(remaining[0].taskId).toBe('PROJ-01-002');
  });

  test('returns released path', () => {
    seedAllocations([makeAllocation({ taskId: 'PROJ-01-001', path: '/some/path' })]);

    const result = releaseWorktree(db, 'PROJ-01-001');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.path).toBe('/some/path');
  });

  test('returns not-found when no allocation exists', () => {
    const result = releaseWorktree(db, 'nonexistent');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.released).toBe(false);
    expect(result.data.path).toBeUndefined();
  });
});

describe('cleanupStaleAllocations', () => {
  test('removes allocations for tasks not in active set', () => {
    seedAllocations([
      makeAllocation({ taskId: 'T1' }),
      makeAllocation({ taskId: 'T2', workstream: 'ws-02' }),
      makeAllocation({ taskId: 'T3', workstream: 'ws-03' }),
    ]);

    const activeIds = new Set(['T1', 'T3']);
    const stale = cleanupStaleAllocations(db, activeIds);

    expect(stale).toEqual(['T2']);

    const remaining = getAllocations(db);
    expect(remaining).toHaveLength(2);
    expect(remaining.map((a) => a.taskId)).toEqual(['T1', 'T3']);
  });

  test('returns empty array when all allocations are active', () => {
    seedAllocations([makeAllocation({ taskId: 'T1' })]);

    const stale = cleanupStaleAllocations(db, new Set(['T1']));
    expect(stale).toEqual([]);
  });

  test('handles empty allocations', () => {
    const stale = cleanupStaleAllocations(db, new Set());
    expect(stale).toEqual([]);
  });
});
