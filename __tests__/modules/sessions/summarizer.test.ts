import { describe, it, expect, vi } from 'vitest';
import {
  buildSummaryDigest,
  generateSummaries,
  generateL2Timeline,
} from '../../../src/modules/sessions/ingestion/summarizer.js';
import type {
  SessionAnalytics,
  ToolCall,
  ErrorEvent,
  FrictionSignal,
} from '../../../src/modules/sessions/types.js';

function makeToolCall(overrides: Partial<ToolCall> = {}): ToolCall {
  return {
    toolUseId: 'tc-001',
    toolName: 'Bash',
    input: {},
    timestamp: '2026-03-13T10:00:00Z',
    outcome: 'success',
    durationMs: 100,
    isSidechain: false,
    ...overrides,
  };
}

function makeAnalytics(overrides: Partial<SessionAnalytics> = {}): SessionAnalytics {
  return {
    sessionId: 'sess-abc123',
    projectDir: '/Users/test/project',
    gitBranch: null,
    model: null,
    claudeVersion: null,
    startTime: '2026-03-13T10:00:00Z',
    endTime: '2026-03-13T10:30:00Z',
    durationMs: 30 * 60_000, // 30 minutes
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
    tokens: { inputTokens: 1000, outputTokens: 500, cacheCreationTokens: 0, cacheReadTokens: 0 },
    frictionSignals: [],
    hookEventCount: 0,
    hookPreventionCount: 0,
    capturedViaHooks: false,
    capturedViaJsonl: true,
    ...overrides,
  };
}

describe('buildSummaryDigest', () => {
  it('includes session ID, project, duration, turns, and tool call counts', () => {
    const analytics = makeAnalytics({
      toolCalls: [makeToolCall(), makeToolCall({ outcome: 'error' })],
      errorCount: 1,
      errorRate: 0.5,
    });

    const digest = buildSummaryDigest(analytics);

    expect(digest).toContain('Session: sess-abc123');
    expect(digest).toContain('Project: /Users/test/project');
    expect(digest).toContain('30m');
    expect(digest).toContain('5 user, 5 assistant');
    expect(digest).toContain('Tool calls: 2');
    expect(digest).toContain('1 errors');
    expect(digest).toContain('50.0% error rate');
  });

  it('includes friction signals when present', () => {
    const frictionSignals: FrictionSignal[] = [
      {
        kind: 'error_loop',
        detail: 'Bash failed 3 times',
        timestamp: '2026-03-13T10:05:00Z',
        count: 3,
      },
      {
        kind: 'consecutive_identical_tool',
        detail: 'Read called twice',
        timestamp: '2026-03-13T10:10:00Z',
      },
    ];
    const analytics = makeAnalytics({ frictionSignals });

    const digest = buildSummaryDigest(analytics);

    expect(digest).toContain('Friction signals: 2');
    expect(digest).toContain('error_loop: Bash failed 3 times');
    expect(digest).toContain('consecutive_identical_tool: Read called twice');
  });

  it('includes compaction count when isCompacted is true', () => {
    const analytics = makeAnalytics({ isCompacted: true, compactionCount: 3 });

    const digest = buildSummaryDigest(analytics);

    expect(digest).toContain('Compactions: 3');
  });

  it('does not include compaction count when isCompacted is false', () => {
    const analytics = makeAnalytics({ isCompacted: false, compactionCount: 0 });

    const digest = buildSummaryDigest(analytics);

    expect(digest).not.toContain('Compaction');
  });

  it('includes top tools sorted by call count descending', () => {
    const analytics = makeAnalytics({
      toolCallsByName: { Bash: 10, Read: 7, Edit: 3 },
      uniqueToolsUsed: ['Bash', 'Read', 'Edit'],
    });

    const digest = buildSummaryDigest(analytics);

    expect(digest).toContain('Top tools:');
    expect(digest).toContain('Bash: 10 calls');
    expect(digest).toContain('Read: 7 calls');
    expect(digest).toContain('Edit: 3 calls');

    const bashIndex = digest.indexOf('Bash: 10 calls');
    const readIndex = digest.indexOf('Read: 7 calls');
    const editIndex = digest.indexOf('Edit: 3 calls');
    expect(bashIndex).toBeLessThan(readIndex);
    expect(readIndex).toBeLessThan(editIndex);
  });

  it('includes git branch and model when present', () => {
    const analytics = makeAnalytics({ gitBranch: 'feat/my-feature', model: 'claude-sonnet-4-5' });

    const digest = buildSummaryDigest(analytics);

    expect(digest).toContain('Branch: feat/my-feature');
    expect(digest).toContain('Model: claude-sonnet-4-5');
  });

  it('omits branch and model lines when null', () => {
    const analytics = makeAnalytics({ gitBranch: null, model: null });

    const digest = buildSummaryDigest(analytics);

    expect(digest).not.toContain('Branch:');
    expect(digest).not.toContain('Model:');
  });
});

