import { vi, describe, it, expect, beforeEach } from 'vitest';
import type { TaskMetadata } from '../../../src/modules/pm/types.js';

const mockGetPmNotes = vi.fn();
const mockAssembleContext = vi.fn();

vi.mock('../../../src/modules/pm/data/queries.js', () => ({
  getPmNotes: (...args: unknown[]) => mockGetPmNotes(...args),
}));

vi.mock('../../../src/modules/pm/engine/dispatch.js', () => ({
  assembleContext: (...args: unknown[]) => mockAssembleContext(...args),
}));

import {
  buildAgentDispatchContext,
  formatDispatchBrief,
} from '../../../src/modules/agents/dispatch-context.js';

const TASK_META: TaskMetadata = {
  display_id: 'VNM-01.03',
  project: 'VNM',
  workstream: 1,
  number: 3,
  status: 'pending',
  mode: 'agent',
  category: 'implementation',
  priority: 'high',
  title: 'Wire PM routing',
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('buildAgentDispatchContext', () => {
  it('returns null when task is not found', () => {
    mockGetPmNotes.mockReturnValue([]);

    const result = buildAgentDispatchContext({} as never, 'VNM-99.99');

    expect(result).toBeNull();
  });

  it('returns null when assembleContext fails', () => {
    mockGetPmNotes.mockReturnValue([{ id: 'note-1', metadata: JSON.stringify(TASK_META) }]);
    mockAssembleContext.mockReturnValue({
      ok: false,
      error: { error: true, code: 'NOT_FOUND', message: 'not found' },
    });

    const result = buildAgentDispatchContext({} as never, 'VNM-01.03');

    expect(result).toBeNull();
  });

  it('builds dispatch context with routing for agent-mode task', () => {
    mockGetPmNotes.mockReturnValue([{ id: 'note-1', metadata: JSON.stringify(TASK_META) }]);
    mockAssembleContext.mockReturnValue({
      ok: true,
      data: {
        task: TASK_META,
        body: 'Implement the feature',
        workstream: { displayId: 'VNM-01', title: 'Core' },
        relatedNotes: [],
        prompt: undefined,
        dependencies: [
          { displayId: 'VNM-01.01', name: 'Setup', status: 'done', direction: 'upstream' },
        ],
        decisions: [],
        constraints: ['no breaking changes'],
        contextHash: 'abc123',
      },
    });

    const result = buildAgentDispatchContext({} as never, 'VNM-01.03');

    expect(result).not.toBeNull();
    expect(result!.taskId).toBe('VNM-01.03');
    expect(result!.agentDispatchable).toBe(true);
    expect(result!.routing.model).toBe('opus');
    expect(result!.routing.isolation).toBe('worktree');
    expect(result!.routing.verify).toBe(true);
    expect(result!.context.title).toBe('Wire PM routing');
    expect(result!.context.body).toBe('Implement the feature');
    expect(result!.context.workstream).toEqual({ displayId: 'VNM-01', title: 'Core' });
    expect(result!.context.dependencies).toHaveLength(1);
    expect(result!.context.constraints).toEqual(['no breaking changes']);
    expect(result!.contextHash).toBe('abc123');
  });

  it('marks non-agent tasks as not dispatchable with fallback routing', () => {
    const humanTask = { ...TASK_META, mode: 'human' as const };
    mockGetPmNotes.mockReturnValue([{ id: 'note-1', metadata: JSON.stringify(humanTask) }]);
    mockAssembleContext.mockReturnValue({
      ok: true,
      data: {
        task: humanTask,
        body: '',
        workstream: undefined,
        relatedNotes: [],
        prompt: undefined,
        dependencies: [],
        decisions: [],
        constraints: [],
        contextHash: 'def456',
      },
    });

    const result = buildAgentDispatchContext({} as never, 'VNM-01.03');

    expect(result!.agentDispatchable).toBe(false);
    expect(result!.routing.model).toBe('sonnet');
    expect(result!.routing.isolation).toBe('none');
  });

  it('routes research category to sonnet with Explore agent', () => {
    const researchTask = { ...TASK_META, category: 'research' as const };
    mockGetPmNotes.mockReturnValue([{ id: 'note-1', metadata: JSON.stringify(researchTask) }]);
    mockAssembleContext.mockReturnValue({
      ok: true,
      data: {
        task: researchTask,
        body: '',
        workstream: undefined,
        relatedNotes: [],
        prompt: undefined,
        dependencies: [],
        decisions: [],
        constraints: [],
        contextHash: 'ghi789',
      },
    });

    const result = buildAgentDispatchContext({} as never, 'VNM-01.03');

    expect(result!.routing.model).toBe('sonnet');
    expect(result!.routing.agentType).toBe('Explore');
    expect(result!.routing.concurrency).toBe('parallel');
  });
});

describe('formatDispatchBrief', () => {
  it('formats a complete dispatch brief', () => {
    const ctx = {
      taskId: 'VNM-01.03',
      routing: {
        agentType: 'general-purpose' as const,
        model: 'opus' as const,
        isolation: 'worktree' as const,
        verify: true,
        concurrency: 'sequential-within-workstream' as const,
      },
      agentDispatchable: true,
      context: {
        title: 'Wire PM routing',
        body: 'Implement the feature',
        workstream: { displayId: 'VNM-01', title: 'Core' },
        prompt: 'Do the thing',
        dependencies: [{ displayId: 'VNM-01.01', name: 'Setup', status: 'done' }],
        decisions: [{ displayId: 'DEC-01', status: 'accepted', content: 'Use SQLite' }],
        constraints: [],
      },
      contextHash: 'abc123',
    };

    const brief = formatDispatchBrief(ctx);

    expect(brief).toContain('Task: VNM-01.03 - Wire PM routing');
    expect(brief).toContain('Model: opus');
    expect(brief).toContain('Isolation: worktree');
    expect(brief).toContain('Verify: true');
    expect(brief).toContain('Dispatchable: true');
    expect(brief).toContain('Implement the feature');
    expect(brief).toContain('Workstream: VNM-01 - Core');
    expect(brief).toContain('Do the thing');
    expect(brief).toContain('VNM-01.01 [done] Setup');
    expect(brief).toContain('DEC-01 [accepted] Use SQLite');
  });

  it('omits empty sections', () => {
    const ctx = {
      taskId: 'VNM-01.03',
      routing: {
        agentType: 'general-purpose' as const,
        model: 'sonnet' as const,
        isolation: 'none' as const,
        verify: false,
        concurrency: 'parallel' as const,
      },
      agentDispatchable: false,
      context: {
        title: 'Simple task',
        body: '',
        workstream: undefined,
        prompt: undefined,
        dependencies: [],
        decisions: [],
        constraints: [],
      },
      contextHash: 'xyz',
    };

    const brief = formatDispatchBrief(ctx);

    expect(brief).toContain('Task: VNM-01.03 - Simple task');
    expect(brief).not.toContain('Description');
    expect(brief).not.toContain('Workstream');
    expect(brief).not.toContain('Prompt');
    expect(brief).not.toContain('Dependencies');
    expect(brief).not.toContain('Decisions');
  });
});
