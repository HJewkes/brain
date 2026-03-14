import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { VocabularyRepo } from '../../../src/services/repos/vocabulary-repo.js';

let db: Database.Database;
let repo: VocabularyRepo;

beforeEach(() => {
  db = new Database(':memory:');
  repo = new VocabularyRepo(db);
});

afterEach(() => {
  db.close();
});

describe('VocabularyRepo', () => {
  describe('updateForNote', () => {
    it('inserts terms from note content', () => {
      repo.updateForNote('VBT Fundamentals', 'velocity based training fundamentals', 10);

      const vocab = repo.getVocabulary();
      const terms = vocab.map((v) => v.term);
      expect(terms).toContain('velocity');
      expect(terms).toContain('based');
      expect(terms).toContain('training');
      expect(terms).toContain('fundamentals');
    });

    it('increments doc_frequency on duplicate terms', () => {
      repo.updateForNote('Note 1', 'velocity training methods', 10);
      repo.updateForNote('Note 2', 'velocity sensor calibration', 10);

      const vocab = repo.getVocabulary();
      const velocityEntry = vocab.find((v) => v.term === 'velocity');
      expect(velocityEntry).toBeDefined();
      expect(velocityEntry!.docFrequency).toBe(2);
    });

    it('assigns non-zero scores to terms', () => {
      repo.updateForNote('Test', 'bluetooth protocol research', 10);

      const vocab = repo.getVocabulary();
      for (const entry of vocab) {
        expect(entry.score).toBeGreaterThan(0);
      }
    });
  });

  describe('getVocabulary', () => {
    it('returns entries sorted by score descending', () => {
      repo.updateForNote('Test', 'short longer_identifier longest_possible_term', 100);
      repo.rebuildScores(100);

      const vocab = repo.getVocabulary();
      for (let i = 1; i < vocab.length; i++) {
        expect(vocab[i - 1].score).toBeGreaterThanOrEqual(vocab[i].score);
      }
    });

    it('returns empty array when no terms exist', () => {
      expect(repo.getVocabulary()).toEqual([]);
    });
  });

  describe('rebuildScores', () => {
    it('recalculates scores based on total docs', () => {
      repo.updateForNote('Test', 'velocity training', 10);
      const before = repo.getVocabulary().find((v) => v.term === 'velocity')!.score;

      repo.rebuildScores(1000);
      const after = repo.getVocabulary().find((v) => v.term === 'velocity')!.score;

      expect(after).not.toBe(before);
    });
  });

  describe('clear', () => {
    it('removes all vocabulary entries', () => {
      repo.updateForNote('Test', 'velocity training methods', 10);
      expect(repo.count()).toBeGreaterThan(0);

      repo.clear();
      expect(repo.count()).toBe(0);
    });
  });

  describe('count', () => {
    it('returns number of unique terms', () => {
      repo.updateForNote('VBT', 'velocity training bluetooth protocol', 10);
      expect(repo.count()).toBe(5);
    });

    it('returns 0 for empty vocabulary', () => {
      expect(repo.count()).toBe(0);
    });
  });
});
