import type Database from 'better-sqlite3';
import { execFileSync } from 'node:child_process';
import { sleep } from '../../utils/db.js';

const MAX_PUSH_RETRIES = 3;
const PUSH_BACKOFF_BASE_MS = 2_000;

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
  | 'redispatched'
  | 'review-paused';

export const VALID_DELIVERY_STATUSES: ReadonlySet<DeliveryStatus> = new Set([
  'in-progress',
  'pushed',
  'push-failed',
  'pr-open',
  'pr-failed',
  'conflicted',
  'merged',
  'delivered',
  'stalled',
  'redispatched',
  'review-paused',
]);

export type HumanSignal = 'approve' | 'needs_fixes';

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
  review_tier: string | null;
  review_score: number | null;
  fix_attempts: number;
  review_agent_id: string | null;
  stall_reason: string | null;
  human_signal: string | null;
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
  review_tier?: string | null;
  review_score?: number | null;
  fix_attempts?: number;
  review_agent_id?: string | null;
  stall_reason?: string | null;
  human_signal?: string | null;
}

export interface PrResult {
  number: number;
  url: string;
}

export function recordDelivery(
  db: Database.Database,
  agentId: string,
  opts: RecordDeliveryOpts
): void {
  if (!VALID_DELIVERY_STATUSES.has(opts.status)) {
    throw new Error(`Invalid delivery status: ${opts.status}`);
  }
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
        retry_count = COALESCE(?, retry_count),
        review_tier = COALESCE(?, review_tier),
        review_score = COALESCE(?, review_score),
        fix_attempts = COALESCE(?, fix_attempts),
        review_agent_id = COALESCE(?, review_agent_id),
        stall_reason = COALESCE(?, stall_reason),
        human_signal = COALESCE(?, human_signal),
        updated_at = ?
      WHERE agent_id = ?
    `
    ).run(
      opts.status,
      opts.pr_number ?? null,
      opts.pr_url ?? null,
      opts.pr_merged_at ?? null,
      opts.delivered_at ?? null,
      opts.retry_count ?? null,
      opts.review_tier ?? null,
      opts.review_score ?? null,
      opts.fix_attempts ?? null,
      opts.review_agent_id ?? null,
      opts.stall_reason ?? null,
      opts.human_signal ?? null,
      now,
      agentId
    );
  } else {
    db.prepare(
      `
      INSERT INTO delivery_states
        (agent_id, task_id, branch, status, pr_number, pr_url, pr_merged_at, delivered_at,
         retry_count, session_id, review_tier, review_score, fix_attempts, review_agent_id,
         stall_reason, human_signal, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      opts.review_tier ?? null,
      opts.review_score ?? null,
      opts.fix_attempts ?? 0,
      opts.review_agent_id ?? null,
      opts.stall_reason ?? null,
      opts.human_signal ?? null,
      now,
      now
    );
  }
}

export function getDelivery(db: Database.Database, agentId: string): DeliveryRecord | null {
  try {
    return (
      (db.prepare('SELECT * FROM delivery_states WHERE agent_id = ?').get(agentId) as
        | DeliveryRecord
        | undefined) ?? null
    );
  } catch {
    return null;
  }
}

export function getDeliveryForTask(db: Database.Database, taskId: string): DeliveryRecord | null {
  try {
    return (
      (db
        .prepare('SELECT * FROM delivery_states WHERE task_id = ? ORDER BY created_at DESC LIMIT 1')
        .get(taskId) as DeliveryRecord | undefined) ?? null
    );
  } catch {
    return null;
  }
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
    timeout: 60_000,
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
  opts: Pick<RecordDeliveryOpts, 'pr_merged_at' | 'delivered_at' | 'stall_reason'> = {}
): void {
  recordDelivery(db, agentId, { status, ...opts });
}

export async function initiateDelivery(
  db: Database.Database,
  agentId: string,
  taskId: string,
  branch: string,
  projectDir: string
): Promise<DeliveryRecord> {
  requireGh();

  recordDelivery(db, agentId, { status: 'in-progress', task_id: taskId, branch });

  for (let attempt = 1; attempt <= MAX_PUSH_RETRIES; attempt++) {
    try {
      pushBranch(branch, projectDir);
      break;
    } catch (err) {
      if (attempt === MAX_PUSH_RETRIES) {
        recordDelivery(db, agentId, { status: 'push-failed' });
        throw err;
      }
      await sleep(PUSH_BACKOFF_BASE_MS * Math.pow(2, attempt - 1));
    }
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

export type SignalResult =
  | { ok: true; delivery: DeliveryRecord }
  | { ok: false; reason: 'not-found' }
  | { ok: false; reason: 'not-paused'; delivery: DeliveryRecord };

export function signalDelivery(
  db: Database.Database,
  taskId: string,
  signal: HumanSignal
): SignalResult {
  if (signal !== 'approve' && signal !== 'needs_fixes') {
    throw new Error(`Invalid human signal: ${signal}`);
  }
  const delivery = getDeliveryForTask(db, taskId);
  if (!delivery) return { ok: false, reason: 'not-found' };
  if (delivery.status !== 'review-paused') {
    return { ok: false, reason: 'not-paused', delivery };
  }
  db.prepare('UPDATE delivery_states SET human_signal = ? WHERE agent_id = ?').run(
    signal,
    delivery.agent_id
  );
  return { ok: true, delivery: { ...delivery, human_signal: signal } };
}

export function readAndClearHumanSignal(
  db: Database.Database,
  agentId: string
): HumanSignal | null {
  const row = db
    .prepare('SELECT human_signal FROM delivery_states WHERE agent_id = ?')
    .get(agentId) as { human_signal: string | null } | undefined;
  if (!row?.human_signal) return null;
  const signal = row.human_signal as HumanSignal;
  db.prepare('UPDATE delivery_states SET human_signal = NULL WHERE agent_id = ?').run(agentId);
  return signal;
}
