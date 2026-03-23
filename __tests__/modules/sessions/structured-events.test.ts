import { describe, it, expect } from 'vitest';
import { buildStructuredEvents } from '../../../src/modules/sessions/ingestion/structured-events.js';
import type {
  SessionAnalytics,
  ToolCall,
  TokenSnapshot,
} from '../../../src/modules/sessions/types.js';

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
    slug: null,
    logicalParentUuid: null,
    compactionTimestamps: [],
    compactionSummaries: [],
    compactionByteOffsets: [],
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

  describe('multi-user-message turn grouping', () => {
    it('groups tool calls between distinct user messages into separate turns', () => {
      const snapshots: TokenSnapshot[] = [
        { timestamp: '2026-03-15T10:01:00Z', cumulativeInput: 100, cumulativeOutput: 50 },
        { timestamp: '2026-03-15T10:03:00Z', cumulativeInput: 300, cumulativeOutput: 150 },
        { timestamp: '2026-03-15T10:05:00Z', cumulativeInput: 600, cumulativeOutput: 300 },
      ];

      const toolCalls: ToolCall[] = [
        makeToolCall({ toolUseId: 'tu-1', toolName: 'Read', timestamp: '2026-03-15T10:01:00Z' }),
        makeToolCall({ toolUseId: 'tu-2', toolName: 'Grep', timestamp: '2026-03-15T10:01:00Z' }),
        makeToolCall({ toolUseId: 'tu-3', toolName: 'Edit', timestamp: '2026-03-15T10:03:00Z' }),
        makeToolCall({ toolUseId: 'tu-4', toolName: 'Bash', timestamp: '2026-03-15T10:05:00Z' }),
        makeToolCall({ toolUseId: 'tu-5', toolName: 'Read', timestamp: '2026-03-15T10:05:00Z' }),
      ];

      const analytics = makeAnalytics({
        assistantTurns: 3,
        assistantTexts: ['Looking at files.', 'Making an edit.', 'Running tests.'],
        tokenSnapshots: snapshots,
        toolCalls,
      });

      const result = buildStructuredEvents(analytics);

      expect(result.turns).toHaveLength(3);
      expect(result.turns[0].toolCalls).toHaveLength(2);
      expect(result.turns[0].toolCalls[0].toolName).toBe('Read');
      expect(result.turns[0].toolCalls[1].toolName).toBe('Grep');
      expect(result.turns[1].toolCalls).toHaveLength(1);
      expect(result.turns[1].toolCalls[0].toolName).toBe('Edit');
      expect(result.turns[2].toolCalls).toHaveLength(2);
      expect(result.turns[2].toolCalls[0].toolName).toBe('Bash');
      expect(result.turns[2].toolCalls[1].toolName).toBe('Read');
    });

    it('creates turns from assistantTexts even when assistantTurns is lower', () => {
      const analytics = makeAnalytics({
        assistantTurns: 1,
        assistantTexts: ['First response.', 'Second response.', 'Third response.'],
        tokenSnapshots: [
          { timestamp: '2026-03-15T10:01:00Z', cumulativeInput: 100, cumulativeOutput: 50 },
          { timestamp: '2026-03-15T10:02:00Z', cumulativeInput: 200, cumulativeOutput: 100 },
          { timestamp: '2026-03-15T10:03:00Z', cumulativeInput: 300, cumulativeOutput: 150 },
        ],
      });

      const result = buildStructuredEvents(analytics);

      expect(result.turns).toHaveLength(3);
      expect(result.turns[0].assistantText).toBe('First response.');
      expect(result.turns[1].assistantText).toBe('Second response.');
      expect(result.turns[2].assistantText).toBe('Third response.');
    });
  });

  describe('assistant text in turns', () => {
    it('includes assistant text content in corresponding turns', () => {
      const analytics = makeAnalytics({
        assistantTurns: 2,
        assistantTexts: ['Here is my analysis of the code.', 'I have completed the refactoring.'],
        tokenSnapshots: [
          { timestamp: '2026-03-15T10:01:00Z', cumulativeInput: 100, cumulativeOutput: 50 },
          { timestamp: '2026-03-15T10:05:00Z', cumulativeInput: 500, cumulativeOutput: 250 },
        ],
      });

      const result = buildStructuredEvents(analytics);

      expect(result.turns).toHaveLength(2);
      expect(result.turns[0].assistantText).toBe('Here is my analysis of the code.');
      expect(result.turns[1].assistantText).toBe('I have completed the refactoring.');
    });

    it('truncates assistant text to 500 characters', () => {
      const longText = 'A'.repeat(600);
      const analytics = makeAnalytics({
        assistantTurns: 1,
        assistantTexts: [longText],
        tokenSnapshots: [
          { timestamp: '2026-03-15T10:01:00Z', cumulativeInput: 100, cumulativeOutput: 50 },
        ],
      });

      const result = buildStructuredEvents(analytics);

      expect(result.turns).toHaveLength(1);
      expect(result.turns[0].assistantText).toHaveLength(500);
    });

    it('leaves assistantText undefined when assistantTexts entry is missing', () => {
      const analytics = makeAnalytics({
        assistantTurns: 2,
        assistantTexts: ['Only first turn has text.'],
        tokenSnapshots: [
          { timestamp: '2026-03-15T10:01:00Z', cumulativeInput: 100, cumulativeOutput: 50 },
          { timestamp: '2026-03-15T10:05:00Z', cumulativeInput: 500, cumulativeOutput: 250 },
        ],
      });

      const result = buildStructuredEvents(analytics);

      expect(result.turns).toHaveLength(2);
      expect(result.turns[0].assistantText).toBe('Only first turn has text.');
      expect(result.turns[1].assistantText).toBeUndefined();
    });
  });

  describe('task event extraction from command formats', () => {
    it('extracts task claim with bare brain command', () => {
      const toolCalls: ToolCall[] = [
        makeToolCall({
          toolName: 'Bash',
          input: { command: 'brain pm task claim VNM-12' },
          timestamp: '2026-03-15T10:05:00Z',
        }),
      ];

      const result = buildStructuredEvents(makeAnalytics({ toolCalls }));

      expect(result.taskEvents).toHaveLength(1);
      expect(result.taskEvents[0]).toEqual({
        type: 'task_claim',
        taskId: 'VNM-12',
        timestamp: '2026-03-15T10:05:00Z',
      });
    });

    it('extracts task done via npx tsx src/cli.ts prefix', () => {
      const toolCalls: ToolCall[] = [
        makeToolCall({
          toolName: 'Bash',
          input: { command: 'npx tsx src/cli.ts brain pm task done VNM-7.3' },
          timestamp: '2026-03-15T10:10:00Z',
        }),
      ];

      const result = buildStructuredEvents(makeAnalytics({ toolCalls }));

      expect(result.taskEvents).toHaveLength(1);
      expect(result.taskEvents[0].type).toBe('task_done');
      expect(result.taskEvents[0].taskId).toBe('VNM-7');
    });

    it('extracts task events from chained commands with &&', () => {
      const toolCalls: ToolCall[] = [
        makeToolCall({
          toolName: 'Bash',
          input: { command: 'npm test && brain pm task done ABC-55' },
          timestamp: '2026-03-15T10:20:00Z',
        }),
      ];

      const result = buildStructuredEvents(makeAnalytics({ toolCalls }));

      expect(result.taskEvents).toHaveLength(1);
      expect(result.taskEvents[0].type).toBe('task_done');
      expect(result.taskEvents[0].taskId).toBe('ABC-55');
    });

    it('ignores non-Bash tool calls for task extraction', () => {
      const toolCalls: ToolCall[] = [
        makeToolCall({
          toolName: 'Read',
          input: { file_path: '/tmp/brain pm task claim VNM-99.ts' },
          timestamp: '2026-03-15T10:05:00Z',
        }),
      ];

      const result = buildStructuredEvents(makeAnalytics({ toolCalls }));
      expect(result.taskEvents).toHaveLength(0);
    });

    it('ignores bash commands without task IDs', () => {
      const toolCalls: ToolCall[] = [
        makeToolCall({
          toolName: 'Bash',
          input: { command: 'brain pm task claim' },
          timestamp: '2026-03-15T10:05:00Z',
        }),
      ];

      const result = buildStructuredEvents(makeAnalytics({ toolCalls }));
      expect(result.taskEvents).toHaveLength(0);
    });

    it('extracts task events using lowercase bash tool name', () => {
      const toolCalls: ToolCall[] = [
        makeToolCall({
          toolName: 'bash',
          input: { command: 'brain pm task claim DEV-10' },
          timestamp: '2026-03-15T10:05:00Z',
        }),
      ];

      const result = buildStructuredEvents(makeAnalytics({ toolCalls }));
      expect(result.taskEvents).toHaveLength(1);
      expect(result.taskEvents[0].taskId).toBe('DEV-10');
    });

    it('extracts task events using cmd input field', () => {
      const toolCalls: ToolCall[] = [
        makeToolCall({
          toolName: 'Bash',
          input: { cmd: 'brain pm task done PROJ-33' },
          timestamp: '2026-03-15T10:05:00Z',
        }),
      ];

      const result = buildStructuredEvents(makeAnalytics({ toolCalls }));
      expect(result.taskEvents).toHaveLength(1);
      expect(result.taskEvents[0].type).toBe('task_done');
      expect(result.taskEvents[0].taskId).toBe('PROJ-33');
    });
  });

  describe('agent event extraction', () => {
    it('detects agent spawn from brain agent command', () => {
      const toolCalls: ToolCall[] = [
        makeToolCall({
          toolName: 'Bash',
          input: { command: 'brain agent spawn --template worker' },
          timestamp: '2026-03-15T10:05:00Z',
        }),
      ];

      const result = buildStructuredEvents(makeAnalytics({ toolCalls }));

      expect(result.agentEvents).toHaveLength(1);
      expect(result.agentEvents[0].type).toBe('agent_spawn');
      expect(result.agentEvents[0].detail).toContain('brain agent spawn');
    });

    it('truncates agent event detail to 200 characters', () => {
      const longCommand = 'brain pm dispatch --wave 1 ' + 'x'.repeat(250);
      const toolCalls: ToolCall[] = [
        makeToolCall({
          toolName: 'Bash',
          input: { command: longCommand },
          timestamp: '2026-03-15T10:05:00Z',
        }),
      ];

      const result = buildStructuredEvents(makeAnalytics({ toolCalls }));

      expect(result.agentEvents).toHaveLength(1);
      expect(result.agentEvents[0].detail).toHaveLength(200);
    });

    it('detects agent_complete for brain agent commands without spawn/dispatch', () => {
      const toolCalls: ToolCall[] = [
        makeToolCall({
          toolName: 'Bash',
          input: { command: 'brain agent list --status completed' },
          timestamp: '2026-03-15T10:05:00Z',
        }),
      ];

      const result = buildStructuredEvents(makeAnalytics({ toolCalls }));

      expect(result.agentEvents).toHaveLength(1);
      expect(result.agentEvents[0].type).toBe('agent_complete');
    });

    it('ignores non-agent bash commands', () => {
      const toolCalls: ToolCall[] = [
        makeToolCall({
          toolName: 'Bash',
          input: { command: 'npm test' },
          timestamp: '2026-03-15T10:05:00Z',
        }),
        makeToolCall({
          toolName: 'Bash',
          input: { command: 'git status' },
          timestamp: '2026-03-15T10:06:00Z',
        }),
      ];

      const result = buildStructuredEvents(makeAnalytics({ toolCalls }));
      expect(result.agentEvents).toHaveLength(0);
    });
  });

  describe('token timeline ordering', () => {
    it('preserves strictly increasing cumulative values', () => {
      const snapshots: TokenSnapshot[] = [
        { timestamp: '2026-03-15T10:01:00Z', cumulativeInput: 100, cumulativeOutput: 50 },
        { timestamp: '2026-03-15T10:02:00Z', cumulativeInput: 300, cumulativeOutput: 120 },
        { timestamp: '2026-03-15T10:03:00Z', cumulativeInput: 800, cumulativeOutput: 400 },
        { timestamp: '2026-03-15T10:04:00Z', cumulativeInput: 1500, cumulativeOutput: 700 },
        { timestamp: '2026-03-15T10:05:00Z', cumulativeInput: 2500, cumulativeOutput: 1100 },
      ];

      const analytics = makeAnalytics({ tokenSnapshots: snapshots });
      const result = buildStructuredEvents(analytics);

      expect(result.tokenTimeline).toHaveLength(5);
      for (let i = 1; i < result.tokenTimeline.length; i++) {
        expect(result.tokenTimeline[i].cumulativeInput).toBeGreaterThan(
          result.tokenTimeline[i - 1].cumulativeInput
        );
        expect(result.tokenTimeline[i].cumulativeOutput).toBeGreaterThan(
          result.tokenTimeline[i - 1].cumulativeOutput
        );
      }
    });

    it('passes through token timeline directly from analytics', () => {
      const snapshots: TokenSnapshot[] = [
        { timestamp: '2026-03-15T10:01:00Z', cumulativeInput: 500, cumulativeOutput: 200 },
      ];

      const analytics = makeAnalytics({ tokenSnapshots: snapshots });
      const result = buildStructuredEvents(analytics);

      expect(result.tokenTimeline).toBe(analytics.tokenSnapshots);
    });
  });

  describe('files touched deduplication', () => {
    it('deduplicates across Read and Edit for the same file', () => {
      const toolCalls: ToolCall[] = [
        makeToolCall({
          toolUseId: 'tu-1',
          toolName: 'Read',
          input: { file_path: '/src/main.ts' },
          timestamp: '2026-03-15T10:01:00Z',
        }),
        makeToolCall({
          toolUseId: 'tu-2',
          toolName: 'Edit',
          input: { file_path: '/src/main.ts' },
          timestamp: '2026-03-15T10:02:00Z',
        }),
        makeToolCall({
          toolUseId: 'tu-3',
          toolName: 'Read',
          input: { file_path: '/src/main.ts' },
          timestamp: '2026-03-15T10:03:00Z',
        }),
        makeToolCall({
          toolUseId: 'tu-4',
          toolName: 'Write',
          input: { file_path: '/src/utils.ts' },
          timestamp: '2026-03-15T10:04:00Z',
        }),
      ];

      const result = buildStructuredEvents(makeAnalytics({ toolCalls }));

      expect(result.filesTouched).toEqual(['/src/main.ts', '/src/utils.ts']);
    });

    it('deduplicates files from Read, Edit, Write, and Bash tool calls', () => {
      const toolCalls: ToolCall[] = [
        makeToolCall({
          toolUseId: 'tu-1',
          toolName: 'Read',
          input: { file_path: '/src/app.ts' },
          timestamp: '2026-03-15T10:01:00Z',
        }),
        makeToolCall({
          toolUseId: 'tu-2',
          toolName: 'Bash',
          input: { command: 'cat /src/app.ts' },
          timestamp: '2026-03-15T10:02:00Z',
        }),
        makeToolCall({
          toolUseId: 'tu-3',
          toolName: 'Edit',
          input: { file_path: '/src/app.ts' },
          timestamp: '2026-03-15T10:03:00Z',
        }),
      ];

      const result = buildStructuredEvents(makeAnalytics({ toolCalls }));

      expect(result.filesTouched).toEqual(['/src/app.ts']);
    });

    it('extracts file paths from bash commands', () => {
      const toolCalls: ToolCall[] = [
        makeToolCall({
          toolUseId: 'tu-1',
          toolName: 'Bash',
          input: { command: 'cat /tmp/output.log && head /var/data/report.csv' },
          timestamp: '2026-03-15T10:01:00Z',
        }),
      ];

      const result = buildStructuredEvents(makeAnalytics({ toolCalls }));

      expect(result.filesTouched).toContain('/tmp/output.log');
      expect(result.filesTouched).toContain('/var/data/report.csv');
    });

    it('returns sorted file list', () => {
      const toolCalls: ToolCall[] = [
        makeToolCall({
          toolUseId: 'tu-1',
          toolName: 'Read',
          input: { file_path: '/z/last.ts' },
          timestamp: '2026-03-15T10:01:00Z',
        }),
        makeToolCall({
          toolUseId: 'tu-2',
          toolName: 'Read',
          input: { file_path: '/a/first.ts' },
          timestamp: '2026-03-15T10:02:00Z',
        }),
        makeToolCall({
          toolUseId: 'tu-3',
          toolName: 'Read',
          input: { file_path: '/m/middle.ts' },
          timestamp: '2026-03-15T10:03:00Z',
        }),
      ];

      const result = buildStructuredEvents(makeAnalytics({ toolCalls }));

      expect(result.filesTouched).toEqual(['/a/first.ts', '/m/middle.ts', '/z/last.ts']);
    });

    it('handles path input field as alternative to file_path', () => {
      const toolCalls: ToolCall[] = [
        makeToolCall({
          toolUseId: 'tu-1',
          toolName: 'Read',
          input: { path: '/alt/path.ts' },
          timestamp: '2026-03-15T10:01:00Z',
        }),
      ];

      const result = buildStructuredEvents(makeAnalytics({ toolCalls }));
      expect(result.filesTouched).toContain('/alt/path.ts');
    });
  });

  describe('compaction events', () => {
    it('creates placeholder compaction events when no friction signals match', () => {
      const analytics = makeAnalytics({ compactionCount: 3 });
      const result = buildStructuredEvents(analytics);

      expect(result.compactions).toHaveLength(3);
      for (let i = 0; i < 3; i++) {
        expect(result.compactions[i].index).toBe(i);
        expect(result.compactions[i].timestamp).toBe('2026-03-15T10:00:00Z');
      }
    });

    it('uses friction signal timestamps when available', () => {
      const analytics = makeAnalytics({
        compactionCount: 2,
        frictionSignals: [
          {
            kind: 'user_correction',
            timestamp: '2026-03-15T10:20:00Z',
            detail: 'compaction detected at turn 15',
          },
          {
            kind: 'user_correction',
            timestamp: '2026-03-15T10:40:00Z',
            detail: 'compaction detected at turn 30',
          },
        ],
      });

      const result = buildStructuredEvents(analytics);

      expect(result.compactions).toHaveLength(2);
      expect(result.compactions[0].timestamp).toBe('2026-03-15T10:20:00Z');
      expect(result.compactions[1].timestamp).toBe('2026-03-15T10:40:00Z');
    });

    it('fills remaining compactions with placeholders if fewer friction signals than count', () => {
      const analytics = makeAnalytics({
        compactionCount: 3,
        frictionSignals: [
          {
            kind: 'user_correction',
            timestamp: '2026-03-15T10:20:00Z',
            detail: 'compaction detected',
          },
        ],
      });

      const result = buildStructuredEvents(analytics);

      expect(result.compactions).toHaveLength(3);
      expect(result.compactions[0].index).toBe(0);
      expect(result.compactions[0].timestamp).toBe('2026-03-15T10:20:00Z');
      expect(result.compactions[1].index).toBe(1);
      expect(result.compactions[1].timestamp).toBe('2026-03-15T10:00:00Z');
      expect(result.compactions[2].index).toBe(2);
    });

    it('ignores friction signals that are not compaction-related', () => {
      const analytics = makeAnalytics({
        compactionCount: 1,
        frictionSignals: [
          { kind: 'error_loop', timestamp: '2026-03-15T10:10:00Z', detail: 'error loop detected' },
          {
            kind: 'user_correction',
            timestamp: '2026-03-15T10:15:00Z',
            detail: 'user said try again',
          },
        ],
      });

      const result = buildStructuredEvents(analytics);

      // Neither friction signal is a compaction signal, so placeholder used
      expect(result.compactions).toHaveLength(1);
      expect(result.compactions[0].timestamp).toBe('2026-03-15T10:00:00Z');
    });

    it('returns empty array when compactionCount is 0', () => {
      const analytics = makeAnalytics({ compactionCount: 0 });
      const result = buildStructuredEvents(analytics);
      expect(result.compactions).toHaveLength(0);
    });
  });

  describe('large session data', () => {
    it('handles 100+ tool calls and produces valid output', () => {
      const toolCalls: ToolCall[] = [];
      const snapshots: TokenSnapshot[] = [];

      for (let i = 0; i < 120; i++) {
        const minute = String(i).padStart(2, '0');
        const _ts = `2026-03-15T10:${minute.slice(0, 2)}:${minute.slice(0, 2)}Z`;
        const timestamp = `2026-03-15T${String(10 + Math.floor(i / 60)).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}:00Z`;

        toolCalls.push(
          makeToolCall({
            toolUseId: `tu-${i}`,
            toolName: i % 3 === 0 ? 'Read' : i % 3 === 1 ? 'Edit' : 'Bash',
            input:
              i % 3 === 2
                ? { command: `echo "step ${i}"` }
                : { file_path: `/src/file-${i % 10}.ts` },
            timestamp,
            outcome: i % 15 === 0 ? 'error' : 'success',
          })
        );

        if (i % 5 === 0) {
          snapshots.push({
            timestamp,
            cumulativeInput: (i + 1) * 100,
            cumulativeOutput: (i + 1) * 40,
          });
        }
      }

      const assistantTexts = Array.from({ length: 24 }, (_, i) => `Response block ${i}`);

      const analytics = makeAnalytics({
        assistantTurns: 24,
        assistantTexts,
        tokenSnapshots: snapshots,
        toolCalls,
        compactionCount: 2,
      });

      const result = buildStructuredEvents(analytics);

      // Valid structure
      expect(result.sessionId).toBe('test-session-1');
      expect(result.turns.length).toBeGreaterThanOrEqual(24);
      expect(result.tokenTimeline).toHaveLength(snapshots.length);
      expect(result.compactions).toHaveLength(2);

      // Files are deduplicated (only 10 unique file patterns)
      expect(result.filesTouched.length).toBeLessThanOrEqual(120);
      expect(result.filesTouched.length).toBeGreaterThan(0);

      // JSON-serializable
      const json = JSON.stringify(result);
      expect(json.length).toBeGreaterThan(0);
      const parsed = JSON.parse(json);
      expect(parsed.sessionId).toBe('test-session-1');
    });

    it('handles 200 tool calls with mixed types efficiently', () => {
      const toolCalls: ToolCall[] = [];
      for (let i = 0; i < 200; i++) {
        const timestamp = `2026-03-15T${String(10 + Math.floor(i / 60)).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}:00Z`;
        const tools = ['Read', 'Edit', 'Write', 'Bash', 'Grep'];
        const toolName = tools[i % tools.length];
        const input =
          toolName === 'Bash' || toolName === 'Grep'
            ? { command: `action-${i}` }
            : { file_path: `/project/src/module-${i % 20}.ts` };

        toolCalls.push(makeToolCall({ toolUseId: `tu-${i}`, toolName, input, timestamp }));
      }

      const analytics = makeAnalytics({
        assistantTurns: 1,
        assistantTexts: ['Done.'],
        tokenSnapshots: [
          { timestamp: '2026-03-15T10:00:00Z', cumulativeInput: 100, cumulativeOutput: 50 },
        ],
        toolCalls,
      });

      const result = buildStructuredEvents(analytics);

      expect(result.filesTouched.length).toBeGreaterThan(0);
      // 20 unique modules from Read/Edit/Write
      expect(result.filesTouched.length).toBeLessThanOrEqual(200);
    });
  });

  describe('edge cases', () => {
    it('handles session with only user messages and no tool calls', () => {
      const snapshots: TokenSnapshot[] = [
        { timestamp: '2026-03-15T10:01:00Z', cumulativeInput: 100, cumulativeOutput: 50 },
        { timestamp: '2026-03-15T10:02:00Z', cumulativeInput: 200, cumulativeOutput: 100 },
      ];

      const analytics = makeAnalytics({
        userTurns: 3,
        assistantTurns: 2,
        assistantTexts: ['I understand your question.', 'Here is my answer.'],
        tokenSnapshots: snapshots,
        toolCalls: [],
      });

      const result = buildStructuredEvents(analytics);

      expect(result.turns).toHaveLength(2);
      expect(result.turns[0].toolCalls).toHaveLength(0);
      expect(result.turns[1].toolCalls).toHaveLength(0);
      expect(result.turns[0].assistantText).toBe('I understand your question.');
      expect(result.turns[1].assistantText).toBe('Here is my answer.');
      expect(result.filesTouched).toHaveLength(0);
      expect(result.taskEvents).toHaveLength(0);
      expect(result.agentEvents).toHaveLength(0);
    });

    it('handles session with only tool calls and no user messages', () => {
      const toolCalls: ToolCall[] = [
        makeToolCall({
          toolUseId: 'tu-1',
          toolName: 'Read',
          input: { file_path: '/src/a.ts' },
          timestamp: '2026-03-15T10:01:00Z',
        }),
        makeToolCall({
          toolUseId: 'tu-2',
          toolName: 'Edit',
          input: { file_path: '/src/b.ts' },
          timestamp: '2026-03-15T10:02:00Z',
        }),
      ];

      const analytics = makeAnalytics({
        userTurns: 0,
        assistantTurns: 0,
        assistantTexts: [],
        tokenSnapshots: [],
        toolCalls,
      });

      const result = buildStructuredEvents(analytics);

      // No turns since assistantTurns=0 and assistantTexts is empty
      expect(result.turns).toHaveLength(0);
      // But files are still extracted
      expect(result.filesTouched).toEqual(['/src/a.ts', '/src/b.ts']);
    });

    it('handles tool calls with empty command string', () => {
      const toolCalls: ToolCall[] = [
        makeToolCall({
          toolName: 'Bash',
          input: { command: '' },
          timestamp: '2026-03-15T10:01:00Z',
        }),
        makeToolCall({ toolName: 'Bash', input: {}, timestamp: '2026-03-15T10:02:00Z' }),
      ];

      const result = buildStructuredEvents(makeAnalytics({ toolCalls }));

      expect(result.taskEvents).toHaveLength(0);
      expect(result.agentEvents).toHaveLength(0);
    });

    it('handles tool calls with empty file_path', () => {
      const toolCalls: ToolCall[] = [
        makeToolCall({
          toolName: 'Read',
          input: { file_path: '' },
          timestamp: '2026-03-15T10:01:00Z',
        }),
        makeToolCall({ toolName: 'Edit', input: {}, timestamp: '2026-03-15T10:02:00Z' }),
      ];

      const result = buildStructuredEvents(makeAnalytics({ toolCalls }));
      expect(result.filesTouched).toHaveLength(0);
    });

    it('handles single-turn session correctly', () => {
      const analytics = makeAnalytics({
        assistantTurns: 1,
        assistantTexts: ['Here is the answer.'],
        tokenSnapshots: [
          { timestamp: '2026-03-15T10:01:00Z', cumulativeInput: 500, cumulativeOutput: 200 },
        ],
        toolCalls: [
          makeToolCall({ toolUseId: 'tu-1', toolName: 'Read', timestamp: '2026-03-15T10:01:00Z' }),
        ],
      });

      const result = buildStructuredEvents(analytics);

      expect(result.turns).toHaveLength(1);
      expect(result.turns[0].index).toBe(0);
      expect(result.turns[0].assistantText).toBe('Here is the answer.');
      expect(result.turns[0].toolCalls).toHaveLength(1);
    });

    it('uses startTime as timestamp fallback when no snapshots exist', () => {
      const analytics = makeAnalytics({
        assistantTurns: 1,
        assistantTexts: ['Hello'],
        tokenSnapshots: [],
      });

      const result = buildStructuredEvents(analytics);

      expect(result.turns).toHaveLength(1);
      expect(result.turns[0].timestamp).toBe('2026-03-15T10:00:00Z');
    });
  });
});
