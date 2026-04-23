import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../../src/utils/db.js', () => ({
  getRawDb: vi.fn((db: unknown) => {
    if (db && typeof db === 'object' && 'rawDb' in db) return (db as Record<string, unknown>).rawDb;
    return db;
  }),
  sleep: vi.fn(() => Promise.resolve()),
}));

vi.mock('../../../src/modules/agents/data.js', () => ({
  getAgent: vi.fn(),
  findAgentByTask: vi.fn(),
  getAgentContext: vi.fn(),
}));

vi.mock('../../../src/modules/agents/delivery.js', () => ({
  getDeliveryForTask: vi.fn(),
  initiateDelivery: vi.fn(),
}));

vi.mock('../../../src/modules/agents/worktree.js', () => ({
  releaseWorktree: vi.fn(),
}));

vi.mock('../../../src/modules/agents/delivery-monitor.js', () => ({
  monitorDelivery: vi.fn(),
}));

vi.mock('../../../src/modules/pm/data/task-ops.js', () => ({
  updateTaskStatus: vi.fn(),
}));

import {
  DispatchLoop,
  type DispatchLoopPmDeps,
  type SpawnResult,
} from '../../../src/modules/agents/dispatch-loop.js';
import { findAgentByTask, getAgent, getAgentContext } from '../../../src/modules/agents/data.js';
import { getDeliveryForTask, initiateDelivery } from '../../../src/modules/agents/delivery.js';
import { releaseWorktree } from '../../../src/modules/agents/worktree.js';
import { monitorDelivery } from '../../../src/modules/agents/delivery-monitor.js';
import { updateTaskStatus } from '../../../src/modules/pm/data/task-ops.js';

const mockGetAgent = getAgent as ReturnType<typeof vi.fn>;
const mockFindAgentByTask = findAgentByTask as ReturnType<typeof vi.fn>;
const mockGetAgentContext = getAgentContext as ReturnType<typeof vi.fn>;
const mockGetDelivery = getDeliveryForTask as ReturnType<typeof vi.fn>;
const mockInitiateDelivery = initiateDelivery as ReturnType<typeof vi.fn>;
const mockReleaseWorktree = releaseWorktree as ReturnType<typeof vi.fn>;
const mockMonitorDelivery = monitorDelivery as ReturnType<typeof vi.fn>;
const mockUpdateTaskStatus = updateTaskStatus as ReturnType<typeof vi.fn>;

const fakeDb = {} as unknown;
const projectDir = '/tmp/test-project';

