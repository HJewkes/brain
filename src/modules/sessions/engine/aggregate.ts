import type { BrainDB } from '../../../services/brain-db.js';
import type {
  SessionAnalytics,
  ToolCall,
  ErrorEvent,
  FrictionSignal,
  TokenTotals,
  SessionEvent,
} from '../types.js';

interface EventData {
  type?: string;
  toolName?: string;
  toolUseId?: string;
  input?: Record<string, unknown>;
  output?: string;
  outcome?: string;
  errorMessage?: string;
  durationMs?: number;
  isSidechain?: boolean;
  timestamp?: string;
  tokens?: Partial<TokenTotals>;
  model?: string;
  branch?: string;
  kind?: string;
  detail?: string;
  count?: number;
  message?: string;
  projectDir?: string;
}

export function aggregateSessionEvents(db: BrainDB, sessionId: string): SessionAnalytics | null {
  const rawDb = (
    db as unknown as {
      db: {
        prepare: (sql: string) => {
          all: (...args: unknown[]) => SessionEvent[];
        };
      };
    }
  ).db;

  const events = rawDb
    .prepare('SELECT * FROM session_events WHERE session_id = ? ORDER BY timestamp ASC')
    .all(sessionId);

  if (events.length === 0) return null;

  const toolCalls: ToolCall[] = [];
  const errors: ErrorEvent[] = [];
  const frictionSignals: FrictionSignal[] = [];
  const tokens: TokenTotals = {
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
  };

  let userTurns = 0;
  let assistantTurns = 0;
  let compactionCount = 0;
  let hookEventCount = 0;
  let hookPreventionCount = 0;
  let sidechainCount = 0;
  let model: string | null = null;
  let gitBranch: string | null = null;
  let projectDir = '';
  let startTime = '';
  let endTime = '';

  for (const event of events) {
    const data = JSON.parse(event.data) as EventData;

    if (!startTime || event.timestamp < startTime) startTime = event.timestamp;
    if (!endTime || event.timestamp > endTime) endTime = event.timestamp;

    switch (event.event_type) {
      case 'tool_call': {
        const tc: ToolCall = {
          toolName: data.toolName ?? 'unknown',
          toolUseId: data.toolUseId ?? '',
          input: data.input ?? {},
          timestamp: event.timestamp,
          outcome: (data.outcome as ToolCall['outcome']) ?? 'success',
          durationMs: data.durationMs,
          isSidechain: data.isSidechain ?? false,
        };
        if (data.errorMessage) tc.errorMessage = data.errorMessage;
        toolCalls.push(tc);
        if (tc.isSidechain) sidechainCount++;
        break;
      }
      case 'error': {
        errors.push({
          timestamp: event.timestamp,
          toolName: data.toolName,
          toolUseId: data.toolUseId,
          message: data.message ?? '',
          isSidechain: data.isSidechain ?? false,
        });
        break;
      }
      case 'friction': {
        frictionSignals.push({
          kind: data.kind as FrictionSignal['kind'],
          timestamp: event.timestamp,
          detail: data.detail ?? '',
          toolName: data.toolName,
          count: data.count,
        });
        break;
      }
      case 'tokens': {
        if (data.tokens) {
          tokens.inputTokens += data.tokens.inputTokens ?? 0;
          tokens.outputTokens += data.tokens.outputTokens ?? 0;
          tokens.cacheCreationTokens += data.tokens.cacheCreationTokens ?? 0;
          tokens.cacheReadTokens += data.tokens.cacheReadTokens ?? 0;
        }
        break;
      }
      case 'user_turn':
        userTurns++;
        break;
      case 'assistant_turn':
        assistantTurns++;
        if (!model && data.model) model = data.model;
        if (!gitBranch && data.branch) gitBranch = data.branch;
        break;
      case 'compaction':
        compactionCount++;
        break;
      case 'hook':
        hookEventCount++;
        break;
      case 'hook_prevention':
        hookPreventionCount++;
        break;
      case 'metadata':
        if (data.projectDir) projectDir = data.projectDir;
        if (data.model) model = data.model;
        if (data.branch) gitBranch = data.branch;
        break;
    }
  }

  const toolCallsByName: Record<string, number> = {};
  for (const tc of toolCalls) {
    toolCallsByName[tc.toolName] = (toolCallsByName[tc.toolName] ?? 0) + 1;
  }

  const errorCount = errors.length;
  const durationMs =
    startTime && endTime ? new Date(endTime).getTime() - new Date(startTime).getTime() : 0;

  return {
    sessionId,
    projectDir,
    gitBranch,
    model,
    claudeVersion: null,
    startTime,
    endTime,
    durationMs,
    userTurns,
    assistantTurns,
    isCompacted: compactionCount > 0,
    compactionCount,
    sidechainEventCount: sidechainCount,
    toolCalls,
    toolCallsByName,
    uniqueToolsUsed: Object.keys(toolCallsByName),
    errors,
    errorCount,
    errorRate: toolCalls.length > 0 ? errorCount / toolCalls.length : 0,
    tokens,
    frictionSignals,
    hookEventCount,
    hookPreventionCount,
    capturedViaHooks: true,
    capturedViaJsonl: false,

    // Extended signals — defaults for hook-captured sessions
    slug: null,
    prLinks: [],
    filesTouched: new Map(),
    filesWritten: [],
    modelCounts: new Map(),
    taskRefs: [],
    compactionTimestamps: [],
    compactionSummaries: [],
    compactionByteOffsets: [],
    tokenSnapshots: [],
    assistantTexts: [],
    userTexts: [],
    logicalParentUuid: null,
    thinkingBlockCount: 0,
    skillUsage: new Map(),
    planPresent: false,
    permissionMode: null,
    serviceTier: null,
    gitCommandCount: 0,
    commitCount: 0,
    subagentCount: 0,
  };
}

export function getSessionChunkContents(db: BrainDB, sessionId: string): string[] {
  const rawDb = (
    db as unknown as {
      db: {
        prepare: (sql: string) => {
          all: (...args: unknown[]) => Array<{ content: string }>;
        };
      };
    }
  ).db;

  try {
    const rows = rawDb
      .prepare('SELECT content FROM session_chunks WHERE session_id = ? ORDER BY chunk_index')
      .all(sessionId);
    return rows.map((r) => r.content);
  } catch {
    return [];
  }
}
