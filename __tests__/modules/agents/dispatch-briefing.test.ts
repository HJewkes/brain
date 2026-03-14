import { vi, describe, it, expect, beforeEach } from 'vitest';
import type { SessionBriefing } from '../../../src/modules/sessions/engine/session-briefing.js';

const mockGetPmNotes = vi.fn();
const mockAssembleContext = vi.fn();
const mockGenerateSessionBriefing = vi.fn();

vi.mock('../../../src/modules/pm/data/queries.js', () => ({
  getPmNotes: (...args: unknown[]) => mockGetPmNotes(...args),
}));

vi.mock('../../../src/modules/pm/engine/dispatch.js', () => ({
  assembleContext: (...args: unknown[]) => mockAssembleContext(...args),
}));

vi.mock('../../../src/modules/sessions/engine/session-briefing.js', () => ({
  generateSessionBriefing: (...args: unknown[]) => mockGenerateSessionBriefing(...args),
}));

import {
  buildAgentDispatchContext,
  formatDispatchBrief,
  formatSessionBriefing,
} from '../../../src/modules/agents/dispatch-context.js';
import type { BrainConfig } from '../../../src/types.js';

const TASK_META_JSON = JSON.stringify({
  display_id: 'VNM-01.03',
  project: 'VNM',
  workstream: 1,
  number: 3,
  status: 'pending',
  mode: 'agent',
  category: 'implementation',
  priority: 'high',
  title: 'Wire PM routing',
});

const ASSEMBLED_CONTEXT = {
  ok: true,
  data: {
    task: { title: 'Wire PM routing' },
    body: 'Implement the feature',
    workstream: { displayId: 'VNM-01', title: 'Core' },
    relatedNotes: [],
    prompt: undefined,
    dependencies: [],
    decisions: [],
    constraints: [],
    contextHash: 'abc123',
  },
};

const SAMPLE_BRIEFING: SessionBriefing = {
  project: 'VNM',
  sections: [
    {
      heading: 'Active Work',
      items: ['VNM-01.02 [high] Setup database (in-progress)'],
    },
    {
      heading: 'Progress',
      items: ['5/20 tasks done (25%)'],
    },
  ],
  suggestedFocus: ['Continue VNM-01.02: Setup database'],
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('buildAgentDispatchContext with session briefing', () => {
  it('includes session briefing when config and projectDir are provided', () => {
    mockGetPmNotes.mockReturnValue([{ id: 'note-1', metadata: TASK_META_JSON }]);
    mockAssembleContext.mockReturnValue(ASSEMBLED_CONTEXT);
    mockGenerateSessionBriefing.mockReturnValue(SAMPLE_BRIEFING);

    const config = { notesDir: '/tmp/notes' } as BrainConfig;
    const result = buildAgentDispatchContext({} as never, 'VNM-01.03', {
      config,
      projectDir: '/tmp/project',
    });

    expect(result).not.toBeNull();
    expect(result!.sessionBriefing).toEqual(SAMPLE_BRIEFING);
    expect(mockGenerateSessionBriefing).toHaveBeenCalledWith(
      expect.anything(),
      config,
      '/tmp/project'
    );
  });

  it('omits session briefing when options are not provided', () => {
    mockGetPmNotes.mockReturnValue([{ id: 'note-1', metadata: TASK_META_JSON }]);
    mockAssembleContext.mockReturnValue(ASSEMBLED_CONTEXT);

    const result = buildAgentDispatchContext({} as never, 'VNM-01.03');

    expect(result).not.toBeNull();
    expect(result!.sessionBriefing).toBeUndefined();
    expect(mockGenerateSessionBriefing).not.toHaveBeenCalled();
  });

  it('omits session briefing when only config is provided (no projectDir)', () => {
    mockGetPmNotes.mockReturnValue([{ id: 'note-1', metadata: TASK_META_JSON }]);
    mockAssembleContext.mockReturnValue(ASSEMBLED_CONTEXT);

    const result = buildAgentDispatchContext({} as never, 'VNM-01.03', {
      config: { notesDir: '/tmp' } as BrainConfig,
    });

    expect(result).not.toBeNull();
    expect(result!.sessionBriefing).toBeUndefined();
    expect(mockGenerateSessionBriefing).not.toHaveBeenCalled();
  });

  it('gracefully handles session briefing errors', () => {
    mockGetPmNotes.mockReturnValue([{ id: 'note-1', metadata: TASK_META_JSON }]);
    mockAssembleContext.mockReturnValue(ASSEMBLED_CONTEXT);
    mockGenerateSessionBriefing.mockImplementation(() => {
      throw new Error('DB table not found');
    });

    const result = buildAgentDispatchContext({} as never, 'VNM-01.03', {
      config: { notesDir: '/tmp' } as BrainConfig,
      projectDir: '/tmp/project',
    });

    expect(result).not.toBeNull();
    expect(result!.sessionBriefing).toBeUndefined();
  });
});

describe('formatSessionBriefing', () => {
  it('renders all sections with project name', () => {
    const output = formatSessionBriefing(SAMPLE_BRIEFING);

    expect(output).toContain('--- Session Briefing ---');
    expect(output).toContain('Project: VNM');
    expect(output).toContain('[Active Work]');
    expect(output).toContain('  VNM-01.02 [high] Setup database (in-progress)');
    expect(output).toContain('[Progress]');
    expect(output).toContain('  5/20 tasks done (25%)');
    expect(output).toContain('[Suggested Focus]');
    expect(output).toContain('  Continue VNM-01.02: Setup database');
  });

  it('omits project line when project is null', () => {
    const briefing: SessionBriefing = {
      project: null,
      sections: [],
      suggestedFocus: ['Run "brain pm onboard" to set up a project'],
    };

    const output = formatSessionBriefing(briefing);

    expect(output).toContain('--- Session Briefing ---');
    expect(output).not.toContain('Project:');
    expect(output).toContain('[Suggested Focus]');
  });

  it('omits suggested focus when empty', () => {
    const briefing: SessionBriefing = {
      project: 'VNM',
      sections: [{ heading: 'Progress', items: ['10/10 done (100%)'] }],
      suggestedFocus: [],
    };

    const output = formatSessionBriefing(briefing);

    expect(output).toContain('[Progress]');
    expect(output).not.toContain('[Suggested Focus]');
  });
});

describe('formatDispatchBrief with session briefing', () => {
  it('includes session briefing section when present', () => {
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
        body: '',
        workstream: undefined,
        prompt: undefined,
        dependencies: [],
        decisions: [],
        constraints: [],
      },
      contextHash: 'abc123',
      sessionBriefing: SAMPLE_BRIEFING,
    };

    const brief = formatDispatchBrief(ctx);

    expect(brief).toContain('--- Session Briefing ---');
    expect(brief).toContain('Project: VNM');
    expect(brief).toContain('[Active Work]');
  });

  it('omits session briefing section when not present', () => {
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
        body: '',
        workstream: undefined,
        prompt: undefined,
        dependencies: [],
        decisions: [],
        constraints: [],
      },
      contextHash: 'abc123',
    };

    const brief = formatDispatchBrief(ctx);

    expect(brief).not.toContain('Session Briefing');
  });
});