describe('generateSummaries', () => {
  it('returns deterministic fallback when ollama is null', async () => {
    const analytics = makeAnalytics({
      gitBranch: 'main',
      durationMs: 15 * 60_000,
      toolCalls: [makeToolCall()],
    });

    const result = await generateSummaries(analytics, null);

    // l0 is the L0 fallback: branch — tool count — duration
    expect(result.l0).toContain('main');
    expect(result.l0).toContain('1 tool call');
    // l1 is the digest
    expect(result.l1).toContain('Session: sess-abc123');
  });

  it('calls ollama.generate and returns trimmed l0 and l1', async () => {
    const analytics = makeAnalytics();
    const ollama = {
      generate: vi
        .fn()
        .mockResolvedValueOnce('  Implemented a new feature.  ')
        .mockResolvedValueOnce('## What Was Accomplished\n- Wrote code\n'),
    };

    const result = await generateSummaries(analytics, ollama as never);

    expect(ollama.generate).toHaveBeenCalledTimes(2);
    expect(result.l0).toBe('Implemented a new feature.');
    expect(result.l1).toBe('## What Was Accomplished\n- Wrote code');
  });

  it('falls back to deterministic when ollama.generate throws', async () => {
    const analytics = makeAnalytics({ gitBranch: 'fix/bug', durationMs: 5 * 60_000 });
    const ollama = {
      generate: vi.fn().mockRejectedValue(new Error('Ollama unavailable')),
    };

    const result = await generateSummaries(analytics, ollama as never);

    expect(result.l0).toContain('fix/bug');
    expect(result.l1).toContain('Session: sess-abc123');
  });

  it('uses l0Fallback when ollama returns empty string for l0', async () => {
    const analytics = makeAnalytics({ gitBranch: 'main' });
    const ollama = {
      generate: vi.fn().mockResolvedValueOnce('   ').mockResolvedValueOnce('## Summary\n- done'),
    };

    const result = await generateSummaries(analytics, ollama as never);

    expect(result.l0).toContain('main');
  });

  it('uses digest when ollama returns empty string for l1', async () => {
    const analytics = makeAnalytics();
    const ollama = {
      generate: vi.fn().mockResolvedValueOnce('Good session.').mockResolvedValueOnce('   '),
    };

    const result = await generateSummaries(analytics, ollama as never);

    expect(result.l1).toContain('Session: sess-abc123');
  });
});

