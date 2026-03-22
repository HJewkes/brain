import { randomUUID } from 'node:crypto';
import type {
  AgentRecord,
  AgentStatus,
  WorktreeAllocation,
  CreateAgentInput,
  AllocateWorktreeInput,
} from './types.js';

interface PreparedStatement {
  run(...args: unknown[]): { changes: number };
  get(...args: unknown[]): unknown;
  all(...args: unknown[]): unknown[];
}

interface RawDb {
  prepare(sql: string): PreparedStatement;
}

/** Extract the underlying better-sqlite3 Database from a BrainDB instance. */
function toRaw(db: unknown): RawDb {
  // BrainDB exposes a private `db` field; cast through unknown to reach it
  const asInner = (db as { db?: RawDb }).db;
  return asInner ?? (db as RawDb);
}

export function createAgent(db: unknown, input: CreateAgentInput): string {
  const raw = toRaw(db);
  const id = randomUUID();
  const now = new Date().toISOString();
  const ownership = input.ownership ? JSON.stringify(input.ownership) : null;

  raw
    .prepare(
      `INSERT INTO agents
         (id, name, parent, status, brain_task, claim_token, branch, worktree_path,
          ownership, dod_spec, pid, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
    )
    .run(
      id,
      input.name,
      input.parent,
      'pending',
      input.brain_task ?? null,
      input.claim_token ?? null,
      input.branch ?? null,
      input.worktree_path ?? null,
      ownership,
      input.dod_spec ?? null,
      input.pid ?? null,
      now
    );

  return id;
}

export function getAgent(db: unknown, id: string): AgentRecord | null {
  const raw = toRaw(db);
  const row = raw.prepare('SELECT * FROM agents WHERE id = ?').get(id);
  return row ? (row as AgentRecord) : null;
}

export function listAgents(db: unknown, filter?: { status?: AgentStatus }): AgentRecord[] {
  const raw = toRaw(db);
  if (filter?.status) {
    return raw
      .prepare('SELECT * FROM agents WHERE status = ? ORDER BY created_at DESC')
      .all(filter.status) as AgentRecord[];
  }
  return raw.prepare('SELECT * FROM agents ORDER BY created_at DESC').all() as AgentRecord[];
}

export function updateAgentStatus(
  db: unknown,
  id: string,
  status: AgentStatus,
  extras?: {
    summary?: string;
    exit_reason?: string;
    pid?: number;
    started_at?: string;
    completed_at?: string;
  }
): void {
  const raw = toRaw(db);
  const now = new Date().toISOString();

  const started_at = extras?.started_at ?? (status === 'active' ? now : undefined);
  const completed_at =
    extras?.completed_at ??
    (['completed', 'failed', 'abandoned'].includes(status) ? now : undefined);

  raw
    .prepare(
      `UPDATE agents
       SET status       = ?,
           summary      = COALESCE(?, summary),
           exit_reason  = COALESCE(?, exit_reason),
           pid          = COALESCE(?, pid),
           started_at   = COALESCE(?, started_at),
           completed_at = COALESCE(?, completed_at)
       WHERE id = ?`
    )
    .run(
      status,
      extras?.summary ?? null,
      extras?.exit_reason ?? null,
      extras?.pid ?? null,
      started_at ?? null,
      completed_at ?? null,
      id
    );
}

export function allocateWorktree(db: unknown, input: AllocateWorktreeInput): void {
  const raw = toRaw(db);
  const now = new Date().toISOString();

  raw
    .prepare(
      `INSERT OR REPLACE INTO worktree_allocations
         (task_id, workstream, worktree_path, branch, claim_token, created_at)
       VALUES (?,?,?,?,?,?)`
    )
    .run(
      input.task_id,
      input.workstream ?? null,
      input.worktree_path,
      input.branch,
      input.claim_token ?? null,
      now
    );
}

export function releaseWorktree(db: unknown, taskId: string): void {
  const raw = toRaw(db);
  raw.prepare('DELETE FROM worktree_allocations WHERE task_id = ?').run(taskId);
}

export function getWorktreeAllocations(db: unknown): WorktreeAllocation[] {
  const raw = toRaw(db);
  return raw
    .prepare('SELECT * FROM worktree_allocations ORDER BY created_at')
    .all() as WorktreeAllocation[];
}

export function countActiveAgents(db: unknown): number {
  const raw = toRaw(db);
  const row = raw.prepare("SELECT COUNT(*) as n FROM agents WHERE status = 'active'").get() as {
    n: number;
  };
  return row.n;
}

/** Retrieve full context object or a specific key for an agent. */
export function getAgentContext(
  db: unknown,
  agentId: string,
  key?: string
): Record<string, unknown> | unknown {
  const raw = toRaw(db);
  const row = raw.prepare('SELECT context FROM agents WHERE id = ?').get(agentId) as
    | { context: string }
    | undefined;
  if (!row) return undefined;

  const ctx = JSON.parse(row.context) as Record<string, unknown>;
  if (key !== undefined) return ctx[key];
  return ctx;
}

/** Merge a key/value pair into an agent's context JSON. */
export function setAgentContext(db: unknown, agentId: string, key: string, value: unknown): void {
  const raw = toRaw(db);
  const row = raw.prepare('SELECT context FROM agents WHERE id = ?').get(agentId) as
    | { context: string }
    | undefined;
  if (!row) return;

  const ctx = JSON.parse(row.context) as Record<string, unknown>;
  ctx[key] = value;

  raw.prepare('UPDATE agents SET context = ? WHERE id = ?').run(JSON.stringify(ctx), agentId);
}
