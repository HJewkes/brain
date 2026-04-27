import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { BrainServiceClass } from '../../src/services/brain-service.js';
import type { TriageResult } from '../../src/server/triage.js';
import type { SessionMetadata } from '../../src/modules/sessions/types.js';

vi.mock('../../src/server/triage.js', () => ({
  triageDispatch: vi.fn(),
}));

vi.mock('../../src/modules/sessions/data/session-ops.js', () => ({
  listSessions: vi.fn(),
}));

const { triageDispatch } = await import('../../src/server/triage.js');
const { listSessions } = await import('../../src/modules/sessions/data/session-ops.js');
const { generateNextSessionPrompt, renderNextSessionPrompt, writeNextSessionPrompt } =
  await import('../../src/services/next-session-prompt.js');

const mockTriage = triageDispatch as ReturnType<typeof vi.fn>;
const mockListSessions = listSessions as ReturnType<typeof vi.fn>;

function makeService(): BrainServiceClass {
  return { db: {} } as unknown as BrainServiceClass;
}

function emptyTriage(overrides: Partial<TriageResult> = {}): TriageResult {
  return {
    generatedAt: '2026-04-27T10:00:00.000Z',
    scope: { prefix: 'VNM' },
    totals: { ready: 0, in_flight: 0, stuck: 0, blocked: 0, capacity_limited: 0 },
    wip: { activeAgents: 0, limit: null, atCapacity: false },
    workstreams: [],
    ...overrides,
  };
}

function makeSession(overrides: Partial<SessionMetadata> = {}): SessionMetadata {
  return {
    session_id: 'sess-uuid-1',
    display_id: 'SNS-007',
    project_dir: '/tmp/proj',
    project: 'VNM',
    status: 'completed',
    started_at: '2026-04-26T08:00:00.000Z',
    summary: 'Landed three PRs and unblocked dispatcher',
    tasks_completed: ['VNM-56.51', 'VNM-56.52'],
    pr_links: ['https://github.com/x/y/pull/190'],
    commits: ['abc123', 'def456'],
    duration_minutes: 95,
    cost_usd: 24.5,
    tool_calls: 412,
    error_count: 8,
    outcome: 'success',
    ...overrides,
  };
}

beforeEach(() => {
  mockTriage.mockReset();
  mockListSessions.mockReset();
});