describe('generateL2Timeline', () => {
  it('includes Active Files section from Read/Write/Edit tool calls', () => {
    const toolCalls: ToolCall[] = [
      makeToolCall({
        toolName: 'Read',
        input: { file_path: '/Users/test/project/src/foo.ts' },
        timestamp: '2026-03-13T10:01:00Z',
      }),
      makeToolCall({
        toolName: 'Edit',
        input: { file_path: '/Users/test/project/src/foo.ts' },
        timestamp: '2026-03-13T10:02:00Z',
      }),
      makeToolCall({
        toolName: 'Write',
        input: { file_path: '/Users/test/project/src/bar.ts' },
        timestamp: '2026-03-13T10:03:00Z',
      }),
    ];
    const analytics = makeAnalytics({ toolCalls });

    const timeline = generateL2Timeline(analytics);

    expect(timeline).toContain('## Active Files');
    expect(timeline).toContain('src/foo.ts');
    expect(timeline).toContain('src/bar.ts');
    expect(timeline).toContain('Read');
    expect(timeline).toContain('Edit');
    expect(timeline).toContain('Write');
  });

  it('omits Active Files section when no file tool calls are present', () => {
    const toolCalls: ToolCall[] = [makeToolCall({ toolName: 'Bash', input: { command: 'ls' } })];
    const analytics = makeAnalytics({ toolCalls });

    const timeline = generateL2Timeline(analytics);

    expect(timeline).not.toContain('## Active Files');
  });

  it('includes Tool Call Log with timestamps', () => {
    const toolCalls: ToolCall[] = [
      makeToolCall({ toolName: 'Bash', timestamp: '2026-03-13T10:05:30Z', durationMs: 250 }),
      makeToolCall({ toolName: 'Read', timestamp: '2026-03-13T10:06:45Z', durationMs: null }),
    ];
    const analytics = makeAnalytics({ toolCalls });

    const timeline = generateL2Timeline(analytics);

    expect(timeline).toContain('## Tool Call Log');
    expect(timeline).toContain('10:05:30 Bash');
    expect(timeline).toContain('(250ms)');
    expect(timeline).toContain('10:06:45 Read');
  });

  it('marks errored and pending tool calls in the log', () => {
    const toolCalls: ToolCall[] = [
      makeToolCall({ toolName: 'Bash', outcome: 'error', timestamp: '2026-03-13T10:05:00Z' }),
      makeToolCall({ toolName: 'Read', outcome: 'pending', timestamp: '2026-03-13T10:06:00Z' }),
    ];
    const analytics = makeAnalytics({ toolCalls });

    const timeline = generateL2Timeline(analytics);

    expect(timeline).toContain('Bash ERROR');
    expect(timeline).toContain('Read PENDING');
  });

  it('marks sidechain tool calls in the log', () => {
    const toolCalls: ToolCall[] = [
      makeToolCall({ toolName: 'Bash', isSidechain: true, timestamp: '2026-03-13T10:05:00Z' }),
    ];
    const analytics = makeAnalytics({ toolCalls });

    const timeline = generateL2Timeline(analytics);

    expect(timeline).toContain('[sidechain]');
  });

  it('includes Errors section when errors are present', () => {
    const errors: ErrorEvent[] = [
      {
        timestamp: '2026-03-13T10:07:00Z',
        toolName: 'Bash',
        message: 'Command not found: foobar',
        isSidechain: false,
      },
    ];
    const analytics = makeAnalytics({ errors, errorCount: 1, errorRate: 0.5 });

    const timeline = generateL2Timeline(analytics);

    expect(timeline).toContain('## Errors');
    expect(timeline).toContain('10:07:00 Bash: Command not found: foobar');
  });

  it('uses "unknown" for errors with no toolName', () => {
    const errors: ErrorEvent[] = [
      {
        timestamp: '2026-03-13T10:07:00Z',
        toolName: undefined,
        message: 'Unexpected failure',
        isSidechain: false,
      },
    ];
    const analytics = makeAnalytics({ errors, errorCount: 1 });

    const timeline = generateL2Timeline(analytics);

    expect(timeline).toContain('unknown: Unexpected failure');
  });

  it('omits Errors section when no errors are present', () => {
    const analytics = makeAnalytics({ errors: [], errorCount: 0 });

    const timeline = generateL2Timeline(analytics);

    expect(timeline).not.toContain('## Errors');
  });

  it('includes Friction Signals section when present', () => {
    const frictionSignals: FrictionSignal[] = [
      {
        kind: 'error_loop',
        detail: 'Bash failed 3 times',
        timestamp: '2026-03-13T10:05:00Z',
        count: 3,
      },
      {
        kind: 'user_correction',
        detail: 'User corrected output',
        timestamp: '2026-03-13T10:08:00Z',
      },
    ];
    const analytics = makeAnalytics({ frictionSignals });

    const timeline = generateL2Timeline(analytics);

    expect(timeline).toContain('## Friction Signals');
    expect(timeline).toContain('error_loop: Bash failed 3 times');
    expect(timeline).toContain('user_correction: User corrected output');
  });

  it('omits Friction Signals section when none are present', () => {
    const analytics = makeAnalytics({ frictionSignals: [] });

    const timeline = generateL2Timeline(analytics);

    expect(timeline).not.toContain('## Friction Signals');
  });

  it('includes Metadata section with session details', () => {
    const analytics = makeAnalytics({
      gitBranch: 'feat/summarizer',
      model: 'claude-sonnet',
      userTurns: 8,
      assistantTurns: 8,
      toolCalls: [makeToolCall()],
      errorCount: 0,
      tokens: { inputTokens: 2000, outputTokens: 800, cacheCreationTokens: 0, cacheReadTokens: 0 },
    });

    const timeline = generateL2Timeline(analytics);

    expect(timeline).toContain('## Metadata');
    expect(timeline).toContain('Session ID: sess-abc123');
    expect(timeline).toContain('Project: /Users/test/project');
    expect(timeline).toContain('Branch: feat/summarizer');
    expect(timeline).toContain('Model: claude-sonnet');
    expect(timeline).toContain('8 user / 8 assistant');
    expect(timeline).toContain('Tokens: 2000 in / 800 out');
  });

  it('includes compaction count in Metadata when isCompacted is true', () => {
    const analytics = makeAnalytics({ isCompacted: true, compactionCount: 2 });

    const timeline = generateL2Timeline(analytics);

    expect(timeline).toContain('Compactions: 2');
  });

  it('omits branch and model from Metadata when null', () => {
    const analytics = makeAnalytics({ gitBranch: null, model: null });

    const timeline = generateL2Timeline(analytics);

    expect(timeline).not.toMatch(/- Branch:/);
    expect(timeline).not.toMatch(/- Model:/);
  });

  it('truncates long error messages to 200 characters', () => {
    const longMessage = 'x'.repeat(300);
    const errors: ErrorEvent[] = [
      {
        timestamp: '2026-03-13T10:07:00Z',
        toolName: 'Bash',
        message: longMessage,
        isSidechain: false,
      },
    ];
    const analytics = makeAnalytics({ errors, errorCount: 1 });

    const timeline = generateL2Timeline(analytics);

    expect(timeline).toContain('x'.repeat(200));
    expect(timeline).not.toContain('x'.repeat(201));
  });

  it('starts with # Session Timeline header', () => {
    const analytics = makeAnalytics();

    const timeline = generateL2Timeline(analytics);

    expect(timeline).toMatch(/^# Session Timeline/);
  });
});
