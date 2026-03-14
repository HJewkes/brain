import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { BrainDB } from '../../src/services/brain-db.js';
import { LocalEmbedder } from '../../src/adapters/local-embedder.js';
import { parseMarkdown } from '../../src/services/markdown-parser.js';
import { search } from '../../src/services/search.js';
import type { RecallFixture } from './fixtures/memory-recall-dataset.js';
import { memoryRecallDataset } from './fixtures/memory-recall-dataset.js';

interface RecallEnvironment {
  db: BrainDB;
  embedder: LocalEmbedder;
  tempDir: string;
}

function setupRecallEnvironment(fixtures: RecallFixture[]): Promise<RecallEnvironment> {
  const tempDir = mkdtempSync(join(tmpdir(), 'brain-recall-'));
  const notesDir = join(tempDir, 'notes');
  const dbPath = join(tempDir, 'recall.db');

  mkdirSync(notesDir, { recursive: true });

  const db = new BrainDB(dbPath);
  const embedder = new LocalEmbedder();
  db.setEmbeddingModel(embedder.model, embedder.dimensions);

  return indexFixtures(db, embedder, notesDir, fixtures).then(() => ({
    db,
    embedder,
    tempDir,
  }));
}

async function indexFixtures(
  db: BrainDB,
  embedder: LocalEmbedder,
  notesDir: string,
  fixtures: RecallFixture[]
): Promise<void> {
  for (const fixture of fixtures) {
    const filename = `${fixture.id}.md`;
    const markdown = [
      '---',
      `title: ${fixture.id}`,
      'type: note',
      'tier: slow',
      '---',
      '',
      fixture.sourceText,
    ].join('\n');

    const filePath = join(notesDir, filename);
    writeFileSync(filePath, markdown, 'utf-8');

    const parsed = parseMarkdown(filePath, markdown);

    db.upsertNote({
      id: parsed.id,
      filePath: parsed.filePath,
      title: parsed.frontmatter.title,
      type: parsed.frontmatter.type,
      tier: parsed.frontmatter.tier,
      category: null,
      tags: null,
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

    db.upsertNoteFTS(parsed.id, parsed.frontmatter.title, '', fixture.sourceText);

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
}

function checkRecall(searchExcerpts: string[], expectedFacts: string[]): number {
  let found = 0;
  const combinedText = searchExcerpts.join(' ').toLowerCase();

  for (const fact of expectedFacts) {
    if (combinedText.includes(fact.toLowerCase())) {
      found++;
    }
  }

  return found / expectedFacts.length;
}

describe('LoCoMo-style memory recall benchmark', { timeout: 120_000 }, () => {
  let env: RecallEnvironment;

  beforeAll(async () => {
    env = await setupRecallEnvironment(memoryRecallDataset);
  });

  afterAll(() => {
    env.db.close();
    rmSync(env.tempDir, { recursive: true, force: true });
  });

  describe.each(memoryRecallDataset)('$category: $id', (fixture) => {
    test.each(fixture.recallQueries)('query: "%s" recalls expected facts', async (query) => {
      const { results } = await search(env.db, env.embedder, query, { limit: 5 });

      const excerpts = results.map((r) => r.excerpt);
      const recall = checkRecall(excerpts, fixture.expectedFacts);

      console.log(
        `  [${fixture.id}] query="${query}" recall=${recall.toFixed(2)} ` +
          `(${Math.round(recall * fixture.expectedFacts.length)}/${fixture.expectedFacts.length})`
      );

      expect(recall).toBeGreaterThan(0);
    });
  });

  test('aggregate recall rate across all fixtures', async () => {
    let totalFound = 0;
    let totalExpected = 0;

    for (const fixture of memoryRecallDataset) {
      for (const query of fixture.recallQueries) {
        const { results } = await search(env.db, env.embedder, query, { limit: 5 });
        const excerpts = results.map((r) => r.excerpt);
        const combinedText = excerpts.join(' ').toLowerCase();

        for (const fact of fixture.expectedFacts) {
          totalExpected++;
          if (combinedText.includes(fact.toLowerCase())) {
            totalFound++;
          }
        }
      }
    }

    const aggregateRecall = totalFound / totalExpected;
    console.log(
      `\nAggregate recall: ${aggregateRecall.toFixed(3)} (${totalFound}/${totalExpected})`
    );

    expect(aggregateRecall).toBeGreaterThanOrEqual(0.5);
  });

  test('recall by category', async () => {
    const categories = [...new Set(memoryRecallDataset.map((f) => f.category))];
    const categoryRecall = new Map<string, { found: number; total: number }>();

    for (const cat of categories) {
      categoryRecall.set(cat, { found: 0, total: 0 });
    }

    for (const fixture of memoryRecallDataset) {
      const stats = categoryRecall.get(fixture.category)!;

      for (const query of fixture.recallQueries) {
        const { results } = await search(env.db, env.embedder, query, { limit: 5 });
        const combinedText = results
          .map((r) => r.excerpt)
          .join(' ')
          .toLowerCase();

        for (const fact of fixture.expectedFacts) {
          stats.total++;
          if (combinedText.includes(fact.toLowerCase())) {
            stats.found++;
          }
        }
      }
    }

    console.log('\nRecall by category:');
    for (const [cat, stats] of categoryRecall) {
      const rate = stats.found / stats.total;
      console.log(`  ${cat}: ${rate.toFixed(3)} (${stats.found}/${stats.total})`);
      expect(rate).toBeGreaterThan(0);
    }
  });
});
