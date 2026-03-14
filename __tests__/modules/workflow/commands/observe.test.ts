import { describe, it, expect } from 'vitest';
import {
  parseDuration,
  sessionAnalyticsToFrictionInput,
  filterByThreshold,
  formatAnalysis,
  buildJsonOutput,
  mergeAnalyses,
} from '../../../../src/modules/workflow/commands/observe.js';
import type {
  FrictionAnalysis,
  FrictionEvent,
} from '../../../../src/modules/workflow/engine/friction-types.js';
import type { SessionAnalytics } from '../../../../src/modules/sessions/types.js';

function makeEvent(overrides: Partial<FrictionEvent> = {}): FrictionEvent {
  return {
    type: 'repeated_tool_failure',
    severity: 'medium',
    description: 'Test friction event',
    timestamp: '2026-03-14T10:30:00Z',
    context: {},
    ...overrides,
  };
}

function makeAnalysis(overrides: Partial<FrictionAnalysis> = {}): FrictionAnalysis {
  return {
    sessionId: 'test-session',
    events: [],
    score: 0,
    summary: 'No friction detected',
    ...overrides,
  };
}

function makeSessionAnalytics(overrides: Partial<SessionAnalytics> = {}): SessionAnalytics {
  return {
    sessionId: 'sess-001',
    projectDir: '/tmp/project',
    gitBranch: 'main',
    model: 'claude-opus-4-20250514',
    claudeVersion: null,
    startTime: '2026-03-14T10:00:00Z',
    endTime: '2026-03-14T10:30:00Z',
    durationMs: 1_800_000,
    userTurns: 5,
    assistantTurns: 10,
    isCompacted: false,
    compactionCount: 0,
    sidechainEventCount: 0,
    toolCalls: [],
    toolCallsByName: {},
    uniqueToolsUsed: [],
    errors: [],
    errorCount: 0,
    errorRate: 0,
    tokens: { inputTokens: 5000, outputTokens: 2000, cacheCreationTokens: 0, cacheReadTokens: 0 },
    frictionSignals: [],
    hookEventCount: 0,
    hookPreventionCount: 0,
    capturedViaHooks: true,
    capturedViaJsonl: false,
    ...overrides,
  };
}

describe('parseDuration', () => {
  it('parses minutes', () => {
    expect(parseDuration('10m')).toBe(10 * 60_000);
  });

  it('parses hours', () => {
    expect(parseDuration('1h')).toBe(3_600_000);
  });

  it('parses 24 hours', () => {
    expect(parseDuration('24h')).toBe(24 * 3_600_000);
  });

  it('parses days', () => {
    expect(parseDuration('7d')).toBe(7 * 86_400_000);
  });

  it('defaults to 10m for invalid input', () => {
    expect(parseDuration('invalid')).toBe(10 * 60_000);
  });

  it('defaults to 10m for empty string', () => {
    expect(parseDuration('')).toBe(10 * 60_000);
  });
});

describe('sessionAnalyticsToFrictionInput', () => {
  it('maps session analytics to ParsedSessionData', () => {
    const analytics = makeSessionAnalytics({
      toolCalls: [
        {
          toolName: 'Bash',
          toolUseId: 'tu-1',
          input: {},
          timestamp: '2026-03-14T10:00:00Z',
          outcome: 'error',
          errorMessage: 'fail',
          isSidechain: false,
        },
      ],
      errorCount: 1,
      compactionCount: 2,
      hookPreventionCount: 1,
    });

    const result = sessionAnalyticsToFrictionInput(analytics);

    expect(result.sessionId).toBe('sess-001');
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].toolName).toBe('Bash');
    expect(result.toolCalls[0].outcome).toBe('error');
    expect(result.toolCalls[0].errorMessage).toBe('fail');
    expect(result.errorCount).toBe(1);
    expect(result.totalTurns).toBe(15);
    expect(result.compactionCount).toBe(2);
    expect(result.hookPreventionCount).toBe(1);
    expect(result.tokens).toEqual({ input: 5000, output: 2000 });
  });
});

describe('filterByThreshold', () => {
  const events: FrictionEvent[] = [
    makeEvent({ severity: 'low' }),
    makeEvent({ severity: 'medium' }),
    makeEvent({ severity: 'high' }),
    makeEvent({ severity: 'critical' }),
  ];

  it('filters at medium threshold', () => {
    const filtered = filterByThreshold(events, 'medium');
    expect(filtered).toHaveLength(3);
    expect(filtered.map((e) => e.severity)).toEqual(['medium', 'high', 'critical']);
  });

  it('filters at high threshold', () => {
    const filtered = filterByThreshold(events, 'high');
    expect(filtered).toHaveLength(2);
    expect(filtered.map((e) => e.severity)).toEqual(['high', 'critical']);
  });

  it('includes all at low threshold', () => {
    const filtered = filterByThreshold(events, 'low');
    expect(filtered).toHaveLength(4);
  });

  it('includes only critical at critical threshold', () => {
    const filtered = filterByThreshold(events, 'critical');
    expect(filtered).toHaveLength(1);
    expect(filtered[0].severity).toBe('critical');
  });
});

