import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import type { BrainDB } from '../../../src/services/brain-db.js';
import type { TaskReadinessScore } from '../../../src/modules/autoloop/types.js';
import {
  recordEnrichment,
  getLastEnrichment,
  filterAlreadyEnriched,
} from '../../../src/modules/autoloop/engine/enrichment-tracker.js';

function createTestDb(): BrainDB {
  const raw = new Database(':memory:');
  raw.exec(`
    CREATE TABLE autoloop_enrichments (
      task_id         TEXT PRIMARY KEY,
      enriched_at     TEXT NOT NULL,
      run_id          INTEGER,
      readiness_score REAL NOT NULL
    );
    CREATE INDEX idx_autoloop_enrichments_at
      ON autoloop_enrichments(enriched_at);
  `);
  return { rawDb: raw } as unknown as BrainDB;
}

function makeTask(taskId: string, overall: number): TaskReadinessScore {
  return {
    taskId,
    title: `Task ${taskId}`,
    description: 'Some description here that is long enough',
    category: 'implementation',
    overall,
    dimensions: {
      hasDescription: true,
      hasDependencies: false,
      hasRelatedResearch: false,
      hasDoneWhen: false,
      isSpecific: true,
    },
    suggestions: [],
  };
}

describe('enrichment-tracker', () => {
  let db: BrainDB;

  beforeEach(() => {
    db = createTestDb();
  });

  describe('recordEnrichment / getLastEnrichment', () => {
    it('records and retrieves enrichment', () => {
      recordEnrichment(db, 'VNM-01.01', 0.45);
      const record = getLastEnrichment(db, 'VNM-01.01');

      expect(record).not.toBeNull();
      expect(record!.taskId).toBe('VNM-01.01');
      expect(record!.readinessScore).toBe(0.45);
      expect(record!.enrichedAt).toBeTruthy();
    });

    it('returns null for unknown task', () => {
      expect(getLastEnrichment(db, 'VNM-99.99')).toBeNull();
    });

    it('updates on re-enrichment (upsert)', () => {
      recordEnrichment(db, 'VNM-01.01', 0.3);
      recordEnrichment(db, 'VNM-01.01', 0.5, 42);

      const record = getLastEnrichment(db, 'VNM-01.01');
      expect(record!.readinessScore).toBe(0.5);
      expect(record!.runId).toBe(42);
    });
  });

  describe('filterAlreadyEnriched', () => {
    it('passes through tasks with no enrichment record', () => {
      const tasks = [makeTask('VNM-01.01', 0.4), makeTask('VNM-01.02', 0.3)];
      const result = filterAlreadyEnriched(db, tasks, 30 * 60 * 1000);
      expect(result).toHaveLength(2);
    });

    it('filters out recently enriched task with same score', () => {
      recordEnrichment(db, 'VNM-01.01', 0.4);

      const tasks = [makeTask('VNM-01.01', 0.4), makeTask('VNM-01.02', 0.3)];
      const result = filterAlreadyEnriched(db, tasks, 30 * 60 * 1000);

      expect(result).toHaveLength(1);
      expect(result[0].taskId).toBe('VNM-01.02');
    });

    it('includes recently enriched task if score changed', () => {
      recordEnrichment(db, 'VNM-01.01', 0.4);

      const tasks = [makeTask('VNM-01.01', 0.55)]; // score changed
      const result = filterAlreadyEnriched(db, tasks, 30 * 60 * 1000);

      expect(result).toHaveLength(1);
      expect(result[0].taskId).toBe('VNM-01.01');
    });

    it('includes task when enrichment is past cooldown', () => {
      // Insert with old timestamp
      const rawDb = (db as unknown as { rawDb: Database.Database }).rawDb;
      const oldTime = new Date(Date.now() - 60 * 60 * 1000).toISOString(); // 1 hour ago
      rawDb
        .prepare(
          `INSERT INTO autoloop_enrichments (task_id, enriched_at, run_id, readiness_score)
           VALUES (?, ?, ?, ?)`
        )
        .run('VNM-01.01', oldTime, null, 0.4);

      const tasks = [makeTask('VNM-01.01', 0.4)];
      const result = filterAlreadyEnriched(db, tasks, 30 * 60 * 1000); // 30min cooldown

      expect(result).toHaveLength(1);
    });
  });
});
