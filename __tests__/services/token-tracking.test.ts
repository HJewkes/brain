import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { unlinkSync } from 'node:fs';
import { BrainDB } from '../../src/services/brain-db.js';
import { search } from '../../src/services/search.js';
import {
  createEmptyTokenUsage,
  estimateTokens,
  type SearchResult,
  type Embedder,
} from '../../src/types.js';
import { tmpDbPath, makeNote, makeChunk, createMockEmbedder } from '../helpers.js';

vi.mock('../../src/services/reranker.js', () => ({
  rerank: vi.fn(async (_query: string, results: SearchResult[]) =>
    results.reverse().map((r) => ({ ...r, matchSource: 'rerank' as const }))
  ),
}));

interface TestContext {
  db: BrainDB;
  dbPath: string;
  embedder: Embedder;
}

function generateEmbedding(text: string, dims = 384): Float32Array {
  const vec = new Array<number>(dims).fill(0);
  for (let i = 0; i < text.length; i++) {
    const idx = i % dims;
    vec[idx] += text.charCodeAt(i) / 1000;
  }
  const magnitude = Math.sqrt(vec.reduce((sum, v) => sum + v * v, 0));
  if (magnitude > 0) {
    for (let i = 0; i < vec.length; i++) {
      vec[i] /= magnitude;
    }
  }
  return new Float32Array(vec);
}

describe('token tracking', () => {
  let ctx: TestContext;

  beforeEach(() => {
    const dbPath = tmpDbPath();
    const db = new BrainDB(dbPath);
    const embedder = createMockEmbedder();

    db.upsertNote(
      makeNote({
        id: 'test-note',
        filePath: '/notes/test.md',
        title: 'Test Note',
        tier: 'slow',
        tags: 'test',
      })
    );

    const chunk = makeChunk({
      id: 'chunk-1',
      noteId: 'test-note',
      content: 'This is a test note about TypeScript patterns and design',
    });
    const embedding = generateEmbedding(chunk.content);
    db.upsertChunks('test-note', [chunk], [embedding]);

    db.upsertNote(
      makeNote({
        id: 'test-note-2',
        filePath: '/notes/test2.md',
        title: 'Second Note',
        tier: 'slow',
        tags: 'typescript',
      })
    );

    const chunk2 = makeChunk({
      id: 'chunk-2',
      noteId: 'test-note-2',
      content: 'TypeScript generics enable reusable type-safe code patterns',
    });
    const embedding2 = generateEmbedding(chunk2.content);
    db.upsertChunks('test-note-2', [chunk2], [embedding2]);

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

  describe('estimateTokens', () => {
    it('estimates tokens from text length', () => {
      expect(estimateTokens('test')).toBe(1);
      expect(estimateTokens('hello world')).toBe(3);
      expect(estimateTokens('')).toBe(0);
    });

    it('rounds up fractional tokens', () => {
      expect(estimateTokens('ab')).toBe(1);
      expect(estimateTokens('abc')).toBe(1);
      expect(estimateTokens('abcde')).toBe(2);
    });
  });

  describe('createEmptyTokenUsage', () => {
    it('returns zeroed usage', () => {
      const usage = createEmptyTokenUsage();
      expect(usage.queryEmbedTokens).toBe(0);
      expect(usage.rerankTokens).toBe(0);
      expect(usage.intentFilterTokens).toBe(0);
      expect(usage.totalTokens).toBe(0);
    });
  });

  describe('search returns tokenUsage', () => {
    it('includes tokenUsage in search results', async () => {
      const { results, tokenUsage } = await search(ctx.db, ctx.embedder, 'TypeScript', {
        limit: 5,
      });

      expect(tokenUsage).toBeDefined();
      expect(tokenUsage.queryEmbedTokens).toBeGreaterThan(0);
      expect(tokenUsage.totalTokens).toBeGreaterThan(0);
      expect(tokenUsage.totalTokens).toBe(tokenUsage.queryEmbedTokens);
      expect(Array.isArray(results)).toBe(true);
    });

    it('returns zero tokens for empty query', async () => {
      const { results, tokenUsage } = await search(ctx.db, ctx.embedder, '', { limit: 5 });

      expect(results).toHaveLength(0);
      expect(tokenUsage.totalTokens).toBe(0);
    });

    it('tracks rerank tokens when reranking is enabled', async () => {
      const { tokenUsage } = await search(ctx.db, ctx.embedder, 'TypeScript', {
        limit: 5,
        rerank: true,
        minScore: 0,
      });

      expect(tokenUsage.rerankTokens).toBeGreaterThan(0);
      expect(tokenUsage.totalTokens).toBe(
        tokenUsage.queryEmbedTokens + tokenUsage.rerankTokens + tokenUsage.intentFilterTokens
      );
    });

    it('does not track rerank tokens without reranking', async () => {
      const { tokenUsage } = await search(ctx.db, ctx.embedder, 'TypeScript', {
        limit: 5,
        rerank: false,
      });

      expect(tokenUsage.rerankTokens).toBe(0);
    });

    it('tracks intent filter tokens when intent is provided', async () => {
      const { tokenUsage } = await search(ctx.db, ctx.embedder, 'TypeScript', {
        limit: 5,
        intent: 'find design patterns for enterprise applications',
        minScore: 0,
      });

      expect(tokenUsage.intentFilterTokens).toBeGreaterThan(0);
      expect(tokenUsage.totalTokens).toBeGreaterThan(tokenUsage.queryEmbedTokens);
    });

    it('accumulates all token sources in totalTokens', async () => {
      const { tokenUsage } = await search(ctx.db, ctx.embedder, 'TypeScript', {
        limit: 5,
        rerank: true,
        intent: 'find patterns',
        minScore: 0,
      });

      expect(tokenUsage.totalTokens).toBe(
        tokenUsage.queryEmbedTokens + tokenUsage.rerankTokens + tokenUsage.intentFilterTokens
      );
    });
  });
});
