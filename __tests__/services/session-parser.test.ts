import { describe, it, expect } from 'vitest';
import { AnalyticsAccumulator } from '../../src/modules/sessions/engine/accumulator.js';
import {
  computeCostUsd,
  computeCacheHitRate,
  classifySessionType,
  classifySessionOutcome,
  categorizeError,
  computeErrorCategories,
  classifyToolDomain,
  deriveRichAnalytics,
} from '../../src/services/session-parser.js';
import type { SessionAnalytics } from '../../src/modules/sessions/types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeUserEvent(
  content: string | unknown[],
  opts: {
    timestamp?: string;
    sessionId?: string;
    cwd?: string;
    gitBranch?: string;
    slug?: string;
  } = {}
) {
  return {
    type: 'user',
    sessionId: opts.sessionId ?? 'sess-1',
    timestamp: opts.timestamp ?? '2026-01-01T00:00:00Z',
    cwd: opts.cwd ?? '/test/project',
    gitBranch: opts.gitBranch ?? 'main',
    slug: opts.slug,
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
      model: opts.model ?? 'claude-sonnet-4-20250514',
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

function makeToolUseBlock(id: string, name: string, input: Record<string, unknown> = {}) {
  return { type: 'tool_use', id, name, input };
}

function buildSession(events: unknown[]): SessionAnalytics {
  const acc = new AnalyticsAccumulator();
  for (const e of events) acc.ingest(e);
  return acc.finalize();
}

// ---------------------------------------------------------------------------
// Accumulator: extended signals
// ---------------------------------------------------------------------------

describe('AnalyticsAccumulator — extended signals', () => {
  it('extracts slug from first event that has it', () => {
    const acc = new AnalyticsAccumulator();
    acc.ingest(makeUserEvent('hello', { slug: 'cozy-baking-fox' }));
    const result = acc.finalize();
    expect(result.slug).toBe('cozy-baking-fox');
  });

  it('captures PR link events', () => {
    const acc = new AnalyticsAccumulator();
    acc.ingest({
      type: 'pr-link',
      sessionId: 'sess-1',
      timestamp: '2026-01-01T01:00:00Z',
      prNumber: 42,
      prUrl: 'https://github.com/user/repo/pull/42',
      prRepository: 'user/repo',
    });
    const result = acc.finalize();
    expect(result.prLinks).toHaveLength(1);
    expect(result.prLinks[0].number).toBe(42);
    expect(result.prLinks[0].url).toBe('https://github.com/user/repo/pull/42');
    expect(result.prLinks[0].repo).toBe('user/repo');
  });

  it('tracks files touched by Read', () => {
    const acc = new AnalyticsAccumulator();
    acc.ingest(
      makeAssistantEvent([makeToolUseBlock('tu_1', 'Read', { file_path: '/src/foo.ts' })])
    );
    acc.ingest(makeToolResultEvent('tu_1'));
    const result = acc.finalize();
    expect(result.filesTouched.has('/src/foo.ts')).toBe(true);
    expect(result.filesTouched.get('/src/foo.ts')?.has('Read')).toBe(true);
    expect(result.filesWritten).not.toContain('/src/foo.ts');
  });

  it('tracks files written by Write and Edit', () => {
    const acc = new AnalyticsAccumulator();
    acc.ingest(makeAssistantEvent([makeToolUseBlock('tu_1', 'Write', { file_path: '/src/a.ts' })]));
    acc.ingest(makeToolResultEvent('tu_1'));
    acc.ingest(makeAssistantEvent([makeToolUseBlock('tu_2', 'Edit', { file_path: '/src/b.ts' })]));
    acc.ingest(makeToolResultEvent('tu_2'));
    const result = acc.finalize();
    expect(result.filesWritten).toContain('/src/a.ts');
    expect(result.filesWritten).toContain('/src/b.ts');
  });

  it('tracks skill usage', () => {
    const acc = new AnalyticsAccumulator();
    acc.ingest(
      makeAssistantEvent([makeToolUseBlock('tu_1', 'Skill', { skill: 'commit', args: '-m msg' })])
    );
    acc.ingest(makeToolResultEvent('tu_1'));
    acc.ingest(
      makeAssistantEvent([makeToolUseBlock('tu_2', 'Skill', { skill: 'commit', args: '-m msg2' })])
    );
    acc.ingest(makeToolResultEvent('tu_2'));
    const result = acc.finalize();
    expect(result.skillUsage.get('commit')).toBe(2);
  });

  it('counts Task tool calls as subagents', () => {
    const acc = new AnalyticsAccumulator();
    acc.ingest(
      makeAssistantEvent([makeToolUseBlock('tu_1', 'Task', { description: 'Do research' })])
    );
    acc.ingest(makeToolResultEvent('tu_1'));
    const result = acc.finalize();
    expect(result.subagentCount).toBe(1);
  });

  it('counts git commands and commits in Bash tool', () => {
    const acc = new AnalyticsAccumulator();
    acc.ingest(makeAssistantEvent([makeToolUseBlock('tu_1', 'Bash', { command: 'git status' })]));
    acc.ingest(makeToolResultEvent('tu_1'));
    acc.ingest(
      makeAssistantEvent([makeToolUseBlock('tu_2', 'Bash', { command: 'git commit -m "Fix bug"' })])
    );
    acc.ingest(makeToolResultEvent('tu_2'));
    acc.ingest(makeAssistantEvent([makeToolUseBlock('tu_3', 'Bash', { command: 'npm test' })]));
    acc.ingest(makeToolResultEvent('tu_3'));
    const result = acc.finalize();
    expect(result.gitCommandCount).toBe(2);
    expect(result.commitCount).toBe(1);
  });

  it('extracts task refs from user messages', () => {
    const acc = new AnalyticsAccumulator();
    acc.ingest(makeUserEvent('Working on VNM-15.40 and VNM-15.41 today'));
    const result = acc.finalize();
    expect(result.taskRefs).toContain('VNM-15.40');
    expect(result.taskRefs).toContain('VNM-15.41');
  });

  it('counts thinking blocks', () => {
    const acc = new AnalyticsAccumulator();
    acc.ingest(
      makeAssistantEvent([
        { type: 'thinking', thinking: 'Let me think...' },
        { type: 'text', text: 'Here is my answer' },
      ])
    );
    const result = acc.finalize();
    expect(result.thinkingBlockCount).toBe(1);
  });

  it('handles compact_boundary system events', () => {
    const acc = new AnalyticsAccumulator();
    acc.ingest({
      type: 'system',
      sessionId: 'sess-1',
      timestamp: '2026-01-01T01:00:00Z',
      subtype: 'compact_boundary',
      compactMetadata: { trigger: 'auto', preTokens: 50000 },
    });
    const result = acc.finalize();
    expect(result.compactionCount).toBe(1);
    expect(result.compactionTimestamps).toContain('2026-01-01T01:00:00Z');
  });

  it('captures service tier from usage', () => {
    const acc = new AnalyticsAccumulator();
    acc.ingest({
      type: 'assistant',
      sessionId: 'sess-1',
      timestamp: '2026-01-01T00:00:00Z',
      message: {
        model: 'claude-sonnet-4-20250514',
        content: [{ type: 'text', text: 'hi' }],
        usage: { input_tokens: 10, output_tokens: 5, service_tier: 'priority' },
      },
    });
    const result = acc.finalize();
    expect(result.serviceTier).toBe('priority');
  });

  it('tracks all models used', () => {
    const acc = new AnalyticsAccumulator();
    acc.ingest(
      makeAssistantEvent([{ type: 'text', text: 'a' }], { model: 'claude-opus-4-20250514' })
    );
    acc.ingest(
      makeAssistantEvent([{ type: 'text', text: 'b' }], { model: 'claude-sonnet-4-20250514' })
    );
    acc.ingest(
      makeAssistantEvent([{ type: 'text', text: 'c' }], { model: 'claude-opus-4-20250514' })
    );
    const result = acc.finalize();
    expect(result.modelCounts.get('claude-opus-4-20250514')).toBe(2);
    expect(result.modelCounts.get('claude-sonnet-4-20250514')).toBe(1);
  });

  it('captures plan presence from user event', () => {
    const acc = new AnalyticsAccumulator();
    acc.ingest({
      type: 'user',
      sessionId: 'sess-1',
      timestamp: '2026-01-01T00:00:00Z',
      planContent: '## Plan\n1. Do this\n2. Do that',
      message: { role: 'user', content: 'Let us proceed' },
    });
    const result = acc.finalize();
    expect(result.planPresent).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Cost computation
// ---------------------------------------------------------------------------

describe('computeCostUsd', () => {
  it('computes zero cost for empty tokens', () => {
    const analytics = buildSession([]);
    expect(computeCostUsd(analytics)).toBe(0);
  });

  it('computes cost for sonnet-4-20250514 at correct rate', () => {
    // 1M input @ $3 + 1M output @ $15 = $18
    const analytics = buildSession([
      makeAssistantEvent([{ type: 'text', text: 'a' }], {
        usage: {
          input_tokens: 1_000_000,
          output_tokens: 1_000_000,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0,
        },
      }),
    ]);
    const cost = computeCostUsd(analytics);
    expect(cost).toBeCloseTo(18, 2);
  });

  it('computes cost for opus model at higher rate', () => {
    // 1M input @ $15 = $15
    const analytics = buildSession([
      makeAssistantEvent([{ type: 'text', text: 'a' }], {
        model: 'claude-opus-4-20250514',
        usage: {
          input_tokens: 1_000_000,
          output_tokens: 0,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0,
        },
      }),
    ]);
    const cost = computeCostUsd(analytics);
    expect(cost).toBeCloseTo(15, 2);
  });

  it('includes cache read tokens at discounted rate', () => {
    // 1M cache read @ $0.30 for sonnet
    const analytics = buildSession([
      makeAssistantEvent([{ type: 'text', text: 'a' }], {
        usage: {
          input_tokens: 0,
          output_tokens: 0,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 1_000_000,
        },
      }),
    ]);
    const cost = computeCostUsd(analytics);
    expect(cost).toBeCloseTo(0.3, 4);
  });

  it('uses sonnet pricing as fallback for unknown models', () => {
    const analytics = buildSession([
      makeAssistantEvent([{ type: 'text', text: 'a' }], {
        model: 'claude-future-model-unknown',
        usage: { input_tokens: 1_000_000, output_tokens: 0 },
      }),
    ]);
    const cost = computeCostUsd(analytics);
    expect(cost).toBeCloseTo(3, 2); // Sonnet input rate
  });
});

// ---------------------------------------------------------------------------
// Cache hit rate
// ---------------------------------------------------------------------------

describe('computeCacheHitRate', () => {
  it('returns 0 when no tokens', () => {
    const analytics = buildSession([]);
    expect(computeCacheHitRate(analytics)).toBe(0);
  });

  it('computes correct rate with cache reads', () => {
    const analytics = buildSession([
      makeAssistantEvent([{ type: 'text', text: 'a' }], {
        usage: {
          input_tokens: 100,
          output_tokens: 0,
          cache_creation_input_tokens: 50,
          cache_read_input_tokens: 200,
        },
      }),
    ]);
    // 200 / (100 + 50 + 200) = 200/350 ≈ 0.5714
    const rate = computeCacheHitRate(analytics);
    expect(rate).toBeCloseTo(200 / 350, 3);
  });
});

// ---------------------------------------------------------------------------
// Session type classification
// ---------------------------------------------------------------------------

describe('classifySessionType', () => {
  it('classifies implementation when write+edit > 30% of calls', () => {
    const analytics = buildSession([
      makeAssistantEvent([
        makeToolUseBlock('t1', 'Write', { file_path: '/a.ts' }),
        makeToolUseBlock('t2', 'Edit', { file_path: '/b.ts' }),
        makeToolUseBlock('t3', 'Edit', { file_path: '/c.ts' }),
        makeToolUseBlock('t4', 'Read', { file_path: '/d.ts' }),
        makeToolUseBlock('t5', 'Bash', { command: 'npm test' }),
      ]),
      makeToolResultEvent('t1'),
      makeToolResultEvent('t2'),
      makeToolResultEvent('t3'),
      makeToolResultEvent('t4'),
      makeToolResultEvent('t5'),
    ]);
    expect(classifySessionType(analytics)).toBe('implementation');
  });

  it('classifies debugging when bash > 40% and has errors', () => {
    const acc = new AnalyticsAccumulator();
    // 5 Bash calls, 1 Write call = Bash is 83%, plus errors
    for (let i = 0; i < 5; i++) {
      acc.ingest(
        makeAssistantEvent([makeToolUseBlock(`tu_b${i}`, 'Bash', { command: 'npm test' })])
      );
      acc.ingest(makeToolResultEvent(`tu_b${i}`, { isError: true, content: 'test failed' }));
    }
    acc.ingest(makeAssistantEvent([makeToolUseBlock('tu_w', 'Write', { file_path: '/fix.ts' })]));
    acc.ingest(makeToolResultEvent('tu_w'));
    const analytics = acc.finalize();
    expect(classifySessionType(analytics)).toBe('debugging');
  });

  it('classifies exploration when read > 60% and few writes', () => {
    const acc = new AnalyticsAccumulator();
    for (let i = 0; i < 7; i++) {
      acc.ingest(
        makeAssistantEvent([makeToolUseBlock(`t${i}`, 'Read', { file_path: `/src/${i}.ts` })])
      );
      acc.ingest(makeToolResultEvent(`t${i}`));
    }
    acc.ingest(makeAssistantEvent([makeToolUseBlock('t_bash', 'Bash', { command: 'ls' })]));
    acc.ingest(makeToolResultEvent('t_bash'));
    const analytics = acc.finalize();
    expect(classifySessionType(analytics)).toBe('exploration');
  });

  it('classifies research when WebSearch used and low write ratio', () => {
    const acc = new AnalyticsAccumulator();
    acc.ingest(
      makeAssistantEvent([makeToolUseBlock('t1', 'WebSearch', { query: 'async patterns' })])
    );
    acc.ingest(makeToolResultEvent('t1'));
    acc.ingest(makeAssistantEvent([makeToolUseBlock('t2', 'Read', { file_path: '/src/a.ts' })]));
    acc.ingest(makeToolResultEvent('t2'));
    const analytics = acc.finalize();
    expect(classifySessionType(analytics)).toBe('research');
  });

  it('returns exploration for empty session', () => {
    const analytics = buildSession([]);
    expect(classifySessionType(analytics)).toBe('exploration');
  });
});

// ---------------------------------------------------------------------------
// Outcome classification
// ---------------------------------------------------------------------------

describe('classifySessionOutcome', () => {
  it('returns abandoned for very short session', () => {
    const analytics = buildSession([makeUserEvent('hello', { timestamp: '2026-01-01T00:00:00Z' })]);
    expect(classifySessionOutcome(analytics)).toBe('abandoned');
  });

  it('returns success when PR link present', () => {
    const acc = new AnalyticsAccumulator();
    acc.ingest(makeUserEvent('hello', { timestamp: '2026-01-01T00:00:00Z' }));
    // Simulate a 2-minute session
    acc.ingest(makeUserEvent('done', { timestamp: '2026-01-01T00:02:00Z' }));
    acc.ingest({
      type: 'pr-link',
      sessionId: 'sess-1',
      timestamp: '2026-01-01T00:02:00Z',
      prNumber: 1,
      prUrl: 'https://github.com/user/repo/pull/1',
      prRepository: 'user/repo',
    });
    const analytics = acc.finalize();
    expect(classifySessionOutcome(analytics)).toBe('success');
  });

  it('returns success when commit count > 0', () => {
    const acc = new AnalyticsAccumulator();
    acc.ingest(makeUserEvent('start', { timestamp: '2026-01-01T00:00:00Z' }));
    acc.ingest(makeUserEvent('end', { timestamp: '2026-01-01T00:05:00Z' }));
    acc.ingest(
      makeAssistantEvent([makeToolUseBlock('t1', 'Bash', { command: 'git commit -m "feat"' })])
    );
    acc.ingest(makeToolResultEvent('t1'));
    const analytics = acc.finalize();
    expect(classifySessionOutcome(analytics)).toBe('success');
  });

  it('returns error when error rate > 50%', () => {
    const acc = new AnalyticsAccumulator();
    acc.ingest(makeUserEvent('start', { timestamp: '2026-01-01T00:00:00Z' }));
    acc.ingest(makeUserEvent('end', { timestamp: '2026-01-01T00:05:00Z' }));
    for (let i = 0; i < 6; i++) {
      acc.ingest(makeAssistantEvent([makeToolUseBlock(`t${i}`, 'Bash', { command: 'cmd' })]));
      acc.ingest(makeToolResultEvent(`t${i}`, { isError: true, content: 'error' }));
    }
    const analytics = acc.finalize();
    expect(classifySessionOutcome(analytics)).toBe('error');
  });

  it('returns partial when files written but no commit or PR', () => {
    const acc = new AnalyticsAccumulator();
    acc.ingest(makeUserEvent('start', { timestamp: '2026-01-01T00:00:00Z' }));
    acc.ingest(makeUserEvent('end', { timestamp: '2026-01-01T00:05:00Z' }));
    for (let i = 0; i < 11; i++) {
      acc.ingest(
        makeAssistantEvent([
          makeToolUseBlock(`t${i}`, i === 0 ? 'Write' : 'Read', { file_path: `/f${i}.ts` }),
        ])
      );
      acc.ingest(makeToolResultEvent(`t${i}`));
    }
    const analytics = acc.finalize();
    expect(classifySessionOutcome(analytics)).toBe('partial');
  });
});

// ---------------------------------------------------------------------------
// Error categorization
// ---------------------------------------------------------------------------

describe('categorizeError', () => {
  it('categorizes ENOENT as file_not_found', () => {
    expect(categorizeError('ENOENT: no such file or directory')).toBe('file_not_found');
  });

  it('categorizes permission denied', () => {
    expect(categorizeError('Permission denied: /etc/hosts')).toBe('permission_denied');
  });

  it('categorizes timeout', () => {
    expect(categorizeError('Operation timed out after 5000ms')).toBe('timeout');
  });

  it('categorizes SyntaxError', () => {
    expect(categorizeError('SyntaxError: Unexpected token')).toBe('syntax_error');
  });

  it('categorizes test failure', () => {
    expect(categorizeError('FAIL src/foo.test.ts')).toBe('test_failure');
  });

  it('categorizes git conflict', () => {
    expect(categorizeError('CONFLICT (content): Merge conflict in file.ts')).toBe('git_conflict');
  });

  it('defaults to other', () => {
    expect(categorizeError('Something unexpected happened')).toBe('other');
  });
});

describe('computeErrorCategories', () => {
  it('counts errors by category', () => {
    const acc = new AnalyticsAccumulator();
    acc.ingest(makeAssistantEvent([makeToolUseBlock('t1', 'Bash', {})]));
    acc.ingest(makeToolResultEvent('t1', { isError: true, content: 'ENOENT: no such file' }));
    acc.ingest(makeAssistantEvent([makeToolUseBlock('t2', 'Bash', {})]));
    acc.ingest(makeToolResultEvent('t2', { isError: true, content: 'permission denied' }));
    acc.ingest(makeAssistantEvent([makeToolUseBlock('t3', 'Bash', {})]));
    acc.ingest(makeToolResultEvent('t3', { isError: true, content: 'ENOENT: another file' }));
    const analytics = acc.finalize();
    const cats = computeErrorCategories(analytics);
    expect(cats.file_not_found).toBe(2);
    expect(cats.permission_denied).toBe(1);
    expect(cats.other).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Tool domain classification
// ---------------------------------------------------------------------------

describe('classifyToolDomain', () => {
  it('classifies Read/Grep/Glob as read', () => {
    expect(classifyToolDomain('Read')).toBe('read');
    expect(classifyToolDomain('Grep')).toBe('read');
    expect(classifyToolDomain('Glob')).toBe('read');
  });

  it('classifies Write/Edit as write', () => {
    expect(classifyToolDomain('Write')).toBe('write');
    expect(classifyToolDomain('Edit')).toBe('write');
  });

  it('classifies Bash with test commands as test', () => {
    expect(classifyToolDomain('Bash', 'npx vitest run')).toBe('test');
    expect(classifyToolDomain('Bash', 'npm test')).toBe('test');
  });

  it('classifies Bash with git as git', () => {
    expect(classifyToolDomain('Bash', 'git push origin main')).toBe('git');
  });

  it('classifies Task as agent', () => {
    expect(classifyToolDomain('Task')).toBe('agent');
  });

  it('classifies WebSearch as browser', () => {
    expect(classifyToolDomain('WebSearch')).toBe('browser');
  });

  it('classifies plain Bash as bash', () => {
    expect(classifyToolDomain('Bash', 'ls -la')).toBe('bash');
  });
});

// ---------------------------------------------------------------------------
// deriveRichAnalytics
// ---------------------------------------------------------------------------

describe('deriveRichAnalytics', () => {
  it('derives durationMinutes correctly', () => {
    const analytics = buildSession([
      makeUserEvent('start', { timestamp: '2026-01-01T00:00:00Z' }),
      makeUserEvent('end', { timestamp: '2026-01-01T01:30:00Z' }),
    ]);
    const rich = deriveRichAnalytics(analytics);
    expect(rich.durationMinutes).toBe(90);
  });

  it('picks primary model as most-used model', () => {
    const acc = new AnalyticsAccumulator();
    acc.ingest(
      makeAssistantEvent([{ type: 'text', text: 'a' }], { model: 'claude-opus-4-20250514' })
    );
    acc.ingest(
      makeAssistantEvent([{ type: 'text', text: 'b' }], { model: 'claude-sonnet-4-20250514' })
    );
    acc.ingest(
      makeAssistantEvent([{ type: 'text', text: 'c' }], { model: 'claude-sonnet-4-20250514' })
    );
    const analytics = acc.finalize();
    const rich = deriveRichAnalytics(analytics);
    expect(rich.modelPrimary).toBe('claude-sonnet-4-20250514');
    expect(rich.modelsUsed).toContain('claude-opus-4-20250514');
  });

  it('counts filesReadCount correctly', () => {
    const acc = new AnalyticsAccumulator();
    acc.ingest(makeAssistantEvent([makeToolUseBlock('t1', 'Read', { file_path: '/a.ts' })]));
    acc.ingest(makeToolResultEvent('t1'));
    acc.ingest(makeAssistantEvent([makeToolUseBlock('t2', 'Read', { file_path: '/b.ts' })]));
    acc.ingest(makeToolResultEvent('t2'));
    acc.ingest(makeAssistantEvent([makeToolUseBlock('t3', 'Write', { file_path: '/c.ts' })]));
    acc.ingest(makeToolResultEvent('t3'));
    const analytics = acc.finalize();
    const rich = deriveRichAnalytics(analytics);
    expect(rich.filesReadCount).toBe(2);
    expect(rich.filesWrittenCount).toBe(1);
  });

  it('includes skill usage as plain object', () => {
    const acc = new AnalyticsAccumulator();
    acc.ingest(makeAssistantEvent([makeToolUseBlock('t1', 'Skill', { skill: 'commit' })]));
    acc.ingest(makeToolResultEvent('t1'));
    const analytics = acc.finalize();
    const rich = deriveRichAnalytics(analytics);
    expect(rich.skillUsage).toEqual({ commit: 1 });
  });

  it('classifies session type and outcome', () => {
    const acc = new AnalyticsAccumulator();
    acc.ingest(makeUserEvent('start', { timestamp: '2026-01-01T00:00:00Z' }));
    // Enough Write calls for implementation
    for (let i = 0; i < 4; i++) {
      acc.ingest(
        makeAssistantEvent([makeToolUseBlock(`t${i}`, 'Write', { file_path: `/f${i}.ts` })])
      );
      acc.ingest(makeToolResultEvent(`t${i}`));
    }
    // Git commit for success
    acc.ingest(
      makeAssistantEvent([makeToolUseBlock('tg', 'Bash', { command: 'git commit -m "fix"' })])
    );
    acc.ingest(makeToolResultEvent('tg'));
    acc.ingest(makeUserEvent('end', { timestamp: '2026-01-01T00:05:00Z' }));
    const analytics = acc.finalize();
    const rich = deriveRichAnalytics(analytics);
    expect(rich.sessionType).toBe('implementation');
    expect(rich.outcome).toBe('success');
  });
});
