/** Safety bounds for autoloop execution */
export interface AutoloopBounds {
  /** Max wall-clock time per run in milliseconds (default: 15 minutes) */
  maxDurationMs: number;
  /** Max notes created per run (default: 20) */
  maxNotesCreated: number;
  /** Max task modifications per run (default: 10) */
  maxTaskModifications: number;
  /** Max LLM calls per run (default: 50) */
  maxLlmCalls: number;
  /** Cooldown between runs in milliseconds (default: 30 minutes) */
  cooldownMs: number;
}

export const DEFAULT_BOUNDS: AutoloopBounds = {
  maxDurationMs: 15 * 60 * 1000,
  maxNotesCreated: 20,
  maxTaskModifications: 10,
  maxLlmCalls: 50,
  cooldownMs: 30 * 60 * 1000,
};

export type AutoloopType = 'session-review' | 'task-consolidation';

export type AutoloopStatus = 'running' | 'completed' | 'partial' | 'failed' | 'cooldown';

/** Tracks resource consumption during a loop run */
export interface AutoloopCounters {
  notesCreated: number;
  taskModifications: number;
  llmCalls: number;
  startedAt: number;
}

/** Result of a completed autoloop run */
export interface AutoloopReport {
  loopType: AutoloopType;
  status: AutoloopStatus;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  sessionsReviewed: number;
  insightsExtracted: number;
  tasksUpdated: number;
  notesCreated: number;
  terminationReason?: string;
  errors: string[];
}

/** An extracted insight from session review */
export interface AutoloopInsight {
  category: 'pattern' | 'friction' | 'decision' | 'learning' | 'improvement';
  title: string;
  content: string;
  confidence: number;
  sourceSessionIds: string[];
  sourceSessionDisplayIds: string[];
}

/** Task readiness assessment from consolidation loop */
export interface TaskReadinessScore {
  taskId: string;
  overall: number;
  dimensions: {
    hasDescription: boolean;
    hasDependencies: boolean;
    hasRelatedResearch: boolean;
    hasEstimate: boolean;
    isSpecific: boolean;
  };
  suggestions: string[];
}
