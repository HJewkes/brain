import type {
  FrictionEvent,
  FrictionAnalysis,
  FrictionSeverity,
  ParsedSessionData,
  ToolCallRecord,
} from './friction-types.js';

const REPEATED_FAILURE_THRESHOLD = 3;
const CONSECUTIVE_RETRY_THRESHOLD = 3;
const PROGRESS_GAP_MS = 5 * 60 * 1000;
const CONTEXT_PRESSURE_THRESHOLD = 150_000;

const SEVERITY_WEIGHTS: Record<FrictionSeverity, number> = {
  low: 5,
  medium: 15,
  high: 30,
  critical: 50,
};

const PERMISSION_PATTERNS = [
  /permission denied/i,
  /not allowed/i,
  /access denied/i,
  /forbidden/i,
  /EACCES/,
  /unauthorized/i,
];

const AGENT_SPAWN_PATTERNS = [
  /agent.*fail/i,
  /spawn.*fail/i,
  /subagent.*error/i,
  /task.*spawn.*fail/i,
];

export function analyzeFriction(data: ParsedSessionData): FrictionAnalysis {
  const events: FrictionEvent[] = [
    ...detectRepeatedToolFailures(data.toolCalls),
    ...detectPermissionDenials(data.toolCalls),
    ...detectExcessiveRetries(data.toolCalls),
    ...detectContextPressure(data),
    ...detectProgressStalls(data.toolCalls),
    ...detectAgentSpawnFailures(data.toolCalls),
    ...detectHookPreventions(data),
    ...detectErrorLoops(data.toolCalls),
  ];

  events.sort((a, b) => a.timestamp.localeCompare(b.timestamp));

  const score = computeScore(events);
  const summary = buildSummary(data.sessionId, events, score);

  return { sessionId: data.sessionId, events, score, summary };
}

export function detectRepeatedToolFailures(toolCalls: ToolCallRecord[]): FrictionEvent[] {
  const failuresByTool = new Map<string, ToolCallRecord[]>();

  for (const call of toolCalls) {
    if (call.outcome !== 'error') continue;
    const list = failuresByTool.get(call.toolName) ?? [];
    list.push(call);
    failuresByTool.set(call.toolName, list);
  }

  const events: FrictionEvent[] = [];
  failuresByTool.forEach((failures, toolName) => {
    if (failures.length < REPEATED_FAILURE_THRESHOLD) return;
    events.push({
      type: 'repeated_tool_failure',
      severity: failures.length >= 5 ? 'high' : 'medium',
      description: `Tool "${toolName}" failed ${failures.length} times`,
      timestamp: failures[0].timestamp,
      context: { toolName, failureCount: failures.length },
    });
  });

  return events;
}

export function detectPermissionDenials(toolCalls: ToolCallRecord[]): FrictionEvent[] {
  const events: FrictionEvent[] = [];

  for (const call of toolCalls) {
    if (call.outcome !== 'error' || !call.errorMessage) continue;
    if (!PERMISSION_PATTERNS.some((p) => p.test(call.errorMessage!))) continue;

    events.push({
      type: 'permission_denial',
      severity: 'high',
      description: `Permission denied on "${call.toolName}": ${truncate(call.errorMessage, 100)}`,
      timestamp: call.timestamp,
      context: { toolName: call.toolName, message: call.errorMessage },
    });
  }

  return events;
}

export function detectExcessiveRetries(toolCalls: ToolCallRecord[]): FrictionEvent[] {
  const events: FrictionEvent[] = [];
  let prevTool = '';
  let consecutive = 0;
  let firstTs = '';

  for (const call of toolCalls) {
    if (call.toolName === prevTool) {
      consecutive++;
    } else {
      if (consecutive >= CONSECUTIVE_RETRY_THRESHOLD) {
        events.push(buildRetryEvent(prevTool, consecutive, firstTs));
      }
      prevTool = call.toolName;
      consecutive = 1;
      firstTs = call.timestamp;
    }
  }

  if (consecutive >= CONSECUTIVE_RETRY_THRESHOLD) {
    events.push(buildRetryEvent(prevTool, consecutive, firstTs));
  }

  return events;
}

function buildRetryEvent(toolName: string, count: number, timestamp: string): FrictionEvent {
  return {
    type: 'excessive_retry',
    severity: count >= 5 ? 'high' : 'medium',
    description: `"${toolName}" called ${count} times consecutively`,
    timestamp,
    context: { toolName, consecutiveCount: count },
  };
}

export function detectContextPressure(data: ParsedSessionData): FrictionEvent[] {
  if (data.compactionCount === 0 && !exceedsTokenThreshold(data)) return [];

  const severity: FrictionSeverity =
    data.compactionCount >= 3 ? 'critical' : data.compactionCount >= 1 ? 'high' : 'medium';

  const ts =
    data.toolCalls.length > 0
      ? data.toolCalls[data.toolCalls.length - 1].timestamp
      : new Date().toISOString();

  return [
    {
      type: 'context_pressure',
      severity,
      description: `Context window pressure detected (${data.compactionCount} compactions)`,
      timestamp: ts,
      context: {
        compactionCount: data.compactionCount,
        tokenInput: data.tokens?.input,
        tokenOutput: data.tokens?.output,
      },
    },
  ];
}

