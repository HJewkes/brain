import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock all PM and session data access
vi.mock('../../../src/modules/pm/data/queries.js', () => ({
  getActiveProject: vi.fn(),
}));

vi.mock('../../../src/modules/pm/data/task-ops.js', () => ({
  listTasks: vi.fn(),
  getTask: vi.fn(),
}));

vi.mock('../../../src/modules/pm/engine/dependency.js', () => ({
  computeEligible: vi.fn(),
}));

vi.mock('../../../src/modules/sessions/data/session-ops.js', () => ({
  listSessions: vi.fn(),
}));

vi.mock('../../../src/modules/autoloop/engine/discovery.js', () => ({
  findUnreviewedSessions: vi.fn(),
}));

vi.mock('../../../src/modules/autoloop/engine/run-tracker.js', () => ({
  getLastRunTime: vi.fn(),
}));

import { getActiveProject } from '../../../src/modules/pm/data/queries.js';
import { listTasks, getTask } from '../../../src/modules/pm/data/task-ops.js';
import { computeEligible } from '../../../src/modules/pm/engine/dependency.js';
import { listSessions } from '../../../src/modules/sessions/data/session-ops.js';
import { findUnreviewedSessions } from '../../../src/modules/autoloop/engine/discovery.js';
import { getLastRunTime } from '../../../src/modules/autoloop/engine/run-tracker.js';
import {
  generateSessionBriefing,
  renderBriefingXml,
  renderBriefingMarkdown,
} from '../../../src/modules/sessions/engine/session-briefing.js';
import type { BrainDB } from '../../../src/services/brain-db.js';
import type { BrainConfig } from '../../../src/types.js';

const mockGetActiveProject = getActiveProject as ReturnType<typeof vi.fn>;
const mockListTasks = listTasks as ReturnType<typeof vi.fn>;
const mockGetTask = getTask as ReturnType<typeof vi.fn>;
const mockComputeEligible = computeEligible as ReturnType<typeof vi.fn>;
const mockListSessions = listSessions as ReturnType<typeof vi.fn>;
const mockFindUnreviewedSessions = findUnreviewedSessions as ReturnType<typeof vi.fn>;
const mockGetLastRunTime = getLastRunTime as ReturnType<typeof vi.fn>;

const fakeDb = {} as BrainDB;
const fakeConfig = {
  notesDir: '/tmp',
  dbPath: '/tmp/db',
  embedder: 'local',
  fusionWeights: { bm25: 0.3, vector: 0.7 },
} as BrainConfig;

function makeTask(id: string, status: string, priority = 'medium', title = `Task ${id}`) {
  return {
    display_id: id,
    status,
    priority,
    title,
    workstream: 1,
    virtualStates: status === 'pending' ? [] : undefined,
  };
}

