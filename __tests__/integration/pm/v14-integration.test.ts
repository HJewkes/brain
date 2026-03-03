import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, existsSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID, createHash } from 'node:crypto';
import { BrainDB } from '../../../src/services/brain-db.js';
import { tmpDbPath, createMockEmbedder } from '../../helpers.js';
import type { BrainConfig } from '../../../src/types.js';
import { createProject } from '../../../src/modules/pm/data/project-ops.js';
import { createWorkstream } from '../../../src/modules/pm/data/workstream-ops.js';
import { createTask } from '../../../src/modules/pm/data/task-ops.js';
import { search } from '../../../src/services/search.js';
import { indexSingleFile } from '../../../src/services/indexing.js';

let db: BrainDB;
let notesDir: string;
let config: BrainConfig;
const embedder = createMockEmbedder();

beforeEach(async () => {
  db = new BrainDB(tmpDbPath('v14-integration'));
  db.setEmbeddingModel(embedder.model, embedder.dimensions);
  notesDir = join(tmpdir(), `v14-int-${randomUUID()}`);
  mkdirSync(notesDir, { recursive: true });
  config = { notesDir, dbPath: '', embedder: 'local', fusionWeights: { bm25: 0.3, vector: 0.7 } };
});

afterEach(() => {
  db.close();
  if (existsSync(notesDir)) rmSync(notesDir, { recursive: true, force: true });
});

describe('V14 integration', () => {
  it('search applies default min-score filtering', async () => {
    // Index a note
    const path = join(notesDir, 'test.md');
    const content =
      '---\nid: test\ntitle: "Test Note"\ntype: note\ntier: fast\n---\n\nTypeScript programming.';
    writeFileSync(path, content);
    const hash = createHash('sha256').update(content).digest('hex');
    await indexSingleFile(db, embedder, path, content, hash, Date.now());

    // Search should filter low-score results by default
    const results = await search(db, embedder, 'TypeScript', { limit: 10 }, config.fusionWeights);
    for (const r of results) {
      expect(r.score).toBeGreaterThanOrEqual(0.2);
    }
  });

  it('task with references creates graph edges', async () => {
    await createProject(db, config, embedder, { name: 'V14 Test', prefix: 'V14' });
    await createWorkstream(db, config, embedder, { project: 'V14', name: 'Core' });

    // Index a source doc
    const docPath = join(notesDir, 'design-spec.md');
    const docContent =
      '---\nid: design-spec\ntitle: "Design Spec"\ntype: research\ntier: slow\n---\n\nSystem design specification.';
    writeFileSync(docPath, docContent);
    const hash = createHash('sha256').update(docContent).digest('hex');
    await indexSingleFile(db, embedder, docPath, docContent, hash, Date.now());

    // Create task referencing that doc
    const result = await createTask(db, config, embedder, {
      project: 'V14',
      workstream: 1,
      name: 'Implement design',
      references: ['design-spec'],
    });
    expect(result.ok).toBe(true);

    // Verify graph edge exists
    const taskNote = db.getAllNotes().find((n) => {
      const meta = JSON.parse(n.metadata ?? '{}');
      return meta.display_id === 'V14-01.01';
    });
    expect(taskNote).toBeDefined();
    const relations = db.getRelationsFrom(taskNote!.id);
    expect(relations.some((r) => r.type === 'references')).toBe(true);
  });

  it('end-to-end: create → reference → search → graph', async () => {
    await createProject(db, config, embedder, { name: 'E2E', prefix: 'E2E' });
    await createWorkstream(db, config, embedder, { project: 'E2E', name: 'Main' });

    // Index source doc
    const docPath = join(notesDir, 'api-guide.md');
    const docContent =
      '---\nid: api-guide\ntitle: "API Guide"\ntype: research\ntier: slow\n---\n\nComprehensive API development guide with REST patterns.';
    writeFileSync(docPath, docContent);
    const hash = createHash('sha256').update(docContent).digest('hex');
    await indexSingleFile(db, embedder, docPath, docContent, hash, Date.now());

    // Create task with reference
    await createTask(db, config, embedder, {
      project: 'E2E',
      workstream: 1,
      name: 'Build REST API',
      references: ['api-guide'],
      description: 'Implement the REST API following the API guide patterns.',
    });

    // Task note should have chunks (searchable)
    const taskNote = db.getAllNotes().find((n) => {
      const meta = JSON.parse(n.metadata ?? '{}');
      return meta.display_id === 'E2E-01.01';
    });
    expect(taskNote).toBeDefined();
    const chunks = db.getChunksForNote(taskNote!.id);
    expect(chunks.length).toBeGreaterThan(0);

    // Reference relation should exist
    const relations = db.getRelationsFrom(taskNote!.id);
    expect(relations.some((r) => r.type === 'references')).toBe(true);
  });
});
