import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createTestDb } from '../../../helpers.js';
import type { BrainDB } from '../../../../src/services/brain-db.js';
import type { BrainService } from '../../../../src/services/brain-service.js';
import type { SessionMetadata } from '../../../../src/modules/sessions/types.js';

vi.mock('../../../../src/modules/sessions/analytics/gpa-scorer.js', () => ({
  scoreGpa: vi.fn(),
  computeActionScore: vi.fn().mockReturnValue(7.5),
}));

vi.mock('../../../../src/modules/sessions/engine/aggregate.js', () => ({
  aggregateSessionEvents: vi.fn(),
  parsePrUrl: vi.fn(),
}));

vi.mock('../../../../src/modules/sessions/data/session-ops.js', () => ({
  getSessionBySessionId: vi.fn(),
  getSession: vi.fn(),
  listSessions: vi.fn().mockReturnValue([]),
}));

import {
  runPostExecutionAnalysis,
  sessionNoteMetaToScoringInput,
} from '../../../../src/modules/sessions/analytics/post-execution-analyzer.js';
import { scoreGpa } from '../../../../src/modules/sessions/analytics/gpa-scorer.js';
import { aggregateSessionEvents } from '../../../../src/modules/sessions/engine/aggregate.js';
import { getSessionBySessionId } from '../../../../src/modules/sessions/data/session-ops.js';

const mockScoreGpa = vi.mocked(scoreGpa);
const mockAggregateSessionEvents = vi.mocked(aggregateSessionEvents);
const mockGetSessionBySessionId = vi.mocked(getSessionBySessionId);

const DEFAULT_SCORE = {
  sessionId: 'test-session-id',
  gpa: 7.5,
  dimensions: { goal: null, plan: null, action: 7.5 },
  rationale: { action: 'Error rate 10.0%, friction density 0.00' },
  scoredAt: new Date().toISOString(),
};

const DEFAULT_SESSION: SessionMetadata = {
  session_id: 'test-session-id',
  display_id: 'SNS-001',
  project_dir: '/test',
  status: 'completed',
  started_at: '2026-04-01T10:00:00Z',
  tool_calls: 10,
  error_count: 1,
  error_rate: 0.1,
  tasks_worked: ['VNM-34'],
  outcome: 'success',
};

function makeSvc(db: BrainDB): BrainService {
  return {
    db,
    embedder: { embed: vi.fn() } as never,
    config: {
      notesDir: '/tmp/test-notes',
      dbPath: ':memory:',
      embedder: 'local',
      fusionWeights: { bm25: 0.3, vector: 0.7 },
    },
    modules: {} as never,
    instance: {} as never,
    close: vi.fn(),
  };
}

let db: BrainDB;

beforeEach(() => {
  ({ db } = createTestDb());
  vi.clearAllMocks();
  mockScoreGpa.mockResolvedValue({ ...DEFAULT_SCORE });
  mockAggregateSessionEvents.mockReturnValue(null);
  mockGetSessionBySessionId.mockReturnValue({ ...DEFAULT_SESSION });
});

afterEach(() => {
  db.close();
});

// AC-09: runPostExecutionAnalysis returns PostExecutionResult with score + notePath
describe('runPostExecutionAnalysis', () => {
  it('returns score and notePath on successful analysis', async () => {
    const svc = makeSvc(db);
    const result = await runPostExecutionAnalysis(svc, 'test-session-id');

    expect(result.skipped).toBe(false);
    expect(result.score).toBeDefined();
    expect(result.score.dimensions.action).toBeDefined();
    expect(result.notePath).toBeTruthy();
    expect(result.notePath).toContain('session-analysis');
  });

  it('writes an analysis note to the DB with correct module/type', async () => {
    const svc = makeSvc(db);
    await runPostExecutionAnalysis(svc, 'test-session-id');

    const noteIds = db.getModuleNoteIds({ module: 'sessions', type: 'analysis' });
    expect(noteIds.length).toBeGreaterThan(0);

    const notes = db.getNotesByIds(noteIds);
    const note = [...notes.values()][0];
    expect(note.metadata).toContain('test-session-id');
  });

  it('uses metadata fallback when no live events exist', async () => {
    mockAggregateSessionEvents.mockReturnValue(null);

    const svc = makeSvc(db);
    const result = await runPostExecutionAnalysis(svc, 'test-session-id');

    expect(mockGetSessionBySessionId).toHaveBeenCalledWith(db, 'test-session-id');
    expect(result.skipped).toBe(false);
  });

  it('throws when session not found in metadata fallback', async () => {
    mockAggregateSessionEvents.mockReturnValue(null);
    mockGetSessionBySessionId.mockReturnValue(null);

    const svc = makeSvc(db);
    await expect(runPostExecutionAnalysis(svc, 'missing-session')).rejects.toThrow(
      'Session missing-session not found'
    );
  });
});

// EC-03: Idempotency — skip if analysis note exists and force not set
describe('runPostExecutionAnalysis - idempotency (EC-03)', () => {
  it('skips on second run when force is not set', async () => {
    const svc = makeSvc(db);

    const first = await runPostExecutionAnalysis(svc, 'test-session-id');
    expect(first.skipped).toBe(false);

    const second = await runPostExecutionAnalysis(svc, 'test-session-id', undefined, {
      force: false,
    });
    expect(second.skipped).toBe(true);
    expect(second.skipReason).toContain('already analyzed');
    expect(second.notePath).toBeTruthy();
  });

  it('overwrites existing note when force is true', async () => {
    const svc = makeSvc(db);

    await runPostExecutionAnalysis(svc, 'test-session-id');
    const second = await runPostExecutionAnalysis(svc, 'test-session-id', undefined, {
      force: true,
    });

    expect(second.skipped).toBe(false);
    expect(second.score).toBeDefined();
  });
});

