import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { BrainDB } from '../../src/services/brain-db.js';
import { search } from '../../src/services/search.js';
import { unlinkSync } from 'node:fs';
import type { Chunk, SearchResult } from '../../src/types.js';
import { tmpDbPath, makeNote, createMockEmbedder } from '../helpers.js';

vi.mock('../../src/services/reranker.js', () => ({
  rerank: vi.fn(async (_query: string, results: SearchResult[]) => results.reverse()),
}));

interface TestContext {
  db: BrainDB;
  dbPath: string;
  embedder: Embedder;
}

function addNoteWithChunks(
  db: BrainDB,
  embedder: { embed(texts: string[]): Promise<number[][]> },
  id: string,
  title: string,
  content: string,
  opts: { category?: string; tags?: string } = {}
): void {
  const note = makeNote({
    id,
    filePath: `/notes/${id}.md`,
    title,
    tier: 'slow',
    summary: content.slice(0, 80),
    category: opts.category,
    tags: opts.tags,
    modifiedAt: new Date().toISOString(),
  });
  db.upsertNote(note);
  db.upsertNoteFTS(id, title, content.slice(0, 80), content);

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

describe('search with intent filtering', () => {
  let ctx: TestContext;

  beforeEach(() => {
    const dbPath = tmpDbPath();
    const db = new BrainDB(dbPath);
    const embedder = createMockEmbedder();

    // Seed notes with diverse content so intent filtering can differentiate
    addNoteWithChunks(
      db,
      embedder,
      'ts-patterns',
      'TypeScript Design Patterns',
      'The factory pattern in TypeScript creates objects without specifying exact classes. Use generics for type-safe factories and observer implementations.',
      { category: 'frontend', tags: 'typescript,patterns' }
    );
    addNoteWithChunks(
      db,
      embedder,
      'ts-testing',
      'TypeScript Testing Strategies',
      'Testing TypeScript code with vitest and jest. Unit tests, integration tests, and mocking strategies for type-safe test suites.',
      { category: 'frontend', tags: 'typescript,testing' }
    );
    addNoteWithChunks(
      db,
      embedder,
      'ts-performance',
      'TypeScript Performance Optimization',
      'Optimizing TypeScript compilation speed and runtime performance. Bundle size reduction techniques and tree-shaking strategies.',
      { category: 'frontend', tags: 'typescript,performance' }
    );

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

  it('returns results when intent is provided', async () => {
    const { results } = await search(ctx.db, ctx.embedder, 'TypeScript', {
      limit: 10,
      intent: 'I want to learn about design patterns',
    });

    expect(results.length).toBeGreaterThanOrEqual(1);
  });

  it('search without intent is unchanged', async () => {
    const { results: withoutIntent } = await search(ctx.db, ctx.embedder, 'TypeScript', {
      limit: 10,
    });
    const { results: withUndefinedIntent } = await search(ctx.db, ctx.embedder, 'TypeScript', {
      limit: 10,
      intent: undefined,
    });

    expect(withoutIntent.length).toBe(withUndefinedIntent.length);
    expect(withoutIntent.map((r) => r.noteId)).toEqual(withUndefinedIntent.map((r) => r.noteId));
  });

  it('falls back to original results when no results match intent threshold', async () => {
    // Use a very unrelated intent to test fallback
    const { results } = await search(ctx.db, ctx.embedder, 'TypeScript', {
      limit: 10,
      intent: 'xyzzy completely unrelated gibberish topic that matches nothing at all',
    });

    // Should still return results (fallback behavior)
    expect(results.length).toBeGreaterThanOrEqual(1);
  });

  it('does not apply intent filter when only one result', async () => {
    const { results } = await search(ctx.db, ctx.embedder, 'TypeScript', {
      limit: 1,
      intent: 'testing strategies',
    });

    // With limit 1, intent filter is skipped (results.length <= 1)
    expect(results.length).toBe(1);
  });

  it('intent filtering embeds the intent string via the embedder', async () => {
    const embeddedTexts: string[][] = [];
    const spyEmbedder: Embedder = {
      ...ctx.embedder,
      async embed(texts: string[]): Promise<number[][]> {
        embeddedTexts.push([...texts]);
        return ctx.embedder.embed(texts);
      },
    };

    await search(ctx.db, spyEmbedder, 'TypeScript', {
      limit: 10,
      intent: 'design patterns for objects',
    });

    // The embedder should have been called at least twice:
    // once for the query vector, and once for the intent + excerpts
    expect(embeddedTexts.length).toBeGreaterThanOrEqual(2);
    // The intent embedding call should contain the intent text (with nomic prefix)
    const intentCall = embeddedTexts.find((texts) =>
      texts.some((t) => t.includes('design patterns for objects'))
    );
    expect(intentCall).toBeDefined();
  });
});
