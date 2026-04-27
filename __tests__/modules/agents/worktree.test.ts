import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import {
  agentsMigrationV1,
  agentsMigrationV2,
  agentsMigrationV3,
  agentsMigrationV4,
} from '../../../src/modules/agents/schema.js';
import {
  allocateWorktree,
  releaseWorktree,
  checkWorktreePath,
  cleanupStaleAllocations,
  cleanupOrphanRemoteBranches,
  reclaimTerminatedAllocations,
  WorktreeBudgetExhaustedError,
} from '../../../src/modules/agents/worktree.js';
import {
  createAgent,
  getWorktreeAllocations,
  updateAgentStatus,
} from '../../../src/modules/agents/data.js';
import { recordDelivery } from '../../../src/modules/agents/delivery.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeDb(): ReturnType<typeof Database> {
  const db = new Database(':memory:');
  agentsMigrationV1.up(db);
  agentsMigrationV2.up(db);
  agentsMigrationV3.up(db);
  agentsMigrationV4.up(db);
  return db;
}

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('node:child_process', () => ({
  execFileSync: vi.fn(),
}));

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return { ...actual, existsSync: vi.fn(), cpSync: vi.fn() };
});

import { execFileSync } from 'node:child_process';
import { existsSync, cpSync } from 'node:fs';

