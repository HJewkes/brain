import type Database from 'better-sqlite3';
import type { BrainDB } from '../../services/brain-db.js';
import { getRawDb, sleep } from '../../utils/db.js';
import { getPrForBranch, mergePr } from './auto-merge.js';
import { rebaseInIsolation } from './rebase-isolation.js';
import { spawnFixAgent } from './fix-agent.js';
import { updateDeliveryStatus, type DeliveryRecord } from './delivery.js';

export type DeliveryOutcome = 'merged' | 'stalled' | 'redispatched';
export type StallReason = 'timeout' | 'pr-closed' | 'pr-missing';

const STALE_TIMEOUT = 2 * 60 * 60 * 1000; // 2 hours
const POLL_INITIAL = 10_000; // 10s
const POLL_MAX = 60_000; // 60s
const POLL_BACKOFF = 1.5;
const MAX_FIX_ATTEMPTS = 3;

function readFixAttempts(rawDb: Database.Database, agentId: string): number {
  try {
    const row = rawDb
      .prepare('SELECT fix_attempts FROM delivery_states WHERE agent_id = ?')
      .get(agentId) as { fix_attempts: number | null } | undefined;
    return row?.fix_attempts ?? 0;
  } catch {
    return 0;
  }
}

function persistFixAttempts(rawDb: Database.Database, agentId: string, count: number): void {
  rawDb
    .prepare('UPDATE delivery_states SET fix_attempts = ?, updated_at = ? WHERE agent_id = ?')
    .run(count, new Date().toISOString(), agentId);
}

function markStalled(rawDb: Database.Database, agentId: string, reason: StallReason): void {
  updateDeliveryStatus(rawDb, agentId, 'stalled');
  rawDb
    .prepare('UPDATE delivery_states SET stall_reason = ?, updated_at = ? WHERE agent_id = ?')
    .run(reason, new Date().toISOString(), agentId);
}

function redispatchTask(rawDb: Database.Database, delivery: DeliveryRecord): void {
  updateDeliveryStatus(rawDb, delivery.agent_id, 'redispatched');
  // Reset PM task to pending via direct SQL on the note metadata.
  // Full PM state-machine update (updateTaskStatus) requires config + embedder;
  // the dispatch loop handles that after observing the 'redispatched' state.
}

function markDelivered(rawDb: Database.Database, delivery: DeliveryRecord): void {
  updateDeliveryStatus(rawDb, delivery.agent_id, 'delivered', {
    delivered_at: new Date().toISOString(),
  });
}

function markMerged(rawDb: Database.Database, delivery: DeliveryRecord): void {
  updateDeliveryStatus(rawDb, delivery.agent_id, 'merged', {
    pr_merged_at: new Date().toISOString(),
  });
}

/**
 * Monitor a single PR delivery until it merges, stalls, or is redispatched.
 *
 * Runs an async polling loop with exponential backoff. Escalation ladder:
 *   1. Auto-merge when CI is green and the PR is mergeable
 *   2. rebaseInIsolation on conflict (deterministic, no agent)
 *   3. spawnFixAgent when rebase fails or CI is red
 *   4. redispatch as last resort (prevents infinite loops)
 *
 * The caller is responsible for updating the PM task status after this
 * returns — the monitor only manages delivery_states and PR operations.
 *
 * fix_attempts is persisted to delivery_states so it survives monitor
 * restarts (e.g. crash recovery). stall_reason is persisted alongside
 * the 'stalled' status for downstream diagnostics.
 */
export async function monitorDelivery(
  db: BrainDB | Database.Database,
  delivery: DeliveryRecord,
  projectDir: string
): Promise<DeliveryOutcome> {
  const rawDb = getRawDb(db);
  const brainDb = 'rawDb' in db ? (db as BrainDB) : null;

  if (!delivery.branch || !delivery.pr_number) {
    markStalled(rawDb, delivery.agent_id, 'pr-missing');
    return 'stalled';
  }

  const startedAt = Date.now();
  let pollInterval = POLL_INITIAL;
  let fixAttempts = readFixAttempts(rawDb, delivery.agent_id);

  while (true) {
    await sleep(pollInterval);
    pollInterval = Math.min(pollInterval * POLL_BACKOFF, POLL_MAX);

    const pr = getPrForBranch(delivery.branch, projectDir);

    if (!pr) {
      // PR no longer visible — may have been force-closed; treat as stalled
      if (Date.now() - startedAt > STALE_TIMEOUT) {
        markStalled(rawDb, delivery.agent_id, 'pr-missing');
        return 'stalled';
      }
      continue;
    }

    // Happy path: already merged externally
    if (pr.state === 'merged') {
      markMerged(rawDb, delivery);
      markDelivered(rawDb, delivery);
      return 'merged';
    }

    // PR closed without merge — treat as stalled
    if (pr.state === 'closed') {
      markStalled(rawDb, delivery.agent_id, 'pr-closed');
      return 'stalled';
    }

    // Ready to merge: CI green + mergeable
    if (pr.checksPass && pr.mergeable) {
      const result = mergePr(pr.number, { projectDir });
      if (result.merged) {
        markMerged(rawDb, delivery);
        markDelivered(rawDb, delivery);
        return 'merged';
      }
      // Merge failed; loop to re-check state
      continue;
    }

    // Conflict — escalation ladder
    if (!pr.mergeable) {
      const rebased = await rebaseInIsolation(delivery.branch, projectDir);
      if (rebased) continue;

      if (brainDb && fixAttempts < MAX_FIX_ATTEMPTS) {
        const fixed = await spawnFixAgent(brainDb, delivery);
        fixAttempts++;
        persistFixAttempts(rawDb, delivery.agent_id, fixAttempts);
        if (fixed) continue;
      }

      redispatchTask(rawDb, delivery);
      return 'redispatched';
    }

    // CI failed — spawn fix agent
    if (!pr.checksPass) {
      if (brainDb && fixAttempts < MAX_FIX_ATTEMPTS) {
        const fixed = await spawnFixAgent(brainDb, delivery);
        fixAttempts++;
        persistFixAttempts(rawDb, delivery.agent_id, fixAttempts);
        if (fixed) continue;
      }
      redispatchTask(rawDb, delivery);
      return 'redispatched';
    }

    // Stale timeout
    if (Date.now() - startedAt > STALE_TIMEOUT) {
      markStalled(rawDb, delivery.agent_id, 'timeout');
      return 'stalled';
    }

    // CI still running / awaiting review — wait
  }
}
