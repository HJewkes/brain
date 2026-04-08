import { describe, it, expect } from 'vitest';
import { scoreSessionQuality } from '../../../src/modules/sessions/analytics/scorer.js';
import type {
  SessionAnalytics,
  FrictionSignal,
  ToolCall,
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

describe('scoreSessionQuality', () => {
  describe('efficiency', () => {
    it('returns 0 efficiency when there are no tool calls', () => {
      const analytics = makeAnalytics({ toolCalls: [], commitCount: 1 });
      const result = scoreSessionQuality(analytics);
      expect(result.efficiency).toBe(0);
    });

    it('returns 0 efficiency when there are no commits', () => {
      const toolCalls = Array.from({ length: 20 }, () => makeToolCall());
      const analytics = makeAnalytics({ toolCalls, commitCount: 0 });
      const result = scoreSessionQuality(analytics);
      expect(result.efficiency).toBe(0);
    });

    it('returns 1.0 at the reference rate of 20 tool calls per commit', () => {
      const toolCalls = Array.from({ length: 20 }, () => makeToolCall());
      const analytics = makeAnalytics({ toolCalls, commitCount: 1 });
      const result = scoreSessionQuality(analytics);
      expect(result.efficiency).toBe(1);
    });

    it('returns 1.0 when tool calls are below the reference rate', () => {
      // 10 calls for 1 commit = 10 tools/commit < 20 reference → capped at 1
      const toolCalls = Array.from({ length: 10 }, () => makeToolCall());
      const analytics = makeAnalytics({ toolCalls, commitCount: 1 });
      const result = scoreSessionQuality(analytics);
      expect(result.efficiency).toBe(1);
    });

    it('returns 0.5 at twice the reference rate (40 tool calls per commit)', () => {
      const toolCalls = Array.from({ length: 40 }, () => makeToolCall());
      const analytics = makeAnalytics({ toolCalls, commitCount: 1 });
      const result = scoreSessionQuality(analytics);
      expect(result.efficiency).toBeCloseTo(0.5);
    });

    it('scales correctly with multiple commits', () => {
      // 40 calls, 4 commits = 10 per commit → below reference → efficiency 1.0
      const toolCalls = Array.from({ length: 40 }, () => makeToolCall());
      const analytics = makeAnalytics({ toolCalls, commitCount: 4 });
      const result = scoreSessionQuality(analytics);
      expect(result.efficiency).toBe(1);
    });
  });

  describe('reliability', () => {
    it('returns 1.0 reliability when errorRate is 0', () => {
      const analytics = makeAnalytics({ errorRate: 0 });
      const result = scoreSessionQuality(analytics);
      expect(result.reliability).toBe(1);
    });

    it('returns 0 reliability when errorRate is 1', () => {
      const analytics = makeAnalytics({ errorRate: 1 });
      const result = scoreSessionQuality(analytics);
      expect(result.reliability).toBe(0);
    });

    it('returns 0.75 reliability for 0.25 error rate', () => {
      const analytics = makeAnalytics({ errorRate: 0.25 });
      const result = scoreSessionQuality(analytics);
      expect(result.reliability).toBeCloseTo(0.75);
    });
  });

  describe('assurance', () => {
    it('returns 1.0 when there are no friction signals', () => {
      const toolCalls = Array.from({ length: 10 }, () => makeToolCall());
      const analytics = makeAnalytics({ toolCalls, frictionSignals: [] });
      const result = scoreSessionQuality(analytics);
      expect(result.assurance).toBe(1);
    });

    it('returns 1.0 with no tool calls and no friction signals', () => {
      const analytics = makeAnalytics({ toolCalls: [], frictionSignals: [] });
      const result = scoreSessionQuality(analytics);
      expect(result.assurance).toBe(1);
    });

    it('returns 0 with no tool calls but friction signals present', () => {
      const frictionSignals: FrictionSignal[] = [
        { kind: 'user_correction', timestamp: '2026-01-01T00:00:00Z', detail: 'oops' },
      ];
      const analytics = makeAnalytics({ toolCalls: [], frictionSignals });
      const result = scoreSessionQuality(analytics);
      expect(result.assurance).toBe(0);
    });

    it('decreases assurance as friction density increases', () => {
      // 2 friction signals out of 10 tool calls = 0.2 density → 1 - 0.2*5 = 0
      const frictionSignals: FrictionSignal[] = [
        { kind: 'user_correction', timestamp: '2026-01-01T00:00:00Z', detail: 'oops' },
        { kind: 'hook_prevention', timestamp: '2026-01-01T00:01:00Z', detail: 'blocked' },
      ];
      const toolCalls = Array.from({ length: 10 }, () => makeToolCall());
      const analytics = makeAnalytics({ toolCalls, frictionSignals });
      const result = scoreSessionQuality(analytics);
      expect(result.assurance).toBe(0);
    });

    it('gives partial assurance at low friction density', () => {
      // 1 signal / 20 calls = 0.05 density → 1 - 0.05*5 = 0.75
      const frictionSignals: FrictionSignal[] = [
        { kind: 'user_correction', timestamp: '2026-01-01T00:00:00Z', detail: 'minor' },
      ];
      const toolCalls = Array.from({ length: 20 }, () => makeToolCall());
      const analytics = makeAnalytics({ toolCalls, frictionSignals });
      const result = scoreSessionQuality(analytics);
      expect(result.assurance).toBeCloseTo(0.75);
    });
  });

  describe('steadiness', () => {
    it('returns 1.0 when there are no retry-type friction signals', () => {
      const toolCalls = Array.from({ length: 10 }, () => makeToolCall());
      const analytics = makeAnalytics({ toolCalls, frictionSignals: [] });
      const result = scoreSessionQuality(analytics);
      expect(result.steadiness).toBe(1);
    });

    it('counts error_loop friction as retries', () => {
      const toolCalls = Array.from({ length: 10 }, () => makeToolCall());
      const frictionSignals: FrictionSignal[] = [
        { kind: 'error_loop', timestamp: '2026-01-01T00:00:00Z', detail: 'loop' },
        { kind: 'error_loop', timestamp: '2026-01-01T00:01:00Z', detail: 'loop' },
      ];
      const analytics = makeAnalytics({ toolCalls, frictionSignals });
      const result = scoreSessionQuality(analytics);
      // 2 retries / 10 calls = 0.2 retry rate → 1 - 0.2*5 = 0
      expect(result.steadiness).toBe(0);
    });

    it('counts consecutive_identical_tool friction as retries', () => {
      const toolCalls = Array.from({ length: 20 }, () => makeToolCall());
      const frictionSignals: FrictionSignal[] = [
        {
          kind: 'consecutive_identical_tool',
          timestamp: '2026-01-01T00:00:00Z',
          detail: 'dup',
        },
      ];
      const analytics = makeAnalytics({ toolCalls, frictionSignals });
      const result = scoreSessionQuality(analytics);
      // 1 retry / 20 calls = 0.05 retry rate → 1 - 0.05*5 = 0.75
      expect(result.steadiness).toBeCloseTo(0.75);
    });

    it('does not count user_correction or hook_prevention as retries', () => {
      const toolCalls = Array.from({ length: 10 }, () => makeToolCall());
      const frictionSignals: FrictionSignal[] = [
        { kind: 'user_correction', timestamp: '2026-01-01T00:00:00Z', detail: 'fix' },
        { kind: 'hook_prevention', timestamp: '2026-01-01T00:01:00Z', detail: 'hook' },
      ];
      const analytics = makeAnalytics({ toolCalls, frictionSignals });
      const result = scoreSessionQuality(analytics);
      expect(result.steadiness).toBe(1); // no retry-type signals
    });
  });

  describe('overall', () => {
    it('returns 100 for a perfect session', () => {
      // Perfect: low tool calls per commit, 0 errors, 0 friction, 0 retries
      const toolCalls = Array.from({ length: 10 }, () => makeToolCall());
      const analytics = makeAnalytics({
        toolCalls,
        commitCount: 1,
        errorRate: 0,
        frictionSignals: [],
      });
      const result = scoreSessionQuality(analytics);
      expect(result.overall).toBe(100);
    });

    it('returns 0 overall for a completely failed session', () => {
      // Zero commits, 100% error rate, saturated friction and retries
      const frictionSignals: FrictionSignal[] = Array.from({ length: 20 }, (_, i) => ({
        kind: 'error_loop' as const,
        timestamp: `2026-01-01T00:${String(i).padStart(2, '0')}:00Z`,
        detail: 'loop',
      }));
      const toolCalls = Array.from({ length: 10 }, () => makeToolCall({ outcome: 'error' }));
      const analytics = makeAnalytics({
        toolCalls,
        commitCount: 0,
        errorRate: 1,
        frictionSignals,
      });
      const result = scoreSessionQuality(analytics);
      expect(result.overall).toBe(0);
    });

    it('produces a score between 0 and 100 for typical sessions', () => {
      const toolCalls = Array.from({ length: 50 }, () =>
        makeToolCall({ outcome: Math.random() > 0.8 ? 'error' : 'success' })
      );
      const frictionSignals: FrictionSignal[] = [
        { kind: 'user_correction', timestamp: '2026-01-01T00:00:00Z', detail: 'fix' },
      ];
      const analytics = makeAnalytics({
        toolCalls,
        commitCount: 2,
        errorRate: 0.15,
        frictionSignals,
      });
      const result = scoreSessionQuality(analytics);
      expect(result.overall).toBeGreaterThanOrEqual(0);
      expect(result.overall).toBeLessThanOrEqual(100);
    });
  });

  describe('raw signals', () => {
    it('exposes correct raw values', () => {
      const toolCalls = [
        makeToolCall({ toolName: 'Read', outcome: 'success' }),
        makeToolCall({ toolName: 'Edit', outcome: 'error' }),
      ];
      const frictionSignals: FrictionSignal[] = [
        { kind: 'error_loop', timestamp: '2026-01-01T00:00:00Z', detail: 'loop' },
        { kind: 'user_correction', timestamp: '2026-01-01T00:01:00Z', detail: 'fix' },
      ];
      const analytics = makeAnalytics({
        toolCalls,
        commitCount: 1,
        errorRate: 0.5,
        frictionSignals,
        hookPreventionCount: 3,
        taskRefs: ['TASK-1', 'TASK-2'],
      });
      const result = scoreSessionQuality(analytics);
      expect(result.raw.toolCallCount).toBe(2);
      expect(result.raw.commitCount).toBe(1);
      expect(result.raw.taskRefCount).toBe(2);
      expect(result.raw.errorRate).toBe(0.5);
      expect(result.raw.frictionSignalCount).toBe(2);
      expect(result.raw.retryCount).toBe(1); // only error_loop counts
      expect(result.raw.hookPreventionCount).toBe(3);
    });
  });
});
