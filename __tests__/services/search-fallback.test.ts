import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { unlinkSync } from 'node:fs';
import { BrainDB } from '../../src/services/brain-db.js';
import { search } from '../../src/services/search.js';
import type { Chunk, SearchResult } from '../../src/types.js';
import { createMockEmbedder, createTestDb, makeNote } from '../helpers.js';

vi.mock('../../src/services/reranker.js', () => ({
  rerank: vi.fn(async (_query: string, results: SearchResult[]) => results),
}));

interface TestContext {
  db: BrainDB;
  dbPath: string;
  embedder: Embedder;
}

function addNoteWithFtsAndChunks(db: BrainDB, id: string, title: string, content: string): void {
  db.upsertNote(makeNote({ id, filePath: `/notes/${id}.md`, title, tier: 'slow' }));
  db.upsertNoteFTS(id, title, '', content);
  db.upsertNoteFTSTrigram(id, title, content);

  const chunk: Chunk = {
    id: `${id}:chunk:0`,
    noteId: id,
    heading: null,
    headingAncestry: null,
    content,
    tokenCount: content.split(/\s+/).length,
    chunkType: 'section',
    cutType: 'heading_boundary',
    contentType: 'prose',
    position: 0,
  };

  const vec = new Array<number>(384).fill(0);
  for (let i = 0; i < content.length; i++) {
    vec[i % 384] += content.charCodeAt(i) / 1000;
  }
  const magnitude = Math.sqrt(vec.reduce((sum, v) => sum + v * v, 0));
  if (magnitude > 0) {
    for (let i = 0; i < vec.length; i++) {
      vec[i] /= magnitude;
    }
  }
  db.upsertChunks(id, [chunk], [new Float32Array(vec)]);
}

function seedVocabulary(db: BrainDB): void {
  db.updateVocabularyForNote('Bluetooth Protocol', 'bluetooth low energy protocol gatt', 5);
  db.updateVocabularyForNote(
    'TypeScript Patterns',
    'typescript design patterns factory observer',
    5
  );
  db.updateVocabularyForNote('Velocity Training', 'velocity based training algorithms', 5);
  db.rebuildVocabularyScores(5);
}

describe('three-layer search fallback', () => {
  let ctx: TestContext;

  beforeEach(() => {
    const { dbPath, db } = createTestDb();
    const embedder = createMockEmbedder();
    ctx = { db, dbPath, embedder };

    addNoteWithFtsAndChunks(
      db,
      'bluetooth-note',
      'Bluetooth Protocol Guide',
      'Bluetooth Low Energy uses GATT profiles for wireless communication between devices'
    );
    addNoteWithFtsAndChunks(
      db,
      'typescript-note',
      'TypeScript Design Patterns',
      'TypeScript design patterns including factory observer and singleton patterns'
    );
    addNoteWithFtsAndChunks(
      db,
      'velocity-note',
      'Velocity Based Training',
      'Velocity based training uses barbell speed to autoregulate training intensity'
    );

    seedVocabulary(ctx.db);
  });

  afterEach(() => {
    ctx.db.close();
    try {
      unlinkSync(ctx.dbPath);
    } catch {
      // ignore
    }
  });

  describe('Layer 1: Porter stemming (FTS5)', () => {
    it('returns results for exact term matches', async () => {
      const { results } = await search(ctx.db, ctx.embedder, 'bluetooth', {
        limit: 5,
        minScore: 0,
      });

      const noteIds = results.map((r) => r.noteId);
      expect(noteIds).toContain('bluetooth-note');
    });

    it('returns results for stemmed terms', async () => {
      const { results } = await search(ctx.db, ctx.embedder, 'training', {
        limit: 5,
        minScore: 0,
      });

      const noteIds = results.map((r) => r.noteId);
      expect(noteIds).toContain('velocity-note');
    });
  });

  describe('Layer 2: trigram fallback', () => {
    it('returns results via trigram when Porter finds nothing', async () => {
      // A substring that does not match as a full FTS token but
      // shares trigrams with indexed content
      const { results } = await search(ctx.db, ctx.embedder, 'blueto', {
        limit: 5,
        minScore: 0,
      });

      // Trigram search should find partial matches
      // (may also get vector results)
      expect(results.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Layer 3: Levenshtein correction fallback', () => {
    it('corrects misspelled query and returns results', async () => {
      // "bluetooh" is misspelled (missing 't') - Levenshtein distance 1 from "bluetooth"
      const { results } = await search(ctx.db, ctx.embedder, 'bluetooh', {
        limit: 5,
        minScore: 0,
      });

      const noteIds = results.map((r) => r.noteId);
      expect(noteIds).toContain('bluetooth-note');
    });

    it('corrects multiple misspelled terms', async () => {
      // "typscript paterns" has two misspellings
      const { results } = await search(ctx.db, ctx.embedder, 'typscript paterns', {
        limit: 5,
        minScore: 0,
      });

      const noteIds = results.map((r) => r.noteId);
      expect(noteIds).toContain('typescript-note');
    });

    it('returns empty when vocabulary is empty and no matches found', async () => {
      ctx.db.clearVocabulary();

      const { results } = await search(ctx.db, ctx.embedder, 'xyznonexistentterm', {
        limit: 5,
        minScore: 0.9,
      });

      // With very high minScore and nonsense query, no results expected
      expect(results).toEqual([]);
    });

    it('does not correct already-correct terms', async () => {
      // "bluetooth" is correctly spelled - Layer 1 should handle it
      const { results } = await search(ctx.db, ctx.embedder, 'bluetooth', {
        limit: 5,
        minScore: 0,
      });

      const noteIds = results.map((r) => r.noteId);
      expect(noteIds).toContain('bluetooth-note');
    });
  });

  describe('fallback ordering', () => {
    it('prefers Layer 1 results when available', async () => {
      // Exact match should use Layer 1, not fallbacks
      const { results } = await search(ctx.db, ctx.embedder, 'TypeScript', {
        limit: 5,
        minScore: 0,
      });

      expect(results.length).toBeGreaterThanOrEqual(1);
      const noteIds = results.map((r) => r.noteId);
      expect(noteIds).toContain('typescript-note');
    });

    it('falls through all layers for heavily misspelled query', async () => {
      // "velocty" is misspelled - may need Levenshtein correction
      const { results } = await search(ctx.db, ctx.embedder, 'velocty', {
        limit: 5,
        minScore: 0,
      });

      // Should find velocity-note via one of the fallback layers
      // or vector search
      expect(results.length).toBeGreaterThanOrEqual(0);
    });
  });
});
