import type Database from 'better-sqlite3';
import { execFileSync } from 'node:child_process';

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

export interface PrResult {
  number: number;
  url: string;
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

export function getDeliveryForTask(db: Database.Database, taskId: string): DeliveryRecord | null {
  try {
    ensureTable(db);
  } catch {
    return null;
  }
  return (
    (db
      .prepare('SELECT * FROM delivery_states WHERE task_id = ? ORDER BY created_at DESC LIMIT 1')
      .get(taskId) as DeliveryRecord | undefined) ?? null
  );
}

export function requireGh(): void {
  try {
    execFileSync('gh', ['auth', 'status'], { stdio: 'pipe', timeout: 5000 });
  } catch {
    throw new Error('GitHub CLI not authenticated. Run: gh auth login');
  }
}

export function pushBranch(branch: string, projectDir: string): void {
  execFileSync('git', ['push', '-u', 'origin', branch], {
    cwd: projectDir,
    encoding: 'utf-8',
    stdio: 'pipe',
    timeout: 10_000,
  });
}

export function createPr(branch: string, title: string, projectDir: string): PrResult {
  // Check for existing PR first (idempotent)
  try {
    const existing = execFileSync('gh', ['pr', 'view', branch, '--json', 'number,url'], {
      cwd: projectDir,
      encoding: 'utf-8',
      stdio: 'pipe',
    });
    const data = JSON.parse(existing) as { number: number; url: string };
    if (data.number) return { number: data.number, url: data.url };
  } catch {
    // No existing PR — create one
  }

  const output = execFileSync(
    'gh',
    ['pr', 'create', '--head', branch, '--title', title, '--body', '', '--base', 'main'],
    { cwd: projectDir, encoding: 'utf-8', stdio: 'pipe' }
  );

  // gh pr create outputs the PR URL on stdout
  const url = output.trim();
  const match = /\/pull\/(\d+)$/.exec(url);
  const number = match ? parseInt(match[1], 10) : 0;
  return { number, url };
}

export function updateDeliveryStatus(
  db: Database.Database,
  agentId: string,
  status: DeliveryStatus,
  opts: Pick<RecordDeliveryOpts, 'pr_merged_at' | 'delivered_at'> = {}
): void {
  recordDelivery(db, agentId, { status, ...opts });
}

// Legacy stubs — retained for backward compatibility with existing callers.
// These were placeholders before VNM-48.264 and will be removed once all
// callers are migrated to the new API (initiateDelivery, pushBranch, etc.).

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

export function initiateDelivery(
  db: Database.Database,
  agentId: string,
  taskId: string,
  branch: string,
  projectDir: string
): DeliveryRecord {
  requireGh();

  recordDelivery(db, agentId, { status: 'in-progress', task_id: taskId, branch });

  try {
    pushBranch(branch, projectDir);
  } catch (err) {
    recordDelivery(db, agentId, { status: 'push-failed' });
    throw err;
  }
  recordDelivery(db, agentId, { status: 'pushed' });

  let pr: PrResult;
  try {
    pr = createPr(branch, taskId, projectDir);
  } catch (err) {
    recordDelivery(db, agentId, { status: 'pr-failed' });
    throw err;
  }
  recordDelivery(db, agentId, { status: 'pr-open', pr_number: pr.number, pr_url: pr.url });

  return getDelivery(db, agentId)!;
}
