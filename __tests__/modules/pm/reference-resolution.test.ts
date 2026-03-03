import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID, createHash } from 'node:crypto';
import { BrainDB } from '../../../src/services/brain-db.js';
import { tmpDbPath, createMockEmbedder } from '../../helpers.js';
import type { BrainConfig } from '../../../src/types.js';
import { createProject } from '../../../src/modules/pm/data/project-ops.js';
import { createWorkstream } from '../../../src/modules/pm/data/workstream-ops.js';
import { createTask } from '../../../src/modules/pm/data/task-ops.js';
import { indexSingleFile } from '../../../src/services/indexing.js';

let db: BrainDB;
let notesDir: string;
let config: BrainConfig;
const embedder = createMockEmbedder();

beforeEach(async () => {
  db = new BrainDB(tmpDbPath('ref-resolution'));
  db.setEmbeddingModel(embedder.model, embedder.dimensions);
  notesDir = join(tmpdir(), `ref-res-${randomUUID()}`);
  mkdirSync(notesDir, { recursive: true });
  config = { notesDir, dbPath: '', embedder: 'local', fusionWeights: { bm25: 0.3, vector: 0.7 } };
  await createProject(db, config, embedder, { name: 'Ref Test', prefix: 'REF' });
  await createWorkstream(db, config, embedder, { project: 'REF', name: 'Core' });
});

afterEach(() => {
  db.close();
  if (existsSync(notesDir)) rmSync(notesDir, { recursive: true, force: true });
});

describe('reference resolution', () => {
  it('creates references relation when target note exists', async () => {
    // Index a source doc first
    const docPath = join(notesDir, 'api-spec.md');
    const docContent =
      '---\nid: api-spec\ntitle: "API Spec"\ntype: research\ntier: slow\n---\n\nAPI specification document.';
    writeFileSync(docPath, docContent);
    const hash = createHash('sha256').update(docContent).digest('hex');
    await indexSingleFile(db, embedder, docPath, docContent, hash, Date.now());

    // Create task with reference to that doc
    const result = await createTask(db, config, embedder, {
      project: 'REF',
      workstream: 1,
      name: 'Implement API',
      references: ['api-spec'],
    });
    expect(result.ok).toBe(true);

    // Verify relation edge was created
    const taskNotes = db.getAllNotes().filter((n) => {
      const meta = JSON.parse(n.metadata ?? '{}');
      return meta.display_id === 'REF-01.01';
    });
    expect(taskNotes).toHaveLength(1);
    const relations = db.getRelationsFrom(taskNotes[0].id);
    const refRels = relations.filter((r) => r.type === 'references');
    expect(refRels).toHaveLength(1);
  });

  it('skips references when target note not found', async () => {
    const result = await createTask(db, config, embedder, {
      project: 'REF',
      workstream: 1,
      name: 'Task with bad ref',
      references: ['nonexistent-doc'],
    });
    expect(result.ok).toBe(true);

    const taskNotes = db.getAllNotes().filter((n) => {
      const meta = JSON.parse(n.metadata ?? '{}');
      return meta.display_id === 'REF-01.01';
    });
    const relations = db.getRelationsFrom(taskNotes[0].id);
    const refRels = relations.filter((r) => r.type === 'references');
    expect(refRels).toHaveLength(0);
  });

  it('creates multiple reference relations', async () => {
    // Index two source docs
    for (const id of ['doc-a', 'doc-b']) {
      const path = join(notesDir, `${id}.md`);
      const content = `---\nid: ${id}\ntitle: "${id}"\ntype: research\ntier: slow\n---\n\nContent for ${id}.`;
      writeFileSync(path, content);
      const hash = createHash('sha256').update(content).digest('hex');
      await indexSingleFile(db, embedder, path, content, hash, Date.now());
    }

    const result = await createTask(db, config, embedder, {
      project: 'REF',
      workstream: 1,
      name: 'Multi-ref task',
      references: ['doc-a', 'doc-b'],
    });
    expect(result.ok).toBe(true);

    const taskNotes = db.getAllNotes().filter((n) => {
      const meta = JSON.parse(n.metadata ?? '{}');
      return meta.display_id === 'REF-01.01';
    });
    const relations = db.getRelationsFrom(taskNotes[0].id);
    const refRels = relations.filter((r) => r.type === 'references');
    expect(refRels).toHaveLength(2);
  });
});
