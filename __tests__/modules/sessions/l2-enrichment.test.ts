import { describe, it, expect } from 'vitest';
import {
  generateL2Timeline,
  summarizeInput,
} from '../../../src/modules/sessions/ingestion/summarizer.js';
import type { SessionAnalytics, ToolCall } from '../../../src/modules/sessions/types.js';

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
    durationMs: 30 * 60_000,
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

describe('summarizeInput', () => {
  it('returns file_path for Read tool', () => {
    const result = summarizeInput('Read', { file_path: '/some/path.ts' });
    expect(result).toBe('file_path: /some/path.ts');
  });

  it('returns file_path for Write tool', () => {
    const result = summarizeInput('Write', { file_path: '/some/path.ts' });
    expect(result).toBe('file_path: /some/path.ts');
  });

  it('returns file_path for Edit tool', () => {
    const result = summarizeInput('Edit', { file_path: '/some/path.ts' });
    expect(result).toBe('file_path: /some/path.ts');
  });

  it('returns command for Bash tool truncated at 100 chars', () => {
    const longCmd = 'npm test --reporter=dot ' + 'x'.repeat(200);
    const result = summarizeInput('Bash', { command: longCmd });
    expect(result).toMatch(/^command: /);
    expect(result!.length).toBeLessThanOrEqual('command: '.length + 100);
  });

  it('returns pattern for Grep tool', () => {
    const result = summarizeInput('Grep', { pattern: 'foo.*bar' });
    expect(result).toBe('pattern: foo.*bar');
  });

  it('returns pattern for Glob tool', () => {
    const result = summarizeInput('Glob', { pattern: '**/*.ts' });
    expect(result).toBe('pattern: **/*.ts');
  });

  it('returns prompt for Agent tool truncated at 80 chars', () => {
    const longPrompt = 'Implement the feature: ' + 'x'.repeat(200);
    const result = summarizeInput('Agent', { prompt: longPrompt });
    expect(result).toMatch(/^prompt: /);
    expect(result!.length).toBeLessThanOrEqual('prompt: '.length + 80);
  });

  it('returns query for WebSearch tool', () => {
    const result = summarizeInput('WebSearch', { query: 'typescript generics' });
    expect(result).toBe('query: typescript generics');
  });

  it('returns url for WebFetch tool', () => {
    const result = summarizeInput('WebFetch', { url: 'https://example.com' });
    expect(result).toBe('url: https://example.com');
  });

  it('returns skill for Skill tool', () => {
    const result = summarizeInput('Skill', { skill: 'code-review' });
    expect(result).toBe('skill: code-review');
  });

  it('returns to for SendMessage tool', () => {
    const result = summarizeInput('SendMessage', { to: 'agent-042' });
    expect(result).toBe('to: agent-042');
  });

  it('returns null for unknown tool', () => {
    const result = summarizeInput('UnknownTool', { foo: 'bar' });
    expect(result).toBeNull();
  });

  it('returns null for Read with no file_path', () => {
    const result = summarizeInput('Read', {});
    expect(result).toBeNull();
  });
});

describe('generateL2Timeline — enriched tool call entries', () => {
  it('renders [offset:N] when byteOffset is defined', () => {
    const toolCalls = [
      makeToolCall({ toolName: 'Bash', input: { command: 'ls' }, byteOffset: 4520 }),
    ];
    const analytics = makeAnalytics({ toolCalls });

    const timeline = generateL2Timeline(analytics);

    expect(timeline).toContain('[offset:4520]');
  });

  it('omits offset tag when byteOffset is undefined', () => {
    const toolCalls = [makeToolCall({ toolName: 'Bash', input: { command: 'ls' } })];
    const analytics = makeAnalytics({ toolCalls });

    const timeline = generateL2Timeline(analytics);

    expect(timeline).not.toContain('[offset:');
  });

  it('renders input summary for Read tool call', () => {
    const toolCalls = [
      makeToolCall({ toolName: 'Read', input: { file_path: 'src/modules/pm/engine/routing.ts' } }),
    ];
    const analytics = makeAnalytics({ toolCalls });

    const timeline = generateL2Timeline(analytics);

    expect(timeline).toContain('  > file_path: src/modules/pm/engine/routing.ts');
  });

  it('renders Bash command input summary truncated at 100 chars', () => {
    const longCmd = 'npm test --reporter=dot ' + 'a'.repeat(200);
    const toolCalls = [makeToolCall({ toolName: 'Bash', input: { command: longCmd } })];
    const analytics = makeAnalytics({ toolCalls });

    const timeline = generateL2Timeline(analytics);

    expect(timeline).toContain('  > command:');
    // The summary line should not exceed 100 chars from the command part
    const cmdLine = timeline.split('\n').find((l) => l.startsWith('  > command:'));
    const cmdValue = cmdLine!.slice('  > command: '.length);
    expect(cmdValue.length).toBeLessThanOrEqual(100);
  });

  it('renders error detail for errored tool calls', () => {
    const toolCalls = [
      makeToolCall({
        toolName: 'Edit',
        outcome: 'error',
        input: { file_path: 'src/foo.ts' },
        errorMessage: 'old_string not found in file',
      }),
    ];
    const analytics = makeAnalytics({ toolCalls, errorCount: 1 });

    const timeline = generateL2Timeline(analytics);

    expect(timeline).toContain('  > error: old_string not found in file');
  });

  it('places ERROR before offset tag in the tool call line', () => {
    const toolCalls = [
      makeToolCall({
        toolName: 'Edit',
        outcome: 'error',
        durationMs: 265,
        byteOffset: 5890,
        input: { file_path: 'src/foo.ts' },
        errorMessage: 'old_string not found',
      }),
    ];
    const analytics = makeAnalytics({ toolCalls, errorCount: 1 });

    const timeline = generateL2Timeline(analytics);

    // Verify line format: "- TIME TOOL ERROR (Nms) [offset:N]"
    expect(timeline).toMatch(/- \d{2}:\d{2}:\d{2} Edit ERROR \(265ms\) \[offset:5890\]/);
  });
});

