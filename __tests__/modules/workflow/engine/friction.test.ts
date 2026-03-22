import { describe, it, expect } from 'vitest';
import {
  analyzeFriction,
  detectRepeatedToolFailures,
  detectPermissionDenials,
  detectExcessiveRetries,
  detectContextPressure,
  detectProgressStalls,
  detectAgentSpawnFailures,
  detectHookPreventions,
  detectErrorLoops,
} from '../../../../src/modules/workflow/engine/friction.js';
import type {
  ParsedSessionData,
  ToolCallRecord,
} from '../../../../src/modules/workflow/engine/friction-types.js';

function makeCall(
  toolName: string,
  outcome: 'success' | 'error' = 'success',
  opts: Partial<ToolCallRecord> = {}
): ToolCallRecord {
  return {
    toolName,
    timestamp: opts.timestamp ?? '2026-03-14T10:00:00Z',
    outcome,
    errorMessage: opts.errorMessage,
  };
}

function makeSession(overrides: Partial<ParsedSessionData> = {}): ParsedSessionData {
  return {
    sessionId: 'test-session',
    toolCalls: [],
    errorCount: 0,
    totalTurns: 10,
    durationMs: 60_000,
    compactionCount: 0,
    hookPreventionCount: 0,
    ...overrides,
  };
}

describe('detectRepeatedToolFailures', () => {
  it('returns empty for no failures', () => {
    const calls = [makeCall('Bash'), makeCall('Read'), makeCall('Bash')];
    expect(detectRepeatedToolFailures(calls)).toEqual([]);
  });

  it('detects tool failing 3+ times', () => {
    const calls = [
      makeCall('Bash', 'error', { errorMessage: 'fail 1' }),
      makeCall('Read'),
      makeCall('Bash', 'error', { errorMessage: 'fail 2' }),
      makeCall('Bash', 'error', { errorMessage: 'fail 3' }),
    ];

    const events = detectRepeatedToolFailures(calls);
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('repeated_tool_failure');
    expect(events[0].severity).toBe('medium');
    expect(events[0].context.failureCount).toBe(3);
  });

  it('escalates severity at 5+ failures', () => {
    const calls = Array.from({ length: 5 }, () =>
      makeCall('Bash', 'error', { errorMessage: 'fail' })
    );

    const events = detectRepeatedToolFailures(calls);
    expect(events[0].severity).toBe('high');
  });
});

describe('detectPermissionDenials', () => {
  it('returns empty when no permission errors', () => {
    const calls = [makeCall('Bash', 'error', { errorMessage: 'syntax error' })];
    expect(detectPermissionDenials(calls)).toEqual([]);
  });

  it('detects permission denied errors', () => {
    const calls = [
      makeCall('Bash', 'error', { errorMessage: 'Permission denied: /etc/shadow' }),
      makeCall('Write', 'error', { errorMessage: 'EACCES: cannot write to /root/file' }),
    ];

    const events = detectPermissionDenials(calls);
    expect(events).toHaveLength(2);
    expect(events[0].type).toBe('permission_denial');
    expect(events[0].severity).toBe('high');
    expect(events[1].context.toolName).toBe('Write');
  });

  it('detects access denied and forbidden patterns', () => {
    const calls = [
      makeCall('Bash', 'error', { errorMessage: 'Access denied to resource' }),
      makeCall('Bash', 'error', { errorMessage: 'Forbidden: admin only' }),
    ];

    const events = detectPermissionDenials(calls);
    expect(events).toHaveLength(2);
  });
});

describe('detectExcessiveRetries', () => {
  it('returns empty for varied tool usage', () => {
    const calls = [makeCall('Bash'), makeCall('Read'), makeCall('Write')];
    expect(detectExcessiveRetries(calls)).toEqual([]);
  });

  it('detects 3+ consecutive identical tool calls', () => {
    const calls = [
      makeCall('Read'),
      makeCall('Bash', 'success', { timestamp: '2026-03-14T10:00:00Z' }),
      makeCall('Bash', 'success', { timestamp: '2026-03-14T10:00:01Z' }),
      makeCall('Bash', 'success', { timestamp: '2026-03-14T10:00:02Z' }),
      makeCall('Write'),
    ];

    const events = detectExcessiveRetries(calls);
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('excessive_retry');
    expect(events[0].context.consecutiveCount).toBe(3);
  });

  it('detects retries at end of call list', () => {
    const calls = [makeCall('Read'), makeCall('Bash'), makeCall('Bash'), makeCall('Bash')];

    const events = detectExcessiveRetries(calls);
    expect(events).toHaveLength(1);
  });

  it('escalates severity at 5+ retries', () => {
    const calls = Array.from({ length: 5 }, () => makeCall('Bash'));

    const events = detectExcessiveRetries(calls);
    expect(events[0].severity).toBe('high');
  });
});

