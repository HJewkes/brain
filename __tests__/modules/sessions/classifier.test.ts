import { describe, it, expect } from 'vitest';
import { classifySession } from '../../../src/modules/sessions/engine/classifier.js';
import type { SessionAnalytics } from '../../../src/modules/sessions/types.js';

function makeAnalytics(overrides: Partial<SessionAnalytics> = {}): SessionAnalytics {
  return {
    sessionId: 'test-session',
    projectDir: '/test',
    gitBranch: 'main',
    model: 'claude-opus-4-5',
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
    capturedViaJsonl: true,
    slug: null,
    prLinks: [],
    filesTouched: new Map(),
    filesWritten: [],
    modelCounts: new Map(),
    taskRefs: [],
    compactionTimestamps: [],
    compactionSummaries: [],
    logicalParentUuid: null,
    thinkingBlockCount: 0,
    skillUsage: new Map(),
    planPresent: false,
    permissionMode: null,
    serviceTier: null,
    gitCommandCount: 0,
    commitCount: 0,
    subagentCount: 0,
    ...overrides,
  };
}

function makeCalls(names: string[]): SessionAnalytics['toolCalls'] {
  return names.map((name, i) => ({
    toolUseId: `id-${i}`,
    toolName: name,
    input: {},
    timestamp: '2026-01-01T00:00:00Z',
    outcome: 'success' as const,
    isSidechain: false,
  }));
}

function countsByName(names: string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const n of names) counts[n] = (counts[n] ?? 0) + 1;
  return counts;
}

// --- session_type ---

describe('classifySession - sessionType', () => {
  it('returns implementation when Write tools dominate (>30%)', () => {
    // 4 out of 10 = 40% write fraction
    const tools = [
      'Write',
      'Write',
      'Write',
      'Write',
      'Read',
      'Bash',
      'Read',
      'Bash',
      'Read',
      'Bash',
    ];
    const analytics = makeAnalytics({
      toolCalls: makeCalls(tools),
      toolCallsByName: countsByName(tools),
    });
    expect(classifySession(analytics).sessionType).toBe('implementation');
  });

  it('returns review when reads dominate and writes are minimal', () => {
    const tools = ['Read', 'Read', 'Read', 'Read', 'Read', 'Grep', 'Glob', 'Read', 'Read', 'Read'];
    const analytics = makeAnalytics({
      toolCalls: makeCalls(tools),
      toolCallsByName: countsByName(tools),
    });
    expect(classifySession(analytics).sessionType).toBe('review');
  });

  it('returns research when WebSearch is used', () => {
    const tools = ['WebSearch', 'Read', 'Read', 'Read', 'Bash'];
    const analytics = makeAnalytics({
      toolCalls: makeCalls(tools),
      toolCallsByName: countsByName(tools),
    });
    expect(classifySession(analytics).sessionType).toBe('research');
  });

  it('returns research when agent task delegation is dominant', () => {
    const tools = ['Task', 'Task', 'Task', 'Task', 'Read', 'Read', 'Bash', 'Read', 'Bash', 'Bash'];
    const analytics = makeAnalytics({
      toolCalls: makeCalls(tools),
      toolCallsByName: countsByName(tools),
    });
    expect(classifySession(analytics).sessionType).toBe('research');
  });

  it('returns debugging when error rate is high (>15%)', () => {
    const tools = ['Bash', 'Bash', 'Bash', 'Bash', 'Bash', 'Bash', 'Bash', 'Bash', 'Bash', 'Read'];
    const calls = makeCalls(tools);
    calls[0].outcome = 'error';
    calls[1].outcome = 'error';
    const analytics = makeAnalytics({
      toolCalls: calls,
      toolCallsByName: countsByName(tools),
      errorRate: 0.2,
      errorCount: 2,
    });
    expect(classifySession(analytics).sessionType).toBe('debugging');
  });

  it('returns planning when tool calls are few and thinking blocks are present', () => {
    const tools = ['Read', 'Bash'];
    const analytics = makeAnalytics({
      toolCalls: makeCalls(tools),
      toolCallsByName: countsByName(tools),
      thinkingBlockCount: 5,
      assistantTurns: 5,
    });
    expect(classifySession(analytics).sessionType).toBe('planning');
  });

  it('returns mixed when no pattern dominates', () => {
    const tools = [
      'Read',
      'Write',
      'Bash',
      'Grep',
      'Glob',
      'Read',
      'Write',
      'Bash',
      'Read',
      'Grep',
      'Bash',
      'Glob',
    ];
    const analytics = makeAnalytics({
      toolCalls: makeCalls(tools),
      toolCallsByName: countsByName(tools),
    });
    expect(classifySession(analytics).sessionType).toBe('mixed');
  });

  it('returns planning for zero tool calls', () => {
    const analytics = makeAnalytics({ toolCalls: [], toolCallsByName: {} });
    expect(classifySession(analytics).sessionType).toBe('planning');
  });
});