describe('formatAnalysis', () => {
  it('formats header with label and score', () => {
    const analysis = makeAnalysis({ score: 45 });
    const output = formatAnalysis(analysis, 'last 10m', 'medium');

    expect(output).toContain('Friction Analysis (last 10m)');
    expect(output).toContain('Score: 45/100');
  });

  it('shows no-events message when all filtered out', () => {
    const analysis = makeAnalysis({
      events: [makeEvent({ severity: 'low' })],
      score: 5,
    });
    const output = formatAnalysis(analysis, 'last 10m', 'high');

    expect(output).toContain('No friction events above threshold.');
  });

  it('formats friction events with severity tags', () => {
    const analysis = makeAnalysis({
      events: [
        makeEvent({
          severity: 'high',
          description: 'Tool "Bash" failed 5 times',
          timestamp: '2026-03-14T10:32:00Z',
        }),
      ],
      score: 30,
    });
    const output = formatAnalysis(analysis, 'last 10m', 'medium');

    expect(output).toContain('[HIGH] Tool "Bash" failed 5 times');
    expect(output).toContain('at 10:32');
  });

  it('handles empty events gracefully', () => {
    const analysis = makeAnalysis();
    const output = formatAnalysis(analysis, 'last 10m', 'medium');

    expect(output).toContain('No friction events above threshold.');
  });
});

describe('buildJsonOutput', () => {
  it('produces structured JSON with filtered events', () => {
    const events = [
      makeEvent({ severity: 'low' }),
      makeEvent({ severity: 'high', description: 'high event' }),
    ];
    const analysis = makeAnalysis({ events, score: 35, summary: 'test summary' });

    const json = buildJsonOutput(analysis, 'medium');

    expect(json.sessionId).toBe('test-session');
    expect(json.score).toBe(35);
    expect(json.summary).toBe('test summary');
    expect(json.eventCount).toBe(1);
    expect(json.events as FrictionEvent[]).toHaveLength(1);
    expect((json.events as FrictionEvent[])[0].description).toBe('high event');
  });

  it('returns zero events when all below threshold', () => {
    const events = [makeEvent({ severity: 'low' })];
    const analysis = makeAnalysis({ events, score: 5 });

    const json = buildJsonOutput(analysis, 'high');

    expect(json.eventCount).toBe(0);
    expect(json.events as FrictionEvent[]).toHaveLength(0);
  });
});

describe('mergeAnalyses', () => {
  it('returns single analysis unchanged', () => {
    const analysis = makeAnalysis({ sessionId: 'sess-1', score: 20 });
    const result = mergeAnalyses([analysis]);

    expect(result).toBe(analysis);
  });

  it('merges multiple analyses', () => {
    const a1 = makeAnalysis({
      sessionId: 'sess-1',
      score: 20,
      events: [makeEvent({ timestamp: '2026-03-14T10:00:00Z' })],
    });
    const a2 = makeAnalysis({
      sessionId: 'sess-2',
      score: 30,
      events: [makeEvent({ timestamp: '2026-03-14T10:05:00Z' })],
    });

    const result = mergeAnalyses([a1, a2]);

    expect(result.events).toHaveLength(2);
    expect(result.score).toBe(50);
    expect(result.sessionId).toContain('sess-1');
    expect(result.sessionId).toContain('sess-2');
    expect(result.summary).toContain('2 sessions');
  });

  it('caps merged score at 100', () => {
    const a1 = makeAnalysis({ score: 80, events: [] });
    const a2 = makeAnalysis({ score: 60, events: [] });

    const result = mergeAnalyses([a1, a2]);

    expect(result.score).toBe(100);
  });

  it('sorts merged events by timestamp', () => {
    const a1 = makeAnalysis({
      sessionId: 'sess-1',
      events: [makeEvent({ timestamp: '2026-03-14T10:10:00Z' })],
    });
    const a2 = makeAnalysis({
      sessionId: 'sess-2',
      events: [makeEvent({ timestamp: '2026-03-14T10:05:00Z' })],
    });

    const result = mergeAnalyses([a1, a2]);

    expect(result.events[0].timestamp).toBe('2026-03-14T10:05:00Z');
    expect(result.events[1].timestamp).toBe('2026-03-14T10:10:00Z');
  });
});
