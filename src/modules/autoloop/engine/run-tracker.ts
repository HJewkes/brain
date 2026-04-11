import type { BrainDB } from '../../../services/brain-db.js';
import { getRawDb } from '../../../utils/db.js';
import type { AutoloopReport, AutoloopType } from '../types.js';

export interface RunRecord {
  id: number;
  loopType: AutoloopType;
  status: string;
  startedAt: string;
  completedAt: string | null;
  durationMs: number | null;
  reportNoteId: string | null;
}

export function recordAutoloopRun(
  db: BrainDB,
  report: AutoloopReport,
  reportNoteId?: string
): void {
  try {
    const rawDb = getRawDb(db);
    rawDb
      .prepare(
        `INSERT OR REPLACE INTO autoloop_runs
         (loop_type, status, started_at, completed_at, duration_ms, report_note_id)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(
        report.loopType,
        report.status,
        report.startedAt,
        report.completedAt,
        report.durationMs,
        reportNoteId ?? null
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

export function isOnCooldown(db: BrainDB, loopType: AutoloopType, cooldownMs: number): boolean {
  const lastRun = getLastRunTime(db, loopType);
  if (!lastRun) return false;
  return Date.now() - lastRun.getTime() < cooldownMs;
}

export function getRunHistory(
  db: BrainDB,
  opts?: { loopType?: AutoloopType; limit?: number }
): RunRecord[] {
  try {
    const rawDb = getRawDb(db);
    const limit = opts?.limit ?? 20;

    if (opts?.loopType) {
      const rows = rawDb
        .prepare(
          `SELECT id, loop_type, status, started_at, completed_at, duration_ms, report_note_id
           FROM autoloop_runs
           WHERE loop_type = ?
           ORDER BY started_at DESC
           LIMIT ?`
        )
        .all(opts.loopType, limit) as RawRunRow[];
      return rows.map(mapRow);
    }

    const rows = rawDb
      .prepare(
        `SELECT id, loop_type, status, started_at, completed_at, duration_ms, report_note_id
         FROM autoloop_runs
         ORDER BY started_at DESC
         LIMIT ?`
      )
      .all(limit) as RawRunRow[];
    return rows.map(mapRow);
  } catch {
    return [];
  }
}

interface RawRunRow {
  id: number;
  loop_type: string;
  status: string;
  started_at: string;
  completed_at: string | null;
  duration_ms: number | null;
  report_note_id: string | null;
}

function mapRow(row: RawRunRow): RunRecord {
  return {
    id: row.id,
    loopType: row.loop_type as AutoloopType,
    status: row.status,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    durationMs: row.duration_ms,
    reportNoteId: row.report_note_id,
  };
}
