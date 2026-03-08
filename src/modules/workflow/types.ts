import type { TaskCategory, TaskMode, TaskPriority } from '../pm/types.js';

export interface WorkflowStep {
  id: string;
  name: string;
  template?: string;
  category?: TaskCategory;
  mode?: TaskMode;
  priority?: TaskPriority;
  gates?: Gate[];
  outputs?: string[];
  metadata?: Record<string, unknown>;
}

export interface WorkflowEdge {
  from: string;
  to: string;
  condition?: string;
}

export interface Gate {
  type: 'task-complete' | 'file-exists' | 'cli-pass' | 'human-approval' | 'custom';
  target: string;
  command?: string;
  timeout?: number;
  description?: string;
}

export interface WorkflowDefinition {
  version: number;
  name: string;
  description: string;
  steps: WorkflowStep[];
  edges: WorkflowEdge[];
  parameters?: WorkflowParameter[];
}

export interface WorkflowParameter {
  name: string;
  description: string;
  required: boolean;
  default?: string;
}

export interface WorkflowNoteMetadata {
  display_id: string;
  name: string;
  version: number;
  registration_status: 'draft' | 'registered' | 'deprecated';
  step_count: number;
  edge_count: number;
}

export interface WorkflowInstanceMetadata {
  workflow_id: string;
  workflow_version: number;
  instance_status: 'placeholder' | 'expanded' | 'executing' | 'completed' | 'collapsed';
  context: Record<string, string>;
}

export interface ResourceMetadata {
  display_id: string;
  resource_type: 'worktree' | 'branch' | 'ownership' | 'wip-slot';
  project: string;
  status: 'active' | 'released';
  data: Record<string, unknown>;
}

export interface FastPathResource {
  id: string;
  type: string;
  project: string;
  status: string;
  data: Record<string, unknown>;
  updatedAt: string;
}
