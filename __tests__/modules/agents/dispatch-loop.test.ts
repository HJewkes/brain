import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../../src/utils/db.js', () => ({
  getRawDb: vi.fn((db: unknown) => {
    if (db && typeof db === 'object' && 'rawDb' in db) return (db as Record<string, unknown>).rawDb;
    return db;
  }),
  sleep: vi.fn(() => Promise.resolve()),
}));

vi.mock('../../../src/modules/agents/data.js', () => ({
  countActiveAgents: vi.fn(),
  getAgent: vi.fn(),
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

import {
  checkDispatchConcurrency,
  DispatchLoop,
  type SpawnResult,
} from '../../../src/modules/agents/dispatch-loop.js';
import { countActiveAgents, getAgent } from '../../../src/modules/agents/data.js';
import { getDeliveryForTask, initiateDelivery } from '../../../src/modules/agents/delivery.js';
import { releaseWorktree } from '../../../src/modules/agents/worktree.js';
import { monitorDelivery } from '../../../src/modules/agents/delivery-monitor.js';

const mockCountActive = countActiveAgents as ReturnType<typeof vi.fn>;
const mockGetAgent = getAgent as ReturnType<typeof vi.fn>;
const mockGetDelivery = getDeliveryForTask as ReturnType<typeof vi.fn>;
const mockInitiateDelivery = initiateDelivery as ReturnType<typeof vi.fn>;
const mockReleaseWorktree = releaseWorktree as ReturnType<typeof vi.fn>;
const mockMonitorDelivery = monitorDelivery as ReturnType<typeof vi.fn>;

const fakeDb = {} as unknown;
const projectDir = '/tmp/test-project';

function makeBackpressure(effectiveWip = 3) {
  return {
    computeEffectiveWip: vi.fn(() => ({ effectiveWip, reason: 'nominal' })),
    recordMerge: vi.fn(),
    recordStall: vi.fn(),
    setMergeQueueDepth: vi.fn(),
    getState: vi.fn(),
  };
}

describe('checkDispatchConcurrency', () => {
  afterEach(() => vi.restoreAllMocks());

  it('allows dispatch when active < WIP limit', () => {
    mockCountActive.mockReturnValue(1);
    const bp = makeBackpressure(3);
    const result = checkDispatchConcurrency(fakeDb, bp as unknown);
    expect(result).toEqual({ allowed: true, reason: 'nominal' });
  });

  it('blocks dispatch when active >= WIP limit', () => {
    mockCountActive.mockReturnValue(3);
    const bp = makeBackpressure(3);
    const result = checkDispatchConcurrency(fakeDb, bp as unknown);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('WIP limit');
  });
});

describe('DispatchLoop', () => {
  let bp: ReturnType<typeof makeBackpressure>;
  let spawnFn: ReturnType<typeof vi.fn<[], Promise<SpawnResult>>>;

  beforeEach(() => {
    bp = makeBackpressure(3);
    spawnFn = vi.fn();
    // Default: WIP slot available
    mockCountActive.mockReturnValue(0);
  });

  afterEach(() => vi.restoreAllMocks());

  function makeLoop() {
    return new DispatchLoop(fakeDb, bp as unknown, spawnFn, projectDir);
  }

  describe('dispatchAndDeliver', () => {
    it('spawns agent, waits for completion, initiates delivery, monitors', async () => {
      spawnFn.mockResolvedValue({ agentId: 'a1', taskId: 't1', branch: 'b1' });
      mockGetAgent
        .mockReturnValueOnce({ status: 'active' })
        .mockReturnValueOnce({ status: 'completed' });
      mockGetDelivery.mockReturnValue(null);
      const deliveryRecord = { agent_id: 'a1', task_id: 't1', branch: 'b1' };
      mockInitiateDelivery.mockReturnValue(deliveryRecord);
      mockMonitorDelivery.mockResolvedValue('merged');

      await makeLoop().dispatchAndDeliver('t1');

      expect(spawnFn).toHaveBeenCalledWith('t1');
      expect(mockInitiateDelivery).toHaveBeenCalledWith(fakeDb, 'a1', 't1', 'b1', projectDir);
      expect(mockReleaseWorktree).toHaveBeenCalledWith(fakeDb, projectDir, 't1');
      expect(mockMonitorDelivery).toHaveBeenCalledWith(fakeDb, deliveryRecord, projectDir);
    });

    it('releases worktree and returns early when agent fails', async () => {
      spawnFn.mockResolvedValue({ agentId: 'a1', taskId: 't1', branch: 'b1' });
      mockGetAgent.mockReturnValue({ status: 'failed' });

      await makeLoop().dispatchAndDeliver('t1');

      expect(mockReleaseWorktree).toHaveBeenCalledWith(fakeDb, projectDir, 't1');
      expect(mockMonitorDelivery).not.toHaveBeenCalled();
    });

    it('handles spawn failure gracefully', async () => {
      spawnFn.mockRejectedValue(new Error('spawn failed'));

      // Should not throw
      await makeLoop().dispatchAndDeliver('t1');

      expect(mockGetAgent).not.toHaveBeenCalled();
      expect(mockMonitorDelivery).not.toHaveBeenCalled();
    });

    it('uses existing delivery record if agent-done hook already pushed', async () => {
      spawnFn.mockResolvedValue({ agentId: 'a1', taskId: 't1', branch: 'b1' });
      mockGetAgent.mockReturnValueOnce({ status: 'completed' });
      const existing = { agent_id: 'a1', task_id: 't1', branch: 'b1', status: 'pr-open' };
      mockGetDelivery.mockReturnValue(existing);
      mockMonitorDelivery.mockResolvedValue('merged');

      await makeLoop().dispatchAndDeliver('t1');

      expect(mockInitiateDelivery).not.toHaveBeenCalled();
      expect(mockMonitorDelivery).toHaveBeenCalledWith(fakeDb, existing, projectDir);
    });

    it('retries delivery when existing record has push-failed status', async () => {
      spawnFn.mockResolvedValue({ agentId: 'a1', taskId: 't1', branch: 'b1' });
      mockGetAgent.mockReturnValueOnce({ status: 'completed' });
      mockGetDelivery.mockReturnValue({
        agent_id: 'a1',
        task_id: 't1',
        branch: 'b1',
        status: 'push-failed',
      });
      const retried = { agent_id: 'a1', task_id: 't1', branch: 'b1', status: 'pr-open' };
      mockInitiateDelivery.mockReturnValue(retried);
      mockMonitorDelivery.mockResolvedValue('merged');

      await makeLoop().dispatchAndDeliver('t1');

      expect(mockInitiateDelivery).toHaveBeenCalledWith(fakeDb, 'a1', 't1', 'b1', projectDir);
      expect(mockMonitorDelivery).toHaveBeenCalledWith(fakeDb, retried, projectDir);
    });

    it('skips monitoring when no branch and no existing delivery', async () => {
      spawnFn.mockResolvedValue({ agentId: 'a1', taskId: 't1', branch: undefined });
      mockGetAgent.mockReturnValueOnce({ status: 'completed' });
      mockGetDelivery.mockReturnValue(null);

      await makeLoop().dispatchAndDeliver('t1');

      expect(mockInitiateDelivery).not.toHaveBeenCalled();
      expect(mockMonitorDelivery).not.toHaveBeenCalled();
    });

    it('waits for WIP slot before spawning', async () => {
      // First check: full, second check: available
      mockCountActive.mockReturnValueOnce(3).mockReturnValueOnce(1);
      spawnFn.mockResolvedValue({ agentId: 'a1', taskId: 't1', branch: 'b1' });
      mockGetAgent.mockReturnValueOnce({ status: 'completed' });
      mockGetDelivery.mockReturnValue(null);
      mockInitiateDelivery.mockReturnValue({ agent_id: 'a1', task_id: 't1' });
      mockMonitorDelivery.mockResolvedValue('merged');

      await makeLoop().dispatchAndDeliver('t1');

      // Should have polled twice for WIP
      expect(mockCountActive).toHaveBeenCalledTimes(2);
      expect(spawnFn).toHaveBeenCalled();
    });

    it('returns early when agent is abandoned', async () => {
      spawnFn.mockResolvedValue({ agentId: 'a1', taskId: 't1', branch: 'b1' });
      mockGetAgent.mockReturnValue({ status: 'abandoned' });

      await makeLoop().dispatchAndDeliver('t1');

      expect(mockReleaseWorktree).toHaveBeenCalled();
      expect(mockMonitorDelivery).not.toHaveBeenCalled();
    });

    it('returns false from waitForAgent when agent disappears', async () => {
      spawnFn.mockResolvedValue({ agentId: 'a1', taskId: 't1', branch: 'b1' });
      mockGetAgent.mockReturnValue(null);

      await makeLoop().dispatchAndDeliver('t1');

      expect(mockReleaseWorktree).toHaveBeenCalled();
      expect(mockMonitorDelivery).not.toHaveBeenCalled();
    });
  });

  describe('executeWave', () => {
    it('dispatches all tasks in wave and returns settled results', async () => {
      spawnFn.mockResolvedValue({ agentId: 'a1', taskId: 't1', branch: 'b1' });
      mockGetAgent.mockReturnValue({ status: 'completed' });
      mockGetDelivery.mockReturnValue(null);
      mockInitiateDelivery.mockReturnValue({ agent_id: 'a1', task_id: 't1' });
      mockMonitorDelivery.mockResolvedValue('merged');

      const { settled } = await makeLoop().executeWave({
        wave: 1,
        taskIds: ['t1', 't2'],
      });

      expect(settled).toHaveLength(2);
      expect(settled.every((r) => r.status === 'fulfilled')).toBe(true);
      expect(spawnFn).toHaveBeenCalledTimes(2);
    });

    it('settles all tasks even when some fail', async () => {
      spawnFn
        .mockResolvedValueOnce({ agentId: 'a1', taskId: 't1', branch: 'b1' })
        .mockRejectedValueOnce(new Error('spawn fail'));
      mockGetAgent.mockReturnValue({ status: 'completed' });
      mockGetDelivery.mockReturnValue(null);
      mockInitiateDelivery.mockReturnValue({ agent_id: 'a1', task_id: 't1' });
      mockMonitorDelivery.mockResolvedValue('merged');

      const { settled } = await makeLoop().executeWave({
        wave: 1,
        taskIds: ['t1', 't2'],
      });

      expect(settled).toHaveLength(2);
      expect(settled.every((r) => r.status === 'fulfilled')).toBe(true);
    });
  });
});
