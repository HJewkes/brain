import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../src/modules/agents/task-pull.js', () => ({
  pullNextTask: vi.fn(),
}));

vi.mock('../../../src/modules/agents/prompt-builder.js', () => ({
  buildSpawnPrompt: vi.fn(),
}));

vi.mock('../../../src/modules/agents/stall-detector.js', () => ({
  detectStalledTasks: vi.fn(),
}));

vi.mock('../../../src/modules/agents/data.js', () => ({
  countActiveAgents: vi.fn(),
}));

import { BurndownOrchestrator } from '../../../src/modules/agents/burndown.js';
import { BackpressureController } from '../../../src/modules/agents/backpressure.js';
import { pullNextTask } from '../../../src/modules/agents/task-pull.js';
import { buildSpawnPrompt } from '../../../src/modules/agents/prompt-builder.js';
import { detectStalledTasks } from '../../../src/modules/agents/stall-detector.js';
import { countActiveAgents } from '../../../src/modules/agents/data.js';
import type { BrainDB } from '../../../src/services/brain-db.js';
import type { BrainConfig, Embedder } from '../../../src/types.js';

const mockPullNextTask = pullNextTask as ReturnType<typeof vi.fn>;
const mockBuildSpawnPrompt = buildSpawnPrompt as ReturnType<typeof vi.fn>;
const mockDetectStalledTasks = detectStalledTasks as ReturnType<typeof vi.fn>;
const mockCountActiveAgents = countActiveAgents as ReturnType<typeof vi.fn>;

const fakeDb = {} as BrainDB;
const fakeConfig = {} as BrainConfig;
const fakeEmbedder = {} as Embedder;

function makePullResult(taskId: string) {
  return {
    taskId,
    claimToken: `token-${taskId}`,
    dispatchContext: {
      routing: {
        agentType: 'general-purpose' as const,
        model: 'opus' as const,
        isolation: 'worktree' as const,
        verify: true,
        concurrency: 'sequential-within-workstream' as const,
      },
      context: { title: `Task ${taskId}`, body: '' },
    },
    brief: `Brief for ${taskId}`,
  };
}

