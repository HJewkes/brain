import { describe, it, expect } from 'vitest';
import { computeSessionAnalyticsExt } from '../../../src/modules/sessions/analytics/metrics.js';
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
    ...overrides,
  };
}

describe('computeSessionAnalyticsExt', () => {
  describe('top_tools', () => {
    it('sorts tools by count descending', () => {
      // Arrange
      const toolCalls = [
        makeToolCall({ toolName: 'Read', outcome: 'success' }),
        makeToolCall({ toolName: 'Read', outcome: 'success' }),
        makeToolCall({ toolName: 'Read', outcome: 'success' }),
        makeToolCall({ toolName: 'Edit', outcome: 'success' }),
        makeToolCall({ toolName: 'Edit', outcome: 'success' }),
        makeToolCall({ toolName: 'Bash', outcome: 'success' }),
      ];
      const analytics = makeAnalytics({ toolCalls });

      // Act
      const result = computeSessionAnalyticsExt(analytics);

      // Assert
      expect(result.top_tools[0].name).toBe('Read');
      expect(result.top_tools[0].count).toBe(3);
      expect(result.top_tools[1].name).toBe('Edit');
      expect(result.top_tools[1].count).toBe(2);
      expect(result.top_tools[2].name).toBe('Bash');
      expect(result.top_tools[2].count).toBe(1);
    });

    it('limits results to 10 tools', () => {
      // Arrange
      const toolNames = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K'];
      const toolCalls = toolNames.map((name) => makeToolCall({ toolName: name }));
      const analytics = makeAnalytics({ toolCalls });

      // Act
      const result = computeSessionAnalyticsExt(analytics);

      // Assert
      expect(result.top_tools).toHaveLength(10);
    });

    it('computes per-tool error_rate correctly', () => {
      // Arrange: Read called 4 times, 1 error → 0.25; Bash called 2 times, 2 errors → 1.0
      const toolCalls = [
        makeToolCall({ toolName: 'Read', outcome: 'success' }),
        makeToolCall({ toolName: 'Read', outcome: 'success' }),
        makeToolCall({ toolName: 'Read', outcome: 'success' }),
        makeToolCall({ toolName: 'Read', outcome: 'error' }),
        makeToolCall({ toolName: 'Bash', outcome: 'error' }),
        makeToolCall({ toolName: 'Bash', outcome: 'error' }),
      ];
      const analytics = makeAnalytics({ toolCalls });

      // Act
      const result = computeSessionAnalyticsExt(analytics);

      // Assert
      const readEntry = result.top_tools.find((t) => t.name === 'Read');
      const bashEntry = result.top_tools.find((t) => t.name === 'Bash');
      expect(readEntry?.error_rate).toBe(0.25);
      expect(bashEntry?.error_rate).toBe(1.0);
    });

    it('returns error_rate of 0 when a tool has no errors', () => {
      // Arrange
      const toolCalls = [
        makeToolCall({ toolName: 'Read', outcome: 'success' }),
        makeToolCall({ toolName: 'Read', outcome: 'success' }),
      ];
      const analytics = makeAnalytics({ toolCalls });

      // Act
      const result = computeSessionAnalyticsExt(analytics);

      // Assert
      expect(result.top_tools[0].error_rate).toBe(0);
    });
  });

  describe('friction_categories', () => {
    it('groups friction signals by kind', () => {
      // Arrange
      const frictionSignals: FrictionSignal[] = [
        { kind: 'error_loop', timestamp: '2026-01-01T00:00:00Z', detail: 'loop' },
        { kind: 'error_loop', timestamp: '2026-01-01T00:01:00Z', detail: 'loop' },
        { kind: 'user_correction', timestamp: '2026-01-01T00:02:00Z', detail: 'correction' },
      ];
      const analytics = makeAnalytics({ frictionSignals });

      // Act
      const result = computeSessionAnalyticsExt(analytics);

      // Assert
      const errorLoopEntry = result.friction_categories.find((c) => c.category === 'error_loop');
      const correctionEntry = result.friction_categories.find(
        (c) => c.category === 'user_correction'
      );
      expect(errorLoopEntry?.count).toBe(2);
      expect(correctionEntry?.count).toBe(1);
    });

    it('includes all friction kinds present in the session', () => {
      // Arrange
      const frictionSignals: FrictionSignal[] = [
        {
          kind: 'consecutive_identical_tool',
          timestamp: '2026-01-01T00:00:00Z',
          detail: 'dup',
        },
        { kind: 'hook_prevention', timestamp: '2026-01-01T00:01:00Z', detail: 'hook' },
      ];
      const analytics = makeAnalytics({ frictionSignals });

      // Act
      const result = computeSessionAnalyticsExt(analytics);

      // Assert
      expect(result.friction_categories).toHaveLength(2);
      const categories = result.friction_categories.map((c) => c.category);
      expect(categories).toContain('consecutive_identical_tool');
      expect(categories).toContain('hook_prevention');
    });
  });

  describe('delegation_ratio', () => {
    it('computes ratio of sidechain calls to total calls', () => {
      // Arrange: 3 total calls, 2 sidechain → ratio = 2/3
      const toolCalls = [
        makeToolCall({ isSidechain: false }),
        makeToolCall({ isSidechain: true }),
        makeToolCall({ isSidechain: true }),
      ];
      const analytics = makeAnalytics({ toolCalls });

      // Act
      const result = computeSessionAnalyticsExt(analytics);

      // Assert
      expect(result.delegation_ratio).toBeCloseTo(2 / 3);
    });

    it('returns 0 when there are no tool calls', () => {
      // Arrange
      const analytics = makeAnalytics({ toolCalls: [] });

      // Act
      const result = computeSessionAnalyticsExt(analytics);

      // Assert
      expect(result.delegation_ratio).toBe(0);
    });

    it('returns 0 when all calls are main-chain', () => {
      // Arrange
      const toolCalls = [
        makeToolCall({ isSidechain: false }),
        makeToolCall({ isSidechain: false }),
      ];
      const analytics = makeAnalytics({ toolCalls });

      // Act
      const result = computeSessionAnalyticsExt(analytics);

      // Assert
      expect(result.delegation_ratio).toBe(0);
    });

    it('returns 1 when all calls are sidechain', () => {
      // Arrange
      const toolCalls = [makeToolCall({ isSidechain: true }), makeToolCall({ isSidechain: true })];
      const analytics = makeAnalytics({ toolCalls });

      // Act
      const result = computeSessionAnalyticsExt(analytics);

      // Assert
      expect(result.delegation_ratio).toBe(1);
    });
  });

  describe('context_pressure', () => {
    it('computes compactionCount divided by assistantTurns', () => {
      // Arrange: 3 compactions, 10 assistant turns → 0.3
      const analytics = makeAnalytics({ compactionCount: 3, assistantTurns: 10 });

      // Act
      const result = computeSessionAnalyticsExt(analytics);

      // Assert
      expect(result.context_pressure).toBeCloseTo(0.3);
    });

    it('returns 0 when compactionCount is 0', () => {
      // Arrange
      const analytics = makeAnalytics({ compactionCount: 0, assistantTurns: 10 });

      // Act
      const result = computeSessionAnalyticsExt(analytics);

      // Assert
      expect(result.context_pressure).toBe(0);
    });

    it('uses assistantTurns of at least 1 to avoid division by zero', () => {
      // Arrange: compactions present but assistantTurns is 0
      const analytics = makeAnalytics({ compactionCount: 2, assistantTurns: 0 });

      // Act
      const result = computeSessionAnalyticsExt(analytics);

      // Assert — 2 / max(0, 1) = 2
      expect(result.context_pressure).toBe(2);
    });
  });

  describe('empty session', () => {
    it('returns empty top_tools and friction_categories', () => {
      // Arrange
      const analytics = makeAnalytics();

      // Act
      const result = computeSessionAnalyticsExt(analytics);

      // Assert
      expect(result.top_tools).toEqual([]);
      expect(result.friction_categories).toEqual([]);
    });

    it('returns zero for delegation_ratio and context_pressure', () => {
      // Arrange
      const analytics = makeAnalytics();

      // Act
      const result = computeSessionAnalyticsExt(analytics);

      // Assert
      expect(result.delegation_ratio).toBe(0);
      expect(result.context_pressure).toBe(0);
    });
  });
});