describe('detectContextPressure', () => {
  it('returns empty with no compactions and low tokens', () => {
    const data = makeSession();
    expect(detectContextPressure(data)).toEqual([]);
  });

  it('detects single compaction as high severity', () => {
    const data = makeSession({
      compactionCount: 1,
      toolCalls: [makeCall('Bash')],
    });

    const events = detectContextPressure(data);
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('context_pressure');
    expect(events[0].severity).toBe('high');
  });

  it('detects 3+ compactions as critical', () => {
    const data = makeSession({
      compactionCount: 3,
      toolCalls: [makeCall('Bash')],
    });

    const events = detectContextPressure(data);
    expect(events[0].severity).toBe('critical');
  });

  it('detects high token input as pressure', () => {
    const data = makeSession({
      tokens: { input: 200_000, output: 5_000 },
      toolCalls: [makeCall('Bash')],
    });

    const events = detectContextPressure(data);
    expect(events).toHaveLength(1);
    expect(events[0].severity).toBe('medium');
  });
});

describe('detectProgressStalls', () => {
  it('returns empty for closely spaced calls', () => {
    const calls = [
      makeCall('Bash', 'success', { timestamp: '2026-03-14T10:00:00Z' }),
      makeCall('Read', 'success', { timestamp: '2026-03-14T10:01:00Z' }),
    ];
    expect(detectProgressStalls(calls)).toEqual([]);
  });

  it('detects gap exceeding 5 minutes', () => {
    const calls = [
      makeCall('Bash', 'success', { timestamp: '2026-03-14T10:00:00Z' }),
      makeCall('Read', 'success', { timestamp: '2026-03-14T10:06:00Z' }),
    ];

    const events = detectProgressStalls(calls);
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('progress_stall');
    expect(events[0].severity).toBe('medium');
  });

  it('escalates severity for 10+ minute gap', () => {
    const calls = [
      makeCall('Bash', 'success', { timestamp: '2026-03-14T10:00:00Z' }),
      makeCall('Read', 'success', { timestamp: '2026-03-14T10:11:00Z' }),
    ];

    const events = detectProgressStalls(calls);
    expect(events[0].severity).toBe('high');
  });

  it('returns empty for fewer than 2 calls', () => {
    expect(detectProgressStalls([])).toEqual([]);
    expect(detectProgressStalls([makeCall('Bash')])).toEqual([]);
  });
});

describe('detectAgentSpawnFailures', () => {
  it('returns empty for non-agent errors', () => {
    const calls = [makeCall('Bash', 'error', { errorMessage: 'syntax error' })];
    expect(detectAgentSpawnFailures(calls)).toEqual([]);
  });

  it('detects agent spawn failures', () => {
    const calls = [makeCall('Task', 'error', { errorMessage: 'Agent spawn failed: timeout' })];

    const events = detectAgentSpawnFailures(calls);
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('agent_spawn_failure');
    expect(events[0].severity).toBe('high');
  });
});

describe('detectHookPreventions', () => {
  it('returns empty when no hooks blocked', () => {
    const data = makeSession({ hookPreventionCount: 0 });
    expect(detectHookPreventions(data)).toEqual([]);
  });

  it('detects hook preventions', () => {
    const data = makeSession({
      hookPreventionCount: 2,
      toolCalls: [makeCall('Bash')],
    });

    const events = detectHookPreventions(data);
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('hook_prevention');
    expect(events[0].severity).toBe('medium');
  });

  it('escalates severity at 3+ preventions', () => {
    const data = makeSession({
      hookPreventionCount: 3,
      toolCalls: [makeCall('Bash')],
    });

    const events = detectHookPreventions(data);
    expect(events[0].severity).toBe('high');
  });
});

