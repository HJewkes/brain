import { describe, it, expect } from 'vitest';
import { buildStructuredEvents } from '../../../src/modules/sessions/ingestion/structured-events.js';
import type { SessionAnalytics, ToolCall, TokenSnapshot } from '../../../src/modules/sessions/types.js';

function makeAnalytics(overrides: Partial<SessionAnalytics> = {}): SessionAnalytics {
  return {
    sessionId: 'test-session-1',
    projectDir: '/tmp/project',
    gitBranch: 'main',
    model: 'claude-3',
    claudeVersion: '1.0',
    startTime: '2026-03-15T10:00:00Z',
    endTime: '2026-03-15T11:00:00Z',
    durationMs: 3600000,
    userTurns: 2,
    assistantTurns: 2,
    isCompacted: false,
    compactionCount: 0,
    sidechainEventCount: 0,
    toolCalls: [],
    toolCallsByName: {},
    uniqueToolsUsed: [],
    errors: [],
    errorCount: 0,
    errorRate: 0,
    tokens: { inputTokens: 1000, outputTokens: 500, cacheCreationTokens: 0, cacheReadTokens: 0 },
    tokenSnapshots: [],
    assistantTexts: [],
    frictionSignals: [],
    hookEventCount: 0,
    hookPreventionCount: 0,
    capturedViaHooks: false,
    capturedViaJsonl: true,
    ...overrides,
  };
}

function makeToolCall(overrides: Partial<ToolCall> = {}): ToolCall {
  return {
    toolUseId: 'tu-1',
    toolName: 'Read',
    input: { file_path: '/tmp/file.ts' },
    timestamp: '2026-03-15T10:05:00Z',
    outcome: 'success',
    isSidechain: false,
    ...overrides,
  };
}

