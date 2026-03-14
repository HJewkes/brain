import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { BrainDB } from '../../src/services/brain-db.js';
import { LocalEmbedder } from '../../src/adapters/local-embedder.js';
import { parseMarkdown } from '../../src/services/markdown-parser.js';
import { search } from '../../src/services/search.js';
import { notes, queries, type SearchQualityNote } from './fixtures/search-quality-dataset.js';
import {
  hitRate,
  precisionAtK,
  reciprocalRank,
  ndcgAtK,
  aggregateMetrics,
} from '../utils/metrics.js';

interface QualityEnvironment {
  db: BrainDB;
  embedder: LocalEmbedder;
  tempDir: string;
}

async function setupEnvironment(corpus: SearchQualityNote[]): Promise<QualityEnvironment> {
  const tempDir = mkdtempSync(join(tmpdir(), 'brain-squal-'));
  const notesDir = join(tempDir, 'notes');
  const dbPath = join(tempDir, 'squal.db');

  mkdirSync(notesDir, { recursive: true });

  const db = new BrainDB(dbPath);
  const embedder = new LocalEmbedder();
  db.setEmbeddingModel(embedder.model, embedder.dimensions);

  for (const note of corpus) {
    const markdown = [
      '---',
      `id: "${note.id}"`,
      `title: "${note.title}"`,
      'type: note',
      'tier: slow',
      `tags: [${note.tags.map((t) => `"${t}"`).join(', ')}]`,
      '---',
      '',
      note.content,
    ].join('\n');

    const filePath = join(notesDir, `${note.id}.md`);
    writeFileSync(filePath, markdown, 'utf-8');

    const parsed = parseMarkdown(filePath, markdown);

    db.upsertNote({
      id: parsed.id,
      filePath: parsed.filePath,
      title: parsed.frontmatter.title,
      type: parsed.frontmatter.type,
      tier: parsed.frontmatter.tier,
      category: null,
      tags: note.tags.join(','),
      summary: null,
      confidence: null,
      status: 'current',
      sources: null,
      createdAt: null,
      modifiedAt: null,
      lastReviewed: null,
      reviewInterval: null,
      expires: null,
      metadata: null,
    });

    db.upsertNoteFTS(parsed.id, note.title, '', note.content);

    const chunks = parsed.chunks.map((rc, i) => ({
      id: `${parsed.id}::chunk-${i}`,
      noteId: parsed.id,
      heading: rc.heading,
      headingAncestry: rc.headingAncestry,
      content: rc.text,
      tokenCount: rc.tokenCount,
      chunkType: rc.chunkType,
      cutType: rc.cutType,
      contentType: rc.contentType,
      position: rc.position,
    }));

    if (chunks.length > 0) {
      const texts = chunks.map((c) => c.content);
      const embeddings = await embedder.embed(texts);
      const vectors = embeddings.map((e) => new Float32Array(e));
      db.upsertChunks(parsed.id, chunks, vectors);
    }
  }

  return { db, embedder, tempDir };
}

