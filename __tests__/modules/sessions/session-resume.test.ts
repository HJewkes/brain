import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the session lookup — files are queried directly via raw DB, not getStructuralEvents
vi.mock('../../../src/modules/sessions/data/session-ops.js', () => ({
  getSessionBySessionId: vi.fn(),
}));

vi.mock('../../../src/modules/sessions/engine/aggregate.js', () => ({
  getSessionChunkContents: vi.fn().mockReturnValue([]),
}));

import { getSessionBySessionId } from '../../../src/modules/sessions/data/session-ops.js';
import {
  generateResumeContext,
  renderResumeXml,
  renderResumePlain,
} from '../../../src/modules/sessions/engine/session-resume.js';
import type { BrainDB } from '../../../src/services/brain-db.js';

const mockGetSession = getSessionBySessionId as ReturnType<typeof vi.fn>;

// Build a fake BrainDB with a raw DB that supports structural_events queries
function makeFakeDb(fileRows: Array<{ file_path: string }> = {}): BrainDB {
  const prepare = vi.fn().mockReturnValue({
    all: vi.fn().mockReturnValue(fileRows),
    get: vi.fn(),
    run: vi.fn(),
  });
  return { db: { prepare } } as unknown as BrainDB;
}

const fakeDb = makeFakeDb();

function makeSession(overrides: Record<string, unknown> = {}) {
  return {
    session_id: 'sess-abc123',
    display_id: 'SNS-042',
    project: 'VNM',
    project_dir: '/proj',
    status: 'active' as const,
    started_at: '2026-03-14T10:00:00Z',
    compact_count: 2,
    branch: 'feat/my-feature',
    worktree_path: '/proj/.worktrees/feat-my-feature',
    tasks_worked: ['VNM-20.01', 'VNM-20.02'],
    tasks_completed: ['VNM-20.01'],
    commits: ['abc1234 Add feature'],
    ...overrides,
  };
}

describe('generateResumeContext', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns null when session not found', () => {
    mockGetSession.mockReturnValue(null);

    const result = generateResumeContext(fakeDb, 'sess-missing');
    expect(result).toBeNull();
  });

  it('returns correct context for a session with all fields populated', () => {
    const session = makeSession();
    mockGetSession.mockReturnValue(session);
    const db = makeFakeDb([{ file_path: '/proj/src/foo.ts' }]);

    const ctx = generateResumeContext(db, 'sess-abc123');
    expect(ctx).not.toBeNull();
    expect(ctx!.sessionId).toBe('sess-abc123');
    expect(ctx!.displayId).toBe('SNS-042');
    expect(ctx!.project).toBe('VNM');
    expect(ctx!.startedAt).toBe('2026-03-14T10:00:00Z');
    expect(ctx!.compactCount).toBe(2);
    expect(ctx!.tasksWorked).toEqual(['VNM-20.01', 'VNM-20.02']);
    expect(ctx!.tasksCompleted).toEqual(['VNM-20.01']);
    expect(ctx!.commits).toEqual(['abc1234 Add feature']);
    expect(ctx!.filesWritten).toContain('/proj/src/foo.ts');
  });

  it('returns empty arrays when no events exist', () => {
    const session = makeSession({
      tasks_worked: undefined,
      tasks_completed: undefined,
      commits: undefined,
    });
    mockGetSession.mockReturnValue(session);
    const db = makeFakeDb([]);

    const ctx = generateResumeContext(db, 'sess-abc123');
    expect(ctx).not.toBeNull();
    expect(ctx!.filesWritten).toEqual([]);
    expect(ctx!.tasksWorked).toEqual([]);
    expect(ctx!.tasksCompleted).toEqual([]);
    expect(ctx!.commits).toEqual([]);
  });

  it('includes compactCount from session metadata', () => {
    mockGetSession.mockReturnValue(makeSession({ compact_count: 5 }));

    const ctx = generateResumeContext(fakeDb, 'sess-abc123');
    expect(ctx!.compactCount).toBe(5);
  });

  it('defaults compactCount to 0 when not set in metadata', () => {
    mockGetSession.mockReturnValue(makeSession({ compact_count: undefined }));

    const ctx = generateResumeContext(fakeDb, 'sess-abc123');
    expect(ctx!.compactCount).toBe(0);
  });

  it('includes active constraints from session metadata', () => {
    mockGetSession.mockReturnValue(makeSession());

    const ctx = generateResumeContext(fakeDb, 'sess-abc123');
    expect(ctx!.activeConstraints.worktreePath).toBe('/proj/.worktrees/feat-my-feature');
    expect(ctx!.activeConstraints.gitBranch).toBe('feat/my-feature');
  });

  it('collects file paths from structural_events via raw DB query', () => {
    mockGetSession.mockReturnValue(makeSession());
    const db = makeFakeDb([{ file_path: '/proj/src/foo.ts' }, { file_path: '/proj/src/bar.ts' }]);

    const ctx = generateResumeContext(db, 'sess-abc123');
    expect(ctx!.filesWritten).toContain('/proj/src/foo.ts');
    expect(ctx!.filesWritten).toContain('/proj/src/bar.ts');
  });
});

