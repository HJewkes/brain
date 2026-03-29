import type Database from 'better-sqlite3';
import type { BrainDB } from '../../../services/brain-db.js';
import type { AutoloopReport, AutoloopType } from '../types.js';

function getRawDb(db: BrainDB): Database.Database {
  return (db as unknown as { db: Database.Database }).db;
}

export function recordAutoloopRun(db: BrainDB, report: AutoloopReport): void {
  try {
    const rawDb = getRawDb(db);
    rawDb
      .prepare(
        `INSERT OR REPLACE INTO autoloop_runs
         (loop_type, status, started_at, completed_at, duration_ms)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(
        report.loopType,
        report.status,
        report.startedAt,
        report.completedAt,
        report.durationMs
      );
  } catch {
    // Best-effort tracking
  }
}

export function getLastRunTime(db: BrainDB, loopType: AutoloopType): Date | null {
  try {
    const rawDb = getRawDb(db);
    const row = rawDb
      .prepare(
        `SELECT completed_at FROM autoloop_runs
         WHERE loop_type = ?
         ORDER BY completed_at DESC
         LIMIT 1`
      )
      .get(loopType) as { completed_at: string } | undefined;

    return row ? new Date(row.completed_at) : null;
  } catch {
    return null;
  }
}

export function isOnCooldown(
  db: BrainDB,
  loopType: AutoloopType,
  cooldownMs: number
): boolean {
  const lastRun = getLastRunTime(db, loopType);
  if (!lastRun) return false;
  return Date.now() - lastRun.getTime() < cooldownMs;
}