// AC-11: skill counters updated for each skill in skillUsage
describe('runPostExecutionAnalysis - skill counter updates', () => {
  it('updates skill counters for each skill when live analytics are available', async () => {
    mockAggregateSessionEvents.mockReturnValue({
      sessionId: 'test-session-id',
      errorRate: 0.1,
      frictionSignals: [],
      toolCalls: [
        {
          toolName: 'Read',
          outcome: 'success',
          isSidechain: false,
          toolUseId: '1',
          input: {},
          timestamp: '',
        },
      ],
      taskRefs: ['VNM-34'],
      planPresent: false,
      assistantTexts: [],
      skillUsage: new Map([
        ['spec', 3],
        ['commit', 1],
      ]),
      projectDir: '/test',
      gitBranch: null,
      model: null,
      claudeVersion: null,
      startTime: '',
      endTime: '',
      durationMs: 0,
      userTurns: 0,
      assistantTurns: 0,
      isCompacted: false,
      compactionCount: 0,
      sidechainEventCount: 0,
      toolCallsByName: {},
      uniqueToolsUsed: [],
      errors: [],
      errorCount: 1,
      tokens: { inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 },
      hookEventCount: 0,
      hookPreventionCount: 0,
      capturedViaHooks: false,
      capturedViaJsonl: false,
      slug: null,
      logicalParentUuid: null,
      compactionTimestamps: [],
      compactionSummaries: [],
      compactionByteOffsets: [],
      tokenSnapshots: [],
      userTexts: [],
      prLinks: [],
      filesTouched: new Map(),
      filesWritten: [],
      modelCounts: new Map(),
      thinkingBlockCount: 0,
      permissionMode: null,
      serviceTier: null,
      gitCommandCount: 0,
      commitCount: 0,
      subagentCount: 0,
    });

    const svc = makeSvc(db);
    await runPostExecutionAnalysis(svc, 'test-session-id');

    const noteIds = db.getModuleNoteIds({ module: 'sessions', type: 'skill-counter' });
    expect(noteIds.length).toBeGreaterThanOrEqual(2);

    const notes = db.getNotesByIds(noteIds);
    const skillNames = [...notes.values()]
      .map((n) => {
        if (!n.metadata) return null;
        const m = JSON.parse(n.metadata) as Record<string, unknown>;
        return m.skillName as string;
      })
      .filter(Boolean);

    expect(skillNames).toContain('spec');
    expect(skillNames).toContain('commit');
  });
});

// EC-04: sessionNoteMetaToScoringInput maps SessionMetadata → GpaScoringInput
describe('sessionNoteMetaToScoringInput (EC-04)', () => {
  it('maps error_rate and tool_calls from session metadata', () => {
    const meta: SessionMetadata = {
      session_id: 'sess-1',
      display_id: 'SNS-001',
      project_dir: '/test',
      status: 'completed',
      started_at: '2026-01-01T00:00:00Z',
      tool_calls: 20,
      error_count: 4,
      error_rate: 0.2,
      tasks_worked: ['VNM-10', 'VNM-11'],
      plan_id: 'plan-abc',
      outcome: 'success',
    };

    const input = sessionNoteMetaToScoringInput(meta);

    expect(input.errorRate).toBeCloseTo(0.2);
    expect(input.toolCalls).toHaveLength(20);
    expect(input.taskRefs).toEqual(['VNM-10', 'VNM-11']);
    expect(input.planPresent).toBe(true);
    expect(input.outcome).toBe('success');
    expect(input.frictionSignals).toEqual([]);
  });

  it('computes error_rate from counts when error_rate field is absent', () => {
    const meta: SessionMetadata = {
      session_id: 'sess-2',
      display_id: 'SNS-002',
      project_dir: '/test',
      status: 'completed',
      started_at: '2026-01-01T00:00:00Z',
      tool_calls: 10,
      error_count: 2,
    };

    const input = sessionNoteMetaToScoringInput(meta);
    expect(input.errorRate).toBeCloseTo(0.2);
  });

  it('returns zero errorRate and empty toolCalls when no tool data', () => {
    const meta: SessionMetadata = {
      session_id: 'sess-3',
      display_id: 'SNS-003',
      project_dir: '/test',
      status: 'completed',
      started_at: '2026-01-01T00:00:00Z',
    };

    const input = sessionNoteMetaToScoringInput(meta);
    expect(input.errorRate).toBe(0);
    expect(input.toolCalls).toHaveLength(0);
    expect(input.taskRefs).toEqual([]);
    expect(input.planPresent).toBe(false);
    expect(input.outcome).toBeNull();
  });

  it('returns false for planPresent when plan_id is not set', () => {
    const meta: SessionMetadata = {
      session_id: 'sess-4',
      display_id: 'SNS-004',
      project_dir: '/test',
      status: 'completed',
      started_at: '2026-01-01T00:00:00Z',
    };

    const input = sessionNoteMetaToScoringInput(meta);
    expect(input.planPresent).toBe(false);
  });
});
