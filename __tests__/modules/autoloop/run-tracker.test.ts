import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import type { BrainDB } from '../../../src/services/brain-db.js';
import type { AutoloopReport } from '../../../src/modules/autoloop/types.js';
import {
  recordAutoloopRun,
  getLastRunTime,
  isOnCooldown,
  getRunHistory,
} from '../../../src/modules/autoloop/engine/run-tracker.js';

function createTestDb(): BrainDB {
  const rawDb = new Database(':memory:');
  rawDb.exec(`
    CREATE TABLE IF NOT EXISTS autoloop_runs (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      loop_type   TEXT    NOT NULL,
      status      TEXT    NOT NULL,
      started_at  TEXT    NOT NULL,
      completed_at TEXT,
      duration_ms INTEGER,
      report_note_id TEXT,
      UNIQUE(loop_type, started_at)
    );
    CREATE INDEX IF NOT EXISTS idx_autoloop_runs_type
      ON autoloop_runs(loop_type, started_at);
  `);
  return { rawDb } as unknown as BrainDB;
}

function makeReport(overrides: Partial<AutoloopReport> = {}): AutoloopReport {
  return {
    loopType: 'session-review',
    status: 'completed',
    startedAt: '2026-04-11T10:00:00.000Z',
    completedAt: '2026-04-11T10:05:00.000Z',
    durationMs: 300_000,
    sessionsReviewed: 3,
    insightsExtracted: 5,
    tasksUpdated: 0,
    notesCreated: 5,
    errors: [],
    ...overrides,
  };
}

describe('run-tracker', () => {
  let db: BrainDB;

  beforeEach(() => {
    db = createTestDb();
  });

  afterEach(() => {
    (db as unknown as { rawDb: Database.Database }).rawDb.close();
  });

  describe('recordAutoloopRun', () => {
    it('inserts a run record', () => {
      const report = makeReport();
      recordAutoloopRun(db, report, 'note-123');

      const runs = getRunHistory(db);
      expect(runs).toHaveLength(1);
      expect(runs[0].loopType).toBe('session-review');
      expect(runs[0].status).toBe('completed');
      expect(runs[0].reportNoteId).toBe('note-123');
    });

    it('records without a report note id', () => {
      recordAutoloopRun(db, makeReport());

      const runs = getRunHistory(db);
      expect(runs).toHaveLength(1);
      expect(runs[0].reportNoteId).toBeNull();
    });

    it('replaces duplicate (same loop_type + started_at)', () => {
      const report = makeReport();
      recordAutoloopRun(db, report, 'note-1');
      recordAutoloopRun(db, { ...report, status: 'failed' }, 'note-2');

      const runs = getRunHistory(db);
      expect(runs).toHaveLength(1);
      expect(runs[0].status).toBe('failed');
      expect(runs[0].reportNoteId).toBe('note-2');
    });
  });

  describe('getLastRunTime', () => {
    it('returns null when no runs exist', () => {
      expect(getLastRunTime(db, 'session-review')).toBeNull();
    });

    it('returns the most recent completed_at', () => {
      recordAutoloopRun(
        db,
        makeReport({ startedAt: '2026-04-10T08:00:00Z', completedAt: '2026-04-10T08:05:00Z' })
      );
      recordAutoloopRun(
        db,
        makeReport({ startedAt: '2026-04-11T10:00:00Z', completedAt: '2026-04-11T10:05:00Z' })
      );

      const last = getLastRunTime(db, 'session-review');
      expect(last).toBeInstanceOf(Date);
      expect(last!.toISOString()).toBe('2026-04-11T10:05:00.000Z');
    });

    it('filters by loop type', () => {
      recordAutoloopRun(
        db,
        makeReport({ loopType: 'session-review', completedAt: '2026-04-11T10:00:00Z' })
      );
      recordAutoloopRun(
        db,
        makeReport({ loopType: 'task-consolidation', completedAt: '2026-04-11T12:00:00Z' })
      );

      const last = getLastRunTime(db, 'session-review');
      expect(last!.toISOString()).toBe('2026-04-11T10:00:00.000Z');
    });
  });

  describe('isOnCooldown', () => {
    it('returns false when no runs exist', () => {
      expect(isOnCooldown(db, 'session-review', 60_000)).toBe(false);
    });

    it('returns true when last run is within cooldown window', () => {
      const now = new Date().toISOString();
      recordAutoloopRun(db, makeReport({ completedAt: now }));

      expect(isOnCooldown(db, 'session-review', 60_000)).toBe(true);
    });

    it('returns false when last run is older than cooldown window', () => {
      const old = new Date(Date.now() - 120_000).toISOString();
      recordAutoloopRun(db, makeReport({ completedAt: old }));

      expect(isOnCooldown(db, 'session-review', 60_000)).toBe(false);
    });
  });

  describe('getRunHistory', () => {
    it('returns empty array when no runs exist', () => {
      expect(getRunHistory(db)).toEqual([]);
    });

    it('returns runs ordered by started_at descending', () => {
      recordAutoloopRun(db, makeReport({ startedAt: '2026-04-10T08:00:00Z' }));
      recordAutoloopRun(db, makeReport({ startedAt: '2026-04-11T10:00:00Z' }));
      recordAutoloopRun(db, makeReport({ startedAt: '2026-04-09T06:00:00Z' }));

      const runs = getRunHistory(db);
      expect(runs).toHaveLength(3);
      expect(runs[0].startedAt).toBe('2026-04-11T10:00:00Z');
      expect(runs[1].startedAt).toBe('2026-04-10T08:00:00Z');
      expect(runs[2].startedAt).toBe('2026-04-09T06:00:00Z');
    });

    it('respects limit option', () => {
      recordAutoloopRun(db, makeReport({ startedAt: '2026-04-10T08:00:00Z' }));
      recordAutoloopRun(db, makeReport({ startedAt: '2026-04-11T10:00:00Z' }));
      recordAutoloopRun(db, makeReport({ startedAt: '2026-04-09T06:00:00Z' }));

      const runs = getRunHistory(db, { limit: 2 });
      expect(runs).toHaveLength(2);
    });

    it('filters by loop type', () => {
      recordAutoloopRun(
        db,
        makeReport({ loopType: 'session-review', startedAt: '2026-04-10T08:00:00Z' })
      );
      recordAutoloopRun(
        db,
        makeReport({ loopType: 'task-consolidation', startedAt: '2026-04-11T10:00:00Z' })
      );

      const runs = getRunHistory(db, { loopType: 'task-consolidation' });
      expect(runs).toHaveLength(1);
      expect(runs[0].loopType).toBe('task-consolidation');
    });

    it('maps row fields correctly', () => {
      recordAutoloopRun(
        db,
        makeReport({
          startedAt: '2026-04-11T10:00:00Z',
          completedAt: '2026-04-11T10:05:00Z',
          durationMs: 300_000,
        }),
        'note-abc'
      );

      const [run] = getRunHistory(db);
      expect(run.loopType).toBe('session-review');
      expect(run.status).toBe('completed');
      expect(run.startedAt).toBe('2026-04-11T10:00:00Z');
      expect(run.completedAt).toBe('2026-04-11T10:05:00Z');
      expect(run.durationMs).toBe(300_000);
      expect(run.reportNoteId).toBe('note-abc');
      expect(typeof run.id).toBe('number');
    });
  });
});
