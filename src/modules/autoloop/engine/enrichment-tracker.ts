import type { BrainDB } from '../../../services/brain-db.js';
import { getRawDb } from '../../../utils/db.js';
import type { TaskReadinessScore } from '../types.js';

export interface EnrichmentRecord {
  taskId: string;
  enrichedAt: string;
  runId: number | null;
  readinessScore: number;
}

interface RawEnrichmentRow {
  task_id: string;
  enriched_at: string;
  run_id: number | null;
  readiness_score: number;
}

/**
 * Record that a task was enriched in this run.
 * Uses REPLACE to update if the task was previously enriched.
 */
export function recordEnrichment(
  db: BrainDB,
  taskId: string,
  readinessScore: number,
  runId?: number
): void {
  try {
    const rawDb = getRawDb(db);
    rawDb
      .prepare(
        `INSERT OR REPLACE INTO autoloop_enrichments
         (task_id, enriched_at, run_id, readiness_score)
         VALUES (?, ?, ?, ?)`
      )
      .run(taskId, new Date().toISOString(), runId ?? null, readinessScore);
  } catch {
    // Best-effort tracking
  }
}

/**
 * Get the last enrichment record for a task, if any.
 */
export function getLastEnrichment(db: BrainDB, taskId: string): EnrichmentRecord | null {
  try {
    const rawDb = getRawDb(db);
    const row = rawDb
      .prepare(
        `SELECT task_id, enriched_at, run_id, readiness_score
         FROM autoloop_enrichments
         WHERE task_id = ?`
      )
      .get(taskId) as RawEnrichmentRow | undefined;

    return row ? mapRow(row) : null;
  } catch {
    return null;
  }
}

/**
 * Filter out tasks that were already enriched within the cooldown period
 * and whose readiness score hasn't changed since enrichment.
 */
export function filterAlreadyEnriched(
  db: BrainDB,
  tasks: TaskReadinessScore[],
  cooldownMs: number
): TaskReadinessScore[] {
  const now = Date.now();

  return tasks.filter((task) => {
    const record = getLastEnrichment(db, task.taskId);
    if (!record) return true;

    const enrichedAge = now - new Date(record.enrichedAt).getTime();
    if (enrichedAge >= cooldownMs) return true;

    // Re-process if readiness score changed (task was modified externally)
    if (task.overall !== record.readinessScore) return true;

    return false;
  });
}

function mapRow(row: RawEnrichmentRow): EnrichmentRecord {
  return {
    taskId: row.task_id,
    enrichedAt: row.enriched_at,
    runId: row.run_id,
    readinessScore: row.readiness_score,
  };
}