describe('renderResumeXml', () => {
  const baseCtx = {
    sessionId: 'sess-abc123',
    displayId: 'SNS-042',
    project: 'VNM',
    startedAt: '2026-03-14T10:00:00Z',
    compactCount: 2,
    filesWritten: ['/proj/src/foo.ts', '/proj/src/bar.ts'],
    tasksWorked: ['VNM-20.01', 'VNM-20.02'],
    tasksCompleted: ['VNM-20.01'],
    commits: ['abc1234 Add feature'],
    activeConstraints: {
      worktreePath: '/proj/.worktrees/feat',
      gitBranch: 'feat/my-feature',
    },
  };

  it('contains <session-resume> root tag', () => {
    const xml = renderResumeXml(baseCtx);
    expect(xml).toContain('<session-resume');
    expect(xml).toContain('</session-resume>');
  });

  it('includes session identity fields', () => {
    const xml = renderResumeXml(baseCtx);
    // displayId is in the root element attribute; sessionId is internal context
    expect(xml).toContain('SNS-042');
    expect(xml).toContain('VNM');
  });

  it('lists files written', () => {
    const xml = renderResumeXml(baseCtx);
    expect(xml).toContain('/proj/src/foo.ts');
    expect(xml).toContain('/proj/src/bar.ts');
  });

  it('lists tasks worked and completed', () => {
    const xml = renderResumeXml(baseCtx);
    expect(xml).toContain('VNM-20.01');
    expect(xml).toContain('VNM-20.02');
  });

  it('includes active constraints', () => {
    const xml = renderResumeXml(baseCtx);
    expect(xml).toContain('feat/my-feature');
    expect(xml).toContain('/proj/.worktrees/feat');
  });

  it('contains compaction instruction text', () => {
    const xml = renderResumeXml(baseCtx);
    // Should instruct agent how to resume
    expect(xml.toLowerCase()).toMatch(/compact|resume|context/);
  });

  it('handles null project gracefully', () => {
    const ctx = { ...baseCtx, project: null };
    expect(() => renderResumeXml(ctx)).not.toThrow();
    const xml = renderResumeXml(ctx);
    expect(xml).toContain('<session-resume');
  });

  it('handles empty arrays without crashing', () => {
    const ctx = {
      ...baseCtx,
      filesWritten: [],
      tasksWorked: [],
      tasksCompleted: [],
      commits: [],
    };
    expect(() => renderResumeXml(ctx)).not.toThrow();
  });
});

describe('renderResumePlain', () => {
  const baseCtx = {
    sessionId: 'sess-abc123',
    displayId: 'SNS-042',
    project: 'VNM',
    startedAt: '2026-03-14T10:00:00Z',
    compactCount: 1,
    filesWritten: ['/proj/src/widget.ts'],
    tasksWorked: ['VNM-20.01'],
    tasksCompleted: [],
    commits: [],
    activeConstraints: { gitBranch: 'feat/widget' },
  };

  it('contains session display ID', () => {
    const plain = renderResumePlain(baseCtx);
    expect(plain).toContain('SNS-042');
  });

  it('lists files touched', () => {
    const plain = renderResumePlain(baseCtx);
    expect(plain).toContain('/proj/src/widget.ts');
  });

  it('lists tasks worked', () => {
    const plain = renderResumePlain(baseCtx);
    expect(plain).toContain('VNM-20.01');
  });

  it('contains the "Context was compacted" instruction', () => {
    const plain = renderResumePlain(baseCtx);
    expect(plain.toLowerCase()).toMatch(/compact/);
  });

  it('is more compact than a full briefing (fewer than 30 lines)', () => {
    const plain = renderResumePlain(baseCtx);
    const lineCount = plain.split('\n').length;
    expect(lineCount).toBeLessThan(30);
  });
});
