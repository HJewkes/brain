import { describe, it, expect } from 'vitest';
import {
  computeReferenceDistribution,
  compareToReference,
  scoreSessionQuality,
} from '../../../src/modules/sessions/analytics/scorer.js';
import type { SessionQualityScore } from '../../../src/modules/sessions/analytics/scorer.js';
import type {
  SessionAnalytics,
  ToolCall,
  FrictionSignal,
} from '../../../src/modules/sessions/types.js';

function makeToolCall(overrides: Partial<ToolCall> = {}): ToolCall {
  return {
    toolUseId: 'tc-1',
    toolName: 'Read',
    input: {},
    timestamp: '2026-01-01T00:00:00Z',
    outcome: 'success',
    isSidechain: false,
    ...overrides,
  };
}

function makeAnalytics(overrides: Partial<SessionAnalytics> = {}): SessionAnalytics {
  return {
    sessionId: 'sess-1',
    projectDir: '/tmp/project',
    gitBranch: null,
    model: null,
    claudeVersion: null,
    startTime: '2026-01-01T00:00:00Z',
    endTime: '2026-01-01T01:00:00Z',
    durationMs: 3600000,
    userTurns: 5,
    assistantTurns: 5,
    isCompacted: false,
    compactionCount: 0,
    sidechainEventCount: 0,
    toolCalls: [],
    toolCallsByName: {},
    uniqueToolsUsed: [],
    errors: [],
    errorCount: 0,
    errorRate: 0,
    tokens: { inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 },
    frictionSignals: [],
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
    assistantTexts: [],
    userTexts: [],
    prLinks: [],
    filesTouched: new Map(),
    filesWritten: [],
    taskRefs: [],
    modelCounts: new Map(),
    thinkingBlockCount: 0,
    planPresent: false,
    permissionMode: null,
    serviceTier: null,
    gitCommandCount: 0,
    commitCount: 0,
    subagentCount: 0,
    skillUsage: new Map(),
    ...overrides,
  };
}

function makeScore(
  overall: number,
  overrides: Partial<SessionQualityScore> = {}
): SessionQualityScore {
  return {
    overall,
    efficiency: 0.8,
    reliability: 0.9,
    assurance: 0.85,
    steadiness: 0.9,
    raw: {
      toolCallCount: 20,
      commitCount: 1,
      taskRefCount: 1,
      errorRate: 0.1,
      frictionSignalCount: 1,
      retryCount: 0,
      hookPreventionCount: 0,
    },
    ...overrides,
  };
}

describe('computeReferenceDistribution', () => {
  it('returns null when fewer than 2 scores are provided', () => {
    expect(computeReferenceDistribution([])).toBeNull();
    expect(computeReferenceDistribution([makeScore(80)])).toBeNull();
  });

  it('computes correct mean from two scores', () => {
    const scores = [makeScore(60), makeScore(80)];
    const dist = computeReferenceDistribution(scores);
    expect(dist).not.toBeNull();
    expect(dist!.meanOverall).toBe(70);
    expect(dist!.sampleSize).toBe(2);
  });

  it('computes correct stddev from two scores', () => {
    const scores = [makeScore(60), makeScore(80)];
    const dist = computeReferenceDistribution(scores);
    // sample stddev: sqrt(((60-70)^2 + (80-70)^2) / 1) = sqrt(200) ≈ 14.14
    expect(dist!.stddevOverall).toBeCloseTo(14.14, 1);
  });

  it('returns zero stddev when all scores are identical', () => {
    const scores = [makeScore(75), makeScore(75), makeScore(75)];
    const dist = computeReferenceDistribution(scores);
    expect(dist!.stddevOverall).toBe(0);
    expect(dist!.meanOverall).toBe(75);
  });

  it('computes dimension means correctly', () => {
    const s1 = makeScore(70, {
      efficiency: 0.6,
      reliability: 0.8,
      assurance: 0.7,
      steadiness: 0.9,
    });
    const s2 = makeScore(80, {
      efficiency: 0.8,
      reliability: 1.0,
      assurance: 0.9,
      steadiness: 0.7,
    });
    const dist = computeReferenceDistribution([s1, s2]);
    expect(dist!.meanEfficiency).toBeCloseTo(0.7);
    expect(dist!.meanReliability).toBeCloseTo(0.9);
    expect(dist!.meanAssurance).toBeCloseTo(0.8);
    expect(dist!.meanSteadiness).toBeCloseTo(0.8);
  });

  it('handles larger sample sizes', () => {
    const scores = [makeScore(70), makeScore(75), makeScore(80), makeScore(85), makeScore(90)];
    const dist = computeReferenceDistribution(scores);
    expect(dist!.sampleSize).toBe(5);
    expect(dist!.meanOverall).toBe(80);
  });
});

