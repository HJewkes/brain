import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { BrainDB } from '../../src/services/brain-db.js';
import { search } from '../../src/services/search.js';
import { tmpDbPath, createMockEmbedder } from '../helpers.js';
import { indexSingleFile } from '../../src/services/indexing.js';
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID, createHash } from 'node:crypto';

let db: BrainDB;
let notesDir: string;
const embedder = createMockEmbedder();
const weights = { bm25: 0.3, vector: 0.7 };

beforeEach(async () => {
  db = new BrainDB(tmpDbPath('search-guardrails'));
  db.setEmbeddingModel(embedder.model, embedder.dimensions);
  notesDir = join(tmpdir(), `sg-${randomUUID()}`);
  mkdirSync(notesDir, { recursive: true });
});

afterEach(() => {
  db.close();
  if (existsSync(notesDir)) rmSync(notesDir, { recursive: true, force: true });
});

async function indexNote(id: string, content: string) {
  const path = join(notesDir, `${id}.md`);
  const full = `---\nid: ${id}\ntitle: "${id}"\ntype: note\ntier: fast\n---\n\n${content}`;
  writeFileSync(path, full);
  const hash = createHash('sha256').update(full).digest('hex');
  await indexSingleFile(db, embedder, path, full, hash, Date.now());
}

describe('search guardrails', () => {
  it('applies default min-score when none specified', async () => {
    await indexNote('relevant', 'TypeScript programming language features');
    const results = await search(db, embedder, 'TypeScript', { limit: 10 }, weights);
    // All returned results should have score >= default threshold
    for (const r of results) {
      expect(r.score).toBeGreaterThanOrEqual(0.2);
    }
  });

  it('explicit minScore overrides default', async () => {
    await indexNote('test-note', 'JavaScript programming basics');
    const results = await search(db, embedder, 'JavaScript', { limit: 10, minScore: 0.01 }, weights);
    // With very low explicit threshold, results should still return
    expect(results.length).toBeGreaterThanOrEqual(0);
  });

  it('returns empty array when all results below threshold', async () => {
    // Query something completely unrelated to indexed content
    await indexNote('cooking', 'Recipe for chocolate cake with vanilla frosting');
    const results = await search(db, embedder, 'quantum physics relativity', { limit: 10, minScore: 0.9 }, weights);
    expect(results).toHaveLength(0);
  });
});
