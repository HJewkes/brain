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
  session_type?: string;
  outcome?: string;
  cost_usd?: number;
  jsonl_path?: string;
  jsonl_size_bytes?: number;
  pr_links?: string[];
  files_written?: string[];
  segment_count?: number;
  instance_id?: string;
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
  session_type?: string;
  outcome?: string;
  cost_usd?: number;
  jsonl_path?: string;
  jsonl_size_bytes?: number;
  pr_links?: string[];
  files_written?: string[];
  segment_count?: number;
  instance_id?: string;
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
  byteOffset?: number;
  isSidechain: boolean;
}

export interface PrLink {
  number: number;
  repo: string;
  url: string;
  timestamp?: string;
}

export interface AnalyticsTokenSnapshot {
  timestamp: string;
  cumulativeInput: number;
  cumulativeOutput: number;
}

/** Alias for structured-events module compatibility */
export type TokenSnapshot = AnalyticsTokenSnapshot;

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
  slug: string | null;
  logicalParentUuid: string | null;
  compactionTimestamps: string[];
  compactionSummaries: string[];
  compactionByteOffsets: number[];
  tokenSnapshots: AnalyticsTokenSnapshot[];
  assistantTexts: string[];
  userTexts: string[];
  prLinks: PrLink[];
  filesTouched: Map<string, Set<string>>;
  filesWritten: string[];
  taskRefs: string[];
  modelCounts: Map<string, number>;
  thinkingBlockCount: number;
  planPresent: boolean;
  permissionMode: string | null;
  serviceTier: string | null;
  gitCommandCount: number;
  commitCount: number;
  subagentCount: number;
  skillUsage: Map<string, number>;
}

export interface SegmentMetadata {
  segment_index: number;
  parent_session: string;
  started_at: string;
  ended_at: string;
  duration_minutes: number;
  boundary_type: 'compaction' | 'task_switch' | 'idle_gap' | 'manual';
  tool_calls: number;
  error_count: number;
  tasks_worked?: string[];
  compaction_summary?: string;
  jsonl_byte_start?: number;
  jsonl_byte_end?: number;
}
