import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SessionAnalytics, ToolCall, TokenSnapshot } from '../types.js';
import { summarizeInput } from './summarizer.js';

export interface ConversationTurn {
  index: number;
  timestamp: string;
  userText?: string;
  assistantText?: string;
  toolCalls: Array<{
    id: string;
    toolName: string;
    inputSummary: string;
    outcome: 'success' | 'error' | 'pending';
    errorMessage?: string;
    durationMs?: number;
    byteOffset?: number;
    agentId?: string;
  }>;
}

export interface TaskBoundaryEvent {
  type: 'task_claim' | 'task_done' | 'task_add';
  taskId: string;
  timestamp: string;
}

export interface AgentEvent {
  type: 'agent_spawn' | 'agent_complete';
  detail: string;
  timestamp: string;
}

export interface CompactionEvent {
  index: number;
  timestamp: string;
}

export interface StructuredEventsOutput {
  sessionId: string;
  startTime: string;
  endTime: string;
  durationMs: number;
  turns: ConversationTurn[];
  tokenTimeline: TokenSnapshot[];
  compactions: CompactionEvent[];
  taskEvents: TaskBoundaryEvent[];
  agentEvents: AgentEvent[];
  filesTouched: string[];
}

const PM_TASK_COMMANDS = ['brain pm task claim', 'brain pm task done', 'brain pm task add'];
const AGENT_COMMANDS = ['brain agent', 'brain pm dispatch'];

export function buildStructuredEvents(analytics: SessionAnalytics): StructuredEventsOutput {
  const turns = buildTurns(analytics);
  const compactions = buildCompactions(analytics);
  const taskEvents = extractTaskEvents(analytics);
  const agentEvents = extractAgentEvents(analytics);
  const filesTouched = extractFilesTouched(analytics);

  return {
    sessionId: analytics.sessionId,
    startTime: analytics.startTime,
    endTime: analytics.endTime,
    durationMs: analytics.durationMs,
    turns,
    tokenTimeline: analytics.tokenSnapshots,
    compactions,
    taskEvents,
    agentEvents,
    filesTouched,
  };
}

function buildTurns(analytics: SessionAnalytics): ConversationTurn[] {
  const turns: ConversationTurn[] = [];
  const toolsByTimestamp = groupToolCallsByTimestamp(analytics.toolCalls);

  // Pair user and assistant texts into conversation turns
  const userTexts = analytics.userTexts ?? [];
  const assistantTexts = analytics.assistantTexts ?? [];
  const maxTurns = Math.max(
    userTexts.length,
    assistantTexts.length,
    analytics.assistantTurns,
  );

  for (let i = 0; i < maxTurns; i++) {
    const userText = userTexts[i];
    const assistantText = assistantTexts[i];
    const snapshot = (analytics.tokenSnapshots ?? [])[i];
    const timestamp = snapshot?.timestamp ?? analytics.startTime;

    const groupedTools = toolsByTimestamp.get(i) ?? [];

    turns.push({
      index: i,
      timestamp,
      userText: userText?.slice(0, 500),
      assistantText: assistantText?.slice(0, 500),
      toolCalls: groupedTools.map((tc) => ({
        id: tc.toolUseId,
        toolName: tc.toolName,
        inputSummary: summarizeInput(tc.toolName, tc.input) ?? '',
        outcome: tc.outcome,
        errorMessage: tc.errorMessage,
        durationMs: tc.durationMs,
        byteOffset: tc.byteOffset,
        agentId: inferAgentId(tc),
      })),
    });
  }

  return turns;
}

function groupToolCallsByTimestamp(toolCalls: ToolCall[]): Map<number, ToolCall[]> {
  const groups = new Map<number, ToolCall[]>();
  if (toolCalls.length === 0) return groups;

  const sorted = [...toolCalls].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  const timestamps = [...new Set(sorted.map((tc) => tc.timestamp))].sort();

  for (const tc of sorted) {
    const turnIndex = timestamps.indexOf(tc.timestamp);
    const existing = groups.get(turnIndex) ?? [];
    existing.push(tc);
    groups.set(turnIndex, existing);
  }

  return groups;
}