describe('DispatchLoop', () => {
  let spawnFn: ReturnType<typeof vi.fn<[], Promise<SpawnResult>>>;

  beforeEach(() => {
    spawnFn = vi.fn();
    mockFindAgentByTask.mockReset();
    mockGetDelivery.mockReset();
    mockGetAgentContext.mockReset();
  });

  afterEach(() => vi.restoreAllMocks());

  function makeLoop(wipLimit = 3) {
    return new DispatchLoop(fakeDb, wipLimit, spawnFn, projectDir);
  }

  describe('executeWave', () => {
    it('spawns agents, delivers, and monitors', async () => {
      spawnFn.mockResolvedValue({ agentId: 'a1', taskId: 't1', branch: 'b1' });
      mockGetAgent
        .mockReturnValueOnce({ status: 'active' })
        .mockReturnValueOnce({ status: 'completed' })
        .mockReturnValueOnce({ status: 'active' })
        .mockReturnValueOnce({ status: 'completed' });
      mockGetDelivery.mockReturnValue(null);
      const deliveryRecord = { agent_id: 'a1', task_id: 't1', branch: 'b1' };
      mockInitiateDelivery.mockReturnValue(deliveryRecord);
      mockMonitorDelivery.mockResolvedValue('merged');

      const { settled } = await makeLoop().executeWave({ wave: 1, taskIds: ['t1', 't2'] });

      expect(settled).toHaveLength(2);
      expect(settled.every((r) => r.status === 'fulfilled')).toBe(true);
      expect(spawnFn).toHaveBeenCalledTimes(2);
      expect(mockMonitorDelivery).toHaveBeenCalledTimes(2);
      expect(mockReleaseWorktree).toHaveBeenCalledTimes(2);
    });

    it('releases worktree when agent fails', async () => {
      spawnFn.mockResolvedValue({ agentId: 'a1', taskId: 't1', branch: 'b1' });
      mockGetAgent.mockReturnValue({ status: 'failed' });

      const result = await makeLoop().executeWave({ wave: 1, taskIds: ['t1'] });

      expect(mockReleaseWorktree).toHaveBeenCalledWith(fakeDb, projectDir, 't1');
      expect(mockMonitorDelivery).not.toHaveBeenCalled();
      expect(result.failedTaskIds).toEqual(['t1']);
    });

    it('reports spawn failures in failedTaskIds', async () => {
      spawnFn.mockRejectedValue(new Error('spawn failed'));

      const result = await makeLoop().executeWave({ wave: 1, taskIds: ['t1'] });

      expect(result.failedTaskIds).toEqual(['t1']);
    });

    it('reports only the failed tasks in mixed outcomes', async () => {
      spawnFn.mockImplementation(async (taskId: string) => ({
        agentId: `a-${taskId}`,
        taskId,
        branch: `b-${taskId}`,
      }));
      // First poll returns for t1, second poll returns for t2
      mockGetAgent
        .mockReturnValueOnce({ status: 'completed' })
        .mockReturnValueOnce({ status: 'failed' });
      mockGetDelivery.mockReturnValue(null);
      mockInitiateDelivery.mockReturnValue({ agent_id: 'a-t1', task_id: 't1' });
      mockMonitorDelivery.mockResolvedValue('merged');

      const result = await makeLoop(1).executeWave({ wave: 1, taskIds: ['t1', 't2'] });

      expect(result.failedTaskIds).toEqual(['t2']);
    });

    it('handles spawn failure gracefully', async () => {
      spawnFn.mockRejectedValue(new Error('spawn failed'));

      const { settled } = await makeLoop().executeWave({ wave: 1, taskIds: ['t1'] });

      expect(settled).toHaveLength(1);
      expect(settled[0].status).toBe('fulfilled');
      expect(mockGetAgent).not.toHaveBeenCalled();
    });

    it('settles all tasks even when some fail', async () => {
      spawnFn
        .mockResolvedValueOnce({ agentId: 'a1', taskId: 't1', branch: 'b1' })
        .mockRejectedValueOnce(new Error('spawn fail'));
      mockGetAgent.mockReturnValue({ status: 'completed' });
      mockGetDelivery.mockReturnValue(null);
      mockInitiateDelivery.mockReturnValue({ agent_id: 'a1', task_id: 't1' });
      mockMonitorDelivery.mockResolvedValue('merged');

      const { settled } = await makeLoop().executeWave({ wave: 1, taskIds: ['t1', 't2'] });

      expect(settled).toHaveLength(2);
      expect(settled.every((r) => r.status === 'fulfilled')).toBe(true);
    });

    it('uses existing delivery record if already pushed', async () => {
      spawnFn.mockResolvedValue({ agentId: 'a1', taskId: 't1', branch: 'b1' });
      mockGetAgent.mockReturnValueOnce({ status: 'completed' });
      const existing = { agent_id: 'a1', task_id: 't1', branch: 'b1', status: 'pr-open' };
      mockGetDelivery.mockReturnValue(existing);
      mockMonitorDelivery.mockResolvedValue('merged');

      await makeLoop().executeWave({ wave: 1, taskIds: ['t1'] });

      expect(mockInitiateDelivery).not.toHaveBeenCalled();
      expect(mockMonitorDelivery).toHaveBeenCalledWith(fakeDb, existing, projectDir);
    });

    it('respects WIP limit via semaphore', async () => {
      let concurrentCount = 0;
      let maxConcurrent = 0;

      spawnFn.mockImplementation(async (taskId: string) => {
        concurrentCount++;
        maxConcurrent = Math.max(maxConcurrent, concurrentCount);
        return { agentId: `a-${taskId}`, taskId, branch: `b-${taskId}` };
      });

      mockGetAgent.mockImplementation(() => {
        concurrentCount--;
        return { status: 'completed' };
      });

      mockGetDelivery.mockReturnValue(null);
      mockInitiateDelivery.mockImplementation((_db, agentId, taskId) => ({
        agent_id: agentId,
        task_id: taskId,
      }));
      mockMonitorDelivery.mockResolvedValue('merged');

      await makeLoop(2).executeWave({
        wave: 1,
        taskIds: ['t1', 't2', 't3', 't4'],
      });

      expect(maxConcurrent).toBeLessThanOrEqual(2);
      expect(spawnFn).toHaveBeenCalledTimes(4);
    });

    it('preserves worktree when delivery fails', async () => {
      spawnFn.mockResolvedValue({ agentId: 'a1', taskId: 't1', branch: undefined });
      mockGetAgent.mockReturnValueOnce({ status: 'completed' });
      mockGetDelivery.mockReturnValue(null);

      await makeLoop().executeWave({ wave: 1, taskIds: ['t1'] });

      // No branch → no delivery → worktree preserved (not released in deliver path)
      expect(mockMonitorDelivery).not.toHaveBeenCalled();
    });

    it('skips spawn when task already has completed agent with branch', async () => {
      mockFindAgentByTask.mockReturnValue({
        id: 'existing-a1',
        status: 'completed',
        branch: 'agent/t1',
      });
      mockGetDelivery.mockReturnValue(null);
      mockInitiateDelivery.mockReturnValue({
        agent_id: 'existing-a1',
        task_id: 't1',
        branch: 'agent/t1',
      });
      mockMonitorDelivery.mockResolvedValue('merged');

      await makeLoop().executeWave({ wave: 1, taskIds: ['t1'] });

      expect(spawnFn).not.toHaveBeenCalled();
      expect(mockInitiateDelivery).toHaveBeenCalledWith(
        fakeDb,
        'existing-a1',
        't1',
        'agent/t1',
        projectDir
      );
      expect(mockMonitorDelivery).toHaveBeenCalled();
    });

    it('skips task entirely when delivery already merged', async () => {
      mockFindAgentByTask.mockReturnValue({
        id: 'existing-a1',
        status: 'completed',
        branch: 'agent/t1',
      });
      mockGetDelivery.mockReturnValue({ status: 'merged', agent_id: 'existing-a1', task_id: 't1' });

      await makeLoop().executeWave({ wave: 1, taskIds: ['t1'] });

      expect(spawnFn).not.toHaveBeenCalled();
      expect(mockInitiateDelivery).not.toHaveBeenCalled();
      expect(mockMonitorDelivery).not.toHaveBeenCalled();
    });

    it('skips task entirely when delivery stalled', async () => {
      mockFindAgentByTask.mockReturnValue({
        id: 'existing-a1',
        status: 'completed',
        branch: 'agent/t1',
      });
      mockGetDelivery.mockReturnValue({
        status: 'stalled',
        agent_id: 'existing-a1',
        task_id: 't1',
      });

      await makeLoop().executeWave({ wave: 1, taskIds: ['t1'] });

      expect(spawnFn).not.toHaveBeenCalled();
      expect(mockInitiateDelivery).not.toHaveBeenCalled();
      expect(mockMonitorDelivery).not.toHaveBeenCalled();
    });

    it('spawns normally when prior agent failed', async () => {
      mockFindAgentByTask.mockReturnValue({ id: 'prev', status: 'failed', branch: null });
      mockGetDelivery.mockReturnValue(null);
      spawnFn.mockResolvedValue({ agentId: 'a1', taskId: 't1', branch: 'agent/t1' });
      mockGetAgent.mockReturnValue({ status: 'completed' });
      mockInitiateDelivery.mockReturnValue({ agent_id: 'a1', task_id: 't1' });
      mockMonitorDelivery.mockResolvedValue('merged');

      await makeLoop().executeWave({ wave: 1, taskIds: ['t1'] });

      expect(spawnFn).toHaveBeenCalledWith('t1');
    });

    describe('budget retry', () => {
      function stubBudgetExhausted(agentId: string, originalBudget: number) {
        mockGetAgentContext.mockImplementation((_db: unknown, id: string, key: string) => {
          if (id !== agentId) return undefined;
          if (key === 'claude_result') return { subtype: 'error_max_budget_usd' };
          if (key === 'max_budget_usd') return originalBudget;
          return undefined;
        });
      }

      it('retries with 2x budget when first agent exhausts budget', async () => {
        spawnFn
          .mockResolvedValueOnce({ agentId: 'a1', taskId: 't1', branch: 'b1' })
          .mockResolvedValueOnce({ agentId: 'a2', taskId: 't1', branch: 'b2' });
        mockGetAgent
          .mockReturnValueOnce({ status: 'failed' })
          .mockReturnValueOnce({ status: 'completed' });
        stubBudgetExhausted('a1', 5);
        mockGetDelivery.mockReturnValue(null);
        mockInitiateDelivery.mockReturnValue({ agent_id: 'a2', task_id: 't1', branch: 'b2' });
        mockMonitorDelivery.mockResolvedValue('merged');

        const result = await makeLoop().executeWave({ wave: 1, taskIds: ['t1'] });

        expect(spawnFn).toHaveBeenCalledTimes(2);
        expect(spawnFn).toHaveBeenNthCalledWith(1, 't1');
        expect(spawnFn).toHaveBeenNthCalledWith(2, 't1', { maxBudgetUsd: 10 });
        expect(result.failedTaskIds).toEqual([]);
        expect(mockMonitorDelivery).toHaveBeenCalled();
      });

      it('marks task failed when retry agent also fails', async () => {
        spawnFn
          .mockResolvedValueOnce({ agentId: 'a1', taskId: 't1', branch: 'b1' })
          .mockResolvedValueOnce({ agentId: 'a2', taskId: 't1', branch: 'b2' });
        mockGetAgent
          .mockReturnValueOnce({ status: 'failed' })
          .mockReturnValueOnce({ status: 'failed' });
        stubBudgetExhausted('a1', 5);

        const result = await makeLoop().executeWave({ wave: 1, taskIds: ['t1'] });

        expect(spawnFn).toHaveBeenCalledTimes(2);
        expect(result.failedTaskIds).toEqual(['t1']);
      });

      it('does not retry when failure is not budget-related', async () => {
        spawnFn.mockResolvedValueOnce({ agentId: 'a1', taskId: 't1', branch: 'b1' });
        mockGetAgent.mockReturnValueOnce({ status: 'failed' });
        // No claude_result subtype → wasBudgetExhausted is false
        mockGetAgentContext.mockReturnValue(undefined);

        const result = await makeLoop().executeWave({ wave: 1, taskIds: ['t1'] });

        expect(spawnFn).toHaveBeenCalledTimes(1);
        expect(result.failedTaskIds).toEqual(['t1']);
      });

      it('does not retry when original budget is missing', async () => {
        spawnFn.mockResolvedValueOnce({ agentId: 'a1', taskId: 't1', branch: 'b1' });
        mockGetAgent.mockReturnValueOnce({ status: 'failed' });
        mockGetAgentContext.mockImplementation((_db: unknown, _id: string, key: string) => {
          if (key === 'claude_result') return { subtype: 'error_max_budget_usd' };
          return undefined; // max_budget_usd missing
        });

        const result = await makeLoop().executeWave({ wave: 1, taskIds: ['t1'] });

        expect(spawnFn).toHaveBeenCalledTimes(1);
        expect(result.failedTaskIds).toEqual(['t1']);
      });

      it('marks failed when retry spawn throws', async () => {
        spawnFn
          .mockResolvedValueOnce({ agentId: 'a1', taskId: 't1', branch: 'b1' })
          .mockRejectedValueOnce(new Error('spawn boom'));
        mockGetAgent.mockReturnValueOnce({ status: 'failed' });
        stubBudgetExhausted('a1', 5);

        const result = await makeLoop().executeWave({ wave: 1, taskIds: ['t1'] });

        expect(spawnFn).toHaveBeenCalledTimes(2);
        expect(result.failedTaskIds).toEqual(['t1']);
      });
    });
  });

  describe('advanceTaskStatus', () => {
    let addInboxItem: ReturnType<typeof vi.fn>;
    let brainDb: { rawDb: unknown; addInboxItem: ReturnType<typeof vi.fn> };
    let pmDeps: DispatchLoopPmDeps;

    beforeEach(() => {
      addInboxItem = vi.fn();
      brainDb = { rawDb: fakeDb, addInboxItem };
      pmDeps = {
        brainDb: brainDb as unknown as DispatchLoopPmDeps['brainDb'],
        config: {} as DispatchLoopPmDeps['config'],
        embedder: {} as DispatchLoopPmDeps['embedder'],
      };
      mockUpdateTaskStatus.mockResolvedValue({ ok: true, data: {} });
    });

    function loopWithPmDeps() {
      return new DispatchLoop(
        brainDb as unknown as Parameters<typeof DispatchLoop.prototype.constructor>[0],
        3,
        spawnFn,
        projectDir,
        pmDeps
      );
    }

    function stubMergedDelivery(outcome: 'merged' | 'stalled' | 'redispatched') {
      spawnFn.mockResolvedValue({ agentId: 'a1', taskId: 't1', branch: 'b1' });
      mockGetAgent.mockReturnValueOnce({ status: 'completed' });
      mockGetDelivery.mockReturnValue(null);
      const record = {
        agent_id: 'a1',
        task_id: 't1',
        branch: 'b1',
        pr_url: 'https://github.com/owner/repo/pull/7',
        stall_reason: 'timeout',
      };
      mockInitiateDelivery.mockReturnValue(record);
      mockMonitorDelivery.mockResolvedValue(outcome);
      // After monitorDelivery completes, dispatch-loop refetches via getDeliveryForTask
      mockGetDelivery.mockReturnValue(record);
    }

    it('merged outcome transitions task to done', async () => {
      stubMergedDelivery('merged');
      await loopWithPmDeps().executeWave({ wave: 1, taskIds: ['t1'] });
      expect(mockUpdateTaskStatus).toHaveBeenCalledWith(
        pmDeps.brainDb,
        pmDeps.config,
        pmDeps.embedder,
        't1',
        'done'
      );
      expect(addInboxItem).not.toHaveBeenCalled();
    });

    it('stalled outcome transitions task to blocked and creates inbox item', async () => {
      stubMergedDelivery('stalled');
      await loopWithPmDeps().executeWave({ wave: 1, taskIds: ['t1'] });
      expect(mockUpdateTaskStatus).toHaveBeenCalledWith(
        pmDeps.brainDb,
        pmDeps.config,
        pmDeps.embedder,
        't1',
        'blocked'
      );
      expect(addInboxItem).toHaveBeenCalledTimes(1);
      const item = addInboxItem.mock.calls[0][0] as {
        content: string;
        source: string;
        sourceUrl: string | null;
        sourceMeta: string | null;
      };
      expect(item.source).toBe('alert');
      expect(item.content).toContain('t1');
      expect(item.content).toContain('timeout');
      expect(item.sourceUrl).toBe('https://github.com/owner/repo/pull/7');
      expect(item.sourceMeta).toContain('timeout');
    });

    it('redispatched outcome transitions task to pending', async () => {
      stubMergedDelivery('redispatched');
      await loopWithPmDeps().executeWave({ wave: 1, taskIds: ['t1'] });
      expect(mockUpdateTaskStatus).toHaveBeenCalledWith(
        pmDeps.brainDb,
        pmDeps.config,
        pmDeps.embedder,
        't1',
        'pending'
      );
      expect(addInboxItem).not.toHaveBeenCalled();
    });

    it('skips task status update when PM deps are absent', async () => {
      stubMergedDelivery('merged');
      await makeLoop().executeWave({ wave: 1, taskIds: ['t1'] });
      expect(mockUpdateTaskStatus).not.toHaveBeenCalled();
    });

    it('logs but does not throw when updateTaskStatus returns an error', async () => {
      stubMergedDelivery('stalled');
      mockUpdateTaskStatus.mockResolvedValueOnce({
        ok: false,
        error: { code: 'INVALID_TRANSITION', message: 'nope' },
      });
      await expect(
        loopWithPmDeps().executeWave({ wave: 1, taskIds: ['t1'] })
      ).resolves.toMatchObject({ settled: expect.any(Array) });
      expect(addInboxItem).toHaveBeenCalledTimes(1);
    });
  });
});
