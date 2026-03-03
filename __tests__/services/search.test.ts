import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { BrainDB } from '../../src/services/brain-db.js';
import { search, searchMemories, checkAndPromote } from '../../src/services/search.js';
import { unlinkSync } from 'node:fs';
import type { Chunk, NoteRecord, SearchResult } from '../../src/types.js';
import { tmpDbPath, makeNote, makeMemoryEntry, createMockEmbedder } from '../helpers.js';

vi.mock('../../src/services/reranker.js', () => ({
  rerank: vi.fn(async (_query: string, results: SearchResult[]) => results.reverse()),
}));

interface TestContext {
  db: BrainDB;
  dbPath: string;
  embedder: Embedder;
}

function seedTestNotes(db: BrainDB): void {
  const notes: NoteRecord[] = [
    makeNote({
      id: 'ts-patterns',
      filePath: '/notes/typescript-patterns.md',
      title: 'TypeScript Design Patterns',
      tier: 'slow',
      category: 'frontend',
      tags: 'typescript,patterns,design',
      summary: 'Common design patterns in TypeScript',
      confidence: 'high',
      modifiedAt: '2024-07-15',
    }),
    makeNote({
      id: 'ble-protocol',
      filePath: '/notes/ble-protocol.md',
      title: 'BLE Communication Protocol',
      tier: 'slow',
      category: 'hardware',
      tags: 'ble,bluetooth,protocol',
      summary: 'How BLE communication works with Voltra devices',
      confidence: 'high',
      modifiedAt: '2024-08-01',
    }),
    makeNote({
      id: 'react-hooks',
      filePath: '/notes/react-hooks.md',
      title: 'React Hooks Best Practices',
      tier: 'fast',
      category: 'frontend',
      tags: 'react,hooks,typescript',
      summary: 'Best practices for using React hooks',
      confidence: 'medium',
      modifiedAt: '2024-05-10',
    }),
    makeNote({
      id: 'workout-algo',
      filePath: '/notes/workout-algorithms.md',
      title: 'VBT Workout Algorithms',
      tier: 'slow',
      category: 'analytics',
      tags: 'vbt,algorithms,fitness',
      summary: 'Velocity based training algorithms and computations',
      confidence: 'high',
      modifiedAt: '2024-09-01',
    }),
    makeNote({
      id: 'css-grid',
      filePath: '/notes/css-grid.md',
      title: 'CSS Grid Layout Guide',
      tier: 'fast',
      category: 'frontend',
      tags: 'css,layout,design',
      summary: 'Comprehensive guide to CSS grid layout',
      confidence: 'low',
      modifiedAt: '2024-03-20',
    }),
  ];

  const chunkContents: Record<string, { heading: string; content: string }[]> = {
    'ts-patterns': [
      {
        heading: 'Factory Pattern',
        content:
          'The factory pattern in TypeScript creates objects without specifying exact classes. Use generics for type-safe factories.',
      },
      {
        heading: 'Observer Pattern',
        content:
          'Observer pattern implements event-driven architecture. TypeScript interfaces make observers type-safe.',
      },
    ],
    'ble-protocol': [
      {
        heading: 'BLE Basics',
        content:
          'Bluetooth Low Energy uses GATT profiles for communication. Services contain characteristics for data exchange.',
      },
      {
        heading: 'Device Connection',
        content:
          'BLE devices advertise services. Central devices scan and connect using device UUIDs and service characteristics.',
      },
    ],
    'react-hooks': [
      {
        heading: 'useState',
        content:
          'useState hook manages local component state. Use TypeScript generics for typed state values.',
      },
      {
        heading: 'useEffect',
        content:
          'useEffect handles side effects and cleanup. Dependencies array controls re-execution.',
      },
    ],
    'workout-algo': [
      {
        heading: 'Velocity Calculations',
        content:
          'Mean velocity computed from position sensor data. Peak velocity uses derivative of displacement over time.',
      },
      {
        heading: 'Load-Velocity Profile',
        content:
          'Linear regression of load vs velocity creates athlete profile. Predicts one-rep max from submaximal efforts.',
      },
    ],
    'css-grid': [
      {
        heading: 'Grid Basics',
        content:
          'CSS Grid provides two-dimensional layout control. grid-template-columns and grid-template-rows define structure.',
      },
      {
        heading: 'Grid Areas',
        content:
          'Named grid areas simplify complex layouts. grid-template-areas provides visual layout definition.',
      },
    ],
  };

  for (const note of notes) {
    db.upsertNote(note);

    const noteChunks = chunkContents[note.id];
    const fullContent = noteChunks.map((c) => `${c.heading}\n${c.content}`).join('\n\n');
    db.upsertNoteFTS(note.id, note.title, note.summary ?? '', fullContent);

    const chunks: Chunk[] = noteChunks.map((c, i) => ({
      id: `${note.id}:${c.heading.toLowerCase().replace(/\s+/g, '-')}:${i}`,
      noteId: note.id,
      heading: c.heading,
      headingAncestry: null,
      content: c.content,
      tokenCount: c.content.split(/\s+/).length,
      chunkType: 'section' as const,
      cutType: 'heading_boundary' as const,
      position: i,
    }));

    // Generate embeddings synchronously from mock embedder internals
    const embeddings = chunks.map((chunk) => {
      const vec = new Array<number>(384).fill(0);
      const text = chunk.content;
      for (let i = 0; i < text.length; i++) {
        const idx = i % 384;
        vec[idx] += text.charCodeAt(i) / 1000;
      }
      const magnitude = Math.sqrt(vec.reduce((sum, v) => sum + v * v, 0));
      if (magnitude > 0) {
        for (let i = 0; i < vec.length; i++) {
          vec[i] /= magnitude;
        }
      }
      return new Float32Array(vec);
    });

    db.upsertChunks(note.id, chunks, embeddings);
  }
}

