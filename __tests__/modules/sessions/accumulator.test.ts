import { describe, it, expect, beforeEach } from 'vitest';
import { AnalyticsAccumulator } from '../../../src/modules/sessions/engine/accumulator.js';

function makeUserEvent(
  content: string | unknown[],
  opts: { sessionId?: string; timestamp?: string; cwd?: string; gitBranch?: string } = {}
) {
  return {
    type: 'user',
    sessionId: opts.sessionId ?? 'sess-1',
    timestamp: opts.timestamp ?? '2026-01-01T00:00:00Z',
    cwd: opts.cwd ?? '/test/project',
    gitBranch: opts.gitBranch ?? 'main',
    message: { role: 'user', content },
  };
}

function makeAssistantEvent(
  content: unknown[],
  opts: {
    timestamp?: string;
    model?: string;
    usage?: Record<string, number>;
    isSidechain?: boolean;
  } = {}
) {
  return {
    type: 'assistant',
    sessionId: 'sess-1',
    timestamp: opts.timestamp ?? '2026-01-01T00:00:05Z',
    isSidechain: opts.isSidechain ?? false,
    message: {
      model: opts.model ?? 'claude-opus-4-6',
      id: 'msg_1',
      role: 'assistant',
      content,
      stop_reason: 'end_turn',
      usage: {
        input_tokens: 100,
        output_tokens: 50,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
        ...opts.usage,
      },
    },
  };
}

function makeToolResultEvent(
  toolUseId: string,
  opts: { timestamp?: string; isError?: boolean; content?: string } = {}
) {
  return makeUserEvent(
    [
      {
        type: 'tool_result',
        tool_use_id: toolUseId,
        content: opts.content ?? 'result',
        is_error: opts.isError ?? false,
      },
    ],
    { timestamp: opts.timestamp ?? '2026-01-01T00:00:06Z' }
  );
}

