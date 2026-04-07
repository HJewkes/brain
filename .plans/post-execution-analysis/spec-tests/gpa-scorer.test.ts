import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SessionAnalytics } from '../../../../src/modules/sessions/types.js';
import {
  computeActionScore,
  scoreGpa,
} from '../../../../src/modules/sessions/analytics/gpa-scorer.js';

vi.mock('../../../../src/services/ollama.js', () => ({
  checkOllamaHealth: vi.fn(),
  ollamaGenerate: vi.fn(),
}));

import { checkOllamaHealth, ollamaGenerate } from '../../../../src/services/ollama.js';

const mockCheckOllamaHealth = checkOllamaHealth as ReturnType<typeof vi.fn>;
const mockOllamaGenerate = ollamaGenerate as ReturnType<typeof vi.fn>;

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
    assistantTexts: ['Starting implementation', 'Done'],
    userTexts: ['Implement feature X'],
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

describe('computeActionScore', () => {
  it('AC-06: returns number in [0, 10]', () => {
    const analytics = makeAnalytics({
      errorRate: 0.1,
      frictionSignals: [
        { kind: 'error_loop', timestamp: new Date().toISOString(), detail: 'a' },
        { kind: 'error_loop', timestamp: new Date().toISOString(), detail: 'b' },
      ],
    });
    const score = computeActionScore(analytics);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(10);
  });

  it('AC-06: low error rate scores higher than high error rate', () => {
    const low = computeActionScore(makeAnalytics({ errorRate: 0.0, frictionSignals: [] }));
    const high = computeActionScore(
      makeAnalytics({
        errorRate: 0.5,
        frictionSignals: Array.from({ length: 4 }, () => ({
          kind: 'error_loop' as const,
          timestamp: new Date().toISOString(),
          detail: 'x',
        })),
      })
    );
    expect(low).toBeGreaterThan(high);
  });

  it('EC-01: zero tool calls returns neutral score of 5.0', () => {
    const analytics = makeAnalytics({ toolCalls: [], errorRate: 0, frictionSignals: [] });
    const score = computeActionScore(analytics);
    expect(score).toBe(5.0);
  });
});

describe('scoreGpa', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('AC-07: returns null Goal/Plan when Ollama unavailable, falls back to Action-only gpa', async () => {
    mockCheckOllamaHealth.mockResolvedValue(false);
    const analytics = makeAnalytics({
      taskRefs: ['VNM-34.86'],
      assistantTexts: ['doing work'],
      frictionSignals: [],
    });
    const result = await scoreGpa(analytics, 'Implement feature X');
    expect(result.dimensions.goal).toBeNull();
    expect(result.dimensions.plan).toBeNull();
    expect(typeof result.dimensions.action).toBe('number');
    expect(result.gpa).toBe(result.dimensions.action);
  });

  it('AC-08: returns valid scores in [0, 10] when Ollama available', async () => {
    mockCheckOllamaHealth.mockResolvedValue(true);
    mockOllamaGenerate.mockResolvedValue({
      response:
        '{"goal": 8, "plan": 7, "goal_rationale": "Clear goal stated", "plan_rationale": "Good plan structure"}',
    });
    const analytics = makeAnalytics({
      taskRefs: ['VNM-34.86'],
      assistantTexts: ['Starting implementation of feature X'],
      frictionSignals: [],
    });
    const result = await scoreGpa(analytics, 'Implement feature X');
    expect(result.dimensions.goal).toBeGreaterThanOrEqual(0);
    expect(result.dimensions.goal).toBeLessThanOrEqual(10);
    expect(result.dimensions.plan).toBeGreaterThanOrEqual(0);
    expect(result.dimensions.plan).toBeLessThanOrEqual(10);
    expect(result.dimensions.action).toBeGreaterThanOrEqual(0);
    expect(result.dimensions.action).toBeLessThanOrEqual(10);
    expect(result.gpa).toBeGreaterThanOrEqual(0);
    expect(result.gpa).toBeLessThanOrEqual(10);
  });

  it('EC-05: malformed LLM response falls back to null for affected dimension', async () => {
    mockCheckOllamaHealth.mockResolvedValue(true);
    mockOllamaGenerate.mockResolvedValue({ response: 'seven out of ten' });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const analytics = makeAnalytics();
    const result = await scoreGpa(analytics, 'Implement feature X');
    expect(result.dimensions.goal).toBeNull();
    expect(result.dimensions.plan).toBeNull();
    expect(typeof result.dimensions.action).toBe('number');
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('AC-07: gpa equals action score when both LLM dimensions are null', async () => {
    mockCheckOllamaHealth.mockResolvedValue(false);
    const analytics = makeAnalytics({
      errorRate: 0.0,
      frictionSignals: [],
      toolCalls: Array.from({ length: 20 }, (_, i) => ({
        toolUseId: `t-${i}`,
        toolName: 'Read',
        input: {},
        timestamp: new Date().toISOString(),
        outcome: 'success' as const,
        isSidechain: false,
      })),
    });
    const result = await scoreGpa(analytics, null);
    expect(result.gpa).toBe(result.dimensions.action);
  });

  it('result has required fields', async () => {
    mockCheckOllamaHealth.mockResolvedValue(false);
    const analytics = makeAnalytics();
    const result = await scoreGpa(analytics, null);
    expect(result.sessionId).toBe('test-session');
    expect(typeof result.scoredAt).toBe('string');
    expect(result.rationale.action).toBeTruthy();
  });
});
