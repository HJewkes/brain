import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SessionAnalytics } from '../../../../src/modules/sessions/types.js';
import { runPostExecutionAnalysis } from '../../../../src/modules/sessions/analytics/post-execution-analyzer.js';

vi.mock('../../../../src/services/ollama.js', () => ({
  checkOllamaHealth: vi.fn(),
  ollamaGenerate: vi.fn(),
}));

vi.mock('../../../../src/modules/sessions/analytics/gpa-scorer.js', () => ({
  computeActionScore: vi.fn().mockReturnValue(7.0),
  scoreGpa: vi.fn(),
}));

vi.mock('../../../../src/modules/sessions/analytics/skill-counters.js', () => ({
  updateSkillCounter: vi.fn(),
  listSkillCounters: vi.fn(),
}));

import { checkOllamaHealth } from '../../../../src/services/ollama.js';
import { scoreGpa } from '../../../../src/modules/sessions/analytics/gpa-scorer.js';
import { updateSkillCounter } from '../../../../src/modules/sessions/analytics/skill-counters.js';

const mockCheckOllamaHealth = checkOllamaHealth as ReturnType<typeof vi.fn>;
const mockScoreGpa = scoreGpa as ReturnType<typeof vi.fn>;
const mockUpdateSkillCounter = updateSkillCounter as ReturnType<typeof vi.fn>;

