// ---------------------------------------------------------------------------
// Audit report — shape from collectAuditReport() in commands/audit.ts
// ---------------------------------------------------------------------------
export interface AuditReport {
  generatedAt: string;
  schemaVersion: string | null;
  notesDir: string;
  notes: {
    total: number;
    byTier: Record<string, number>;
    byType: Record<string, number>;
    byModule: Record<string, number>;
    staleCount: number;
  };
  memories: {
    total: number;
    active: number;
    forgotten: number;
    byCategory: Record<string, number>;
  };
  search: {
    ftsCount: number;
    trigramCount: number;
    vectorCount: number;
    embeddingModel: string | null;
    embeddingDimensions: number | null;
  };
  storage: {
    dbPath: string;
    dbSizeBytes: number;
    chunkCount: number;
    inboxPending: number;
    inboxTotal: number;
    feedCount: number;
  };
  tasks: {
    total: number;
    byStatus: Record<string, number>;
  };
  relations: {
    byType: Record<string, number>;
    total: number;
  };
}

// ---------------------------------------------------------------------------
// Status cache — from ~/.claude/status-cache/brain-state.json
// ---------------------------------------------------------------------------
export interface StatusCache {
  agents?: Array<{
    name?: string;
    task?: string;
    branch?: string;
    status?: string;
  }>;
  sessions?: {
    eventCount?: number;
    frictionCount?: number;
    prsCreated?: number;
  };
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Dashboard data — shape from collectDashboardData() in commands/audit.ts
// ---------------------------------------------------------------------------
export interface DashboardTask {
  id: string;
  title: string;
  col: string;
  workstream: string;
  agent: string | null;
  branch: string | null;
  priority: string;
  deps: string[];
  queueAge: number | null;
  pr: { url: string; reviewer: string; reviewStatus: string } | null;
  description?: string;
}

export interface DashboardAgent {
  id: string;
  name: string;
  status: string;
  task: string | null;
  branch: string | null;
  tokensIn: number;
  tokensOut: number;
  toolCalls: number;
  errors: number;
  toolDomains: string[];
}

export interface SessionTimelineEvent {
  timestamp: string;
  toolName: string;
  outcome: 'success' | 'error';
  durationMs?: number;
}

export interface DashboardSession {
  id: string;
  displayId: string;
  status: string;
  startedAt: string;
  endedAt: string | null;
  tokensIn: number;
  tokensOut: number;
  toolCalls: number;
  errors: number;
  events?: SessionTimelineEvent[];
  tasksWorked?: string[];
  tasksCompleted?: string[];
  commits?: string[];
  subagentCount?: number;
}

export interface DashboardStageTransition {
  taskId: string;
  fromState: string;
  toState: string;
  agentId: string | null;
  timestamp: string;
}

export interface DashboardData {
  tasks: DashboardTask[];
  agents: DashboardAgent[];
  sessions: DashboardSession[];
  stageHistory: DashboardStageTransition[];
  workstreams: Record<string, { name: string; project: string }>;
}

// ---------------------------------------------------------------------------
// Session detail types (mirrors src/modules/sessions/types.ts)
// ---------------------------------------------------------------------------

export interface SessionToolCall {
  id: string;
  timestamp: string;
  toolName: string;
  inputSummary: string;
  outcome: 'success' | 'error' | 'pending';
  errorMessage: string | null;
  durationMs: number | null;
  byteOffset: number | null;
  agentId: string | null;
}

export interface SessionTurn {
  index: number;
  userMessage: string;
  assistantResponse: string;
  toolCalls: SessionToolCall[];
  timestamp: string;
  tokenUsage: {
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  } | null;
}

export interface TokenSnapshot {
  timestamp: string;
  cumulativeInput: number;
  cumulativeOutput: number;
  messageInput: number;
  messageOutput: number;
  isCompaction: boolean;
}

export interface CompactionEvent {
  timestamp: string;
  turnIndex: number;
  tokensBefore: number;
  tokensAfter: number;
  summaryPreview: string;
}

export interface TaskEvent {
  taskId: string;
  action: 'added' | 'started' | 'completed' | 'blocked' | 'abandoned';
  timestamp: string;
  detail: string | null;
}

export interface AgentEvent {
  agentId: string;
  action: 'spawned' | 'completed' | 'failed';
  timestamp: string;
  taskId: string | null;
  model: string | null;
}

export interface SubagentSummary {
  agentId: string;
  model: string | null;
  taskId: string | null;
  status: 'active' | 'completed' | 'failed';
  toolCalls: number;
  errors: number;
  durationMs: number | null;
}

export interface SessionMetadata {
  sessionId: string;
  displayId: string;
  projectDir: string;
  project: string | null;
  workstream: string | null;
  status: 'active' | 'completed' | 'paused' | 'abandoned';
  startedAt: string;
  completedAt: string | null;
  durationMinutes: number | null;
  branch: string | null;
  worktreePath: string | null;
  agentModel: string | null;
  mode: string | null;
  compactCount: number;
  summary: string | null;
  totalTurns: number;
  toolCalls: number;
  errorCount: number;
  errorRate: number;
  tokensInput: number;
  tokensOutput: number;
  tasksWorked: string[];
  tasksCompleted: string[];
  notesCreated: string[];
  commits: string[];
  memoriesExtracted: number;
}

export interface SessionDetailData {
  session: SessionMetadata;
  turns: SessionTurn[];
  tokenTimeline: TokenSnapshot[];
  compactions: CompactionEvent[];
  taskEvents: TaskEvent[];
  agentEvents: AgentEvent[];
  subagents: SubagentSummary[];
  frictionSignals: Array<{
    kind: string;
    timestamp: string;
    detail: string;
    toolName?: string;
    count?: number;
  }>;
  totalToolCalls: number;
  totalErrors: number;
  errorRate: number;
}

declare global {
  interface Window {
    __AUDIT__: AuditReport;
    __STATUS__: StatusCache;
    __DASHBOARD__: DashboardData | null;
    __BRAIN_API__?: string;
  }
}
