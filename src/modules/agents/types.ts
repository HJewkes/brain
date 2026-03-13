export type AgentStatus = 'pending' | 'active' | 'completed' | 'failed' | 'abandoned';

export interface AgentRecord {
  id: string;
  name: string;
  parent: string;
  status: AgentStatus;
  brain_task: string | null;
  claim_token: string | null;
  branch: string | null;
  worktree_path: string | null;
  /** JSON-serialized string[] */
  ownership: string | null;
  dod_spec: string | null;
  pid: number | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  summary: string | null;
  exit_reason: string | null;
}

export interface WorktreeAllocation {
  id: number;
  task_id: string;
  workstream: string | null;
  worktree_path: string;
  branch: string;
  claim_token: string | null;
  created_at: string;
}

export interface CreateAgentInput {
  name: string;
  parent: string;
  brain_task?: string;
  claim_token?: string;
  branch?: string;
  worktree_path?: string;
  /** Ownership paths */
  ownership?: string[];
  dod_spec?: string;
  pid?: number;
}

export interface AllocateWorktreeInput {
  task_id: string;
  workstream?: string;
  worktree_path: string;
  branch: string;
  claim_token?: string;
}