describe('generateSessionBriefing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListSessions.mockReturnValue([]);
    mockFindUnreviewedSessions.mockReturnValue([]);
    mockGetLastRunTime.mockReturnValue(null);
  });

  it('returns no-project suggestion when no active project', () => {
    mockGetActiveProject.mockReturnValue(null);
    const briefing = generateSessionBriefing(fakeDb, fakeConfig, '/proj');
    expect(briefing.project).toBeNull();
    expect(briefing.suggestedFocus[0]).toContain('brain pm onboard');
  });

  it('includes in-progress and claimed tasks as active work', () => {
    mockGetActiveProject.mockReturnValue('VNM');
    mockListTasks.mockReturnValue({
      ok: true,
      data: [
        makeTask('VNM-01.01', 'in-progress', 'high', 'Fix auth'),
        makeTask('VNM-01.02', 'claimed', 'medium', 'Add tests'),
        makeTask('VNM-01.03', 'done', 'low', 'Docs'),
      ],
    });
    mockComputeEligible.mockReturnValue([]);

    const briefing = generateSessionBriefing(fakeDb, fakeConfig, '/proj');
    expect(briefing.project).toBe('VNM');

    const activeSection = briefing.sections.find((s) => s.heading === 'Active Work');
    expect(activeSection).toBeDefined();
    expect(activeSection!.items).toHaveLength(2);
    expect(activeSection!.items[0]).toContain('VNM-01.01');
    expect(activeSection!.items[1]).toContain('VNM-01.02');
  });

  it('includes eligible tasks sorted by priority', () => {
    mockGetActiveProject.mockReturnValue('VNM');
    mockListTasks.mockReturnValue({ ok: true, data: [] });
    mockComputeEligible.mockReturnValue(['VNM-02.01', 'VNM-02.02']);
    mockGetTask
      .mockReturnValueOnce({ ok: true, data: makeTask('VNM-02.01', 'pending', 'low', 'Low task') })
      .mockReturnValueOnce({
        ok: true,
        data: makeTask('VNM-02.02', 'pending', 'high', 'High task'),
      });

    const briefing = generateSessionBriefing(fakeDb, fakeConfig, '/proj');
    const eligibleSection = briefing.sections.find((s) => s.heading === 'Eligible Tasks');
    expect(eligibleSection).toBeDefined();
    expect(eligibleSection!.items[0]).toContain('VNM-02.02'); // high first
    expect(eligibleSection!.items[1]).toContain('VNM-02.01'); // low second
  });

  it('suggests continuing active work over picking new tasks', () => {
    mockGetActiveProject.mockReturnValue('VNM');
    mockListTasks.mockReturnValue({
      ok: true,
      data: [makeTask('VNM-01.01', 'in-progress', 'high', 'Ongoing work')],
    });
    mockComputeEligible.mockReturnValue(['VNM-02.01']);
    mockGetTask.mockReturnValue({
      ok: true,
      data: makeTask('VNM-02.01', 'pending', 'high', 'New work'),
    });

    const briefing = generateSessionBriefing(fakeDb, fakeConfig, '/proj');
    expect(briefing.suggestedFocus[0]).toContain('Continue VNM-01.01');
  });

  it('includes recent sessions', () => {
    mockGetActiveProject.mockReturnValue('VNM');
    mockListTasks.mockReturnValue({ ok: true, data: [] });
    mockComputeEligible.mockReturnValue([]);
    mockListSessions.mockReturnValue([
      {
        display_id: 'SNS-001',
        started_at: '2026-03-12T10:00:00Z',
        summary: 'Worked on auth',
        tasks_worked: ['VNM-02.01'],
        tasks_completed: ['VNM-01.01'],
        branch: 'feat/auth',
        commits: ['abc123'],
      },
    ]);

    const briefing = generateSessionBriefing(fakeDb, fakeConfig, '/proj');
    const sessionSection = briefing.sections.find((s) => s.heading.includes('Last Session'));
    expect(sessionSection).toBeDefined();
    expect(sessionSection!.heading).toContain('SNS-001');
    expect(sessionSection!.items).toEqual(
      expect.arrayContaining([
        expect.stringContaining('Worked on auth'),
        expect.stringContaining('VNM-02.01'),
        expect.stringContaining('VNM-01.01'),
        expect.stringContaining('feat/auth'),
        expect.stringContaining('Commits: 1'),
      ])
    );
  });

  it('includes progress summary', () => {
    mockGetActiveProject.mockReturnValue('VNM');
    mockListTasks.mockReturnValue({
      ok: true,
      data: [
        makeTask('VNM-01.01', 'done'),
        makeTask('VNM-01.02', 'done'),
        makeTask('VNM-01.03', 'pending'),
      ],
    });
    mockComputeEligible.mockReturnValue([]);

    const briefing = generateSessionBriefing(fakeDb, fakeConfig, '/proj');
    const progress = briefing.sections.find((s) => s.heading === 'Progress');
    expect(progress).toBeDefined();
    expect(progress!.items[0]).toContain('2/3');
    expect(progress!.items[0]).toContain('67%');
  });

  it('suggests autoloop review when 3+ unreviewed sessions', () => {
    mockGetActiveProject.mockReturnValue('VNM');
    mockListTasks.mockReturnValue({ ok: true, data: [] });
    mockComputeEligible.mockReturnValue([]);
    mockFindUnreviewedSessions.mockReturnValue([
      { sessionId: 's1', ageHours: 2 },
      { sessionId: 's2', ageHours: 5 },
      { sessionId: 's3', ageHours: 10 },
    ]);

    const briefing = generateSessionBriefing(fakeDb, fakeConfig, '/proj');
    const section = briefing.sections.find((s) => s.heading === 'Autoloop Review');
    expect(section).toBeDefined();
    expect(section!.items[0]).toContain('3 sessions completed since last review');
    expect(section!.items[0]).toContain('brain autoloop review');
  });

  it('suggests autoloop review when consolidation is stale', () => {
    mockGetActiveProject.mockReturnValue('VNM');
    mockListTasks.mockReturnValue({ ok: true, data: [] });
    mockComputeEligible.mockReturnValue([]);
    mockFindUnreviewedSessions.mockReturnValue([]);
    mockGetLastRunTime.mockReturnValue(new Date(Date.now() - 10 * 24 * 60 * 60 * 1000));

    const briefing = generateSessionBriefing(fakeDb, fakeConfig, '/proj');
    const section = briefing.sections.find((s) => s.heading === 'Autoloop Review');
    expect(section).toBeDefined();
    expect(section!.items[0]).toContain('10 days since last task consolidation');
  });

  it('omits autoloop section when thresholds not met', () => {
    mockGetActiveProject.mockReturnValue('VNM');
    mockListTasks.mockReturnValue({ ok: true, data: [] });
    mockComputeEligible.mockReturnValue([]);
    mockFindUnreviewedSessions.mockReturnValue([{ sessionId: 's1', ageHours: 2 }]);
    mockGetLastRunTime.mockReturnValue(new Date(Date.now() - 2 * 24 * 60 * 60 * 1000));

    const briefing = generateSessionBriefing(fakeDb, fakeConfig, '/proj');
    const section = briefing.sections.find((s) => s.heading === 'Autoloop Review');
    expect(section).toBeUndefined();
  });

  it('handles autoloop check errors gracefully', () => {
    mockGetActiveProject.mockReturnValue('VNM');
    mockListTasks.mockReturnValue({ ok: true, data: [] });
    mockComputeEligible.mockReturnValue([]);
    mockFindUnreviewedSessions.mockImplementation(() => {
      throw new Error('table does not exist');
    });

    const briefing = generateSessionBriefing(fakeDb, fakeConfig, '/proj');
    const section = briefing.sections.find((s) => s.heading === 'Autoloop Review');
    expect(section).toBeUndefined();
  });
});

describe('renderBriefingXml', () => {
  it('renders sections as XML tags', () => {
    const xml = renderBriefingXml({
      project: 'VNM',
      sections: [{ heading: 'Active Work', items: ['VNM-01.01 Fix bug'] }],
      suggestedFocus: ['Continue VNM-01.01'],
    });
    expect(xml).toContain('<session-briefing project="VNM">');
    expect(xml).toContain('<active_work>');
    expect(xml).toContain('VNM-01.01 Fix bug');
    expect(xml).toContain('<suggested_focus>');
  });
});

describe('renderBriefingMarkdown', () => {
  it('renders sections as markdown headers', () => {
    const md = renderBriefingMarkdown({
      project: 'VNM',
      sections: [{ heading: 'Active Work', items: ['VNM-01.01 Fix bug'] }],
      suggestedFocus: ['Continue VNM-01.01'],
    });
    expect(md).toContain('# Session Briefing — VNM');
    expect(md).toContain('## Active Work');
    expect(md).toContain('- VNM-01.01 Fix bug');
    expect(md).toContain('## Suggested Focus');
  });
});