function makeGpaResult(overrides = {}) {
  return {
    sessionId: 'test-session',
    gpa: 7.5,
    dimensions: { goal: 8, plan: 7, action: 7 },
    rationale: { goal: 'Clear goal', plan: 'Good plan', action: 'errorRate=0, frictionCount=0' },
    scoredAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeFakeBrain() {
  return {
    db: {
      prepare: vi.fn().mockReturnValue({ run: vi.fn(), get: vi.fn(), all: vi.fn() }),
    },
    config: { notesDir: '/tmp/notes' },
    addNote: vi.fn().mockResolvedValue({ slug: 'sessions/analysis/test-session' }),
    searchNotes: vi.fn().mockResolvedValue([]),
  } as unknown;
}

function makeAnalytics(overrides: Partial<SessionAnalytics> = {}): SessionAnalytics {
  return {
    sessionId: 'test-session',
    projectDir: '/tmp/test',
    gitBranch: null,
    model: null,
    claudeVersion: null,
    startTime: new Date().toISOString(),
    endTime: new Date().toISOString(),
    durationMs: 5000,
    userTurns: 2,
    assistantTurns: 2,
    isCompacted: false,
    compactionCount: 0,
    sidechainEventCount: 0,
    toolCalls: Array.from({ length: 20 }, (_, i) => ({
      toolUseId: `tool-${i}`,
      toolName: 'Read',
      input: {},
      timestamp: new Date().toISOString(),
      outcome: 'success' as const,
      isSidechain: false,
    })),
    toolCallsByName: { Read: 20 },
    uniqueToolsUsed: ['Read'],
    errors: [],
    errorCount: 0,
    errorRate: 0,
    tokens: { inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 },
    frictionSignals: [],
    hookEventCount: 0,
    hookPreventionCount: 0,
    capturedViaHooks: true,
    capturedViaJsonl: false,
    slug: null,
    logicalParentUuid: null,
    compactionTimestamps: [],
    compactionSummaries: [],
    compactionByteOffsets: [],
    tokenSnapshots: [],
    assistantTexts: ['Doing work'],
    userTexts: ['Implement X'],
    prLinks: [],
    filesTouched: new Map(),
    filesWritten: [],
    taskRefs: ['VNM-34.86'],
    modelCounts: new Map(),
    thinkingBlockCount: 0,
    planPresent: true,
    permissionMode: null,
    serviceTier: null,
    gitCommandCount: 2,
    commitCount: 1,
    subagentCount: 0,
    skillUsage: new Map(),
    analyticsExt: { context_pressure: 0.2 },
    ...overrides,
  };
}

describe('runPostExecutionAnalysis', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCheckOllamaHealth.mockResolvedValue(false);
    mockScoreGpa.mockResolvedValue(makeGpaResult());
    mockUpdateSkillCounter.mockResolvedValue(undefined);
  });

  it('AC-09: returns analysisNoteSlug after successful run', async () => {
    const brain = makeFakeBrain();
    const analytics = makeAnalytics();
    const result = await runPostExecutionAnalysis(brain, analytics, 'Implement feature X');
    expect(result.sessionId).toBe('test-session');
    expect(result.gpa).toBeDefined();
    expect(typeof result.analysisNoteSlug === 'string' || result.analysisNoteSlug === null).toBe(
      true
    );
  });

  it('AC-10: calls updateSkillCounter for each skill in skillUsage', async () => {
    const skillUsage = new Map([
      ['commit', 3],
      ['vitest', 1],
    ]);
    const analytics = makeAnalytics({ skillUsage });
    const brain = makeFakeBrain();
    mockScoreGpa.mockResolvedValue(makeGpaResult({ gpa: 7.5 }));
    await runPostExecutionAnalysis(brain, analytics, null);
    expect(mockUpdateSkillCounter).toHaveBeenCalledWith(
      expect.anything(),
      'commit',
      'success',
      7.5
    );
    expect(mockUpdateSkillCounter).toHaveBeenCalledWith(
      expect.anything(),
      'vitest',
      'success',
      7.5
    );
    expect(mockUpdateSkillCounter.mock.calls.length >= 2).toBeTruthy();
  });

  it('AC-11: generates evolution suggestion when Action < 6 and friction > 3', async () => {
    mockCheckOllamaHealth.mockResolvedValue(true);
    const frictionSignals = Array.from({ length: 4 }, () => ({
      kind: 'error_loop' as const,
      timestamp: new Date().toISOString(),
      detail: 'repeated failure',
    }));
    mockScoreGpa.mockResolvedValue(
      makeGpaResult({ gpa: 5.0, dimensions: { goal: 7, plan: 6, action: 3 } })
    );
    const analytics = makeAnalytics({ frictionSignals });
    const brain = makeFakeBrain();
    const result = await runPostExecutionAnalysis(brain, analytics, null);
    expect(result.evolutionSuggestionSlug).not.toBeNull();
  });

  it('AC-11: no evolution suggestion when Action >= 6', async () => {
    mockCheckOllamaHealth.mockResolvedValue(true);
    mockScoreGpa.mockResolvedValue(
      makeGpaResult({ gpa: 8.0, dimensions: { goal: 8, plan: 8, action: 8 } })
    );
    const analytics = makeAnalytics({ frictionSignals: [] });
    const brain = makeFakeBrain();
    const result = await runPostExecutionAnalysis(brain, analytics, null);
    expect(result.evolutionSuggestionSlug).toBeNull();
  });

  it('EC-03: does not re-analyze existing session without force flag', async () => {
    // brain.searchNotes returns an existing analysis note
    const brain = makeFakeBrain() as Record<string, unknown>;
    (brain.searchNotes as ReturnType<typeof vi.fn>).mockResolvedValue([
      { slug: 'sessions/analysis/test-session', metadata: { session_id: 'test-session' } },
    ]);
    const analytics = makeAnalytics();
    const result = await runPostExecutionAnalysis(brain as unknown, analytics, null, {
      force: false,
    });
    expect(result.skipped).toBe(true);
  });

  it('EC-03: re-analyzes with force flag even when analysis exists', async () => {
    const brain = makeFakeBrain() as Record<string, unknown>;
    (brain.searchNotes as ReturnType<typeof vi.fn>).mockResolvedValue([
      { slug: 'sessions/analysis/test-session', metadata: { session_id: 'test-session' } },
    ]);
    const analytics = makeAnalytics();
    const result = await runPostExecutionAnalysis(brain as unknown, analytics, null, {
      force: true,
    });
    expect(result.skipped).toBeFalsy();
  });
});
