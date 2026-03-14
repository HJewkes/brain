import { vi, describe, it, expect, beforeEach } from 'vitest';
import type { TaskMetadata } from '../../../src/modules/pm/types.js';

const mockGetPmNotes = vi.fn();
const mockAssembleContext = vi.fn();
const mockComputeWaves = vi.fn();

vi.mock('../../../src/modules/pm/data/queries.js', () => ({
  getPmNotes: (...args: unknown[]) => mockGetPmNotes(...args),
}));

vi.mock('../../../src/modules/pm/engine/dispatch.js', () => ({
  assembleContext: (...args: unknown[]) => mockAssembleContext(...args),
}));

vi.mock('../../../src/modules/pm/engine/dependency.js', () => ({
  computeWaves: (...args: unknown[]) => mockComputeWaves(...args),
}));

import {
  buildAgentDispatchContext,
  formatDispatchBrief,
  type AgentDispatchContext,
} from '../../../src/modules/agents/dispatch-context.js';

const TASK_META: TaskMetadata = {
  display_id: 'VNM-02.03',
  project: 'VNM',
  workstream: 2,
  number: 3,
  status: 'pending',
  mode: 'agent',
  category: 'implementation',
  priority: 'high',
  title: 'Build wave display',
};

function makeContextResult(overrides: Partial<TaskMetadata> = {}) {
  const task = { ...TASK_META, ...overrides };
  return {
    ok: true,
    data: {
      task,
      body: 'Implement wave display',
      workstream: { displayId: 'VNM-02', title: 'Dispatch' },
      relatedNotes: [],
      prompt: undefined,
      dependencies: [
        { displayId: 'VNM-02.01', name: 'Design waves', status: 'done', direction: 'upstream' },
        { displayId: 'VNM-02.02', name: 'Wave engine', status: 'done', direction: 'upstream' },
      ],
      decisions: [],
      constraints: [],
      contextHash: 'wavehash',
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('wave info in dispatch context', () => {
  it('populates waveInfo when task is found in a wave', () => {
    mockGetPmNotes.mockReturnValue([{ id: 'note-1', metadata: JSON.stringify(TASK_META) }]);
    mockAssembleContext.mockReturnValue(makeContextResult());
    mockComputeWaves.mockReturnValue([
      { wave: 0, taskIds: ['VNM-02.01', 'VNM-02.02'] },
      { wave: 1, taskIds: ['VNM-02.03', 'VNM-02.04'] },
      { wave: 2, taskIds: ['VNM-02.05'] },
    ]);

    const result = buildAgentDispatchContext({} as never, 'VNM-02.03');

    expect(result).not.toBeNull();
    expect(result!.waveInfo).toEqual({
      waveNumber: 2,
      totalWaves: 3,
      waveTasks: ['VNM-02.04'],
    });
  });

  it('excludes the current task from waveTasks', () => {
    mockGetPmNotes.mockReturnValue([{ id: 'note-1', metadata: JSON.stringify(TASK_META) }]);
    mockAssembleContext.mockReturnValue(makeContextResult());
    mockComputeWaves.mockReturnValue([{ wave: 0, taskIds: ['VNM-02.03'] }]);

    const result = buildAgentDispatchContext({} as never, 'VNM-02.03');

    expect(result!.waveInfo).toEqual({
      waveNumber: 1,
      totalWaves: 1,
      waveTasks: [],
    });
  });

  it('sets waveInfo to undefined when task is not in any wave', () => {
    mockGetPmNotes.mockReturnValue([{ id: 'note-1', metadata: JSON.stringify(TASK_META) }]);
    mockAssembleContext.mockReturnValue(makeContextResult());
    mockComputeWaves.mockReturnValue([{ wave: 0, taskIds: ['VNM-02.01'] }]);

    const result = buildAgentDispatchContext({} as never, 'VNM-02.03');

    expect(result!.waveInfo).toBeUndefined();
  });

  it('sets waveInfo to undefined when computeWaves returns empty', () => {
    mockGetPmNotes.mockReturnValue([{ id: 'note-1', metadata: JSON.stringify(TASK_META) }]);
    mockAssembleContext.mockReturnValue(makeContextResult());
    mockComputeWaves.mockReturnValue([]);

    const result = buildAgentDispatchContext({} as never, 'VNM-02.03');

    expect(result!.waveInfo).toBeUndefined();
  });

  it('handles computeWaves throwing gracefully', () => {
    mockGetPmNotes.mockReturnValue([{ id: 'note-1', metadata: JSON.stringify(TASK_META) }]);
    mockAssembleContext.mockReturnValue(makeContextResult());
    mockComputeWaves.mockImplementation(() => {
      throw new Error('db error');
    });

    const result = buildAgentDispatchContext({} as never, 'VNM-02.03');

    expect(result).not.toBeNull();
    expect(result!.waveInfo).toBeUndefined();
  });
});

describe('formatDispatchBrief with wave info', () => {
  function makeCtx(waveInfo?: AgentDispatchContext['waveInfo']): AgentDispatchContext {
    return {
      taskId: 'VNM-02.03',
      routing: {
        agentType: 'general-purpose' as const,
        model: 'opus' as const,
        isolation: 'worktree' as const,
        verify: true,
        concurrency: 'sequential-within-workstream' as const,
      },
      agentDispatchable: true,
      context: {
        title: 'Build wave display',
        body: 'Implement wave display',
        workstream: { displayId: 'VNM-02', title: 'Dispatch' },
        prompt: undefined,
        dependencies: [{ displayId: 'VNM-02.01', name: 'Design waves', status: 'done' }],
        decisions: [],
        constraints: [],
      },
      waveInfo,
      contextHash: 'wavehash',
    };
  }

  it('renders wave info section with parallel tasks', () => {
    const brief = formatDispatchBrief(
      makeCtx({ waveNumber: 2, totalWaves: 3, waveTasks: ['VNM-02.04', 'VNM-02.05'] })
    );

    expect(brief).toContain('--- Wave Info ---');
    expect(brief).toContain('This task is in wave 2 of 3. All prior wave tasks are complete.');
    expect(brief).toContain('Parallel tasks in this wave: VNM-02.04, VNM-02.05');
  });

  it('renders wave info without parallel tasks line when alone in wave', () => {
    const brief = formatDispatchBrief(makeCtx({ waveNumber: 1, totalWaves: 2, waveTasks: [] }));

    expect(brief).toContain('--- Wave Info ---');
    expect(brief).toContain('This task is in wave 1 of 2. All prior wave tasks are complete.');
    expect(brief).not.toContain('Parallel tasks');
  });

  it('omits wave info section when waveInfo is undefined', () => {
    const brief = formatDispatchBrief(makeCtx(undefined));

    expect(brief).not.toContain('Wave Info');
  });
});