describe('generateL2Timeline — compaction markers', () => {
  it('renders compaction markers in chronological order relative to tool calls', () => {
    const toolCalls = [
      makeToolCall({ toolName: 'Read', timestamp: '2026-03-13T10:00:00Z' }),
      makeToolCall({ toolName: 'Bash', timestamp: '2026-03-13T10:10:00Z' }),
    ];
    const analytics = makeAnalytics({
      toolCalls,
      compactionTimestamps: ['2026-03-13T10:05:00Z'],
      compactionSummaries: ['Refactored the routing engine.'],
      isCompacted: true,
      compactionCount: 1,
    });

    const timeline = generateL2Timeline(analytics);
    const lines = timeline.split('\n');

    const readIdx = lines.findIndex((l) => l.includes('10:00:00 Read'));
    const compactIdx = lines.findIndex((l) => l.includes('--- COMPACTION'));
    const bashIdx = lines.findIndex((l) => l.includes('10:10:00 Bash'));

    expect(readIdx).toBeGreaterThanOrEqual(0);
    expect(compactIdx).toBeGreaterThan(readIdx);
    expect(bashIdx).toBeGreaterThan(compactIdx);
  });

  it('includes compaction summary text after the marker', () => {
    const analytics = makeAnalytics({
      toolCalls: [],
      compactionTimestamps: ['2026-03-13T10:05:00Z'],
      compactionSummaries: ['Refactored the routing engine.'],
      isCompacted: true,
      compactionCount: 1,
    });

    const timeline = generateL2Timeline(analytics);

    expect(timeline).toContain('--- COMPACTION ---');
    expect(timeline).toContain('Refactored the routing engine.');
  });

  it('omits summary text when compactionSummaries is empty', () => {
    const analytics = makeAnalytics({
      toolCalls: [],
      compactionTimestamps: ['2026-03-13T10:05:00Z'],
      compactionSummaries: [],
      isCompacted: true,
      compactionCount: 1,
    });

    const timeline = generateL2Timeline(analytics);

    expect(timeline).toContain('--- COMPACTION ---');
  });
});

describe('generateL2Timeline — task boundary markers', () => {
  it('renders TASK BOUNDARY claimed marker for brain pm claim commands', () => {
    const toolCalls = [
      makeToolCall({ toolName: 'Bash', input: { command: 'brain pm claim VNM-21.05' } }),
    ];
    const analytics = makeAnalytics({ toolCalls });

    const timeline = generateL2Timeline(analytics);

    expect(timeline).toContain('--- TASK BOUNDARY: VNM-21.05 claimed ---');
  });

  it('renders TASK BOUNDARY completed marker for brain pm complete commands', () => {
    const toolCalls = [
      makeToolCall({ toolName: 'Bash', input: { command: 'brain pm complete VNM-21.05' } }),
    ];
    const analytics = makeAnalytics({ toolCalls });

    const timeline = generateL2Timeline(analytics);

    expect(timeline).toContain('--- TASK BOUNDARY: VNM-21.05 completed ---');
  });

  it('does not render task boundary for unrelated Bash commands', () => {
    const toolCalls = [makeToolCall({ toolName: 'Bash', input: { command: 'npm test' } })];
    const analytics = makeAnalytics({ toolCalls });

    const timeline = generateL2Timeline(analytics);

    expect(timeline).not.toContain('--- TASK BOUNDARY');
  });
});

describe('generateL2Timeline — agent spawn markers', () => {
  it('renders AGENT SPAWN marker for Agent tool calls with prompt', () => {
    const toolCalls = [
      makeToolCall({
        toolName: 'Agent',
        input: { prompt: 'Implement the feature branch with tests' },
      }),
    ];
    const analytics = makeAnalytics({ toolCalls });

    const timeline = generateL2Timeline(analytics);

    // Prompt is 39 chars (fits within 40 char limit), full string is used
    expect(timeline).toContain('--- AGENT SPAWN: Implement the feature branch with tests ---');
  });

  it('renders AGENT SPAWN marker for Task tool calls', () => {
    const toolCalls = [
      makeToolCall({
        toolName: 'Task',
        input: { prompt: 'Run the test suite' },
      }),
    ];
    const analytics = makeAnalytics({ toolCalls });

    const timeline = generateL2Timeline(analytics);

    expect(timeline).toContain('--- AGENT SPAWN: Run the test suite ---');
  });

  it('uses description field for TaskCreate when no prompt', () => {
    const toolCalls = [
      makeToolCall({
        toolName: 'TaskCreate',
        input: { description: 'Create deployment agent' },
      }),
    ];
    const analytics = makeAnalytics({ toolCalls });

    const timeline = generateL2Timeline(analytics);

    expect(timeline).toContain('--- AGENT SPAWN: Create deployment agent ---');
  });
});