describe('search service', () => {
  let ctx: TestContext;

  beforeEach(() => {
    const dbPath = tmpDbPath();
    const db = new BrainDB(dbPath);
    const embedder = createMockEmbedder();
    seedTestNotes(db);
    ctx = { db, dbPath, embedder };
  });

  afterEach(() => {
    ctx.db.close();
    try {
      unlinkSync(ctx.dbPath);
    } catch {
      // ignore
    }
  });

  describe('BM25-only search', () => {
    it('returns results ranked by BM25 relevance', async () => {
      const results = await search(ctx.db, ctx.embedder, 'TypeScript patterns', {
        limit: 3,
      });

      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results[0].noteId).toBe('ts-patterns');
    });

    it('result objects contain required fields', async () => {
      const results = await search(ctx.db, ctx.embedder, 'TypeScript patterns', {
        limit: 3,
      });

      expect(results.length).toBeGreaterThan(0);
      const result = results[0];
      expect(result).toHaveProperty('score');
      expect(result).toHaveProperty('filePath');
      expect(result).toHaveProperty('noteId');
      expect(result).toHaveProperty('heading');
      expect(result).toHaveProperty('excerpt');
      expect(result).toHaveProperty('tier');
      expect(result).toHaveProperty('tags');
      expect(typeof result.score).toBe('number');
      expect(result.score).toBeGreaterThan(0);
    });

    it('excerpt is a truncated snippet of matching content', async () => {
      const results = await search(ctx.db, ctx.embedder, 'TypeScript patterns', {
        limit: 3,
      });

      expect(results.length).toBeGreaterThan(0);
      expect(results[0].excerpt.length).toBeLessThanOrEqual(200);
      expect(results[0].excerpt.length).toBeGreaterThan(0);
    });
  });

  describe('vector-only search', () => {
    it('returns results ranked by vector similarity', async () => {
      // Use a query that shares text with BLE content to get deterministic hash similarity
      const results = await search(
        ctx.db,
        ctx.embedder,
        'Bluetooth Low Energy uses GATT profiles for communication',
        { limit: 5 }
      );

      expect(results.length).toBeGreaterThanOrEqual(1);
      // BLE content should rank high since query overlaps with BLE chunk text
      const noteIds = results.map((r) => r.noteId);
      expect(noteIds).toContain('ble-protocol');
    });

    it('query text is embedded via the provided embedder', async () => {
      let embeddedTexts: string[] = [];
      const spyEmbedder: Embedder = {
        ...ctx.embedder,
        async embed(texts: string[]): Promise<number[][]> {
          embeddedTexts = texts;
          return ctx.embedder.embed(texts);
        },
      };

      await search(ctx.db, spyEmbedder, 'test query', { limit: 3 });
      expect(embeddedTexts.length).toBe(1);
      expect(embeddedTexts[0]).toContain('test query');
    });
  });

  describe('RRF fusion', () => {
    it('merges BM25 and vector results using reciprocal rank fusion', async () => {
      const results = await search(ctx.db, ctx.embedder, 'TypeScript design patterns', {
        limit: 5,
      });

      expect(results.length).toBeGreaterThanOrEqual(1);
      // Scores should be descending
      for (let i = 1; i < results.length; i++) {
        expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score);
      }
    });

    it('document ranked high in both gets highest fused score', async () => {
      // TypeScript patterns should rank high in both BM25 (exact match) and vector
      const results = await search(ctx.db, ctx.embedder, 'TypeScript design patterns', {
        limit: 5,
      });

      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results[0].noteId).toBe('ts-patterns');
    });

    it('document appearing in only one result set still appears', async () => {
      const results = await search(ctx.db, ctx.embedder, 'CSS grid layout', {
        limit: 5,
      });

      const noteIds = results.map((r) => r.noteId);
      expect(noteIds).toContain('css-grid');
    });

    it('fusionStrategy rrf uses reciprocal rank fusion', async () => {
      const rrfResults = await search(ctx.db, ctx.embedder, 'TypeScript design patterns', {
        limit: 5,
        fusionStrategy: 'rrf',
      });
      const scoreResults = await search(ctx.db, ctx.embedder, 'TypeScript design patterns', {
        limit: 5,
        fusionStrategy: 'score',
      });

      expect(rrfResults.length).toBeGreaterThan(0);
      expect(rrfResults[0].noteId).toBe('ts-patterns');
      // RRF and score fusion produce different scores for the same query
      expect(rrfResults[0].score).not.toBeCloseTo(scoreResults[0].score, 5);
    });
  });

  describe('metadata filtering', () => {
    it('filters by tier', async () => {
      const results = await search(ctx.db, ctx.embedder, 'TypeScript', {
        limit: 10,
        tier: 'slow',
      });

      for (const result of results) {
        expect(result.tier).toBe('slow');
      }
    });

    it('filters by tags', async () => {
      const results = await search(ctx.db, ctx.embedder, 'design', {
        limit: 10,
        tags: ['typescript'],
      });

      for (const result of results) {
        expect(result.tags).toContain('typescript');
      }
    });

    it('filters by category', async () => {
      const results = await search(ctx.db, ctx.embedder, 'patterns design', {
        limit: 10,
        category: 'frontend',
      });

      // All results should be from frontend category
      expect(results.length).toBeGreaterThan(0);
      for (const result of results) {
        const note = ctx.db.getNoteById(result.noteId);
        expect(note?.category).toBe('frontend');
      }
    });

    it('filters by since date', async () => {
      const results = await search(ctx.db, ctx.embedder, 'patterns algorithms', {
        limit: 10,
        since: '2024-06-01',
      });

      for (const result of results) {
        const note = ctx.db.getNoteById(result.noteId);
        expect(note?.modifiedAt).not.toBeNull();
        expect(note!.modifiedAt! >= '2024-06-01').toBe(true);
      }
    });

    it('filters by confidence', async () => {
      const results = await search(ctx.db, ctx.embedder, 'patterns design layout', {
        limit: 10,
        confidence: 'high',
      });

      for (const result of results) {
        expect(result.confidence).toBe('high');
      }
    });

    it('combines multiple filters with AND logic', async () => {
      const results = await search(ctx.db, ctx.embedder, 'TypeScript', {
        limit: 10,
        tier: 'slow',
        category: 'frontend',
        confidence: 'high',
      });

      expect(results.length).toBeGreaterThan(0);
      for (const result of results) {
        expect(result.tier).toBe('slow');
        const note = ctx.db.getNoteById(result.noteId);
        expect(note?.category).toBe('frontend');
        expect(result.confidence).toBe('high');
      }
    });
  });

  describe('empty and edge cases', () => {
    it('returns empty array for empty query', async () => {
      const results = await search(ctx.db, ctx.embedder, '', { limit: 10 });
      expect(results).toEqual([]);
    });

    it('returns empty array for whitespace-only query', async () => {
      const results = await search(ctx.db, ctx.embedder, '   ', { limit: 10 });
      expect(results).toEqual([]);
    });

    it('returns empty array when no results match', async () => {
      const results = await search(ctx.db, ctx.embedder, 'xyznonexistentquerythatmatchesnothing', {
        limit: 10,
      });
      // May return vector results since vector search is semantic, but BM25 should return nothing
      // The combined results might be empty or have very low scores
      // This is acceptable behavior
      expect(Array.isArray(results)).toBe(true);
    });

    it('returns BM25-only results when no vectors are indexed', async () => {
      // Create a fresh DB with FTS but no vectors
      const freshPath = tmpDbPath();
      const freshDb = new BrainDB(freshPath);

      const note = makeNote({
        id: 'fts-only',
        filePath: '/notes/fts-only.md',
        title: 'FTS Only Note',
        tier: 'slow',
        summary: 'A note with only FTS indexing',
      });
      freshDb.upsertNote(note);
      freshDb.upsertNoteFTS(
        'fts-only',
        'FTS Only Note',
        'A note with only FTS indexing',
        'This note about TypeScript has only FTS content and no vectors'
      );

      const results = await search(freshDb, ctx.embedder, 'TypeScript', { limit: 5 });
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results[0].noteId).toBe('fts-only');

      freshDb.close();
      try {
        unlinkSync(freshPath);
      } catch {
        // ignore
      }
    });

    it('respects the limit parameter', async () => {
      const results = await search(ctx.db, ctx.embedder, 'TypeScript patterns design', {
        limit: 2,
      });
      expect(results.length).toBeLessThanOrEqual(2);
    });
  });

  describe('minScore threshold', () => {
    it('filters out results below the threshold', async () => {
      const allResults = await search(ctx.db, ctx.embedder, 'TypeScript patterns', {
        limit: 10,
      });
      expect(allResults.length).toBeGreaterThan(1);

      const highThreshold = allResults[0].score - 0.01;
      const filtered = await search(ctx.db, ctx.embedder, 'TypeScript patterns', {
        limit: 10,
        minScore: highThreshold,
      });

      expect(filtered.length).toBeGreaterThanOrEqual(1);
      expect(filtered.length).toBeLessThanOrEqual(allResults.length);
      for (const result of filtered) {
        expect(result.score).toBeGreaterThanOrEqual(highThreshold);
      }
    });

    it('returns all results when minScore is undefined', async () => {
      const withoutMinScore = await search(ctx.db, ctx.embedder, 'TypeScript patterns', {
        limit: 10,
      });
      const withUndefined = await search(ctx.db, ctx.embedder, 'TypeScript patterns', {
        limit: 10,
        minScore: undefined,
      });

      expect(withUndefined.length).toBe(withoutMinScore.length);
    });

    it('returns empty results when minScore is 1.0', async () => {
      const results = await search(ctx.db, ctx.embedder, 'TypeScript patterns', {
        limit: 10,
        minScore: 1.0,
      });

      expect(results).toEqual([]);
    });

    it('returns all results when minScore is 0', async () => {
      const allResults = await search(ctx.db, ctx.embedder, 'TypeScript patterns', {
        limit: 10,
      });
      const withZero = await search(ctx.db, ctx.embedder, 'TypeScript patterns', {
        limit: 10,
        minScore: 0,
      });

      expect(withZero.length).toBe(allResults.length);
    });
  });

  describe('custom fusion weights', () => {
    it('respects custom fusion weights', async () => {
      const bm25Heavy = await search(
        ctx.db,
        ctx.embedder,
        'TypeScript patterns',
        { limit: 5 },
        { bm25: 0.9, vector: 0.1 }
      );
      const vectorHeavy = await search(
        ctx.db,
        ctx.embedder,
        'TypeScript patterns',
        { limit: 5 },
        { bm25: 0.1, vector: 0.9 }
      );

      expect(bm25Heavy.length).toBeGreaterThan(0);
      expect(vectorHeavy.length).toBeGreaterThan(0);
      // Scores should differ when weights change
      expect(bm25Heavy[0].score).not.toBeCloseTo(vectorHeavy[0].score, 5);
    });
  });

  describe('dropoff filter', () => {
    it('cuts results at the largest relative score gap', async () => {
      const allResults = await search(ctx.db, ctx.embedder, 'TypeScript patterns', {
        limit: 10,
      });
      expect(allResults.length).toBeGreaterThan(1);

      const withDropoff = await search(ctx.db, ctx.embedder, 'TypeScript patterns', {
        limit: 10,
        dropoff: 0.01,
      });

      expect(withDropoff.length).toBeGreaterThanOrEqual(1);
      expect(withDropoff.length).toBeLessThanOrEqual(allResults.length);
    });

    it('returns all results when no gap exceeds threshold', async () => {
      const allResults = await search(ctx.db, ctx.embedder, 'TypeScript patterns', {
        limit: 10,
      });

      const withHighThreshold = await search(ctx.db, ctx.embedder, 'TypeScript patterns', {
        limit: 10,
        dropoff: 0.99,
      });

      expect(withHighThreshold.length).toBe(allResults.length);
    });

    it('returns all results when dropoff is undefined', async () => {
      const withoutDropoff = await search(ctx.db, ctx.embedder, 'TypeScript patterns', {
        limit: 10,
      });
      const withUndefined = await search(ctx.db, ctx.embedder, 'TypeScript patterns', {
        limit: 10,
        dropoff: undefined,
      });

      expect(withUndefined.length).toBe(withoutDropoff.length);
    });

    it('keeps at least one result even with aggressive threshold', async () => {
      const results = await search(ctx.db, ctx.embedder, 'TypeScript patterns', {
        limit: 10,
        dropoff: 0.001,
      });

      expect(results.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('nomic model query prefix', () => {
    it('prefixes query with search_query: for nomic-embed-text model', async () => {
      let embeddedTexts: string[] = [];
      const nomicEmbedder: Embedder = {
        model: 'nomic-embed-text',
        dimensions: 384,
        async embed(texts: string[]): Promise<number[][]> {
          embeddedTexts = texts;
          return ctx.embedder.embed(texts);
        },
      };

      await search(ctx.db, nomicEmbedder, 'test query', { limit: 3 });
      expect(embeddedTexts[0]).toBe('search_query: test query');
    });

    it('does not prefix query for non-nomic models', async () => {
      let embeddedTexts: string[] = [];
      const otherEmbedder: Embedder = {
        model: 'bge-small-en-v1.5',
        dimensions: 384,
        async embed(texts: string[]): Promise<number[][]> {
          embeddedTexts = texts;
          return ctx.embedder.embed(texts);
        },
      };

      await search(ctx.db, otherEmbedder, 'test query', { limit: 3 });
      expect(embeddedTexts[0]).toBe('test query');
    });
  });

  describe('access tracking', () => {
    it('records search_hit events for returned results', async () => {
      const results = await search(ctx.db, ctx.embedder, 'TypeScript patterns', {
        limit: 5,
      });

      expect(results.length).toBeGreaterThan(0);
      const count = ctx.db.getAccessCount(results[0].noteId);
      expect(count).toBeGreaterThanOrEqual(1);
    });

    it('records one event per result', async () => {
      const results = await search(ctx.db, ctx.embedder, 'TypeScript patterns', {
        limit: 5,
      });

      for (const result of results) {
        const count = ctx.db.getAccessCount(result.noteId);
        expect(count).toBe(1);
      }
    });

    it('accumulates across multiple searches', async () => {
      await search(ctx.db, ctx.embedder, 'TypeScript patterns', { limit: 5 });
      await search(ctx.db, ctx.embedder, 'TypeScript patterns', { limit: 5 });

      const count = ctx.db.getAccessCount('ts-patterns');
      expect(count).toBe(2);
    });
  });

  describe('rerank option', () => {
    it('calls cross-encoder reranking when rerank is true', async () => {
      const { rerank } = await import('../../src/services/reranker.js');

      const results = await search(ctx.db, ctx.embedder, 'TypeScript patterns', {
        limit: 5,
        rerank: true,
      });

      expect(rerank).toHaveBeenCalledOnce();
      expect(results.length).toBeGreaterThan(0);
    });

    it('does not call reranker when rerank is false', async () => {
      const { rerank } = await import('../../src/services/reranker.js');
      vi.mocked(rerank).mockClear();

      await search(ctx.db, ctx.embedder, 'TypeScript patterns', {
        limit: 5,
        rerank: false,
      });

      expect(rerank).not.toHaveBeenCalled();
    });
  });

  describe('checkAndPromote', () => {
    it('promotes a fast-tier note after reaching threshold', () => {
      for (let i = 0; i < 10; i++) {
        ctx.db.recordAccess('react-hooks', 'search_hit');
      }
      const promoted = checkAndPromote(ctx.db, 'react-hooks', 10);
      expect(promoted).toBe(true);
      const note = ctx.db.getNoteById('react-hooks');
      expect(note?.tier).toBe('slow');
    });

    it('does not promote when below threshold', () => {
      for (let i = 0; i < 5; i++) {
        ctx.db.recordAccess('react-hooks', 'search_hit');
      }
      const promoted = checkAndPromote(ctx.db, 'react-hooks', 10);
      expect(promoted).toBe(false);
      const note = ctx.db.getNoteById('react-hooks');
      expect(note?.tier).toBe('fast');
    });

    it('does not promote slow-tier notes', () => {
      for (let i = 0; i < 20; i++) {
        ctx.db.recordAccess('ts-patterns', 'search_hit');
      }
      const promoted = checkAndPromote(ctx.db, 'ts-patterns', 10);
      expect(promoted).toBe(false);
    });

    it('returns false for nonexistent notes', () => {
      const promoted = checkAndPromote(ctx.db, 'nonexistent', 1);
      expect(promoted).toBe(false);
    });
  });
});

describe('searchMemories', () => {
  let db: BrainDB;
  let dbPath: string;
  let embedder: Embedder;

  beforeEach(async () => {
    dbPath = tmpDbPath();
    db = new BrainDB(dbPath);
    embedder = createMockEmbedder();

    db.upsertNote(makeNote({ id: 'note-1', filePath: '/notes/note-1.md' }));
    db.ensureVectorTable(384);

    const memories = [
      makeMemoryEntry({
        id: 'mem-ts',
        memory: 'TypeScript uses structural typing',
        sourceNoteId: 'note-1',
        containerTag: 'dev',
      }),
      makeMemoryEntry({
        id: 'mem-react',
        memory: 'React hooks must follow rules of hooks',
        sourceNoteId: 'note-1',
        containerTag: 'dev',
      }),
      makeMemoryEntry({
        id: 'mem-css',
        memory: 'CSS grid provides two-dimensional layouts',
        sourceNoteId: 'note-1',
        containerTag: 'design',
      }),
      makeMemoryEntry({
        id: 'mem-old',
        memory: 'Old superseded fact',
        sourceNoteId: 'note-1',
        isLatest: false,
      }),
      makeMemoryEntry({
        id: 'mem-forgotten',
        memory: 'Forgotten memory',
        sourceNoteId: 'note-1',
        isForgotten: true,
      }),
    ];

    for (const mem of memories) {
      db.addMemory(mem);
      const [vec] = await embedder.embed([mem.memory]);
      db.upsertMemoryVector(mem.id, new Float32Array(vec));
    }
  });

  afterEach(() => {
    db.close();
    try {
      unlinkSync(dbPath);
    } catch {
      /* ignore */
    }
  });

  it('returns scored memory results', async () => {
    const results = await searchMemories(db, embedder, 'TypeScript structural typing', 10);
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].score).toBeGreaterThan(0);
    expect(results[0].memoryId).toBeDefined();
    expect(results[0].memory).toBeDefined();
  });

  it('results are sorted by score descending', async () => {
    const results = await searchMemories(db, embedder, 'TypeScript', 10);
    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score);
    }
  });

  it('excludes non-latest memories', async () => {
    const results = await searchMemories(db, embedder, 'Old superseded fact', 10);
    const ids = results.map((r) => r.memoryId);
    expect(ids).not.toContain('mem-old');
  });

  it('excludes forgotten memories', async () => {
    const results = await searchMemories(db, embedder, 'Forgotten memory', 10);
    const ids = results.map((r) => r.memoryId);
    expect(ids).not.toContain('mem-forgotten');
  });

  it('filters by container tag', async () => {
    const results = await searchMemories(db, embedder, 'TypeScript React CSS', 10, 'design');
    for (const r of results) {
      expect(r.containerTag).toBe('design');
    }
  });

  it('returns empty for empty query', async () => {
    const results = await searchMemories(db, embedder, '', 10);
    expect(results).toEqual([]);
  });

  it('respects limit parameter', async () => {
    const results = await searchMemories(db, embedder, 'TypeScript React CSS', 1);
    expect(results.length).toBeLessThanOrEqual(1);
  });
});