function buildCompactions(analytics: SessionAnalytics): CompactionEvent[] {
  if (analytics.compactionCount === 0) return [];

  const compactions: CompactionEvent[] = [];
  let compactionIdx = 0;

  for (const signal of analytics.frictionSignals) {
    if (signal.kind === 'user_correction' && signal.detail.includes('compaction')) {
      compactions.push({ index: compactionIdx++, timestamp: signal.timestamp });
    }
  }

  // If no friction signals matched, create placeholder entries
  while (compactions.length < analytics.compactionCount) {
    compactions.push({
      index: compactionIdx++,
      timestamp: analytics.startTime,
    });
  }

  return compactions;
}

function extractTaskEvents(analytics: SessionAnalytics): TaskBoundaryEvent[] {
  const events: TaskBoundaryEvent[] = [];

  for (const tc of analytics.toolCalls) {
    if (tc.toolName !== 'Bash' && tc.toolName !== 'bash') continue;
    const cmd = String(tc.input.command ?? tc.input.cmd ?? '');
    if (!cmd) continue;

    for (const pattern of PM_TASK_COMMANDS) {
      if (!cmd.includes(pattern)) continue;
      const type = inferTaskEventType(pattern);
      const taskId = extractTaskId(cmd);
      if (type && taskId) {
        events.push({ type, taskId, timestamp: tc.timestamp });
      }
    }
  }

  return events;
}

function inferTaskEventType(pattern: string): TaskBoundaryEvent['type'] | null {
  if (pattern.includes('claim')) return 'task_claim';
  if (pattern.includes('done')) return 'task_done';
  if (pattern.includes('add')) return 'task_add';
  return null;
}

function extractTaskId(cmd: string): string | null {
  const match = cmd.match(/\b([A-Z]+-\d+)\b/);
  return match?.[1] ?? null;
}

function inferAgentId(tc: ToolCall): string | undefined {
  if (tc.toolName === 'Agent' || tc.toolName === 'Task' || tc.toolName === 'TaskCreate') {
    return tc.toolUseId;
  }
  return undefined;
}

function extractAgentEvents(analytics: SessionAnalytics): AgentEvent[] {
  const events: AgentEvent[] = [];

  for (const tc of analytics.toolCalls) {
    if (tc.toolName !== 'Bash' && tc.toolName !== 'bash') continue;
    const cmd = String(tc.input.command ?? tc.input.cmd ?? '');
    if (!cmd) continue;

    for (const pattern of AGENT_COMMANDS) {
      if (!cmd.includes(pattern)) continue;
      const type = cmd.includes('dispatch') || cmd.includes('spawn')
        ? 'agent_spawn'
        : 'agent_complete';
      events.push({
        type,
        detail: cmd.slice(0, 200),
        timestamp: tc.timestamp,
      });
    }
  }

  return events;
}

function extractFilesTouched(analytics: SessionAnalytics): string[] {
  const files = new Set<string>();

  for (const tc of analytics.toolCalls) {
    const name = tc.toolName.toLowerCase();
    if (['write', 'edit', 'read'].includes(name)) {
      const filePath = String(tc.input.file_path ?? tc.input.path ?? '');
      if (filePath) files.add(filePath);
    }

    if (name === 'bash' || name === 'execute') {
      const cmd = String(tc.input.command ?? tc.input.cmd ?? '');
      extractFilePathsFromCommand(cmd, files);
    }
  }

  return [...files].sort();
}

function extractFilePathsFromCommand(cmd: string, files: Set<string>): void {
  // Match common file path patterns in bash commands
  const pathRegex = /(?:^|\s)((?:\/[\w./-]+)+\.\w+)/g;
  let match;
  while ((match = pathRegex.exec(cmd)) !== null) {
    files.add(match[1]);
  }
}

export function writeStructuredEvents(
  notesDir: string,
  displayId: string,
  events: StructuredEventsOutput
): string {
  const dir = join(notesDir, 'modules', 'sessions', displayId);
  mkdirSync(dir, { recursive: true });

  const filePath = join(dir, 'structured-events.json');
  writeFileSync(filePath, JSON.stringify(events, null, 2), 'utf-8');
  return filePath;
}