function exceedsTokenThreshold(data: ParsedSessionData): boolean {
  return (data.tokens?.input ?? 0) > CONTEXT_PRESSURE_THRESHOLD;
}

export function detectProgressStalls(toolCalls: ToolCallRecord[]): FrictionEvent[] {
  if (toolCalls.length < 2) return [];

  const events: FrictionEvent[] = [];

  for (let i = 1; i < toolCalls.length; i++) {
    const gap = timeDiffMs(toolCalls[i - 1].timestamp, toolCalls[i].timestamp);
    if (gap === null || gap < PROGRESS_GAP_MS) continue;

    events.push({
      type: 'progress_stall',
      severity: gap > PROGRESS_GAP_MS * 2 ? 'high' : 'medium',
      description: `${Math.round(gap / 60_000)}min gap between tool calls`,
      timestamp: toolCalls[i - 1].timestamp,
      context: { gapMs: gap },
    });
  }

  return events;
}

export function detectAgentSpawnFailures(toolCalls: ToolCallRecord[]): FrictionEvent[] {
  const events: FrictionEvent[] = [];

  for (const call of toolCalls) {
    if (call.outcome !== 'error' || !call.errorMessage) continue;
    if (!AGENT_SPAWN_PATTERNS.some((p) => p.test(call.errorMessage!))) continue;

    events.push({
      type: 'agent_spawn_failure',
      severity: 'high',
      description: `Agent spawn failure on "${call.toolName}": ${truncate(call.errorMessage, 100)}`,
      timestamp: call.timestamp,
      context: { toolName: call.toolName, message: call.errorMessage },
    });
  }

  return events;
}

export function detectHookPreventions(data: ParsedSessionData): FrictionEvent[] {
  if (data.hookPreventionCount === 0) return [];

  const ts = data.toolCalls.length > 0 ? data.toolCalls[0].timestamp : new Date().toISOString();

  return [
    {
      type: 'hook_prevention',
      severity: data.hookPreventionCount >= 3 ? 'high' : 'medium',
      description: `${data.hookPreventionCount} hook prevention(s) blocked operations`,
      timestamp: ts,
      context: { hookPreventionCount: data.hookPreventionCount },
    },
  ];
}

export function detectErrorLoops(toolCalls: ToolCallRecord[]): FrictionEvent[] {
  const events: FrictionEvent[] = [];
  let consecutiveErrors = 0;
  let loopStart = '';

  for (const call of toolCalls) {
    if (call.outcome === 'error') {
      if (consecutiveErrors === 0) loopStart = call.timestamp;
      consecutiveErrors++;
    } else {
      if (consecutiveErrors >= REPEATED_FAILURE_THRESHOLD) {
        events.push({
          type: 'error_loop',
          severity: consecutiveErrors >= 5 ? 'critical' : 'high',
          description: `${consecutiveErrors} consecutive errors in a row`,
          timestamp: loopStart,
          context: { consecutiveErrors },
        });
      }
      consecutiveErrors = 0;
    }
  }

  if (consecutiveErrors >= REPEATED_FAILURE_THRESHOLD) {
    events.push({
      type: 'error_loop',
      severity: consecutiveErrors >= 5 ? 'critical' : 'high',
      description: `${consecutiveErrors} consecutive errors in a row`,
      timestamp: loopStart,
      context: { consecutiveErrors },
    });
  }

  return events;
}

function computeScore(events: FrictionEvent[]): number {
  const raw = events.reduce((sum, e) => sum + SEVERITY_WEIGHTS[e.severity], 0);
  return Math.min(100, raw);
}

function buildSummary(sessionId: string, events: FrictionEvent[], score: number): string {
  if (events.length === 0) {
    return `Session ${sessionId}: No friction detected (score: 0)`;
  }

  const bySeverity = countBySeverity(events);
  const parts = Object.entries(bySeverity)
    .filter(([, count]) => count > 0)
    .map(([sev, count]) => `${count} ${sev}`)
    .join(', ');

  return `Session ${sessionId}: ${events.length} friction event(s) (${parts}), score: ${score}/100`;
}

function countBySeverity(events: FrictionEvent[]): Record<FrictionSeverity, number> {
  const counts: Record<FrictionSeverity, number> = {
    low: 0,
    medium: 0,
    high: 0,
    critical: 0,
  };
  for (const e of events) counts[e.severity]++;
  return counts;
}

function timeDiffMs(ts1: string, ts2: string): number | null {
  const d1 = new Date(ts1).getTime();
  const d2 = new Date(ts2).getTime();
  if (isNaN(d1) || isNaN(d2)) return null;
  return d2 - d1;
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max) + '...';
}
