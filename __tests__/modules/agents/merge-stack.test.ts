import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrStatus } from '../../../src/modules/agents/auto-merge.js';

vi.mock('../../../src/utils/db.js', () => ({
  getRawDb: vi.fn((db: unknown) => {
    if (db && typeof db === 'object' && 'rawDb' in db) return (db as Record<string, unknown>).rawDb;
    return db;
  }),
  sleep: vi.fn(() => Promise.resolve()),
}));

vi.mock('../../../src/modules/agents/auto-merge.js', () => ({
  getPrForBranch: vi.fn(),
  mergePr: vi.fn(),
}));

vi.mock('../../../src/modules/agents/rebase-isolation.js', () => ({
  rebaseInIsolation: vi.fn(),
}));

vi.mock('../../../src/modules/agents/fix-agent.js', () => ({
  spawnFixAgent: vi.fn(),
}));

vi.mock('../../../src/modules/agents/delivery.js', () => ({
  getDelivery: vi.fn(),
}));

import {
  mergeStack,
  sortStackByDependency,
  deliveriesToStackItems,
  type StackMergeItem,
} from '../../../src/modules/agents/merge-stack.js';
import { getPrForBranch, mergePr } from '../../../src/modules/agents/auto-merge.js';
import { rebaseInIsolation } from '../../../src/modules/agents/rebase-isolation.js';
import { spawnFixAgent } from '../../../src/modules/agents/fix-agent.js';
import { getDelivery } from '../../../src/modules/agents/delivery.js';

const mockGetPr = getPrForBranch as ReturnType<typeof vi.fn>;
const mockMergePr = mergePr as ReturnType<typeof vi.fn>;
const mockRebase = rebaseInIsolation as ReturnType<typeof vi.fn>;
const mockFixAgent = spawnFixAgent as ReturnType<typeof vi.fn>;
const mockGetDelivery = getDelivery as ReturnType<typeof vi.fn>;

function makePr(overrides: Partial<PrStatus> = {}): PrStatus {
  return {
    number: 42,
    branch: 'agent/x',
    checksPass: true,
    mergeable: true,
    state: 'open',
    failedChecks: [],
    ...overrides,
  };
}

function makeItem(overrides: Partial<StackMergeItem> = {}): StackMergeItem {
  return {
    prNumber: 42,
    branch: 'agent/x',
    taskId: 'VNM-56.01',
    agentId: 'agent-1',
    ...overrides,
  };
}