describe('BurndownOrchestrator', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockDetectStalledTasks.mockReturnValue([]);
    mockCountActiveAgents.mockReturnValue(0);
    mockPullNextTask.mockResolvedValue(null);
  });

  describe('tick', () => {
    it('spawns agents for available tasks up to WIP limit', async () => {
      const orchestrator = new BurndownOrchestrator(fakeDb, fakeConfig, fakeEmbedder, {
        maxWip: 2,
        projectDir: '/repo',
      });
      const spawner = vi.fn();
      orchestrator.setSpawner(spawner);

      const pull1 = makePullResult('VNM-11.01');
      const pull2 = makePullResult('VNM-11.02');
      mockPullNextTask
        .mockResolvedValueOnce(pull1)
        .mockResolvedValueOnce(pull2)
        .mockResolvedValueOnce(null);
      mockBuildSpawnPrompt.mockReturnValue('Generated prompt');
      // After each spawn, increment active count
      mockCountActiveAgents.mockReturnValueOnce(0).mockReturnValueOnce(1).mockReturnValueOnce(2);

      const result = await orchestrator.tick();

      expect(result.spawned).toHaveLength(2);
      expect(spawner).toHaveBeenCalledTimes(2);
      expect(result.spawned[0].taskId).toBe('VNM-11.01');
      expect(result.spawned[1].taskId).toBe('VNM-11.02');
    });

    it('stops spawning when WIP limit is reached', async () => {
      const orchestrator = new BurndownOrchestrator(fakeDb, fakeConfig, fakeEmbedder, {
        maxWip: 1,
        projectDir: '/repo',
      });
      const spawner = vi.fn();
      orchestrator.setSpawner(spawner);

      const pull1 = makePullResult('VNM-11.01');
      mockPullNextTask.mockResolvedValueOnce(pull1).mockResolvedValueOnce(null);
      mockBuildSpawnPrompt.mockReturnValue('Prompt');
      mockCountActiveAgents
        .mockReturnValueOnce(0) // fillSlots: initial check
        .mockReturnValueOnce(1) // fillSlots: after spawn
        .mockReturnValueOnce(1); // tick: final activeCount

      const result = await orchestrator.tick();

      expect(result.spawned).toHaveLength(1);
      expect(result.activeCount).toBe(1);
      expect(result.availableSlots).toBe(0);
    });

    it('returns empty when no eligible tasks exist', async () => {
      const orchestrator = new BurndownOrchestrator(fakeDb, fakeConfig, fakeEmbedder, {
        maxWip: 4,
        projectDir: '/repo',
      });

      mockPullNextTask.mockResolvedValue(null);

      const result = await orchestrator.tick();

      expect(result.spawned).toEqual([]);
      expect(result.activeCount).toBe(0);
      expect(result.availableSlots).toBe(4);
      expect(result.effectiveWip).toBe(4);
      expect(result.backpressureReason).toBe('nominal');
    });

    it('detects stalled tasks and invokes handler', async () => {
      const orchestrator = new BurndownOrchestrator(fakeDb, fakeConfig, fakeEmbedder, {
        maxWip: 4,
        stallThresholdMinutes: 15,
        projectDir: '/repo',
      });
      const stallHandler = vi.fn();
      orchestrator.setStallHandler(stallHandler);

      const stalledInfo = [
        { displayId: 'VNM-11.03', lastCommitAge: 45, stalledSince: '2026-01-01T00:00:00Z' },
      ];
      mockDetectStalledTasks.mockReturnValue(stalledInfo);
      mockPullNextTask.mockResolvedValue(null);

      const result = await orchestrator.tick();

      expect(result.stalled).toHaveLength(1);
      expect(result.stalled[0].displayId).toBe('VNM-11.03');
      expect(stallHandler).toHaveBeenCalledWith(stalledInfo);
      expect(mockDetectStalledTasks).toHaveBeenCalledWith(fakeDb, '/repo', 15);
    });

    it('uses routing from dispatch context', async () => {
      const orchestrator = new BurndownOrchestrator(fakeDb, fakeConfig, fakeEmbedder, {
        maxWip: 4,
        projectDir: '/repo',
      });

      const pull = makePullResult('VNM-11.03');
      pull.dispatchContext.routing.model = 'sonnet';
      pull.dispatchContext.routing.agentType = 'Explore';
      mockPullNextTask.mockResolvedValueOnce(pull).mockResolvedValueOnce(null);
      mockBuildSpawnPrompt.mockReturnValue('Research prompt');
      mockCountActiveAgents.mockReturnValueOnce(0).mockReturnValueOnce(1);

      const result = await orchestrator.tick();

      expect(result.spawned[0].routing.model).toBe('sonnet');
      expect(result.spawned[0].routing.agentType).toBe('Explore');
    });

    it('uses buildSpawnPrompt for templated prompts', async () => {
      const orchestrator = new BurndownOrchestrator(fakeDb, fakeConfig, fakeEmbedder, {
        maxWip: 4,
        projectDir: '/repo',
      });

      const pull = makePullResult('VNM-11.01');
      mockPullNextTask.mockResolvedValueOnce(pull).mockResolvedValueOnce(null);
      mockBuildSpawnPrompt.mockReturnValue('Templated prompt content');
      mockCountActiveAgents.mockReturnValueOnce(0).mockReturnValueOnce(1);

      const result = await orchestrator.tick();

      expect(result.spawned[0].prompt).toBe('Templated prompt content');
      expect(mockBuildSpawnPrompt).toHaveBeenCalledWith(fakeDb, 'VNM-11.01', {
        projectDir: '/repo',
      });
    });

    it('falls back to brief when buildSpawnPrompt returns null', async () => {
      const orchestrator = new BurndownOrchestrator(fakeDb, fakeConfig, fakeEmbedder, {
        maxWip: 4,
        projectDir: '/repo',
      });

      const pull = makePullResult('VNM-11.01');
      mockPullNextTask.mockResolvedValueOnce(pull).mockResolvedValueOnce(null);
      mockBuildSpawnPrompt.mockReturnValue(null);
      mockCountActiveAgents.mockReturnValueOnce(0).mockReturnValueOnce(1);

      const result = await orchestrator.tick();

      expect(result.spawned[0].prompt).toBe('Brief for VNM-11.01');
    });
  });

  describe('backpressure integration', () => {
    it('reduces effective WIP when conflict rate is high', async () => {
      const backpressure = new BackpressureController(4);
      // Push conflict rate above 30% threshold
      for (let i = 0; i < 5; i++) {
        backpressure.recordMerge(true, true);
      }

      const orchestrator = new BurndownOrchestrator(
        fakeDb,
        fakeConfig,
        fakeEmbedder,
        { maxWip: 4, projectDir: '/repo' },
        backpressure
      );

      mockPullNextTask.mockResolvedValue(null);

      const result = await orchestrator.tick();

      expect(result.effectiveWip).toBeLessThan(4);
      expect(result.backpressureReason).toContain('conflict rate');
    });

    it('delegates onMerge to backpressure controller', async () => {
      const backpressure = new BackpressureController(4);
      const orchestrator = new BurndownOrchestrator(
        fakeDb,
        fakeConfig,
        fakeEmbedder,
        { maxWip: 4, projectDir: '/repo' },
        backpressure
      );

      // Record enough conflicts to trigger reduction
      for (let i = 0; i < 5; i++) {
        orchestrator.onMerge(true, true);
      }

      mockPullNextTask.mockResolvedValue(null);
      const result = await orchestrator.tick();

      expect(result.effectiveWip).toBeLessThan(4);
    });

    it('delegates onStallRecord to backpressure controller', async () => {
      const backpressure = new BackpressureController(4);
      const orchestrator = new BurndownOrchestrator(
        fakeDb,
        fakeConfig,
        fakeEmbedder,
        { maxWip: 4, projectDir: '/repo' },
        backpressure
      );

      // Record stalls to exceed 50% stall rate (need stalls > merges)
      for (let i = 0; i < 5; i++) {
        orchestrator.onStallRecord('WS-01');
      }
      orchestrator.onMerge(true, false);

      mockPullNextTask.mockResolvedValue(null);
      const result = await orchestrator.tick();

      expect(result.effectiveWip).toBeLessThan(4);
      expect(result.backpressureReason).toContain('stall rate');
    });

    it('limits spawning to effective WIP not configured maxWip', async () => {
      const backpressure = new BackpressureController(4);
      // Drive effective WIP to 2 via conflicts
      for (let i = 0; i < 5; i++) {
        backpressure.recordMerge(true, true);
      }

      const orchestrator = new BurndownOrchestrator(
        fakeDb,
        fakeConfig,
        fakeEmbedder,
        { maxWip: 4, projectDir: '/repo' },
        backpressure
      );
      const spawner = vi.fn();
      orchestrator.setSpawner(spawner);

      const pull1 = makePullResult('T-01');
      const pull2 = makePullResult('T-02');
      const pull3 = makePullResult('T-03');
      mockPullNextTask
        .mockResolvedValueOnce(pull1)
        .mockResolvedValueOnce(pull2)
        .mockResolvedValueOnce(pull3)
        .mockResolvedValueOnce(null);
      mockBuildSpawnPrompt.mockReturnValue('prompt');

      const effectiveWip = backpressure.computeEffectiveWip().effectiveWip;
      // Mock active count incrementing per spawn
      const countMock = mockCountActiveAgents;
      for (let i = 0; i <= effectiveWip; i++) {
        countMock.mockReturnValueOnce(i);
      }
      // Final count for tick result
      countMock.mockReturnValueOnce(effectiveWip);

      const result = await orchestrator.tick();

      expect(result.spawned).toHaveLength(effectiveWip);
      expect(result.effectiveWip).toBe(effectiveWip);
    });
  });

  describe('event hooks', () => {
    it('fires onStallDetected when stalled tasks exist', async () => {
      const orchestrator = new BurndownOrchestrator(fakeDb, fakeConfig, fakeEmbedder, {
        maxWip: 4,
        projectDir: '/repo',
      });
      const onStallDetected = vi.fn();
      orchestrator.setEventHooks({ onStallDetected });

      const stalledInfo = [
        { displayId: 'VNM-11.03', lastCommitAge: 45, stalledSince: '2026-01-01T00:00:00Z' },
      ];
      mockDetectStalledTasks.mockReturnValue(stalledInfo);
      mockPullNextTask.mockResolvedValue(null);

      await orchestrator.tick();

      expect(onStallDetected).toHaveBeenCalledWith(stalledInfo);
    });

    it('does not fire onStallDetected when no stalled tasks', async () => {
      const orchestrator = new BurndownOrchestrator(fakeDb, fakeConfig, fakeEmbedder, {
        maxWip: 4,
        projectDir: '/repo',
      });
      const onStallDetected = vi.fn();
      orchestrator.setEventHooks({ onStallDetected });

      mockDetectStalledTasks.mockReturnValue([]);
      mockPullNextTask.mockResolvedValue(null);

      await orchestrator.tick();

      expect(onStallDetected).not.toHaveBeenCalled();
    });

    it('fires onProgress on every tick', async () => {
      const orchestrator = new BurndownOrchestrator(fakeDb, fakeConfig, fakeEmbedder, {
        maxWip: 4,
        projectDir: '/repo',
      });
      const onProgress = vi.fn();
      orchestrator.setEventHooks({ onProgress });

      mockPullNextTask.mockResolvedValue(null);
      mockCountActiveAgents.mockReturnValue(2);

      await orchestrator.tick();

      expect(onProgress).toHaveBeenCalledTimes(1);
      expect(onProgress).toHaveBeenCalledWith(0, 4, 2);
    });

    it('fires onProgress with spawned count', async () => {
      const orchestrator = new BurndownOrchestrator(fakeDb, fakeConfig, fakeEmbedder, {
        maxWip: 4,
        projectDir: '/repo',
      });
      const onProgress = vi.fn();
      orchestrator.setEventHooks({ onProgress });

      const pull = makePullResult('VNM-11.01');
      mockPullNextTask.mockResolvedValueOnce(pull).mockResolvedValueOnce(null);
      mockBuildSpawnPrompt.mockReturnValue('Prompt');
      mockCountActiveAgents
        .mockReturnValueOnce(0) // fillSlots: initial check
        .mockReturnValueOnce(1) // fillSlots: after spawn
        .mockReturnValueOnce(1); // tick: final activeCount

      await orchestrator.tick();

      expect(onProgress).toHaveBeenCalledTimes(1);
    });
  });

  describe('start/stop', () => {
    it('starts and stops the tick interval', () => {
      vi.useFakeTimers();

      const orchestrator = new BurndownOrchestrator(fakeDb, fakeConfig, fakeEmbedder, {
        maxWip: 4,
        projectDir: '/repo',
      });
      mockPullNextTask.mockResolvedValue(null);

      orchestrator.start(1000);
      vi.advanceTimersByTime(3500);
      orchestrator.stop();

      expect(mockDetectStalledTasks).toHaveBeenCalledTimes(3);

      vi.useRealTimers();
    });

    it('is idempotent on repeated start calls', () => {
      vi.useFakeTimers();

      const orchestrator = new BurndownOrchestrator(fakeDb, fakeConfig, fakeEmbedder, {
        maxWip: 4,
        projectDir: '/repo',
      });
      mockPullNextTask.mockResolvedValue(null);

      orchestrator.start(1000);
      orchestrator.start(1000);
      vi.advanceTimersByTime(1500);
      orchestrator.stop();

      expect(mockDetectStalledTasks).toHaveBeenCalledTimes(1);

      vi.useRealTimers();
    });

    it('stop is safe to call when not running', () => {
      const orchestrator = new BurndownOrchestrator(fakeDb, fakeConfig, fakeEmbedder, {
        maxWip: 4,
        projectDir: '/repo',
      });

      expect(() => orchestrator.stop()).not.toThrow();
    });
  });
});