describe('generateNextSessionPrompt', () => {
  it('combines triage data with the most recent completed session', () => {
    mockTriage.mockReturnValue(
      emptyTriage({
        totals: { ready: 2, in_flight: 1, stuck: 1, blocked: 0, capacity_limited: 0 },
        workstreams: [
          {
            workstream: 'VNM-43',
            title: 'Session Continuity',
            counts: { ready: 1, in_flight: 0, stuck: 1, blocked: 0, capacity_limited: 0 },
            tasks: [
              {
                displayId: 'VNM-43.04',
                workstream: 'VNM-43',
                title: 'Hot task prioritization',
                status: 'pending',
                priority: 'high',
                classification: 'ready',
              },
              {
                displayId: 'VNM-43.10',
                workstream: 'VNM-43',
                title: 'Broken dispatcher',
                status: 'in-progress',
                priority: 'critical',
                classification: 'stuck',
                stuckKind: 'pr-conflict',
                reason: 'PR has merge conflicts',
                delivery: {
                  status: 'conflicted',
                  prNumber: 200,
                  prUrl: null,
                  reviewTier: null,
                  fixAttempts: 0,
                  stallReason: null,
                },
              },
            ],
          },
          {
            workstream: 'VNM-56',
            title: 'Review & Merge',
            counts: { ready: 1, in_flight: 1, stuck: 0, blocked: 0, capacity_limited: 0 },
            tasks: [
              {
                displayId: 'VNM-56.46',
                workstream: 'VNM-56',
                title: 'Watchdog',
                status: 'pending',
                priority: 'critical',
                classification: 'ready',
              },
              {
                displayId: 'VNM-56.45',
                workstream: 'VNM-56',
                title: 'Merge reconciler',
                status: 'in-progress',
                priority: 'high',
                classification: 'in_flight',
              },
            ],
          },
        ],
      })
    );
    mockListSessions.mockReturnValue([
      makeSession(),
      makeSession({ display_id: 'SNS-006', status: 'active' }),
    ]);

    const result = generateNextSessionPrompt(makeService(), {
      asOf: '2026-04-27T11:00:00.000Z',
    });

    expect(result.recentSessions).toHaveLength(1);
    expect(result.recentSessions[0].display_id).toBe('SNS-007');

    const md = result.markdown;
    expect(md).toContain('# Next Session — VNM');
    expect(md).toContain('SNS-007');
    expect(md).toContain('Landed three PRs');
    expect(md).toContain('Completed: VNM-56.51, VNM-56.52');
    expect(md).toContain('Cost: $24.50');
    expect(md).toContain('ready: 2 | in_flight: 1 | stuck: 1');
    expect(md).toContain('## Stuck — Needs Attention');
    expect(md).toContain('VNM-43.10');
    expect(md).toContain('[pr-conflict]');
    expect(md).toContain('PR #200');
    expect(md).toContain('## In Flight');
    expect(md).toContain('VNM-56.45');
    expect(md).toContain('## Ready to Pick Up');
    // Critical priority should sort before high priority
    expect(md.indexOf('VNM-56.46')).toBeLessThan(md.indexOf('VNM-43.04'));
    expect(md).toContain('Spans: VNM-43');
  });

  it('renders an empty-but-valid prompt when nothing is in triage', () => {
    mockTriage.mockReturnValue(emptyTriage());
    mockListSessions.mockReturnValue([]);

    const result = generateNextSessionPrompt(makeService(), {
      asOf: '2026-04-27T10:00:00.000Z',
    });

    expect(result.markdown).toContain('# Next Session — VNM');
    expect(result.markdown).toContain('_No completed session on record');
    expect(result.markdown).toContain('## Stuck — Needs Attention');
    expect(result.markdown).toContain('_None._');
    expect(result.markdown).not.toContain('## In Flight');
    expect(result.markdown).not.toContain('## Ready to Pick Up');
    expect(result.markdown).not.toContain('## Blocked');
  });

  it('filters out non-completed sessions', () => {
    mockTriage.mockReturnValue(emptyTriage());
    mockListSessions.mockReturnValue([
      makeSession({ status: 'active' }),
      makeSession({ display_id: 'SNS-005', status: 'completed' }),
    ]);

    const result = generateNextSessionPrompt(makeService());
    expect(result.recentSessions.map((s) => s.display_id)).toEqual(['SNS-005']);
  });

  it('renders blocked tasks with their incomplete deps', () => {
    mockTriage.mockReturnValue(
      emptyTriage({
        totals: { ready: 0, in_flight: 0, stuck: 0, blocked: 1, capacity_limited: 0 },
        workstreams: [
          {
            workstream: 'VNM-56',
            title: 'Review',
            counts: { ready: 0, in_flight: 0, stuck: 0, blocked: 1, capacity_limited: 0 },
            tasks: [
              {
                displayId: 'VNM-56.46',
                workstream: 'VNM-56',
                title: 'Watchdog',
                status: 'blocked',
                priority: 'critical',
                classification: 'blocked',
                incompleteDeps: ['VNM-45.38'],
              },
            ],
          },
        ],
      })
    );
    mockListSessions.mockReturnValue([]);

    const result = generateNextSessionPrompt(makeService());
    expect(result.markdown).toContain('## Blocked');
    expect(result.markdown).toContain('waiting on VNM-45.38');
  });

  it('flags capacity_limited tasks separately from ready', () => {
    mockTriage.mockReturnValue(
      emptyTriage({
        totals: { ready: 0, in_flight: 0, stuck: 0, blocked: 0, capacity_limited: 2 },
        wip: { activeAgents: 5, limit: 5, atCapacity: true },
        workstreams: [
          {
            workstream: 'VNM-56',
            title: 'Review',
            counts: { ready: 0, in_flight: 0, stuck: 0, blocked: 0, capacity_limited: 2 },
            tasks: [
              {
                displayId: 'VNM-56.40',
                workstream: 'VNM-56',
                title: 'A',
                status: 'pending',
                priority: 'medium',
                classification: 'capacity_limited',
              },
              {
                displayId: 'VNM-56.41',
                workstream: 'VNM-56',
                title: 'B',
                status: 'pending',
                priority: 'medium',
                classification: 'capacity_limited',
              },
            ],
          },
        ],
      })
    );
    mockListSessions.mockReturnValue([]);

    const md = generateNextSessionPrompt(makeService()).markdown;
    expect(md).toContain('AT CAPACITY');
    expect(md).toContain('At-capacity (would be ready if WIP allowed)');
    expect(md).toContain('VNM-56.40');
  });

  it('truncates long sections with a "more" footer', () => {
    const tasks = Array.from({ length: 12 }, (_, i) => ({
      displayId: `VNM-43.${i.toString().padStart(2, '0')}`,
      workstream: 'VNM-43',
      title: `Task ${i}`,
      status: 'pending' as const,
      priority: 'medium',
      classification: 'ready' as const,
    }));
    mockTriage.mockReturnValue(
      emptyTriage({
        totals: { ready: 12, in_flight: 0, stuck: 0, blocked: 0, capacity_limited: 0 },
        workstreams: [
          {
            workstream: 'VNM-43',
            title: 'X',
            counts: { ready: 12, in_flight: 0, stuck: 0, blocked: 0, capacity_limited: 0 },
            tasks,
          },
        ],
      })
    );
    mockListSessions.mockReturnValue([]);

    const md = generateNextSessionPrompt(makeService(), { maxItemsPerSection: 3 }).markdown;
    expect(md).toContain('and 9 more ready');
  });
});

