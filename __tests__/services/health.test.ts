import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { makeNote, makeInboxItem, createTestDb } from '../helpers.js';
import { BrainDB } from '../../src/services/brain-db.js';
import {
  checkDatabase,
  checkEmbedder,
  checkLlm,
  checkInbox,
  checkStaleNotes,
  checkFilesystemSync,
  runAllChecks,
} from '../../src/services/health.js';

describe('health checks', () => {
  let db: BrainDB;

  beforeEach(() => {
    ({ db } = createTestDb());
  });

  afterEach(() => {
    db.close();
  });

  describe('checkDatabase', () => {
    it('returns ok for valid database', () => {
      const result = checkDatabase(db);
      expect(result.status).toBe('ok');
      expect(result.name).toBe('Database');
    });
  });

  describe('checkEmbedder', () => {
    it('returns ok for local embedder', () => {
      const result = checkEmbedder('local');
      expect(result.status).toBe('ok');
      expect(result.message).toContain('local');
    });

    it('returns ok for ollama embedder', () => {
      const result = checkEmbedder('ollama');
      expect(result.status).toBe('ok');
    });
  });

  describe('checkLlm', () => {
    it('returns ok when ollama has the model', () => {
      const result = checkLlm({ running: true, models: ['qwen2.5:3b'] }, 'qwen2.5:3b');
      expect(result.status).toBe('ok');
    });

    it('returns ok when model matches by tag suffix', () => {
      const result = checkLlm({ running: true, models: ['qwen2.5:3b:latest'] }, 'qwen2.5:3b');
      expect(result.status).toBe('ok');
    });

    it('does not match model with unrelated prefix', () => {
      const result = checkLlm({ running: true, models: ['qwen2.5:3b-instruct'] }, 'qwen2.5:3b');
      expect(result.status).toBe('warning');
    });

    it('returns warning when ollama is running but model missing', () => {
      const result = checkLlm({ running: true, models: ['other-model:latest'] }, 'qwen2.5:3b');
      expect(result.status).toBe('warning');
      expect(result.message).toContain('not found');
    });

    it('returns warning when ollama is not running', () => {
      const result = checkLlm({ running: false, models: [] }, 'qwen2.5:3b');
      expect(result.status).toBe('warning');
      expect(result.message).toContain('not running');
    });
  });

  describe('checkInbox', () => {
    it('returns ok with no items', () => {
      const result = checkInbox(db);
      expect(result.status).toBe('ok');
    });

    it('returns ok with pending items (pending is normal)', () => {
      db.addInboxItem(makeInboxItem({ status: 'pending' }));
      const result = checkInbox(db);
      expect(result.status).toBe('ok');
      expect(result.message).toContain('1 pending');
    });

    it('returns warning with failed items', () => {
      db.addInboxItem(makeInboxItem({ status: 'failed' }));
      const result = checkInbox(db);
      expect(result.status).toBe('warning');
      expect(result.message).toContain('1 failed');
    });
  });

  describe('checkStaleNotes', () => {
    it('returns ok with no stale notes', () => {
      const result = checkStaleNotes(db);
      expect(result.status).toBe('ok');
    });

    it('returns warning with stale notes', () => {
      db.upsertNote(
        makeNote({
          lastReviewed: '2020-01-01',
          reviewInterval: '30d',
        })
      );
      const result = checkStaleNotes(db);
      expect(result.status).toBe('warning');
      expect(result.message).toContain('1');
    });
  });

  describe('checkFilesystemSync', () => {
    it('returns ok when DB and disk are in sync', () => {
      const dbFiles = new Map([
        ['notes/foo.md', { path: 'notes/foo.md', hash: 'abc', mtime: 1, indexedAt: 1 }],
      ]);
      const diskFiles = new Set(['notes/foo.md']);

      const result = checkFilesystemSync(dbFiles, diskFiles);
      expect(result.status).toBe('ok');
    });

    it('warns about files on disk not in DB', () => {
      const dbFiles = new Map([
        ['notes/foo.md', { path: 'notes/foo.md', hash: 'abc', mtime: 1, indexedAt: 1 }],
      ]);
      const diskFiles = new Set(['notes/foo.md', 'notes/bar.md', 'notes/baz.csv']);

      const result = checkFilesystemSync(dbFiles, diskFiles);
      expect(result.status).toBe('warning');
      expect(result.message).toContain('2 unindexed');
    });

    it('warns about DB records with no file on disk', () => {
      const dbFiles = new Map([
        ['notes/foo.md', { path: 'notes/foo.md', hash: 'abc', mtime: 1, indexedAt: 1 }],
        ['notes/gone.md', { path: 'notes/gone.md', hash: 'def', mtime: 1, indexedAt: 1 }],
      ]);
      const diskFiles = new Set(['notes/foo.md']);

      const result = checkFilesystemSync(dbFiles, diskFiles);
      expect(result.status).toBe('warning');
      expect(result.message).toContain('1 orphaned');
    });

    it('reports both unindexed and orphaned', () => {
      const dbFiles = new Map([
        ['notes/gone.md', { path: 'notes/gone.md', hash: 'def', mtime: 1, indexedAt: 1 }],
      ]);
      const diskFiles = new Set(['notes/new.md']);

      const result = checkFilesystemSync(dbFiles, diskFiles);
      expect(result.status).toBe('warning');
      expect(result.message).toContain('1 unindexed');
      expect(result.message).toContain('1 orphaned');
    });
  });

  describe('runAllChecks', () => {
    it('returns a complete health report', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('no ollama')));
      const report = await runAllChecks(db, 'local');
      expect(report.checks.length).toBeGreaterThanOrEqual(5);
      expect(report.summary).toHaveProperty('ok');
      expect(report.summary).toHaveProperty('warnings');
      expect(report.summary).toHaveProperty('errors');
      vi.unstubAllGlobals();
    });
  });
});
