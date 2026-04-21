import type Database from 'better-sqlite3';
import type { BrainDB } from '../../services/brain-db.js';
import { getRawDb, sleep } from '../../utils/db.js';
import { getPrForBranch, mergePr } from './auto-merge.js';
import { rebaseInIsolation } from './rebase-isolation.js';
import { spawnFixAgent } from './fix-agent.js';
import { updateDeliveryStatus, type DeliveryRecord } from './delivery.js';

export type DeliveryOutcome = 'merged' | 'stalled' | 'redispatched';

const STALE_TIMEOUT = 2 * 60 * 60 * 1000; // 2 hours
const POLL_INITIAL = 10_000; // 10s
const POLL_MAX = 60_000; // 60s
const POLL_BACKOFF = 1.5;
const MAX_FIX_ATTEMPTS = 3;

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
 */
export async function monitorDelivery(
  db: BrainDB | Database.Database,
  delivery: DeliveryRecord,
  projectDir: string
): Promise<DeliveryOutcome> {
  const rawDb = getRawDb(db);
  const brainDb = 'rawDb' in db ? (db as BrainDB) : null;

  if (!delivery.branch || !delivery.pr_number) {
    updateDeliveryStatus(rawDb, delivery.agent_id, 'stalled');
    return 'stalled';
  }

  const startedAt = Date.now();
  let pollInterval = POLL_INITIAL;
  let fixAttempts = 0;

  while (true) {
    await sleep(pollInterval);
    pollInterval = Math.min(pollInterval * POLL_BACKOFF, POLL_MAX);

    const pr = getPrForBranch(delivery.branch, projectDir);

    if (!pr) {
      // PR no longer visible — may have been force-closed; treat as stalled
      if (Date.now() - startedAt > STALE_TIMEOUT) {
        updateDeliveryStatus(rawDb, delivery.agent_id, 'stalled');
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
      updateDeliveryStatus(rawDb, delivery.agent_id, 'stalled');
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
      process.stderr.write(
        `[delivery-monitor] ${delivery.task_id} PR #${delivery.pr_number}: ` +
          `checks=${pr.checksPass ? 'pass' : 'fail'}, mergeable=${pr.mergeable}, ` +
          `reason=${pr.mergeStateStatus ?? 'unknown'}\n`
      );
      const rebased = await rebaseInIsolation(delivery.branch, projectDir);
      if (rebased) continue;

      if (brainDb && fixAttempts < MAX_FIX_ATTEMPTS) {
        fixAttempts++;
        const fixed = await spawnFixAgent(brainDb, delivery);
        if (fixed) continue;
      }

      redispatchTask(rawDb, delivery);
      return 'redispatched';
    }

    // CI failed — spawn fix agent
    if (!pr.checksPass) {
      if (brainDb && fixAttempts < MAX_FIX_ATTEMPTS) {
        fixAttempts++;
        const fixed = await spawnFixAgent(brainDb, delivery);
        if (fixed) continue;
      }
      redispatchTask(rawDb, delivery);
      return 'redispatched';
    }

    // Stale timeout
    if (Date.now() - startedAt > STALE_TIMEOUT) {
      updateDeliveryStatus(rawDb, delivery.agent_id, 'stalled');
      return 'stalled';
    }

    // CI still running / awaiting review — wait
  }
}