describe('merge-stack', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe('sortStackByDependency', () => {
    it('returns items in input order when no dependencies', () => {
      const items = [
        makeItem({ branch: 'a', prNumber: 1 }),
        makeItem({ branch: 'b', prNumber: 2 }),
      ];
      const sorted = sortStackByDependency(items);
      expect(sorted.map((i) => i.branch)).toEqual(['a', 'b']);
    });

    it('places dependencies before dependents', () => {
      const items = [
        makeItem({ branch: 'c', prNumber: 3, dependsOn: ['a', 'b'] }),
        makeItem({ branch: 'a', prNumber: 1 }),
        makeItem({ branch: 'b', prNumber: 2, dependsOn: ['a'] }),
      ];
      const sorted = sortStackByDependency(items);
      const indexOf = (b: string) => sorted.findIndex((i) => i.branch === b);
      expect(indexOf('a')).toBeLessThan(indexOf('b'));
      expect(indexOf('b')).toBeLessThan(indexOf('c'));
    });

    it('ignores unknown dependency branches', () => {
      const items = [makeItem({ branch: 'a', prNumber: 1, dependsOn: ['missing'] })];
      const sorted = sortStackByDependency(items);
      expect(sorted).toHaveLength(1);
      expect(sorted[0].branch).toBe('a');
    });

    it('handles cycles without infinite recursion', () => {
      const items = [
        makeItem({ branch: 'a', prNumber: 1, dependsOn: ['b'] }),
        makeItem({ branch: 'b', prNumber: 2, dependsOn: ['a'] }),
      ];
      const sorted = sortStackByDependency(items);
      expect(sorted).toHaveLength(2);
    });
  });

  describe('mergeStack', () => {
    it('merges all PRs sequentially on the happy path', async () => {
      mockRebase.mockResolvedValue(true);
      mockGetPr.mockReturnValue(makePr());
      mockMergePr.mockReturnValue({ taskId: '', prNumber: 42, merged: true });

      const items = [
        makeItem({ branch: 'a', prNumber: 1 }),
        makeItem({ branch: 'b', prNumber: 2 }),
      ];
      const result = await mergeStack(null, items, { projectDir: '/repo' });

      expect(result.merged).toBe(2);
      expect(result.stopped).toBe(false);
      expect(result.items.every((i) => i.outcome === 'merged')).toBe(true);
      expect(mockRebase).toHaveBeenCalledTimes(2);
      expect(mockMergePr).toHaveBeenCalledTimes(2);
    });

    it('rebases each branch in dependency order before merging', async () => {
      mockRebase.mockResolvedValue(true);
      mockGetPr.mockReturnValue(makePr());
      mockMergePr.mockReturnValue({ taskId: '', prNumber: 0, merged: true });

      const items = [
        makeItem({ branch: 'child', prNumber: 2, dependsOn: ['parent'] }),
        makeItem({ branch: 'parent', prNumber: 1 }),
      ];
      await mergeStack(null, items, { projectDir: '/repo' });

      expect(mockRebase.mock.calls[0][0]).toBe('parent');
      expect(mockRebase.mock.calls[1][0]).toBe('child');
    });

    it('uses the configured merge strategy', async () => {
      mockRebase.mockResolvedValue(true);
      mockGetPr.mockReturnValue(makePr());
      mockMergePr.mockReturnValue({ taskId: '', prNumber: 42, merged: true });

      await mergeStack(null, [makeItem()], {
        projectDir: '/repo',
        strategy: 'rebase',
      });

      expect(mockMergePr).toHaveBeenCalledWith(
        42,
        expect.objectContaining({ strategy: 'rebase', projectDir: '/repo' })
      );
    });

    it('stops the stack when CI fails and stopOnCiFailure is true', async () => {
      mockRebase.mockResolvedValue(true);
      mockGetPr
        .mockReturnValueOnce(makePr({ checksPass: false, failedChecks: ['unit-tests'] }))
        .mockReturnValue(makePr());
      mockMergePr.mockReturnValue({ taskId: '', prNumber: 0, merged: true });

      const items = [
        makeItem({ branch: 'a', prNumber: 1 }),
        makeItem({ branch: 'b', prNumber: 2 }),
      ];
      const result = await mergeStack(null, items, { projectDir: '/repo' });

      expect(result.merged).toBe(0);
      expect(result.stopped).toBe(true);
      expect(result.stopReason).toContain('unit-tests');
      expect(result.items[0].outcome).toBe('ci-failed');
      expect(result.items[1].outcome).toBe('skipped');
      expect(mockMergePr).not.toHaveBeenCalled();
    });

    it('continues past CI failure when stopOnCiFailure is false', async () => {
      mockRebase.mockResolvedValue(true);
      mockGetPr
        .mockReturnValueOnce(makePr({ checksPass: false, failedChecks: ['x'] }))
        .mockReturnValueOnce(makePr());
      mockMergePr.mockReturnValue({ taskId: '', prNumber: 2, merged: true });

      const items = [
        makeItem({ branch: 'a', prNumber: 1 }),
        makeItem({ branch: 'b', prNumber: 2 }),
      ];
      const result = await mergeStack(null, items, {
        projectDir: '/repo',
        stopOnCiFailure: false,
      });

      expect(result.stopped).toBe(false);
      expect(result.items[0].outcome).toBe('ci-failed');
      expect(result.items[1].outcome).toBe('merged');
    });

    it('flags conflicts when onConflict is flag (default)', async () => {
      mockRebase.mockResolvedValue(false); // rebase fails → conflict
      mockGetPr.mockReturnValue(makePr());

      const result = await mergeStack(null, [makeItem()], { projectDir: '/repo' });

      expect(result.items[0].outcome).toBe('conflicted-flagged');
      expect(result.items[0].error).toContain('flagged');
      expect(mockMergePr).not.toHaveBeenCalled();
    });

    it('aborts the stack when onConflict is abort', async () => {
      mockRebase.mockResolvedValue(false);
      mockGetPr.mockReturnValue(makePr());

      const items = [
        makeItem({ branch: 'a', prNumber: 1 }),
        makeItem({ branch: 'b', prNumber: 2 }),
      ];
      const result = await mergeStack(null, items, {
        projectDir: '/repo',
        onConflict: 'abort',
      });

      expect(result.stopped).toBe(true);
      expect(result.items[1].outcome).toBe('skipped');
    });

    it('spawns a fix agent when onConflict is fix-agent and proceeds after success', async () => {
      const fakeDb = {
        rawDb: {} as unknown,
      };
      mockRebase.mockResolvedValue(false); // triggers conflict handler
      mockGetDelivery.mockReturnValue({ agent_id: 'agent-1', branch: 'a', pr_number: 1 });
      mockFixAgent.mockResolvedValue(true);
      mockGetPr.mockReturnValue(makePr());
      mockMergePr.mockReturnValue({ taskId: '', prNumber: 1, merged: true });

      const result = await mergeStack(
        fakeDb as unknown as Parameters<typeof mergeStack>[0],
        [makeItem({ branch: 'a', prNumber: 1 })],
        { projectDir: '/repo', onConflict: 'fix-agent' }
      );

      expect(mockFixAgent).toHaveBeenCalled();
      expect(result.items[0].outcome).toBe('merged');
    });

    it('flags when fix-agent is requested but no db is provided', async () => {
      mockRebase.mockResolvedValue(false);
      mockGetPr.mockReturnValue(makePr());

      const result = await mergeStack(null, [makeItem()], {
        projectDir: '/repo',
        onConflict: 'fix-agent',
      });

      expect(result.items[0].outcome).toBe('conflicted-flagged');
      expect(mockFixAgent).not.toHaveBeenCalled();
    });

    it('returns timeout when CI never resolves', async () => {
      mockRebase.mockResolvedValue(true);
      // PR open with no failed checks and no pass — pending forever
      mockGetPr.mockReturnValue(makePr({ checksPass: false, failedChecks: [], state: 'open' }));

      const result = await mergeStack(null, [makeItem()], {
        projectDir: '/repo',
        ciPollInterval: 1,
        ciMaxWait: 0, // deadline already passed
      });

      expect(result.items[0].outcome).toBe('timeout');
      expect(mockMergePr).not.toHaveBeenCalled();
    });

    it('treats already-merged PRs as merged without calling mergePr', async () => {
      mockRebase.mockResolvedValue(true);
      mockGetPr.mockReturnValue(makePr({ state: 'merged' }));

      const result = await mergeStack(null, [makeItem()], { projectDir: '/repo' });

      expect(result.items[0].outcome).toBe('merged');
      expect(mockMergePr).not.toHaveBeenCalled();
    });

    it('reports merge failure as conflicted-flagged', async () => {
      mockRebase.mockResolvedValue(true);
      mockGetPr.mockReturnValue(makePr());
      mockMergePr.mockReturnValue({
        taskId: '',
        prNumber: 42,
        merged: false,
        error: 'gh: rate limited',
      });

      const result = await mergeStack(null, [makeItem()], { projectDir: '/repo' });

      expect(result.items[0].outcome).toBe('conflicted-flagged');
      expect(result.items[0].error).toContain('rate limited');
    });

    it('flags when PR is open but not mergeable after CI green', async () => {
      mockRebase.mockResolvedValue(true);
      mockGetPr.mockReturnValue(makePr({ mergeable: false }));

      const result = await mergeStack(null, [makeItem()], { projectDir: '/repo' });

      expect(result.items[0].outcome).toBe('conflicted-flagged');
      expect(mockMergePr).not.toHaveBeenCalled();
    });
  });

  describe('deliveriesToStackItems', () => {
    it('filters out deliveries without PR number or branch', () => {
      const deliveries = [
        {
          agent_id: 'a',
          task_id: 't1',
          branch: 'b1',
          pr_number: 1,
          status: 'pr-open',
        },
        {
          agent_id: 'b',
          task_id: 't2',
          branch: null,
          pr_number: 2,
          status: 'pr-open',
        },
        {
          agent_id: 'c',
          task_id: 't3',
          branch: 'b3',
          pr_number: null,
          status: 'pushed',
        },
      ];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const items = deliveriesToStackItems(deliveries as any);
      expect(items).toHaveLength(1);
      expect(items[0].prNumber).toBe(1);
      expect(items[0].agentId).toBe('a');
    });
  });
});