const mockExecFileSync = execFileSync as ReturnType<typeof vi.fn>;
const mockExistsSync = existsSync as ReturnType<typeof vi.fn>;
const mockCpSync = cpSync as ReturnType<typeof vi.fn>;

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
      expect(result.worktreePath).toContain('VNM-09.01');

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

    it('gives each task its own isolated worktree path (no reuse)', () => {
      // First allocation
      allocateWorktree(db, '/repo', {
        taskId: 'VNM-09.01',
        workstream: 'vnm-09',
        claimToken: 'tok-1',
        basePath: '.worktrees',
        budget: 3,
      });

      // Second allocation for same workstream
      const result = allocateWorktree(db, '/repo', {
        taskId: 'VNM-09.02',
        workstream: 'vnm-09',
        claimToken: 'tok-2',
        basePath: '.worktrees',
        budget: 3,
      });

      expect(result.reused).toBe(false);
      expect(result.worktreePath).toContain('VNM-09.02');
      // Two allocations exist, each with its own unique worktree path
      const allocs = getWorktreeAllocations(db);
      expect(allocs).toHaveLength(2);
      expect(allocs.map((a) => a.task_id)).toContain('VNM-09.01');
      expect(allocs.map((a) => a.task_id)).toContain('VNM-09.02');
      // Each task has its own path
      expect(allocs[0].worktree_path).not.toBe(allocs[1].worktree_path);
    });

    it('cleans up stale DB records before checking budget', () => {
      // First allocation creates a worktree
      allocateWorktree(db, '/repo', {
        taskId: 'VNM-09.01',
        workstream: 'vnm-09',
        claimToken: 'tok-1',
        basePath: '.worktrees',
        budget: 1,
      });

      vi.clearAllMocks();
      // Simulate the worktree directory being deleted externally — stale record
      mockExistsSync.mockReturnValue(false);

      // Budget is 1, but after cleanup the stale record is removed, so allocation succeeds
      const result = allocateWorktree(db, '/repo', {
        taskId: 'VNM-09.02',
        workstream: 'vnm-09',
        claimToken: 'tok-2',
        basePath: '.worktrees',
        budget: 1,
      });

      expect(result.reused).toBe(false);
      expect(result.worktreePath).toContain('VNM-09.02');
      // Stale record for VNM-09.01 should be gone, only VNM-09.02 remains
      const allocs = getWorktreeAllocations(db);
      expect(allocs).toHaveLength(1);
      expect(allocs[0].task_id).toBe('VNM-09.02');
    });

    it('enforces budget — throws WorktreeBudgetExhaustedError when limit reached', () => {
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
      ).toThrow(WorktreeBudgetExhaustedError);
    });

    it('reclaims terminated agents before counting budget', () => {
      // First allocation: agent will reach terminal state
      allocateWorktree(db, '/repo', {
        taskId: 'VNM-09.01',
        workstream: 'ws-1',
        claimToken: 'tok-1',
        basePath: '.worktrees',
        budget: 1,
      });
      const agentId = createAgent(db, {
        name: 'agent-1',
        parent: 'test',
        brain_task: 'VNM-09.01',
      });
      // Use an old completed_at so the reclaim grace window does not block.
      updateAgentStatus(db, agentId, 'completed', {
        completed_at: '2020-01-01T00:00:00.000Z',
      });

      vi.clearAllMocks();
      mockExistsSync.mockReturnValue(true);

      // Budget is 1; allocation succeeds because the prior agent is reclaimed
      const result = allocateWorktree(db, '/repo', {
        taskId: 'VNM-09.02',
        workstream: 'ws-2',
        claimToken: 'tok-2',
        basePath: '.worktrees',
        budget: 1,
      });

      expect(result.worktreePath).toContain('VNM-09.02');
      const allocs = getWorktreeAllocations(db);
      expect(allocs).toHaveLength(1);
      expect(allocs[0].task_id).toBe('VNM-09.02');
    });

    it('throws when workstream is empty', () => {
      expect(() =>
        allocateWorktree(db, '/repo', {
          taskId: 'VNM-09.01',
          workstream: '',
          claimToken: 'tok-1',
        })
      ).toThrow('workstream is empty');
    });

    it('copies .claude directory into worktree for hook discovery', () => {
      // .claude exists in project root, does not exist in worktree yet
      mockExistsSync.mockImplementation((p: unknown) => {
        const path = p as string;
        if (path === '/repo/.claude') return true;
        if (path.endsWith('.claude')) return false;
        return true;
      });

      allocateWorktree(db, '/repo', {
        taskId: 'VNM-09.05',
        workstream: 'vnm-09',
        claimToken: 'tok-5',
        budget: 3,
      });

      expect(mockCpSync).toHaveBeenCalledWith('/repo/.claude', expect.stringContaining('.claude'), {
        recursive: true,
      });
    });

    it('skips .claude copy when source does not exist', () => {
      mockExistsSync.mockImplementation((p: unknown) => {
        const path = p as string;
        if (path.endsWith('.claude')) return false;
        return true;
      });

      allocateWorktree(db, '/repo', {
        taskId: 'VNM-09.06',
        workstream: 'vnm-09',
        claimToken: 'tok-6',
        budget: 3,
      });

      expect(mockCpSync).not.toHaveBeenCalled();
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

      // First path (VNM-09.01) exists, second (VNM-09.02) does not
      mockExistsSync.mockImplementation((p: unknown) => {
        const path = p as string;
        return path.includes('VNM-09.01');
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

  // ── reclaimTerminatedAllocations ───────────────────────────────────────────

  describe('reclaimTerminatedAllocations', () => {
    // Past the 120s grace window — bypasses the reclaim deferral guard so
    // tests that just check terminal-status semantics aren't affected.
    const OLD_TIMESTAMP = '2020-01-01T00:00:00.000Z';

    function allocateAndAttachAgent(taskId: string, status: 'completed' | 'failed' | 'abandoned') {
      allocateWorktree(db, '/repo', {
        taskId,
        workstream: 'ws-x',
        claimToken: `tok-${taskId}`,
        basePath: '.worktrees',
        budget: 5,
      });
      const agentId = createAgent(db, {
        name: `agent-${taskId}`,
        parent: 'test',
        brain_task: taskId,
      });
      updateAgentStatus(db, agentId, status, { completed_at: OLD_TIMESTAMP });
      return agentId;
    }

    it('reclaims allocations whose agents are completed/failed/abandoned', () => {
      // Allocate all three first (no agents yet, so no cascading reclaim)
      for (const id of ['VNM-09.01', 'VNM-09.02', 'VNM-09.03']) {
        allocateWorktree(db, '/repo', {
          taskId: id,
          workstream: 'ws-x',
          claimToken: `tok-${id}`,
          basePath: '.worktrees',
          budget: 5,
        });
      }
      const statuses: Array<'completed' | 'failed' | 'abandoned'> = [
        'completed',
        'failed',
        'abandoned',
      ];
      ['VNM-09.01', 'VNM-09.02', 'VNM-09.03'].forEach((id, i) => {
        const agentId = createAgent(db, { name: `a-${id}`, parent: 't', brain_task: id });
        updateAgentStatus(db, agentId, statuses[i], { completed_at: OLD_TIMESTAMP });
      });

      vi.clearAllMocks();
      mockExistsSync.mockReturnValue(true);

      const reclaimed = reclaimTerminatedAllocations(db, '/repo');
      expect(reclaimed.sort()).toEqual(['VNM-09.01', 'VNM-09.02', 'VNM-09.03']);
      expect(getWorktreeAllocations(db)).toHaveLength(0);
    });

    it('preserves allocations whose agents are still active or pending', () => {
      allocateWorktree(db, '/repo', {
        taskId: 'VNM-09.01',
        workstream: 'ws-1',
        claimToken: 'tok-1',
        basePath: '.worktrees',
        budget: 5,
      });
      const agentId = createAgent(db, {
        name: 'agent-1',
        parent: 'test',
        brain_task: 'VNM-09.01',
      });
      updateAgentStatus(db, agentId, 'active');

      vi.clearAllMocks();
      mockExistsSync.mockReturnValue(true);

      const reclaimed = reclaimTerminatedAllocations(db, '/repo');
      expect(reclaimed).toHaveLength(0);
      expect(getWorktreeAllocations(db)).toHaveLength(1);
    });

    it('preserves allocations whose owning agent has no record', () => {
      allocateWorktree(db, '/repo', {
        taskId: 'VNM-09.01',
        workstream: 'ws-1',
        claimToken: 'tok-1',
        basePath: '.worktrees',
        budget: 5,
      });

      vi.clearAllMocks();
      mockExistsSync.mockReturnValue(true);

      const reclaimed = reclaimTerminatedAllocations(db, '/repo');
      expect(reclaimed).toHaveLength(0);
      expect(getWorktreeAllocations(db)).toHaveLength(1);
    });

    it('preserves allocations whose delivery is still in flight', () => {
      const agentId = allocateAndAttachAgent('VNM-09.01', 'completed');
      recordDelivery(db, agentId, {
        status: 'pr-open',
        task_id: 'VNM-09.01',
        branch: 'agent/ws-x/VNM-09.01',
      });

      vi.clearAllMocks();
      mockExistsSync.mockReturnValue(true);

      const reclaimed = reclaimTerminatedAllocations(db, '/repo');
      expect(reclaimed).toHaveLength(0);
      expect(getWorktreeAllocations(db)).toHaveLength(1);
    });

    it('reclaims allocations whose delivery has finalized', () => {
      const agentId = allocateAndAttachAgent('VNM-09.01', 'completed');
      recordDelivery(db, agentId, {
        status: 'merged',
        task_id: 'VNM-09.01',
        branch: 'agent/ws-x/VNM-09.01',
      });

      vi.clearAllMocks();
      mockExistsSync.mockReturnValue(true);

      const reclaimed = reclaimTerminatedAllocations(db, '/repo');
      expect(reclaimed).toEqual(['VNM-09.01']);
      expect(getWorktreeAllocations(db)).toHaveLength(0);
    });

    it('defers reclaim within 120s grace window when no delivery exists', () => {
      // Agent finished moments ago with no delivery row yet — orphan-recovery
      // may still be running. Reconciler must not race-delete the branch.
      allocateWorktree(db, '/repo', {
        taskId: 'VNM-09.01',
        workstream: 'ws-1',
        claimToken: 'tok-1',
        basePath: '.worktrees',
        budget: 5,
      });
      const agentId = createAgent(db, {
        name: 'a-1',
        parent: 't',
        brain_task: 'VNM-09.01',
      });
      const recent = new Date(Date.now() - 30_000).toISOString();
      updateAgentStatus(db, agentId, 'completed', { completed_at: recent });

      vi.clearAllMocks();
      mockExistsSync.mockReturnValue(true);

      const reclaimed = reclaimTerminatedAllocations(db, '/repo');
      expect(reclaimed).toHaveLength(0);
      expect(getWorktreeAllocations(db)).toHaveLength(1);
    });

    it('reclaims after grace window expires', () => {
      allocateWorktree(db, '/repo', {
        taskId: 'VNM-09.01',
        workstream: 'ws-1',
        claimToken: 'tok-1',
        basePath: '.worktrees',
        budget: 5,
      });
      const agentId = createAgent(db, {
        name: 'a-1',
        parent: 't',
        brain_task: 'VNM-09.01',
      });
      const expired = new Date(Date.now() - 200_000).toISOString();
      updateAgentStatus(db, agentId, 'completed', { completed_at: expired });

      vi.clearAllMocks();
      mockExistsSync.mockReturnValue(true);

      const reclaimed = reclaimTerminatedAllocations(db, '/repo');
      expect(reclaimed).toEqual(['VNM-09.01']);
      expect(getWorktreeAllocations(db)).toHaveLength(0);
    });

    it('grace window does not apply once delivery row exists', () => {
      // Once orphan-recovery (or any caller) creates a delivery row, reclaim
      // semantics are governed by ACTIVE_DELIVERY_STATUSES, not the timer.
      const agentId = allocateAndAttachAgent('VNM-09.01', 'completed');
      // Override to a recent completed_at — grace-eligible — but with a
      // finalized delivery, so reclaim still proceeds.
      const recent = new Date(Date.now() - 5_000).toISOString();
      updateAgentStatus(db, agentId, 'completed', { completed_at: recent });
      recordDelivery(db, agentId, {
        status: 'merged',
        task_id: 'VNM-09.01',
        branch: 'agent/ws-x/VNM-09.01',
      });

      vi.clearAllMocks();
      mockExistsSync.mockReturnValue(true);

      const reclaimed = reclaimTerminatedAllocations(db, '/repo');
      expect(reclaimed).toEqual(['VNM-09.01']);
      expect(getWorktreeAllocations(db)).toHaveLength(0);
    });
  });

  // ── cleanupOrphanRemoteBranches ────────────────────────────────────────────

  describe('cleanupOrphanRemoteBranches', () => {
    function mockGitBranches(branches: string[]): void {
      mockExecFileSync.mockImplementation((_cmd: unknown, args: unknown) => {
        const argv = args as string[];
        if (argv[0] === 'for-each-ref') {
          return branches.map((b) => `origin/${b}`).join('\n') + '\n';
        }
        return '';
      });
    }

    it('returns empty array when no remote agent branches exist', () => {
      mockGitBranches([]);
      const reports = cleanupOrphanRemoteBranches(db, '/repo');
      expect(reports).toHaveLength(0);
    });

    it('deletes branches with no open PR and no active allocation', () => {
      const branches = ['agent/VNM-56/VNM-56.01', 'agent/VNM-56/VNM-56.02'];
      mockExecFileSync.mockImplementation((cmd: unknown, args: unknown) => {
        const argv = args as string[];
        if (cmd === 'git' && argv[0] === 'for-each-ref') {
          return branches.map((b) => `origin/${b}`).join('\n') + '\n';
        }
        if (cmd === 'gh' && argv[0] === 'pr' && argv[1] === 'list') {
          return '[]';
        }
        return '';
      });

      const reports = cleanupOrphanRemoteBranches(db, '/repo');
      expect(reports).toHaveLength(2);
      expect(reports.every((r) => r.deleted)).toBe(true);

      const deleteCalls = mockExecFileSync.mock.calls.filter((c) => {
        const argv = (c as unknown[])[1] as string[];
        return argv.includes('push') && argv.includes('--delete');
      });
      expect(deleteCalls).toHaveLength(2);
    });

    it('preserves branches with an open PR', () => {
      mockExecFileSync.mockImplementation((cmd: unknown, args: unknown) => {
        const argv = args as string[];
        if (cmd === 'git' && argv[0] === 'for-each-ref') {
          return 'origin/agent/VNM-56/VNM-56.01\n';
        }
        if (cmd === 'gh' && argv[0] === 'pr') {
          return JSON.stringify([{ number: 123 }]);
        }
        return '';
      });

      const reports = cleanupOrphanRemoteBranches(db, '/repo');
      expect(reports).toHaveLength(1);
      expect(reports[0].hasOpenPR).toBe(true);
      expect(reports[0].deleted).toBe(false);
    });

    it('preserves branches with an active allocation', () => {
      allocateWorktree(db, '/repo', {
        taskId: 'VNM-56.01',
        workstream: 'VNM-56',
        claimToken: 'tok-1',
        basePath: '.worktrees',
        budget: 3,
      });
      vi.clearAllMocks();

      mockExecFileSync.mockImplementation((cmd: unknown, args: unknown) => {
        const argv = args as string[];
        if (cmd === 'git' && argv[0] === 'for-each-ref') {
          return 'origin/agent/VNM-56/VNM-56.01\n';
        }
        if (cmd === 'gh') {
          return '[]';
        }
        return '';
      });

      const reports = cleanupOrphanRemoteBranches(db, '/repo');
      expect(reports).toHaveLength(1);
      expect(reports[0].hasActiveAgent).toBe(true);
      expect(reports[0].deleted).toBe(false);

      const deleteCalls = mockExecFileSync.mock.calls.filter((c) => {
        const argv = (c as unknown[])[1] as string[];
        return argv.includes('push') && argv.includes('--delete');
      });
      expect(deleteCalls).toHaveLength(0);
    });

    it('skips deletion in dry-run mode', () => {
      mockExecFileSync.mockImplementation((cmd: unknown, args: unknown) => {
        const argv = args as string[];
        if (cmd === 'git' && argv[0] === 'for-each-ref') {
          return 'origin/agent/VNM-56/VNM-56.01\n';
        }
        if (cmd === 'gh') return '[]';
        return '';
      });

      const reports = cleanupOrphanRemoteBranches(db, '/repo', { dryRun: true });
      expect(reports).toHaveLength(1);
      expect(reports[0].deleted).toBe(false);
      expect(reports[0].hasOpenPR).toBe(false);
      expect(reports[0].hasActiveAgent).toBe(false);

      const deleteCalls = mockExecFileSync.mock.calls.filter((c) => {
        const argv = (c as unknown[])[1] as string[];
        return argv.includes('push') && argv.includes('--delete');
      });
      expect(deleteCalls).toHaveLength(0);
    });

    it('scopes scan to workstream when provided', () => {
      mockExecFileSync.mockImplementation((cmd: unknown, args: unknown) => {
        const argv = args as string[];
        if (cmd === 'git' && argv[0] === 'for-each-ref') {
          expect(argv[1]).toBe('refs/remotes/origin/agent/VNM-56/');
          return '';
        }
        return '';
      });

      cleanupOrphanRemoteBranches(db, '/repo', { workstream: 'VNM-56' });
    });

    it('assumes PR exists when gh command fails (safer default)', () => {
      mockExecFileSync.mockImplementation((cmd: unknown, args: unknown) => {
        const argv = args as string[];
        if (cmd === 'git' && argv[0] === 'for-each-ref') {
          return 'origin/agent/VNM-56/VNM-56.01\n';
        }
        if (cmd === 'gh') {
          throw new Error('gh not found');
        }
        return '';
      });

      const reports = cleanupOrphanRemoteBranches(db, '/repo');
      expect(reports[0].hasOpenPR).toBe(true);
      expect(reports[0].deleted).toBe(false);
    });

    it('marks branch as not deleted when git push fails', () => {
      mockExecFileSync.mockImplementation((cmd: unknown, args: unknown) => {
        const argv = args as string[];
        if (cmd === 'git' && argv[0] === 'for-each-ref') {
          return 'origin/agent/VNM-56/VNM-56.01\n';
        }
        if (cmd === 'gh') return '[]';
        if (cmd === 'git' && argv[0] === 'push') {
          throw new Error('remote rejected');
        }
        return '';
      });

      const reports = cleanupOrphanRemoteBranches(db, '/repo');
      expect(reports[0].deleted).toBe(false);
      expect(reports[0].hasOpenPR).toBe(false);
      expect(reports[0].hasActiveAgent).toBe(false);
    });
  });
});