describe('AnalyticsAccumulator', () => {
  let acc: AnalyticsAccumulator;

  beforeEach(() => {
    acc = new AnalyticsAccumulator();
  });

  it('handles empty session', () => {
    const result = acc.finalize();
    expect(result.sessionId).toBe('');
    expect(result.userTurns).toBe(0);
    expect(result.assistantTurns).toBe(0);
    expect(result.durationMs).toBe(0);
    expect(result.model).toBeNull();
    expect(result.gitBranch).toBeNull();
    expect(result.toolCalls).toHaveLength(0);
    expect(result.capturedViaJsonl).toBe(true);
    expect(result.capturedViaHooks).toBe(false);
  });

  it('counts single user + assistant turn', () => {
    acc.ingest(makeUserEvent('Hello'));
    acc.ingest(
      makeAssistantEvent([{ type: 'text', text: 'Hi there!' }], {
        timestamp: '2026-01-01T00:00:05Z',
      })
    );

    const result = acc.finalize();
    expect(result.sessionId).toBe('sess-1');
    expect(result.projectDir).toBe('/test/project');
    expect(result.gitBranch).toBe('main');
    expect(result.userTurns).toBe(1);
    expect(result.assistantTurns).toBe(1);
    expect(result.durationMs).toBe(5000);
  });

  it('pairs tool_use and tool_result into ToolCall', () => {
    acc.ingest(makeUserEvent('Do something'));
    acc.ingest(
      makeAssistantEvent(
        [{ type: 'tool_use', id: 'tu_1', name: 'Read', input: { file_path: '/a.ts' } }],
        { timestamp: '2026-01-01T00:00:05Z' }
      )
    );
    acc.ingest(makeToolResultEvent('tu_1', { timestamp: '2026-01-01T00:00:06Z' }));

    const result = acc.finalize();
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].toolName).toBe('Read');
    expect(result.toolCalls[0].outcome).toBe('success');
    expect(result.toolCalls[0].durationMs).toBe(1000);
    expect(result.toolCallsByName).toEqual({ Read: 1 });
    expect(result.uniqueToolsUsed).toEqual(['Read']);
  });

  it('records error tool results', () => {
    acc.ingest(
      makeAssistantEvent(
        [{ type: 'tool_use', id: 'tu_1', name: 'Bash', input: { command: 'npm test' } }],
        { timestamp: '2026-01-01T00:00:00Z' }
      )
    );
    acc.ingest(
      makeToolResultEvent('tu_1', {
        timestamp: '2026-01-01T00:00:02Z',
        isError: true,
        content: 'test failed',
      })
    );

    const result = acc.finalize();
    expect(result.toolCalls[0].outcome).toBe('error');
    expect(result.toolCalls[0].errorMessage).toBe('test failed');
    expect(result.errors).toHaveLength(1);
    expect(result.errorCount).toBe(1);
    expect(result.errorRate).toBeCloseTo(1.0);
  });

  it('emits pending for orphaned tool_use', () => {
    acc.ingest(
      makeAssistantEvent([{ type: 'tool_use', id: 'tu_orphan', name: 'Bash', input: {} }])
    );

    const result = acc.finalize();
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].outcome).toBe('pending');
  });

  it('accumulates token usage across assistant events', () => {
    acc.ingest(
      makeAssistantEvent([{ type: 'text', text: 'a' }], {
        timestamp: '2026-01-01T00:00:00Z',
        usage: {
          input_tokens: 100,
          output_tokens: 50,
          cache_creation_input_tokens: 10,
          cache_read_input_tokens: 5,
        },
      })
    );
    acc.ingest(
      makeAssistantEvent([{ type: 'text', text: 'b' }], {
        timestamp: '2026-01-01T00:00:10Z',
        usage: {
          input_tokens: 200,
          output_tokens: 75,
          cache_creation_input_tokens: 20,
          cache_read_input_tokens: 15,
        },
      })
    );
    acc.ingest(
      makeAssistantEvent([{ type: 'text', text: 'c' }], {
        timestamp: '2026-01-01T00:00:20Z',
        usage: { input_tokens: 150, output_tokens: 30 },
      })
    );

    const result = acc.finalize();
    expect(result.tokens.inputTokens).toBe(450);
    expect(result.tokens.outputTokens).toBe(155);
    expect(result.tokens.cacheCreationTokens).toBe(30);
    expect(result.tokens.cacheReadTokens).toBe(20);
  });

  it('detects compaction', () => {
    acc.ingest(
      makeUserEvent(
        'This session is being continued from a previous conversation that ran out of context.',
        { timestamp: '2026-01-01T00:00:00Z' }
      )
    );

    const result = acc.finalize();
    expect(result.isCompacted).toBe(true);
    expect(result.compactionCount).toBe(1);
  });

  it('counts multiple compactions', () => {
    acc.ingest(makeUserEvent('This session is being continued from a previous conversation...'));
    acc.ingest(makeUserEvent('This session is being continued from a previous conversation...'));

    const result = acc.finalize();
    expect(result.compactionCount).toBe(2);
  });

  it('extracts model from first assistant event', () => {
    acc.ingest(makeAssistantEvent([{ type: 'text', text: 'a' }], { model: 'claude-opus-4-6' }));
    acc.ingest(makeAssistantEvent([{ type: 'text', text: 'b' }], { model: 'claude-sonnet-4-5' }));

    const result = acc.finalize();
    expect(result.model).toBe('claude-opus-4-6');
  });

  it('extracts gitBranch from first event', () => {
    acc.ingest(makeUserEvent('hello', { gitBranch: 'feat/search' }));
    acc.ingest(makeUserEvent('hello', { gitBranch: 'main' }));

    const result = acc.finalize();
    expect(result.gitBranch).toBe('feat/search');
  });

  it('counts sidechain events', () => {
    acc.ingest(
      makeAssistantEvent([{ type: 'text', text: 'subagent work' }], { isSidechain: true })
    );
    acc.ingest(
      makeAssistantEvent([{ type: 'text', text: 'more subagent' }], { isSidechain: true })
    );
    acc.ingest(makeAssistantEvent([{ type: 'text', text: 'main' }]));

    const result = acc.finalize();
    expect(result.sidechainEventCount).toBe(2);
  });

  it('handles hook prevention system events', () => {
    acc.ingest({
      type: 'system',
      sessionId: 'sess-1',
      timestamp: '2026-01-01T00:00:00Z',
      preventedContinuation: true,
      hookInfos: [{ command: 'lint-check', durationMs: 100 }],
    });

    const result = acc.finalize();
    expect(result.hookEventCount).toBe(1);
    expect(result.hookPreventionCount).toBe(1);
    expect(result.frictionSignals).toHaveLength(1);
    expect(result.frictionSignals[0].kind).toBe('hook_prevention');
  });

  it('skips progress and file-history-snapshot events', () => {
    acc.ingest({ type: 'progress', sessionId: 'sess-1', timestamp: '2026-01-01T00:00:00Z' });
    acc.ingest({
      type: 'file-history-snapshot',
      sessionId: 'sess-1',
      timestamp: '2026-01-01T00:00:01Z',
    });
    acc.ingest({ type: 'queue-operation', sessionId: 'sess-1', timestamp: '2026-01-01T00:00:02Z' });

    const result = acc.finalize();
    expect(result.userTurns).toBe(0);
    expect(result.assistantTurns).toBe(0);
    expect(result.hookEventCount).toBe(0);
  });

  it('handles malformed events gracefully', () => {
    acc.ingest(null);
    acc.ingest(undefined);
    acc.ingest('not an object');
    acc.ingest({ type: 'user' }); // no message
    acc.ingest({ type: 'assistant' }); // no message

    const result = acc.finalize();
    expect(result.userTurns).toBe(0);
    expect(result.assistantTurns).toBe(0);
  });
});
