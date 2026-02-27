// PM note types
export type PmNoteType = 'project' | 'workstream' | 'task' | 'decision' | 'prompt' | 'capture';

// PM relation types
export type PmRelationType = 'depends_on' | 'blocks' | 'impacts' | 'supersedes';

// Stored states (persisted in metadata)
export type TaskStatus = 'pending' | 'claimed' | 'in-progress' | 'done' | 'blocked' | 'cancelled';
export type ProjectStatus = 'active' | 'paused' | 'completed' | 'archived';
export type WorkstreamStatus = 'active' | 'paused' | 'completed';
export type DecisionStatus = 'proposed' | 'accepted' | 'superseded' | 'rejected';
export type PromptStatus = 'stub' | 'draft' | 'current' | 'stale' | 'superseded';

// Virtual states (computed, never stored)
export type VirtualState = '+READY' | '+ELIGIBLE' | '+BLOCKED' | '+STALE' | '+OVERDUE';

// Task modes and categories
export type TaskMode = 'auto' | 'interactive' | 'review';
export type TaskCategory =
  | 'implementation'
  | 'testing'
  | 'documentation'
  | 'research'
  | 'review'
  | 'infrastructure';
export type TaskPriority = 'critical' | 'high' | 'medium' | 'low';

// Note visibility for search scoping
export type NoteVisibility = 'public' | 'contextual' | 'private';

// PM metadata interfaces (stored in notes.metadata JSON)
export interface ProjectMetadata {
  display_id: string;
  prefix: string;
  status: ProjectStatus;
  phase?: string;
  wip_limit?: number;
}

export interface WorkstreamMetadata {
  display_id: string;
  project: string;
  number: number;
  status: WorkstreamStatus;
}

export interface TaskMetadata {
  display_id: string;
  project: string;
  workstream: number;
  number: number;
  status: TaskStatus;
  mode: TaskMode;
  category: TaskCategory;
  priority: TaskPriority;
  depends_on?: string[];
  claim_token?: string;
  claimed_at?: string;
}

export interface DecisionMetadata {
  display_id: string;
  project: string;
  status: DecisionStatus;
  source_task: string;
  impacts?: string[];
}

export interface PromptMetadata {
  display_id: string;
  project: string;
  task: string;
  prompt_status: PromptStatus;
  version?: number;
}

export interface CaptureMetadata {
  source: string;
  processed?: boolean;
}