describe('writeNextSessionPrompt', () => {
  it('writes markdown to .plans/next-session-prompt.md by default', () => {
    mockTriage.mockReturnValue(emptyTriage());
    mockListSessions.mockReturnValue([]);

    const dir = mkdtempSync(join(tmpdir(), 'next-session-prompt-'));
    try {
      const out = writeNextSessionPrompt(makeService(), { projectDir: dir });
      expect(out.path).toBe(join(dir, '.plans', 'next-session-prompt.md'));
      expect(readFileSync(out.path, 'utf-8')).toContain('# Next Session — VNM');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('honors an explicit outputPath', () => {
    mockTriage.mockReturnValue(emptyTriage());
    mockListSessions.mockReturnValue([]);

    const dir = mkdtempSync(join(tmpdir(), 'next-session-prompt-'));
    try {
      const target = join(dir, 'nested', 'custom.md');
      const out = writeNextSessionPrompt(makeService(), { outputPath: target });
      expect(out.path).toBe(target);
      expect(readFileSync(target, 'utf-8')).toContain('# Next Session — VNM');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('renderNextSessionPrompt', () => {
  it('is deterministic given a triage + sessions snapshot', () => {
    const triage = emptyTriage();
    const md1 = renderNextSessionPrompt(triage, [], '2026-04-27T10:00:00.000Z');
    const md2 = renderNextSessionPrompt(triage, [], '2026-04-27T10:00:00.000Z');
    expect(md1).toBe(md2);
  });

  it('renders workstream scope into the header when provided', () => {
    const triage = emptyTriage({
      scope: { prefix: 'VNM', workstream: 'VNM-56' },
    });
    const md = renderNextSessionPrompt(triage, [], '2026-04-27T10:00:00.000Z');
    expect(md).toContain('# Next Session — VNM / VNM-56');
    expect(md).toContain('brain_agent_dispatch_workstream workstream=VNM-56');
  });
});
