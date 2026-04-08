import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  buildOtlpPayload,
  exportSessionSpans,
  DEFAULT_PHOENIX_ENDPOINT,
} from '../../../src/modules/sessions/integrations/span-exporter.js';
import type { SessionAnalytics, ToolCall } from '../../../src/modules/sessions/types.js';

function makeToolCall(overrides: Partial<ToolCall> = {}): ToolCall {
  return {
    toolUseId: 'tu-001',
    toolName: 'Read',
    input: { file_path: '/foo.ts' },
    timestamp: '2026-01-01T00:01:00Z',
    outcome: 'success',
    isSidechain: false,
    ...overrides,
  };
}

function makeAnalytics(overrides: Partial<SessionAnalytics> = {}): SessionAnalytics {
  return {
    sessionId: 'sess-abc123',
    projectDir: '/proj',
    gitBranch: 'main',
    model: 'claude-sonnet-4-6',
    claudeVersion: null,
    startTime: '2026-01-01T00:00:00Z',
    endTime: '2026-01-01T01:00:00Z',
    durationMs: 3600000,
    userTurns: 3,
    assistantTurns: 3,
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
    capturedViaHooks: true,
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

describe('buildOtlpPayload', () => {
  it('produces resourceSpans with one resource and one scope', () => {
    const payload = buildOtlpPayload(makeAnalytics()) as {
      resourceSpans: Array<{
        resource: { attributes: Array<{ key: string; value: { stringValue: string } }> };
        scopeSpans: Array<{ scope: { name: string }; spans: object[] }>;
      }>;
    };

    expect(payload.resourceSpans).toHaveLength(1);
    const [rs] = payload.resourceSpans;
    const serviceAttr = rs.resource.attributes.find((a) => a.key === 'service.name');
    expect(serviceAttr?.value.stringValue).toBe('brain');
    expect(rs.scopeSpans[0].scope.name).toBe('brain.sessions');
  });

  it('root span has CHAIN span kind and session attributes', () => {
    const analytics = makeAnalytics({ toolCalls: [makeToolCall()] });
    const payload = buildOtlpPayload(analytics) as {
      resourceSpans: Array<{ scopeSpans: Array<{ spans: Array<Record<string, unknown>> }> }>;
    };
    const spans = payload.resourceSpans[0].scopeSpans[0].spans;
    const rootSpan = spans[0] as {
      name: string;
      parentSpanId?: string;
      attributes: Array<{ key: string; value: { stringValue?: string } }>;
    };

    expect(rootSpan.name).toBe('session:sess-abc123');
    expect(rootSpan.parentSpanId).toBeUndefined();

    const kindAttr = rootSpan.attributes.find((a) => a.key === 'openinference.span.kind');
    expect(kindAttr?.value.stringValue).toBe('CHAIN');

    const sessionAttr = rootSpan.attributes.find((a) => a.key === 'session.id');
    expect(sessionAttr?.value.stringValue).toBe('sess-abc123');
  });

  it('tool span has TOOL span kind and parent span id', () => {
    const tc = makeToolCall({ toolName: 'Write', toolUseId: 'tu-write-1' });
    const analytics = makeAnalytics({ toolCalls: [tc] });
    const payload = buildOtlpPayload(analytics) as {
      resourceSpans: Array<{ scopeSpans: Array<{ spans: Array<Record<string, unknown>> }> }>;
    };
    const spans = payload.resourceSpans[0].scopeSpans[0].spans;

    expect(spans).toHaveLength(2);
    const toolSpan = spans[1] as {
      name: string;
      parentSpanId: string;
      traceId: string;
      attributes: Array<{ key: string; value: { stringValue?: string } }>;
    };

    expect(toolSpan.name).toBe('tool:Write');
    expect(toolSpan.parentSpanId).toBeDefined();
    expect(toolSpan.parentSpanId).toBe(spans[0].spanId);

    const kindAttr = toolSpan.attributes.find((a) => a.key === 'openinference.span.kind');
    expect(kindAttr?.value.stringValue).toBe('TOOL');

    const nameAttr = toolSpan.attributes.find((a) => a.key === 'tool.name');
    expect(nameAttr?.value.stringValue).toBe('Write');
  });

  it('root and tool spans share the same traceId', () => {
    const analytics = makeAnalytics({ toolCalls: [makeToolCall()] });
    const payload = buildOtlpPayload(analytics) as {
      resourceSpans: Array<{ scopeSpans: Array<{ spans: Array<{ traceId: string }> }> }>;
    };
    const spans = payload.resourceSpans[0].scopeSpans[0].spans;
    expect(spans[0].traceId).toBe(spans[1].traceId);
  });

  it('tool span with duration has end time after start time', () => {
    const tc = makeToolCall({ durationMs: 500 });
    const analytics = makeAnalytics({ toolCalls: [tc] });
    const payload = buildOtlpPayload(analytics) as {
      resourceSpans: Array<{
        scopeSpans: Array<{
          spans: Array<{ startTimeUnixNano: string; endTimeUnixNano: string }>;
        }>;
      }>;
    };
    const toolSpan = payload.resourceSpans[0].scopeSpans[0].spans[1];
    expect(BigInt(toolSpan.endTimeUnixNano)).toBeGreaterThan(BigInt(toolSpan.startTimeUnixNano));
  });

  it('error tool span has status code 2', () => {
    const tc = makeToolCall({ outcome: 'error', errorMessage: 'file not found' });
    const analytics = makeAnalytics({ toolCalls: [tc] });
    const payload = buildOtlpPayload(analytics) as {
      resourceSpans: Array<{
        scopeSpans: Array<{ spans: Array<{ status: { code: number; message?: string } }> }>;
      }>;
    };
    const toolSpan = payload.resourceSpans[0].scopeSpans[0].spans[1];
    expect(toolSpan.status.code).toBe(2);
    expect(toolSpan.status.message).toBe('file not found');
  });

  it('high error rate root span has status code 2', () => {
    const analytics = makeAnalytics({ errorRate: 0.5 });
    const payload = buildOtlpPayload(analytics) as {
      resourceSpans: Array<{
        scopeSpans: Array<{ spans: Array<{ status: { code: number } }> }>;
      }>;
    };
    const rootSpan = payload.resourceSpans[0].scopeSpans[0].spans[0];
    expect(rootSpan.status.code).toBe(2);
  });

  it('sidechain tool span includes is_sidechain attribute', () => {
    const tc = makeToolCall({ isSidechain: true });
    const analytics = makeAnalytics({ toolCalls: [tc] });
    const payload = buildOtlpPayload(analytics) as {
      resourceSpans: Array<{
        scopeSpans: Array<{
          spans: Array<{ attributes: Array<{ key: string; value: { boolValue?: boolean } }> }>;
        }>;
      }>;
    };
    const toolSpan = payload.resourceSpans[0].scopeSpans[0].spans[1];
    const sidechainAttr = toolSpan.attributes.find((a) => a.key === 'tool.is_sidechain');
    expect(sidechainAttr?.value.boolValue).toBe(true);
  });

  it('session with no tool calls produces exactly one span', () => {
    const analytics = makeAnalytics({ toolCalls: [] });
    const payload = buildOtlpPayload(analytics) as {
      resourceSpans: Array<{ scopeSpans: Array<{ spans: object[] }> }>;
    };
    expect(payload.resourceSpans[0].scopeSpans[0].spans).toHaveLength(1);
  });

  it('deterministic traceId — same session produces same traceId', () => {
    const a = buildOtlpPayload(makeAnalytics()) as {
      resourceSpans: Array<{ scopeSpans: Array<{ spans: Array<{ traceId: string }> }> }>;
    };
    const b = buildOtlpPayload(makeAnalytics()) as typeof a;
    expect(a.resourceSpans[0].scopeSpans[0].spans[0].traceId).toBe(
      b.resourceSpans[0].scopeSpans[0].spans[0].traceId
    );
  });
});

describe('exportSessionSpans', () => {
  let savedEnv: string | undefined;

  beforeEach(() => {
    savedEnv = process.env.BRAIN_PHOENIX_ENDPOINT;
    vi.clearAllMocks();
  });

  afterEach(() => {
    if (savedEnv === undefined) delete process.env.BRAIN_PHOENIX_ENDPOINT;
    else process.env.BRAIN_PHOENIX_ENDPOINT = savedEnv;
  });

  it('does not throw when called with a session that has no tool calls', () => {
    // No real HTTP server — just ensure the function does not throw
    // (the fire-and-forget request will fail silently)
    expect(() => exportSessionSpans(makeAnalytics())).not.toThrow();
  });

  it('does not throw on an invalid endpoint URL', () => {
    expect(() => exportSessionSpans(makeAnalytics(), 'not-a-url')).not.toThrow();
  });

  it('uses BRAIN_PHOENIX_ENDPOINT env var when no explicit endpoint passed', () => {
    process.env.BRAIN_PHOENIX_ENDPOINT = 'http://localhost:9999/v1/traces';
    // Should not throw even though port 9999 is almost certainly closed
    expect(() => exportSessionSpans(makeAnalytics())).not.toThrow();
  });

  it('default endpoint constant is the Phoenix OTLP endpoint', () => {
    expect(DEFAULT_PHOENIX_ENDPOINT).toBe('http://localhost:6006/v1/traces');
  });
});
