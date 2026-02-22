import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { tmpDbPath, makeNote, makeInboxItem } from '../helpers.js';
import { BrainDB } from '../../src/services/brain-db.js';
import {
  checkDatabase,
  checkEmbedder,
  checkLlm,
  checkInbox,
  checkStaleNotes,
  runAllChecks,
} from '../../src/services/health.js';

describe('health checks', () => {
  let db: BrainDB;

  beforeEach(() => {
    db = new BrainDB(tmpDbPath());
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
      const result = checkLlm(
        { running: true, models: ['qwen2.5:3b'] },
        'qwen2.5:3b'
      );
      expect(result.status).toBe('ok');
    });

    it('returns ok when model matches by tag suffix', () => {
      const result = checkLlm(
        { running: true, models: ['qwen2.5:3b:latest'] },
        'qwen2.5:3b'
      );
      expect(result.status).toBe('ok');
    });

    it('does not match model with unrelated prefix', () => {
      const result = checkLlm(
        { running: true, models: ['qwen2.5:3b-instruct'] },
        'qwen2.5:3b'
      );
      expect(result.status).toBe('warning');
    });

    it('returns warning when ollama is running but model missing', () => {
      const result = checkLlm(
        { running: true, models: ['other-model:latest'] },
        'qwen2.5:3b'
      );
      expect(result.status).toBe('warning');
      expect(result.message).toContain('not found');
    });

    it('returns warning when ollama is not running', () => {
      const result = checkLlm(
        { running: false, models: [] },
        'qwen2.5:3b'
      );
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
      db.upsertNote(makeNote({
        lastReviewed: '2020-01-01',
        reviewInterval: '30d',
      }));
      const result = checkStaleNotes(db);
      expect(result.status).toBe('warning');
      expect(result.message).toContain('1');
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