describe('compareToReference', () => {
  it('returns regressed=false when candidate is at the reference mean', () => {
    const dist = computeReferenceDistribution([makeScore(70), makeScore(90)])!;
    const report = compareToReference(makeScore(80), dist);
    expect(report.regressed).toBe(false);
    expect(report.zScore).toBeCloseTo(0, 5);
  });

  it('returns regressed=false when candidate is above the reference mean', () => {
    const dist = computeReferenceDistribution([makeScore(70), makeScore(90)])!;
    const report = compareToReference(makeScore(95), dist);
    expect(report.regressed).toBe(false);
    expect(report.zScore).toBeGreaterThan(0);
  });

  it('returns regressed=true when candidate is >1.5σ below the reference mean', () => {
    // mean=80, stddev≈14.14; threshold at z=-1.5 → 80 - 1.5*14.14 ≈ 58.8
    const dist = computeReferenceDistribution([makeScore(70), makeScore(90)])!;
    const report = compareToReference(makeScore(50), dist);
    expect(report.regressed).toBe(true);
    expect(report.zScore).toBeLessThan(-1.5);
  });

  it('returns regressed=false just above the threshold', () => {
    // mean=80, stddev≈14.14; z=-1.5 → score ≈ 58.8; 60 should pass
    const dist = computeReferenceDistribution([makeScore(70), makeScore(90)])!;
    const report = compareToReference(makeScore(60), dist);
    expect(report.regressed).toBe(false);
  });

  it('includes a human-readable message', () => {
    const dist = computeReferenceDistribution([makeScore(70), makeScore(90)])!;
    const passing = compareToReference(makeScore(80), dist);
    expect(passing.message).toContain('within reference bounds');

    const failing = compareToReference(makeScore(30), dist);
    expect(failing.message).toContain('regressed');
  });

  it('attaches the reference distribution and candidate score to the report', () => {
    const dist = computeReferenceDistribution([makeScore(70), makeScore(90)])!;
    const candidate = makeScore(80);
    const report = compareToReference(candidate, dist);
    expect(report.referenceDistribution).toBe(dist);
    expect(report.candidateScore).toBe(candidate);
  });

  it('handles zero stddev: candidate at mean is not regressed', () => {
    const dist = computeReferenceDistribution([makeScore(75), makeScore(75)])!;
    const report = compareToReference(makeScore(75), dist);
    expect(report.zScore).toBe(0);
    expect(report.regressed).toBe(false);
  });

  it('handles zero stddev: candidate below mean is regressed (z=-Infinity)', () => {
    const dist = computeReferenceDistribution([makeScore(75), makeScore(75)])!;
    const report = compareToReference(makeScore(50), dist);
    expect(report.zScore).toBe(-Infinity);
    expect(report.regressed).toBe(true);
  });
});

describe('golden dataset integration: score then compare', () => {
  it('flags a degraded session against good reference sessions', () => {
    // Build good reference sessions
    const goodSession = makeAnalytics({
      toolCalls: Array.from({ length: 20 }, () => makeToolCall()),
      commitCount: 1,
      errorRate: 0,
      frictionSignals: [],
    });
    const referenceScores = Array.from({ length: 5 }, () => scoreSessionQuality(goodSession));
    const dist = computeReferenceDistribution(referenceScores)!;

    // A bad session: many tool calls, no commits, high errors
    const frictionSignals: FrictionSignal[] = Array.from({ length: 10 }, (_, i) => ({
      kind: 'error_loop' as const,
      timestamp: `2026-01-01T00:${String(i).padStart(2, '0')}:00Z`,
      detail: 'loop',
    }));
    const badSession = makeAnalytics({
      toolCalls: Array.from({ length: 50 }, () => makeToolCall({ outcome: 'error' })),
      commitCount: 0,
      errorRate: 1,
      frictionSignals,
    });
    const badScore = scoreSessionQuality(badSession);
    const report = compareToReference(badScore, dist);
    expect(report.regressed).toBe(true);
  });

  it('does not flag a good session against varied reference sessions', () => {
    // Reference sessions with varying quality to produce non-zero stddev
    const errorRates = [0, 0.05, 0.1, 0.15, 0.2];
    const referenceScores = errorRates.map((errorRate) =>
      scoreSessionQuality(
        makeAnalytics({
          toolCalls: Array.from({ length: 20 }, () => makeToolCall()),
          commitCount: 1,
          errorRate,
          frictionSignals: [],
        })
      )
    );
    const dist = computeReferenceDistribution(referenceScores)!;

    // A session within the normal range (similar to the middle reference)
    const normalSession = makeAnalytics({
      toolCalls: Array.from({ length: 20 }, () => makeToolCall()),
      commitCount: 1,
      errorRate: 0.1,
      frictionSignals: [],
    });
    const report = compareToReference(scoreSessionQuality(normalSession), dist);
    expect(report.regressed).toBe(false);
  });
});
