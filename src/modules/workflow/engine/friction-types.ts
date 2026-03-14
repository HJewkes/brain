export type FrictionSeverity = 'low' | 'medium' | 'high' | 'critical';

export type FrictionPatternType =
  | 'repeated_tool_failure'
  | 'permission_denial'
  | 'excessive_retry'
  | 'context_pressure'
  | 'progress_stall'
  | 'agent_spawn_failure'
  | 'hook_prevention'
  | 'error_loop';

export interface FrictionEvent {
  type: FrictionPatternType;
  severity: FrictionSeverity;
  description: string;
  timestamp: string;
  context: Record<string, unknown>;
}

export interface FrictionAnalysis {
  sessionId: string;
  events: FrictionEvent[];
  score: number;
  summary: string;
}

export interface ToolCallRecord {
  toolName: string;
  timestamp: string;
  outcome: 'success' | 'error' | 'pending';
  errorMessage?: string;
}

export interface ParsedSessionData {
  sessionId: string;
  toolCalls: ToolCallRecord[];
  errorCount: number;
  totalTurns: number;
  durationMs: number;
  compactionCount: number;
  hookPreventionCount: number;
  tokens?: { input: number; output: number };
}