describe('buildStructuredEvents', () => {
  it('produces valid JSON-serializable output', () => {
    const analytics = makeAnalytics();
    const result = buildStructuredEvents(analytics);

    const json = JSON.stringify(result);
    const parsed = JSON.parse(json);

    expect(parsed.sessionId).toBe('test-session-1');
    expect(parsed.startTime).toBe('2026-03-15T10:00:00Z');
    expect(parsed.endTime).toBe('2026-03-15T11:00:00Z');
    expect(parsed.durationMs).toBe(3600000);
    expect(Array.isArray(parsed.turns)).toBe(true);
    expect(Array.isArray(parsed.tokenTimeline)).toBe(true);
    expect(Array.isArray(parsed.compactions)).toBe(true);
    expect(Array.isArray(parsed.taskEvents)).toBe(true);
    expect(Array.isArray(parsed.agentEvents)).toBe(true);
    expect(Array.isArray(parsed.filesTouched)).toBe(true);
  });

  it('groups turns correctly with tool calls', () => {
    const snapshots: TokenSnapshot[] = [
      { timestamp: '2026-03-15T10:05:00Z', cumulativeInput: 500, cumulativeOutput: 200 },
      { timestamp: '2026-03-15T10:10:00Z', cumulativeInput: 1000, cumulativeOutput: 500 },
    ];

    const toolCalls: ToolCall[] = [
      makeToolCall({
        toolUseId: 'tu-1',
        toolName: 'Read',
        timestamp: '2026-03-15T10:05:00Z',
        outcome: 'success',
      }),
      makeToolCall({
        toolUseId: 'tu-2',
        toolName: 'Edit',
        timestamp: '2026-03-15T10:05:00Z',
        outcome: 'success',
        durationMs: 150,
      }),
      makeToolCall({
        toolUseId: 'tu-3',
        toolName: 'Bash',
        timestamp: '2026-03-15T10:10:00Z',
        outcome: 'error',
      }),
    ];

    const analytics = makeAnalytics({
      assistantTurns: 2,
      assistantTexts: ['Reading the file now.', 'Running tests.'],
      tokenSnapshots: snapshots,
      toolCalls,
    });

    const result = buildStructuredEvents(analytics);

    expect(result.turns).toHaveLength(2);

    // First turn has 2 tool calls (same timestamp)
    expect(result.turns[0].toolCalls).toHaveLength(2);
    expect(result.turns[0].toolCalls[0].toolName).toBe('Read');
    expect(result.turns[0].toolCalls[1].toolName).toBe('Edit');
    expect(result.turns[0].assistantText).toBe('Reading the file now.');

    // Second turn has 1 tool call
    expect(result.turns[1].toolCalls).toHaveLength(1);
    expect(result.turns[1].toolCalls[0].toolName).toBe('Bash');
    expect(result.turns[1].toolCalls[0].outcome).toBe('error');
  });

  it('records cumulative token timeline', () => {
    const snapshots: TokenSnapshot[] = [
      { timestamp: '2026-03-15T10:05:00Z', cumulativeInput: 500, cumulativeOutput: 200 },
      { timestamp: '2026-03-15T10:10:00Z', cumulativeInput: 1200, cumulativeOutput: 600 },
      { timestamp: '2026-03-15T10:15:00Z', cumulativeInput: 2000, cumulativeOutput: 900 },
    ];

    const analytics = makeAnalytics({ tokenSnapshots: snapshots });
    const result = buildStructuredEvents(analytics);

    expect(result.tokenTimeline).toHaveLength(3);
    // Verify cumulative (non-decreasing)
    for (let i = 1; i < result.tokenTimeline.length; i++) {
      expect(result.tokenTimeline[i].cumulativeInput).toBeGreaterThanOrEqual(
        result.tokenTimeline[i - 1].cumulativeInput
      );
      expect(result.tokenTimeline[i].cumulativeOutput).toBeGreaterThanOrEqual(
        result.tokenTimeline[i - 1].cumulativeOutput
      );
    }
  });

  it('extracts task boundary events from bash tool calls', () => {
    const toolCalls: ToolCall[] = [
      makeToolCall({
        toolUseId: 'tu-1',
        toolName: 'Bash',
        input: { command: 'npx tsx src/cli.ts brain pm task claim VNM-42' },
        timestamp: '2026-03-15T10:05:00Z',
      }),
      makeToolCall({
        toolUseId: 'tu-2',
        toolName: 'Bash',
        input: { command: 'npx tsx src/cli.ts brain pm task done VNM-42' },
        timestamp: '2026-03-15T10:30:00Z',
      }),
      makeToolCall({
        toolUseId: 'tu-3',
        toolName: 'Bash',
        input: { command: 'npx tsx src/cli.ts brain pm task add --title "New task" VNM-99' },
        timestamp: '2026-03-15T10:35:00Z',
      }),
    ];

    const analytics = makeAnalytics({ toolCalls });
    const result = buildStructuredEvents(analytics);

    expect(result.taskEvents).toHaveLength(3);
    expect(result.taskEvents[0]).toEqual({
      type: 'task_claim',
      taskId: 'VNM-42',
      timestamp: '2026-03-15T10:05:00Z',
    });
    expect(result.taskEvents[1]).toEqual({
      type: 'task_done',
      taskId: 'VNM-42',
      timestamp: '2026-03-15T10:30:00Z',
    });
    expect(result.taskEvents[2]).toEqual({
      type: 'task_add',
      taskId: 'VNM-99',
      timestamp: '2026-03-15T10:35:00Z',
    });
  });

  it('handles empty session with valid output', () => {
    const analytics = makeAnalytics({
      userTurns: 0,
      assistantTurns: 0,
      toolCalls: [],
      tokenSnapshots: [],
      assistantTexts: [],
      compactionCount: 0,
    });

    const result = buildStructuredEvents(analytics);

    expect(result.sessionId).toBe('test-session-1');
    expect(result.turns).toHaveLength(0);
    expect(result.tokenTimeline).toHaveLength(0);
    expect(result.compactions).toHaveLength(0);
    expect(result.taskEvents).toHaveLength(0);
    expect(result.agentEvents).toHaveLength(0);
    expect(result.filesTouched).toHaveLength(0);
  });

  it('extracts files touched from file tool calls', () => {
    const toolCalls: ToolCall[] = [
      makeToolCall({
        toolUseId: 'tu-1',
        toolName: 'Read',
        input: { file_path: '/src/foo.ts' },
        timestamp: '2026-03-15T10:05:00Z',
      }),
      makeToolCall({
        toolUseId: 'tu-2',
        toolName: 'Edit',
        input: { file_path: '/src/bar.ts' },
        timestamp: '2026-03-15T10:06:00Z',
      }),
      makeToolCall({
        toolUseId: 'tu-3',
        toolName: 'Write',
        input: { file_path: '/src/foo.ts' },
        timestamp: '2026-03-15T10:07:00Z',
      }),
    ];

    const analytics = makeAnalytics({ toolCalls });
    const result = buildStructuredEvents(analytics);

    // Deduplicated and sorted
    expect(result.filesTouched).toEqual(['/src/bar.ts', '/src/foo.ts']);
  });

  it('records compaction events', () => {
    const analytics = makeAnalytics({ compactionCount: 2 });
    const result = buildStructuredEvents(analytics);

    expect(result.compactions).toHaveLength(2);
    expect(result.compactions[0].index).toBe(0);
    expect(result.compactions[1].index).toBe(1);
  });

  it('extracts agent spawn events', () => {
    const toolCalls: ToolCall[] = [
      makeToolCall({
        toolUseId: 'tu-1',
        toolName: 'Bash',
        input: { command: 'npx tsx src/cli.ts brain pm dispatch --wave 3' },
        timestamp: '2026-03-15T10:05:00Z',
      }),
    ];

    const analytics = makeAnalytics({ toolCalls });
    const result = buildStructuredEvents(analytics);

    expect(result.agentEvents).toHaveLength(1);
    expect(result.agentEvents[0].type).toBe('agent_spawn');
  });
});