// --- outcome ---

describe('classifySession - outcome', () => {
  it('returns unknown when there are no tool calls and very few turns', () => {
    const analytics = makeAnalytics({ toolCalls: [], toolCallsByName: {}, userTurns: 1 });
    expect(classifySession(analytics).outcome).toBe('unknown');
  });

  it('returns abandoned for very high error rate (>30%)', () => {
    const tools = Array(10).fill('Bash');
    const calls = makeCalls(tools);
    calls.slice(0, 4).forEach((c) => (c.outcome = 'error'));
    const analytics = makeAnalytics({
      toolCalls: calls,
      toolCallsByName: countsByName(tools),
      errorRate: 0.4,
    });
    expect(classifySession(analytics).outcome).toBe('abandoned');
  });

  it('returns abandoned for very few tool calls (< 5)', () => {
    const tools = ['Read', 'Bash'];
    const analytics = makeAnalytics({
      toolCalls: makeCalls(tools),
      toolCallsByName: countsByName(tools),
    });
    expect(classifySession(analytics).outcome).toBe('abandoned');
  });

  it('returns success when error rate < 5% and tasks completed', () => {
    const tools = Array(15).fill('Write');
    const analytics = makeAnalytics({
      toolCalls: makeCalls(tools),
      toolCallsByName: countsByName(tools),
      errorRate: 0.02,
      taskRefs: ['VNM-01.01'],
    });
    expect(classifySession(analytics).outcome).toBe('success');
  });

  it('returns partial when many tools used but no tasks completed', () => {
    const tools = Array(15).fill('Bash');
    const analytics = makeAnalytics({
      toolCalls: makeCalls(tools),
      toolCallsByName: countsByName(tools),
      errorRate: 0.1,
      taskRefs: [],
    });
    expect(classifySession(analytics).outcome).toBe('partial');
  });
});

// --- cost_usd ---

describe('classifySession - costUsd', () => {
  it('returns 0 for zero tokens', () => {
    const analytics = makeAnalytics();
    expect(classifySession(analytics).costUsd).toBe(0);
  });

  it('computes Opus cost for 1M input and 1M output tokens', () => {
    const analytics = makeAnalytics({
      model: 'claude-opus-4-5',
      tokens: {
        inputTokens: 1_000_000,
        outputTokens: 1_000_000,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
      },
    });
    // $15 input + $75 output = $90
    expect(classifySession(analytics).costUsd).toBeCloseTo(90, 5);
  });

  it('computes Sonnet cost for 1M input and 1M output tokens', () => {
    const analytics = makeAnalytics({
      model: 'claude-sonnet-4-5',
      tokens: {
        inputTokens: 1_000_000,
        outputTokens: 1_000_000,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
      },
    });
    // $3 input + $15 output = $18
    expect(classifySession(analytics).costUsd).toBeCloseTo(18, 5);
  });

  it('computes Haiku cost for 1M input and 1M output tokens', () => {
    const analytics = makeAnalytics({
      model: 'claude-haiku-3-5',
      tokens: {
        inputTokens: 1_000_000,
        outputTokens: 1_000_000,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
      },
    });
    // $0.80 input + $4 output = $4.80
    expect(classifySession(analytics).costUsd).toBeCloseTo(4.8, 5);
  });

  it('includes cache creation and cache read costs', () => {
    const analytics = makeAnalytics({
      model: 'claude-opus-4-5',
      tokens: {
        inputTokens: 0,
        outputTokens: 0,
        cacheCreationTokens: 1_000_000,
        cacheReadTokens: 1_000_000,
      },
    });
    // $18.75 cache write + $1.50 cache read = $20.25
    expect(classifySession(analytics).costUsd).toBeCloseTo(20.25, 5);
  });

  it('defaults to Opus pricing for unknown model', () => {
    const analytics = makeAnalytics({
      model: null,
      tokens: {
        inputTokens: 1_000_000,
        outputTokens: 0,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
      },
    });
    // $15 input (Opus)
    expect(classifySession(analytics).costUsd).toBeCloseTo(15, 5);
  });
});
