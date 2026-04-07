/**
 * OpenInference span exporter for brain session analytics.
 *
 * Transforms SessionAnalytics into OTLP JSON spans and exports them
 * over HTTP to a Phoenix-compatible tracing backend.
 *
 * Session   → root CHAIN span
 * ToolCall  → child TOOL span
 *
 * Configure the export endpoint via BRAIN_PHOENIX_ENDPOINT
 * (default: http://localhost:6006/v1/traces).
 */
import { createHash } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { URL } from 'node:url';
import type { SessionAnalytics, ToolCall } from '../types.js';

export const DEFAULT_PHOENIX_ENDPOINT = 'http://localhost:6006/v1/traces';
const SERVICE_NAME = 'brain';
const SCOPE_NAME = 'brain.sessions';

// --- Attribute helpers ---

interface OtlpAttribute {
  key: string;
  value: { stringValue?: string; intValue?: string; boolValue?: boolean };
}

function strAttr(key: string, value: string): OtlpAttribute {
  return { key, value: { stringValue: value } };
}

function intAttr(key: string, value: number): OtlpAttribute {
  return { key, value: { intValue: String(value) } };
}

// --- ID derivation ---

function traceIdFromSession(sessionId: string): string {
  return createHash('sha256').update(sessionId).digest().subarray(0, 16).toString('hex');
}

function rootSpanId(sessionId: string): string {
  return createHash('sha256').update(`root:${sessionId}`).digest().subarray(0, 8).toString('hex');
}

function toolSpanId(tc: ToolCall, traceId: string): string {
  const key = tc.toolUseId || `${traceId}:${tc.timestamp}:${tc.toolName}`;
  return createHash('sha256').update(key).digest().subarray(0, 8).toString('hex');
}

// --- Timestamp conversion ---

function toNano(isoDate: string): string {
  return String(new Date(isoDate).getTime() * 1_000_000);
}

function toolEndNano(tc: ToolCall): string {
  if (tc.durationMs) {
    return String(new Date(tc.timestamp).getTime() * 1_000_000 + tc.durationMs * 1_000_000);
  }
  return toNano(tc.timestamp);
}

// --- Span builders ---

function buildRootSpan(analytics: SessionAnalytics, traceId: string, spanId: string): object {
  const attrs: OtlpAttribute[] = [
    strAttr('openinference.span.kind', 'CHAIN'),
    strAttr('session.id', analytics.sessionId),
    intAttr('session.tool_calls', analytics.toolCalls.length),
    intAttr('session.error_count', analytics.errorCount),
    intAttr('session.user_turns', analytics.userTurns),
  ];

  if (analytics.model) attrs.push(strAttr('llm.model_name', analytics.model));
  if (analytics.gitBranch) attrs.push(strAttr('session.git_branch', analytics.gitBranch));
  if (analytics.projectDir) attrs.push(strAttr('session.project_dir', analytics.projectDir));

  return {
    traceId,
    spanId,
    name: `session:${analytics.sessionId}`,
    kind: 1,
    startTimeUnixNano: toNano(analytics.startTime),
    endTimeUnixNano: analytics.endTime ? toNano(analytics.endTime) : toNano(analytics.startTime),
    attributes: attrs,
    status: { code: analytics.errorRate > 0.3 ? 2 : 1 },
  };
}

function buildToolSpan(tc: ToolCall, traceId: string, parentSpanId: string): object {
  const attrs: OtlpAttribute[] = [
    strAttr('openinference.span.kind', 'TOOL'),
    strAttr('tool.name', tc.toolName),
    strAttr('tool.parameters', JSON.stringify(tc.input)),
  ];

  if (tc.errorMessage) attrs.push(strAttr('tool.error', tc.errorMessage));
  if (tc.isSidechain) attrs.push({ key: 'tool.is_sidechain', value: { boolValue: true } });

  return {
    traceId,
    spanId: toolSpanId(tc, traceId),
    parentSpanId,
    name: `tool:${tc.toolName}`,
    kind: 1,
    startTimeUnixNano: toNano(tc.timestamp),
    endTimeUnixNano: toolEndNano(tc),
    attributes: attrs,
    status: tc.outcome === 'error' ? { code: 2, message: tc.errorMessage ?? '' } : { code: 1 },
  };
}

// --- Public API ---

/** Build an OTLP JSON payload from session analytics. */
export function buildOtlpPayload(analytics: SessionAnalytics): object {
  const traceId = traceIdFromSession(analytics.sessionId);
  const spanId = rootSpanId(analytics.sessionId);

  const spans: object[] = [buildRootSpan(analytics, traceId, spanId)];
  for (const tc of analytics.toolCalls) {
    spans.push(buildToolSpan(tc, traceId, spanId));
  }

  return {
    resourceSpans: [
      {
        resource: { attributes: [strAttr('service.name', SERVICE_NAME)] },
        scopeSpans: [{ scope: { name: SCOPE_NAME, version: '1.0.0' }, spans }],
      },
    ],
  };
}

/**
 * Fire-and-forget: export session analytics as OTLP spans to Phoenix.
 * All errors are swallowed — span export must never block the session pipeline.
 */
export function exportSessionSpans(analytics: SessionAnalytics, endpoint?: string): void {
  try {
    const url = endpoint ?? process.env.BRAIN_PHOENIX_ENDPOINT ?? DEFAULT_PHOENIX_ENDPOINT;
    const body = JSON.stringify(buildOtlpPayload(analytics));
    const parsed = new URL(url);
    const reqFn = parsed.protocol === 'https:' ? httpsRequest : httpRequest;

    const req = reqFn({
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? '443' : '80'),
      path: parsed.pathname + (parsed.search || ''),
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    });

    req.on('error', () => {}); // intentionally swallowed
    req.write(body);
    req.end();
  } catch {
    // Non-fatal — span export is best-effort
  }
}