describe('detectErrorLoops', () => {
  it('returns empty for scattered errors', () => {
    const calls = [makeCall('Bash', 'error'), makeCall('Read'), makeCall('Write', 'error')];
    expect(detectErrorLoops(calls)).toEqual([]);
  });

  it('detects 3+ consecutive errors', () => {
    const calls = [
      makeCall('Read'),
      makeCall('Bash', 'error', { timestamp: '2026-03-14T10:00:01Z' }),
      makeCall('Write', 'error', { timestamp: '2026-03-14T10:00:02Z' }),
      makeCall('Grep', 'error', { timestamp: '2026-03-14T10:00:03Z' }),
      makeCall('Read'),
    ];

    const events = detectErrorLoops(calls);
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('error_loop');
    expect(events[0].severity).toBe('high');
    expect(events[0].context.consecutiveErrors).toBe(3);
  });

  it('escalates to critical at 5+ consecutive errors', () => {
    const calls = Array.from({ length: 5 }, (_, i) =>
      makeCall('Bash', 'error', { timestamp: `2026-03-14T10:00:0${i}Z` })
    );

    const events = detectErrorLoops(calls);
    expect(events[0].severity).toBe('critical');
  });

  it('detects error loop at end of call list', () => {
    const calls = [
      makeCall('Read'),
      makeCall('Bash', 'error'),
      makeCall('Write', 'error'),
      makeCall('Grep', 'error'),
    ];

    const events = detectErrorLoops(calls);
    expect(events).toHaveLength(1);
  });
});

describe('analyzeFriction', () => {
  it('returns empty analysis for clean session', () => {
    const data = makeSession({
      toolCalls: [makeCall('Read'), makeCall('Write'), makeCall('Bash')],
    });

    const result = analyzeFriction(data);
    expect(result.sessionId).toBe('test-session');
    expect(result.events).toHaveLength(0);
    expect(result.score).toBe(0);
    expect(result.summary).toContain('No friction detected');
  });

  it('handles empty event list', () => {
    const data = makeSession({ toolCalls: [] });

    const result = analyzeFriction(data);
    expect(result.events).toHaveLength(0);
    expect(result.score).toBe(0);
  });

  it('calculates friction score from severity weights', () => {
    const data = makeSession({
      toolCalls: [
        // 3 consecutive Bash calls => excessive_retry (medium = 15)
        makeCall('Bash', 'success', { timestamp: '2026-03-14T10:00:00Z' }),
        makeCall('Bash', 'success', { timestamp: '2026-03-14T10:00:01Z' }),
        makeCall('Bash', 'success', { timestamp: '2026-03-14T10:00:02Z' }),
      ],
    });

    const result = analyzeFriction(data);
    expect(result.score).toBe(15);
  });

  it('caps score at 100', () => {
    const data = makeSession({
      compactionCount: 3,
      hookPreventionCount: 5,
      toolCalls: [
        ...Array.from({ length: 6 }, (_, i) =>
          makeCall('Bash', 'error', {
            errorMessage: 'Permission denied',
            timestamp: `2026-03-14T10:00:0${i}Z`,
          })
        ),
      ],
    });

    const result = analyzeFriction(data);
    expect(result.score).toBe(100);
  });

  it('produces human-readable summary', () => {
    const data = makeSession({
      toolCalls: [
        makeCall('Bash', 'error', {
          errorMessage: 'Permission denied',
          timestamp: '2026-03-14T10:00:00Z',
        }),
        makeCall('Bash', 'error', {
          errorMessage: 'Permission denied',
          timestamp: '2026-03-14T10:00:01Z',
        }),
        makeCall('Bash', 'error', {
          errorMessage: 'Permission denied',
          timestamp: '2026-03-14T10:00:02Z',
        }),
      ],
    });

    const result = analyzeFriction(data);
    expect(result.summary).toContain('test-session');
    expect(result.summary).toContain('friction event');
    expect(result.summary).toMatch(/score: \d+\/100/);
  });

  it('sorts events by timestamp', () => {
    const data = makeSession({
      hookPreventionCount: 1,
      toolCalls: [
        makeCall('Bash', 'success', { timestamp: '2026-03-14T10:00:00Z' }),
        makeCall('Read', 'error', {
          errorMessage: 'Permission denied',
          timestamp: '2026-03-14T10:05:00Z',
        }),
      ],
    });

    const result = analyzeFriction(data);
    for (let i = 1; i < result.events.length; i++) {
      expect(result.events[i].timestamp >= result.events[i - 1].timestamp).toBe(true);
    }
  });
});
