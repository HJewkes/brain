export type SessionStatus = 'active' | 'completed' | 'paused' | 'abandoned';

export interface SessionMetadata {
  session_id: string;
  display_id: string;
  project_dir: string;
  project?: string;
  workstream?: string;
  status: SessionStatus;
  started_at: string;
  completed_at?: string;
  duration_minutes?: number;
  branch?: string;
  worktree_path?: string;
  agent_model?: string;
  mode?: string;
  compact_count?: number;
  summary?: string;
  micro_summary_count?: number;
  last_captured_at?: string;
  total_turns?: number;
  tool_calls?: number;
  error_count?: number;
  error_rate?: number;
  tokens_input?: number;
  tokens_output?: number;
  tasks_worked?: string[];
  tasks_completed?: string[];
  notes_created?: string[];
  commits?: string[];
  memories_extracted?: number;
  plan_id?: string;
  analyticsExt?: SessionAnalyticsExt;
}

export interface SessionAnalyticsExt {
  top_tools?: Array<{ name: string; count: number; error_rate: number }>;
  friction_categories?: Array<{ category: string; count: number }>;
  delegation_ratio?: number;
  context_pressure?: number;
}

export interface CreateSessionInput {
  session_id: string;
  project_dir: string;
  status: SessionStatus;
  started_at: string;
  completed_at?: string;
  duration_minutes?: number;
  branch?: string;
  worktree_path?: string;
  agent_model?: string;
  mode?: string;
  compact_count?: number;
  summary?: string;
  analytics?: {
    total_turns?: number;
    tool_calls?: number;
    error_count?: number;
    tokens_input?: number;
    tokens_output?: number;
  };
  analyticsExt?: SessionAnalyticsExt;
  tasks_worked?: string[];
  tasks_completed?: string[];
  notes_created?: string[];
  commits?: string[];
  plan_id?: string;
  l1Content?: string;
  l2Content?: string;
  observationsContent?: string;
}

export interface SessionListFilters {
  status?: SessionStatus;
  projectDir?: string;
  project?: string;
  since?: string;
  taskId?: string;
}

export interface SessionEvent {
  id: number;
  session_id: string;
  event_type: string;
  category: string | null;
  data: string;
  timestamp: string;
  data_hash: string;
}

export interface SessionChunk {
  id: number;
  session_id: string;
  chunk_index: number;
  content: string;
  source: 'compaction' | 'periodic' | 'manual';
  timestamp: string;
}

// --- Parser types (JSONL event shapes) ---

export type SessionEventType =
  | 'user'
  | 'assistant'
  | 'system'
  | 'progress'
  | 'queue-operation'
  | 'file-history-snapshot'
  | 'pr-link';

export interface MessageContent {
  type: 'text' | 'tool_use' | 'tool_result' | 'thinking';
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  tool_use_id?: string;
  content?: string | MessageContent[];
  is_error?: boolean;
  text?: string;
  thinking?: string;
}

export interface TokenUsage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

export interface ToolCall {
  toolUseId: string;
  toolName: string;
  input: Record<string, unknown>;
  timestamp: string;
  outcome: 'success' | 'error' | 'pending';
  errorMessage?: string;
  durationMs?: number;
  isSidechain: boolean;
}

export interface ErrorEvent {
  timestamp: string;
  toolName?: string;
  toolUseId?: string;
  message: string;
  isSidechain: boolean;
}

export type FrictionKind =
  | 'consecutive_identical_tool'
  | 'error_loop'
  | 'user_correction'
  | 'hook_prevention';

export interface FrictionSignal {
  kind: FrictionKind;
  timestamp: string;
  detail: string;
  toolName?: string;
  count?: number;
}

export interface TokenTotals {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
}

export interface SessionAnalytics {
  sessionId: string;
  projectDir: string;
  gitBranch: string | null;
  model: string | null;
  claudeVersion: string | null;
  startTime: string;
  endTime: string;
  durationMs: number;
  userTurns: number;
  assistantTurns: number;
  isCompacted: boolean;
  compactionCount: number;
  sidechainEventCount: number;
  toolCalls: ToolCall[];
  toolCallsByName: Record<string, number>;
  uniqueToolsUsed: string[];
  errors: ErrorEvent[];
  errorCount: number;
  errorRate: number;
  tokens: TokenTotals;
  frictionSignals: FrictionSignal[];
  hookEventCount: number;
  hookPreventionCount: number;
  capturedViaHooks: boolean;
  capturedViaJsonl: boolean;
}
