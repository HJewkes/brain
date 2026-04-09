// PM note types
export type PmNoteType = 'project' | 'workstream' | 'task' | 'decision' | 'prompt' | 'capture';

// PM relation types
export type PmRelationType = 'depends_on' | 'blocks' | 'impacts' | 'supersedes';

// Stored states (persisted in metadata)
export type TaskStatus =
  | 'pending'
  | 'claimed'
  | 'in-progress'
  | 'pending-merge'
  | 'done'
  | 'blocked'
  | 'cancelled'
  | 'pruned'
  | 'skipped';
export type ProjectStatus = 'active' | 'paused' | 'completed' | 'archived';
export type WorkstreamStatus = 'active' | 'paused' | 'completed';
export type DecisionStatus = 'proposed' | 'accepted' | 'superseded' | 'rejected';
export type PromptStatus = 'stub' | 'draft' | 'current' | 'stale' | 'superseded';

// Virtual states (computed, never stored)
export type VirtualState = '+READY' | '+ELIGIBLE' | '+BLOCKED' | '+STALE' | '+OVERDUE';

// Task modes and categories
// Legacy values 'auto' and 'interactive' are retained for backward compatibility with
// existing task files. They are default/fallback modes not exposed in the routing table.
export type TaskMode = 'agent' | 'assisted' | 'human' | 'review' | 'auto' | 'interactive';
export type TaskCategory =
  | 'implementation'
  | 'testing'
  | 'documentation'
  | 'research'
  | 'review'
  | 'infrastructure'
  | 'configuration'
  | 'design'
  | 'migration'
  | 'feature'
  | 'improvement'
  | 'refactor'
  | 'bug';
export type TaskPriority = 'critical' | 'high' | 'medium' | 'low';

// Note visibility for search scoping
export type NoteVisibility = 'public' | 'contextual' | 'private';

// Embedding lifecycle states
export type EmbedStatus = 'queued' | 'embedding' | 'embedded' | 'stale' | 'failed';

// Activity types for state transition tracking
export type ActivityType =
  | 'onboard'
  | 'import'
  | 'delete'
  | 'complete'
  | 'claim'
  | 'start'
  | 'block'
  | 'unblock'
  | 'cancel'
  | 'reset';

export interface ProjectCommands {
  build?: string | null;
  test?: string | null;
  typecheck?: string | null;
  lint?: string | null;
}

export interface ProjectBranchPrefix {
  feature?: string;
  bug?: string;
  refactor?: string;
  infrastructure?: string;
}

// PM metadata interfaces (stored in notes.metadata JSON)
export interface ProjectMetadata {
  title?: string;
  display_id: string;
  prefix: string;
  status: ProjectStatus;
  phase?: string;
  wip_limit?: number;
  path?: string;
  remote?: string;
  default_branch?: string;
  review_threshold?: number;
  package_name?: string;
  package_manager?: string;
  commands?: ProjectCommands;
  branch_prefix?: ProjectBranchPrefix;
  notes?: Record<string, string>;
}

export interface WorkstreamMetadata {
  title?: string;
  description?: string;
  display_id: string;
  project: string;
  number: number;
  status: WorkstreamStatus;
}

export interface TaskMetadata {
  id?: string;
  title?: string;
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
  due_date?: string;
  milestone?: string;
  done_when?: string;
  acceptance_criteria?: string[];
  references?: string[];
  spawn_timestamp?: string;
}

export interface DecisionMetadata {
  title?: string;
  display_id: string;
  project: string;
  status: DecisionStatus;
  source_task: string;
  impacts?: string[];
}

export interface PromptMetadata {
  title?: string;
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

// Type guards for runtime validation of metadata values
const VALID_TASK_CATEGORIES = new Set<string>([
  'implementation',
  'testing',
  'documentation',
  'research',
  'review',
  'infrastructure',
  'configuration',
  'design',
  'migration',
  'feature',
  'improvement',
  'refactor',
  'bug',
]);

const VALID_TASK_MODES = new Set<string>([
  'agent',
  'assisted',
  'human',
  'review',
  'auto',
  'interactive',
]);

const VALID_TASK_STATUSES = new Set<string>([
  'pending',
  'claimed',
  'in-progress',
  'pending-merge',
  'done',
  'blocked',
  'cancelled',
  'pruned',
  'skipped',
]);

export function isValidTaskCategory(value: unknown): value is TaskCategory {
  return typeof value === 'string' && VALID_TASK_CATEGORIES.has(value);
}

export function isValidTaskMode(value: unknown): value is TaskMode {
  return typeof value === 'string' && VALID_TASK_MODES.has(value);
}

export function isValidTaskStatus(value: unknown): value is TaskStatus {
  return typeof value === 'string' && VALID_TASK_STATUSES.has(value);
}
