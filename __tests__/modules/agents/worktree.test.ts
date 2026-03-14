import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { agentsMigrationV1, agentsMigrationV2 } from '../../../src/modules/agents/schema.js';
import {
  allocateWorktree,
  releaseWorktree,
  checkWorktreePath,
  cleanupStaleAllocations,
} from '../../../src/modules/agents/worktree.js';
import { getWorktreeAllocations } from '../../../src/modules/agents/data.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeDb(): ReturnType<typeof Database> {
  const db = new Database(':memory:');
  agentsMigrationV1.up(db);
  agentsMigrationV2.up(db);
  return db;
}

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('node:child_process', () => ({
  execFileSync: vi.fn(),
}));

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return { ...actual, existsSync: vi.fn() };
});

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';

const mockExecFileSync = execFileSync as ReturnType<typeof vi.fn>;
const mockExistsSync = existsSync as ReturnType<typeof vi.fn>;

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('worktree lifecycle', () => {
  let db: ReturnType<typeof Database>;

  beforeEach(() => {
    db = makeDb();
    vi.clearAllMocks();
    mockExecFileSync.mockReturnValue('');
    mockExistsSync.mockReturnValue(true);
  });

  afterEach(() => {
    db.close();
  });

  // ── allocateWorktree ───────────────────────────────────────────────────────

  describe('allocateWorktree', () => {
    it('creates a new worktree and saves allocation to DB', () => {
      const result = allocateWorktree(db, '/repo', {
        taskId: 'VNM-09.01',
        workstream: 'vnm-09',
        claimToken: 'tok-1',
        basePath: '.worktrees',
        budget: 3,
      });

      expect(result.reused).toBe(false);
      expect(result.branch).toBe('agent/vnm-09/VNM-09.01');
      expect(result.worktreePath).toContain('vnm-09');

      const allocs = getWorktreeAllocations(db);
      expect(allocs).toHaveLength(1);
      expect(allocs[0].task_id).toBe('VNM-09.01');
      expect(allocs[0].workstream).toBe('vnm-09');
      expect(allocs[0].branch).toBe('agent/vnm-09/VNM-09.01');
      expect(allocs[0].claim_token).toBe('tok-1');
    });

    it('calls git worktree add with correct args', () => {
      allocateWorktree(db, '/repo', {
        taskId: 'VNM-09.02',
        workstream: 'vnm-09',
        claimToken: 'tok-2',
        basePath: '.worktrees',
        budget: 3,
      });

      expect(mockExecFileSync).toHaveBeenCalledWith(
        'git',
        expect.arrayContaining(['worktree', 'add', '-b']),
        expect.objectContaining({ cwd: '/repo' })
      );
    });

    it('reuses existing worktree for same workstream', () => {
      // First allocation
      allocateWorktree(db, '/repo', {
        taskId: 'VNM-09.01',
        workstream: 'vnm-09',
        claimToken: 'tok-1',
        basePath: '.worktrees',
        budget: 3,
      });

      vi.clearAllMocks();

      // Second allocation for same workstream
      const result = allocateWorktree(db, '/repo', {
        taskId: 'VNM-09.02',
        workstream: 'vnm-09',
        claimToken: 'tok-2',
        basePath: '.worktrees',
        budget: 3,
      });

      expect(result.reused).toBe(true);
      // git worktree add should NOT be called again
      expect(mockExecFileSync).not.toHaveBeenCalled();
      // Two allocations exist (different task_ids sharing the same worktree)
      const allocs = getWorktreeAllocations(db);
      expect(allocs).toHaveLength(2);
      expect(allocs.map((a) => a.task_id)).toContain('VNM-09.01');
      expect(allocs.map((a) => a.task_id)).toContain('VNM-09.02');
      // Both share the same worktree path
      expect(allocs[0].worktree_path).toBe(allocs[1].worktree_path);
    });

    it('enforces budget — throws when limit reached', () => {
      allocateWorktree(db, '/repo', {
        taskId: 'VNM-09.01',
        workstream: 'ws-1',
        claimToken: 'tok-1',
        basePath: '.worktrees',
        budget: 2,
      });
      allocateWorktree(db, '/repo', {
        taskId: 'VNM-09.02',
        workstream: 'ws-2',
        claimToken: 'tok-2',
        basePath: '.worktrees',
        budget: 2,
      });

      expect(() =>
        allocateWorktree(db, '/repo', {
          taskId: 'VNM-09.03',
          workstream: 'ws-3',
          claimToken: 'tok-3',
          basePath: '.worktrees',
          budget: 2,
        })
      ).toThrow('Worktree budget exhausted: 2/2');
    });

    it('uses default basePath and budget when not supplied', () => {
      const result = allocateWorktree(db, '/repo', {
        taskId: 'VNM-09.01',
        workstream: 'vnm-09',
        claimToken: 'tok-1',
      });

      expect(result.worktreePath).toContain('.worktrees');
      expect(result.reused).toBe(false);
    });
  });

  // ── releaseWorktree ────────────────────────────────────────────────────────

  describe('releaseWorktree', () => {
    it('removes the allocation from DB', () => {
      allocateWorktree(db, '/repo', {
        taskId: 'VNM-09.01',
        workstream: 'vnm-09',
        claimToken: 'tok-1',
        basePath: '.worktrees',
        budget: 3,
      });

      vi.clearAllMocks();

      const released = releaseWorktree(db, '/repo', 'VNM-09.01');

      expect(released).toBe(true);
      expect(getWorktreeAllocations(db)).toHaveLength(0);
    });

    it('calls git worktree remove and git branch -D', () => {
      allocateWorktree(db, '/repo', {
        taskId: 'VNM-09.01',
        workstream: 'vnm-09',
        claimToken: 'tok-1',
        basePath: '.worktrees',
        budget: 3,
      });

      vi.clearAllMocks();
      releaseWorktree(db, '/repo', 'VNM-09.01');

      const calls = mockExecFileSync.mock.calls.map((c) => (c as string[][])[1]);
      expect(calls.some((args) => args.includes('worktree') && args.includes('remove'))).toBe(true);
      expect(calls.some((args) => args.includes('branch') && args.includes('-D'))).toBe(true);
    });

    it('force-removes worktree when normal remove fails', () => {
      allocateWorktree(db, '/repo', {
        taskId: 'VNM-09.01',
        workstream: 'vnm-09',
        claimToken: 'tok-1',
        basePath: '.worktrees',
        budget: 3,
      });

      vi.clearAllMocks();
      // First call (git worktree remove) throws; second call (--force) should succeed
      mockExecFileSync
        .mockImplementationOnce(() => {
          throw new Error('dirty');
        })
        .mockReturnValue('');

      const released = releaseWorktree(db, '/repo', 'VNM-09.01');

      expect(released).toBe(true);
      const calls = mockExecFileSync.mock.calls.map((c) => (c as string[][])[1]);
      expect(calls.some((args) => args.includes('--force'))).toBe(true);
    });

    it('returns false when task has no allocation', () => {
      const released = releaseWorktree(db, '/repo', 'no-such-task');
      expect(released).toBe(false);
      expect(mockExecFileSync).not.toHaveBeenCalled();
    });
  });

  // ── checkWorktreePath ──────────────────────────────────────────────────────

  describe('checkWorktreePath', () => {
    it('returns inWorktree true when cwd equals expected path', () => {
      const cwd = process.cwd();
      const result = checkWorktreePath(cwd);
      expect(result.inWorktree).toBe(true);
      expect(result.actual).toBe(cwd);
      expect(result.expected).toBe(cwd);
    });

    it('returns inWorktree false when cwd is outside expected path', () => {
      const result = checkWorktreePath('/some/completely/different/path');
      expect(result.inWorktree).toBe(false);
    });

    it('returns inWorktree true when cwd is nested inside expected path', () => {
      const cwd = process.cwd();
      // Parent of cwd is the expected path (cwd starts with it)
      const parentDir = cwd.substring(0, cwd.lastIndexOf('/'));
      const result = checkWorktreePath(parentDir);
      expect(result.inWorktree).toBe(true);
    });

    it('exposes expected and actual paths in result', () => {
      const result = checkWorktreePath('/tmp/worktree');
      expect(typeof result.expected).toBe('string');
      expect(typeof result.actual).toBe('string');
    });
  });

  // ── cleanupStaleAllocations ────────────────────────────────────────────────

  describe('cleanupStaleAllocations', () => {
    it('removes allocations whose paths do not exist on disk', () => {
      allocateWorktree(db, '/repo', {
        taskId: 'VNM-09.01',
        workstream: 'ws-1',
        claimToken: 'tok-1',
        basePath: '.worktrees',
        budget: 5,
      });
      allocateWorktree(db, '/repo', {
        taskId: 'VNM-09.02',
        workstream: 'ws-2',
        claimToken: 'tok-2',
        basePath: '.worktrees',
        budget: 5,
      });

      // First path exists, second does not
      mockExistsSync.mockImplementation((p: unknown) => {
        const path = p as string;
        return path.includes('ws-1');
      });

      const removed = cleanupStaleAllocations(db, '/repo');

      expect(removed).toHaveLength(1);
      expect(removed[0]).toBe('VNM-09.02');

      const remaining = getWorktreeAllocations(db);
      expect(remaining).toHaveLength(1);
      expect(remaining[0].task_id).toBe('VNM-09.01');
    });

    it('returns empty array when all allocations are still valid', () => {
      allocateWorktree(db, '/repo', {
        taskId: 'VNM-09.01',
        workstream: 'ws-1',
        claimToken: 'tok-1',
        basePath: '.worktrees',
        budget: 3,
      });

      mockExistsSync.mockReturnValue(true);

      const removed = cleanupStaleAllocations(db, '/repo');
      expect(removed).toHaveLength(0);
      expect(getWorktreeAllocations(db)).toHaveLength(1);
    });

    it('returns empty array when there are no allocations', () => {
      const removed = cleanupStaleAllocations(db, '/repo');
      expect(removed).toHaveLength(0);
    });
  });
});
