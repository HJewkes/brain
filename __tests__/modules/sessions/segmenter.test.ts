import { describe, it, expect } from 'vitest';
import {
  detectSegmentBoundaries,
  buildSegments,
} from '../../../src/modules/sessions/engine/segmenter.js';
import type { SessionAnalytics, ToolCall } from '../../../src/modules/sessions/types.js';

function makeToolCall(overrides: Partial<ToolCall> & { timestamp: string }): ToolCall {
  return {
    toolUseId: `id-${overrides.timestamp}`,
    toolName: 'Read',
    input: {},
    outcome: 'success',
    isSidechain: false,
    ...overrides,
  };
}

function minutes(n: number, base = 0): string {
  return new Date(base + n * 60 * 1000).toISOString();
}

function makeAnalytics(
  toolCalls: ToolCall[],
  overrides: Partial<SessionAnalytics> = {}
): SessionAnalytics {
  return {
    sessionId: 'test',
    projectDir: '/test',
    gitBranch: null,
    model: null,
    claudeVersion: null,
    startTime: toolCalls[0]?.timestamp ?? '',
    endTime: toolCalls[toolCalls.length - 1]?.timestamp ?? '',
    durationMs: 0,
    userTurns: 0,
    assistantTurns: 0,
    isCompacted: false,
    compactionCount: 0,
    sidechainEventCount: 0,
    toolCalls,
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
    compactionByteOffsets: [],
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

describe('detectSegmentBoundaries', () => {
  it('returns empty boundaries for a short session with no signals', () => {
    const toolCalls = Array.from({ length: 5 }, (_, i) => makeToolCall({ timestamp: minutes(i) }));
    const analytics = makeAnalytics(toolCalls);
    expect(detectSegmentBoundaries(analytics)).toEqual([]);
  });

  it('returns empty array when there are zero tool calls', () => {
    const analytics = makeAnalytics([]);
    expect(detectSegmentBoundaries(analytics)).toEqual([]);
  });

  it('creates a compaction boundary at the correct tool call index', () => {
    const toolCalls = Array.from({ length: 10 }, (_, i) => makeToolCall({ timestamp: minutes(i) }));
    // Compaction happened before tool call at index 5
    const compactionTs = minutes(4, 30 * 1000); // between index 4 and 5
    const analytics = makeAnalytics(toolCalls, {
      compactionTimestamps: [compactionTs],
      compactionSummaries: ['Summary text'],
      compactionByteOffsets: [1024],
    });
    const boundaries = detectSegmentBoundaries(analytics);
    expect(boundaries).toHaveLength(1);
    expect(boundaries[0].toolCallIndex).toBe(5);
    expect(boundaries[0].boundaryType).toBe('compaction');
    expect(boundaries[0].compactionSummary).toBe('Summary text');
    expect(boundaries[0].byteOffset).toBe(1024);
  });

  it('creates an idle gap boundary when consecutive tool calls are 30+ minutes apart', () => {
    const toolCalls = [
      makeToolCall({ timestamp: minutes(0) }),
      makeToolCall({ timestamp: minutes(1) }),
      makeToolCall({ timestamp: minutes(32) }), // 31 min gap
      makeToolCall({ timestamp: minutes(33) }),
    ];
    const analytics = makeAnalytics(toolCalls);
    const boundaries = detectSegmentBoundaries(analytics);
    expect(boundaries).toHaveLength(1);
    expect(boundaries[0].toolCallIndex).toBe(2);
    expect(boundaries[0].boundaryType).toBe('idle_gap');
  });

  it('does NOT create a task switch boundary if fewer than 10 tool calls since last boundary', () => {
    const toolCalls = Array.from({ length: 5 }, (_, i) => makeToolCall({ timestamp: minutes(i) }));
    toolCalls.push(
      makeToolCall({
        timestamp: minutes(5),
        toolName: 'Bash',
        input: { command: 'brain pm claim VNM-23.01' },
      })
    );
    const analytics = makeAnalytics(toolCalls);
    const boundaries = detectSegmentBoundaries(analytics);
    const taskSwitches = boundaries.filter((b) => b.boundaryType === 'task_switch');
    expect(taskSwitches).toHaveLength(0);
  });

  it('creates a task switch boundary when 10+ tool calls have elapsed since last boundary', () => {
    const toolCalls = Array.from({ length: 10 }, (_, i) => makeToolCall({ timestamp: minutes(i) }));
    toolCalls.push(
      makeToolCall({
        timestamp: minutes(10),
        toolName: 'Bash',
        input: { command: 'brain pm claim VNM-23.02' },
      })
    );
    const analytics = makeAnalytics(toolCalls);
    const boundaries = detectSegmentBoundaries(analytics);
    const taskSwitches = boundaries.filter((b) => b.boundaryType === 'task_switch');
    expect(taskSwitches).toHaveLength(1);
    expect(taskSwitches[0].toolCallIndex).toBe(10);
  });

  it('deduplicates when compaction and idle gap coincide — prefers compaction', () => {
    // Tool call at index 2 matches both a compaction and an idle gap
    const toolCalls = [
      makeToolCall({ timestamp: minutes(0) }),
      makeToolCall({ timestamp: minutes(1) }),
      makeToolCall({ timestamp: minutes(35) }), // idle gap here
      makeToolCall({ timestamp: minutes(36) }),
    ];
    // Compaction timestamp falls just before index 2
    const compactionTs = minutes(33);
    const analytics = makeAnalytics(toolCalls, {
      compactionTimestamps: [compactionTs],
      compactionSummaries: ['Compaction summary'],
      compactionByteOffsets: [512],
    });
    const boundaries = detectSegmentBoundaries(analytics);
    expect(boundaries).toHaveLength(1);
    expect(boundaries[0].boundaryType).toBe('compaction');
    expect(boundaries[0].compactionSummary).toBe('Compaction summary');
  });
});

describe('buildSegments', () => {
  it('returns a single segment when there are no boundaries', () => {
    const toolCalls = Array.from({ length: 5 }, (_, i) => makeToolCall({ timestamp: minutes(i) }));
    const analytics = makeAnalytics(toolCalls);
    const segments = buildSegments(analytics);
    expect(segments).toHaveLength(1);
    expect(segments[0].index).toBe(0);
    expect(segments[0].startToolIndex).toBe(0);
    expect(segments[0].endToolIndex).toBe(5);
    expect(segments[0].toolCalls).toBe(5);
    expect(segments[0].boundaryType).toBe('start');
  });

  it('returns empty array when there are no tool calls', () => {
    const analytics = makeAnalytics([]);
    expect(buildSegments(analytics)).toEqual([]);
  });

  it('produces correct segment count for multiple compactions', () => {
    const toolCalls = Array.from({ length: 20 }, (_, i) => makeToolCall({ timestamp: minutes(i) }));
    // Two compactions: before index 5 and before index 12
    const analytics = makeAnalytics(toolCalls, {
      compactionTimestamps: [minutes(4, 30000), minutes(11, 30000)],
      compactionSummaries: ['First summary', 'Second summary'],
      compactionByteOffsets: [100, 200],
    });
    const segments = buildSegments(analytics);
    expect(segments).toHaveLength(3);
    expect(segments[0].startToolIndex).toBe(0);
    expect(segments[0].endToolIndex).toBe(5);
    expect(segments[1].startToolIndex).toBe(5);
    expect(segments[1].endToolIndex).toBe(12);
    expect(segments[2].startToolIndex).toBe(12);
    expect(segments[2].endToolIndex).toBe(20);
  });

  it('computes correct tool call counts per segment', () => {
    const toolCalls = Array.from({ length: 10 }, (_, i) => makeToolCall({ timestamp: minutes(i) }));
    const analytics = makeAnalytics(toolCalls, {
      compactionTimestamps: [minutes(3, 30000)],
      compactionSummaries: ['summary'],
      compactionByteOffsets: [0],
    });
    const segments = buildSegments(analytics);
    expect(segments[0].toolCalls).toBe(4); // indices 0-3
    expect(segments[1].toolCalls).toBe(6); // indices 4-9
  });

  it('computes correct error counts per segment', () => {
    const toolCalls = [
      makeToolCall({ timestamp: minutes(0), outcome: 'error' }),
      makeToolCall({ timestamp: minutes(1), outcome: 'success' }),
      makeToolCall({ timestamp: minutes(2), outcome: 'error' }),
      makeToolCall({ timestamp: minutes(35), outcome: 'success' }), // idle gap before this
      makeToolCall({ timestamp: minutes(36), outcome: 'error' }),
    ];
    const analytics = makeAnalytics(toolCalls);
    const segments = buildSegments(analytics);
    expect(segments).toHaveLength(2);
    expect(segments[0].errorCount).toBe(2);
    expect(segments[1].errorCount).toBe(1);
  });

  it('extracts tasksWorked from tool call inputs within each segment', () => {
    const toolCalls = [
      makeToolCall({
        timestamp: minutes(0),
        input: { command: 'brain pm claim VNM-23.01' },
        toolName: 'Bash',
      }),
      makeToolCall({
        timestamp: minutes(1),
        input: { command: 'brain pm complete VNM-23.01' },
        toolName: 'Bash',
      }),
      makeToolCall({
        timestamp: minutes(35),
        input: { command: 'brain pm claim VNM-23.02' },
        toolName: 'Bash',
      }),
    ];
    const analytics = makeAnalytics(toolCalls);
    const segments = buildSegments(analytics);
    expect(segments).toHaveLength(2);
    expect(segments[0].tasksWorked).toContain('VNM-23.01');
    expect(segments[0].tasksWorked).not.toContain('VNM-23.02');
    expect(segments[1].tasksWorked).toContain('VNM-23.02');
  });
});
