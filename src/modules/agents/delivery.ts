import type Database from 'better-sqlite3';

export type DeliveryStatus =
  | 'in-progress'
  | 'pushed'
  | 'push-failed'
  | 'pr-open'
  | 'pr-failed'
  | 'conflicted'
  | 'merged'
  | 'delivered'
  | 'stalled'
  | 'redispatched';

export interface DeliveryRecord {
  agent_id: string;
  task_id: string | null;
  branch: string | null;
  status: DeliveryStatus;
  pr_number: number | null;
  pr_url: string | null;
  pr_merged_at: string | null;
  delivered_at: string | null;
  retry_count: number;
  session_id: string | null;
  created_at: string;
  updated_at: string;
}

interface RecordDeliveryOpts {
  status: DeliveryStatus;
  task_id?: string;
  branch?: string;
  pr_number?: number;
  pr_url?: string;
  pr_merged_at?: string;
  delivered_at?: string;
  retry_count?: number;
  session_id?: string;
}

function ensureTable(db: Database.Database): void {
  (db as unknown as { exec(sql: string): void }).exec(`
    CREATE TABLE IF NOT EXISTS delivery_states (
      agent_id     TEXT PRIMARY KEY REFERENCES agents(id),
      task_id      TEXT,
      branch       TEXT,
      status       TEXT NOT NULL DEFAULT 'in-progress',
      pr_number    INTEGER,
      pr_url       TEXT,
      pr_merged_at TEXT,
      delivered_at TEXT,
      retry_count  INTEGER NOT NULL DEFAULT 0,
      session_id   TEXT,
      created_at   TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_delivery_status ON delivery_states(status);
    CREATE INDEX IF NOT EXISTS idx_delivery_task ON delivery_states(task_id);
  `);
}

export function recordDelivery(
  db: Database.Database,
  agentId: string,
  opts: RecordDeliveryOpts
): void {
  ensureTable(db);
  const now = new Date().toISOString();
  const existing = db.prepare('SELECT * FROM delivery_states WHERE agent_id = ?').get(agentId) as
    | DeliveryRecord
    | undefined;
  if (existing) {
    db.prepare(
      `
      UPDATE delivery_states SET
        status = ?, pr_number = COALESCE(?, pr_number), pr_url = COALESCE(?, pr_url),
        pr_merged_at = COALESCE(?, pr_merged_at), delivered_at = COALESCE(?, delivered_at),
        retry_count = COALESCE(?, retry_count), updated_at = ?
      WHERE agent_id = ?
    `
    ).run(
      opts.status,
      opts.pr_number ?? null,
      opts.pr_url ?? null,
      opts.pr_merged_at ?? null,
      opts.delivered_at ?? null,
      opts.retry_count ?? null,
      now,
      agentId
    );
  } else {
    db.prepare(
      `
      INSERT INTO delivery_states
        (agent_id, task_id, branch, status, pr_number, pr_url, pr_merged_at, delivered_at, retry_count, session_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
    ).run(
      agentId,
      opts.task_id ?? null,
      opts.branch ?? null,
      opts.status,
      opts.pr_number ?? null,
      opts.pr_url ?? null,
      opts.pr_merged_at ?? null,
      opts.delivered_at ?? null,
      opts.retry_count ?? 0,
      opts.session_id ?? null,
      now,
      now
    );
  }
}

export function getDelivery(db: Database.Database, agentId: string): DeliveryRecord | null {
  try {
    ensureTable(db);
  } catch {
    return null;
  }
  return (
    (db.prepare('SELECT * FROM delivery_states WHERE agent_id = ?').get(agentId) as
      | DeliveryRecord
      | undefined) ?? null
  );
}

// Stubs for push/PR operations — implemented in VNM-48.264

export function initiateTaskDelivery(..._args: unknown[]): never {
  throw new Error('Not implemented');
}

export function getDeliveryStatus(..._args: unknown[]): never {
  throw new Error('Not implemented');
}

export function allocateDeliveryWorktree(..._args: unknown[]): never {
  throw new Error('Not implemented');
}

export function releaseDeliveryWorktree(..._args: unknown[]): never {
  throw new Error('Not implemented');
}

export function pushTaskBranch(..._args: unknown[]): never {
  throw new Error('Not implemented');
}

export function createTaskPR(..._args: unknown[]): never {
  throw new Error('Not implemented');
}

export function autoMergePR(..._args: unknown[]): never {
  throw new Error('Not implemented');
}

export function completeTaskDelivery(..._args: unknown[]): never {
  throw new Error('Not implemented');
}