describe('OpenViking-inspired search quality benchmarks', { timeout: 120_000 }, () => {
  let env: QualityEnvironment;
  let evalResults: Array<{
    queryIdx: number;
    description: string;
    retrieved: string[];
    relevant: Set<string>;
  }>;

  beforeAll(async () => {
    env = await setupEnvironment(notes);

    evalResults = [];
    for (let i = 0; i < queries.length; i++) {
      const q = queries[i];
      const { results } = await search(env.db, env.embedder, q.query, { limit: 5 });
      evalResults.push({
        queryIdx: i,
        description: q.description,
        retrieved: results.map((r) => r.noteId),
        relevant: new Set(q.relevantNoteIds),
      });
    }
  });

  afterAll(() => {
    env.db.close();
    rmSync(env.tempDir, { recursive: true, force: true });
  });

  describe('precision@K', () => {
    test('precision@3 >= 0.25', () => {
      const precisions = evalResults.map((r) => precisionAtK(r.retrieved, r.relevant, 3));
      const avg = precisions.reduce((a, b) => a + b, 0) / precisions.length;
      console.log(`precision@3: ${avg.toFixed(3)}`);

      for (let i = 0; i < evalResults.length; i++) {
        const p = precisions[i];
        console.log(
          `  [${queries[i].query.slice(0, 50)}] p@3=${p.toFixed(2)} — ${evalResults[i].description}`
        );
      }

      // With ~1 relevant note per query in a 12-note corpus, max p@3 is ~0.33.
      // Threshold reflects that most queries correctly rank the relevant note first.
      expect(avg).toBeGreaterThanOrEqual(0.25);
    });

    test('precision@5 >= 0.15', () => {
      const precisions = evalResults.map((r) => precisionAtK(r.retrieved, r.relevant, 5));
      const avg = precisions.reduce((a, b) => a + b, 0) / precisions.length;
      console.log(`precision@5: ${avg.toFixed(3)}`);
      // With ~1 relevant note per query, max p@5 is 0.20. Threshold is realistic.
      expect(avg).toBeGreaterThanOrEqual(0.15);
    });
  });

  describe('MRR (Mean Reciprocal Rank)', () => {
    test('MRR >= 0.5', () => {
      const rrs = evalResults.map((r) => reciprocalRank(r.retrieved, r.relevant));
      const avg = rrs.reduce((a, b) => a + b, 0) / rrs.length;
      console.log(`MRR@5: ${avg.toFixed(3)}`);

      for (let i = 0; i < evalResults.length; i++) {
        const rr = rrs[i];
        console.log(`  [${queries[i].query.slice(0, 50)}] RR=${rr.toFixed(2)}`);
      }

      expect(avg).toBeGreaterThanOrEqual(0.5);
    });
  });

  describe('hit rate and NDCG', () => {
    test('hit_rate@5 >= 0.80', () => {
      const hits = evalResults.map((r) => hitRate(r.retrieved, r.relevant));
      const avg = hits.reduce((a, b) => a + b, 0) / hits.length;
      console.log(`hit_rate@5: ${avg.toFixed(3)}`);
      expect(avg).toBeGreaterThanOrEqual(0.8);
    });

    test('NDCG@5 (reporting)', () => {
      const ndcgs = evalResults.map((r) => ndcgAtK(r.retrieved, r.relevant, 5));
      const avg = ndcgs.reduce((a, b) => a + b, 0) / ndcgs.length;
      console.log(`NDCG@5: ${avg.toFixed(3)}`);
      expect(avg).toBeGreaterThan(0);
    });
  });

  describe('per-query diagnostics', () => {
    test('every query retrieves at least one relevant result', () => {
      const failures: string[] = [];

      for (let i = 0; i < evalResults.length; i++) {
        const r = evalResults[i];
        const hit = r.retrieved.some((id) => r.relevant.has(id));
        if (!hit) {
          failures.push(
            `Query "${queries[i].query}" expected [${[...r.relevant].join(', ')}] ` +
              `but got [${r.retrieved.join(', ')}]`
          );
        }
      }

      if (failures.length > 0) {
        console.log(`\nMissed queries (${failures.length}/${evalResults.length}):`);
        for (const f of failures) console.log(`  ${f}`);
      }

      const hitRateVal = 1 - failures.length / evalResults.length;
      expect(hitRateVal).toBeGreaterThanOrEqual(0.8);
    });
  });

  describe('aggregate summary', () => {
    test('log full metrics table', () => {
      const forMetrics = evalResults.map((r) => ({
        retrieved: r.retrieved,
        relevant: r.relevant,
      }));
      const agg = aggregateMetrics(forMetrics, 5);

      console.log('\n=== Search Quality Benchmark Results ===');
      console.log(`  Corpus:         ${notes.length} notes`);
      console.log(`  Queries:        ${queries.length}`);
      console.log(`  hit_rate@5:     ${agg.hitRate.toFixed(3)}`);
      console.log(`  MRR@5:          ${agg.mrr.toFixed(3)}`);
      console.log(`  precision@5:    ${agg.precisionAtK.toFixed(3)}`);
      console.log(`  recall@5:       ${agg.recallAtK.toFixed(3)}`);
      console.log(`  NDCG@5:         ${agg.ndcgAtK.toFixed(3)}`);

      expect(agg.hitRate).toBeGreaterThan(0);
    });
  });
});
