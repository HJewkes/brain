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

import { indexSingleFile } from '../../../src/services/indexing.js';
import { computeAutoLinks, computeGraphScores } from '../../../src/services/graph.js';
import { createTestTask } from '../../helpers.js';

let db: BrainDB;
let notesDir: string;
let config: BrainConfig;
const embedder = createMockEmbedder();

async function seedProjectAndWorkstream(prefix: string) {
  await createProject(db, config, embedder, { name: `${prefix} Project`, prefix });
  await createWorkstream(db, config, embedder, { project: prefix, name: 'Main' });
}

async function indexDoc(id: string, title: string, content: string): Promise<string> {
  const docPath = join(notesDir, `${id}.md`);
  const full = `---\nid: ${id}\ntitle: "${title}"\ntype: research\ntier: slow\n---\n\n${content}`;
  writeFileSync(docPath, full);
  const hash = createHash('sha256').update(full).digest('hex');
  return await indexSingleFile(db, embedder, docPath, full, hash, Date.now());
}

function findTaskNoteId(displayId: string): string {
  const notes = db.getAllNotes().filter(n => {
    if (!n.metadata) return false;
    const meta = JSON.parse(n.metadata);
    return meta.display_id === displayId;
  });
  expect(notes).toHaveLength(1);
  return notes[0].id;
}

beforeEach(async () => {
  db = new BrainDB(tmpDbPath('v14-reg-graph'));
  db.setEmbeddingModel(embedder.model, embedder.dimensions);
  notesDir = join(tmpdir(), `v14-reg-${randomUUID()}`);
  mkdirSync(notesDir, { recursive: true });
  config = { notesDir, dbPath: '', embedder: 'local', fusionWeights: { bm25: 0.3, vector: 0.7 } };
});

afterEach(() => {
  db.close();
  if (existsSync(notesDir)) rmSync(notesDir, { recursive: true, force: true });
});

describe('O-224: references relation edges after task creation', () => {
  it('task with references gets references edges and parent edge', async () => {
    await seedProjectAndWorkstream('GR');
    const docNoteId = await indexDoc('design-doc', 'Design Doc', 'System design for the API layer.');

    const result = await createTestTask(db, config, embedder, {
      project: 'GR', workstream: 1, name: 'Implement design',
      references: ['design-doc'],
    });
    expect(result.ok).toBe(true);

    const taskNoteId = findTaskNoteId('GR-01.01');
    const relations = db.getRelationsFrom(taskNoteId);
    const refEdges = relations.filter(r => r.type === 'references');
    expect(refEdges).toHaveLength(1);
    expect(refEdges[0].targetId).toBe(docNoteId);

    // Should also have parent edge from workstream -> task
    const incomingRels = db.getRelationsTo(taskNoteId);
    const parentEdges = incomingRels.filter(r => r.type === 'parent');
    expect(parentEdges.length).toBeGreaterThanOrEqual(1);
  });

  it('task with multiple references gets all edges', async () => {
    await seedProjectAndWorkstream('MR');
    const docA = await indexDoc('arch-doc', 'Architecture', 'Microservices architecture overview.');
    const docB = await indexDoc('api-doc', 'API Guide', 'REST API patterns and conventions.');

    const result = await createTestTask(db, config, embedder, {
      project: 'MR', workstream: 1, name: 'Build microservice',
      references: ['arch-doc', 'api-doc'],
    });
    expect(result.ok).toBe(true);

    const taskNoteId = findTaskNoteId('MR-01.01');
    const relations = db.getRelationsFrom(taskNoteId);
    const refEdges = relations.filter(r => r.type === 'references');
    expect(refEdges).toHaveLength(2);

    const targetIds = new Set(refEdges.map(r => r.targetId));
    expect(targetIds.has(docA)).toBe(true);
    expect(targetIds.has(docB)).toBe(true);
  });
});

describe('O-223: auto-links at lower threshold', () => {
  it('computeAutoLinks runs without error at default 0.65 threshold', async () => {
    await seedProjectAndWorkstream('AL');

    await indexDoc('guide-a', 'Deployment Guide', 'How to deploy the application to production servers.');
    const noteB = await indexDoc('guide-b', 'Deployment Checklist', 'Pre-deployment checks for production servers.');

    const links = computeAutoLinks(db, noteB);
    expect(Array.isArray(links)).toBe(true);
    // Each link should have the correct structure
    for (const link of links) {
      expect(link).toHaveProperty('sourceId', noteB);
      expect(link).toHaveProperty('targetId');
      expect(link).toHaveProperty('type', 'related');
    }
  });
});

describe('O-225: re-ingesting docs does not create duplicates', () => {
  it('indexing same doc twice keeps note count stable', async () => {
    const docId = 'stable-doc';
    const docPath = join(notesDir, `${docId}.md`);

    const contentV1 = `---\nid: ${docId}\ntitle: "Stable Doc"\ntype: research\ntier: slow\n---\n\nVersion 1 content.`;
    writeFileSync(docPath, contentV1);
    const hash1 = createHash('sha256').update(contentV1).digest('hex');
    await indexSingleFile(db, embedder, docPath, contentV1, hash1, Date.now());

    const countAfterFirst = db.getAllNotes().filter(n => n.id === docId).length;
    expect(countAfterFirst).toBe(1);

    // Re-ingest with updated content but same ID
    const contentV2 = `---\nid: ${docId}\ntitle: "Stable Doc"\ntype: research\ntier: slow\n---\n\nVersion 2 content with updates.`;
    writeFileSync(docPath, contentV2);
    const hash2 = createHash('sha256').update(contentV2).digest('hex');
    await indexSingleFile(db, embedder, docPath, contentV2, hash2, Date.now());

    const countAfterSecond = db.getAllNotes().filter(n => n.id === docId).length;
    expect(countAfterSecond).toBe(1);
  });
});

describe('O-49: task notes are searchable', () => {
  it('chunks exist after createTask', async () => {
    await seedProjectAndWorkstream('SR');

    const result = await createTestTask(db, config, embedder, {
      project: 'SR', workstream: 1, name: 'Searchable task with unique keywords',
      description: 'This task involves refactoring the authentication middleware.',
    });
    expect(result.ok).toBe(true);

    const taskNoteId = findTaskNoteId('SR-01.01');
    const chunks = db.getChunksForNote(taskNoteId);
    expect(chunks.length).toBeGreaterThan(0);

    // At least one chunk should contain task content
    const hasContent = chunks.some(c => c.content.includes('Searchable task'));
    expect(hasContent).toBe(true);
  });
});

describe('Graph traversal: computeGraphScores from task finds referenced docs', () => {
  it('referenced doc appears at depth 1 with score 0.5', async () => {
    await seedProjectAndWorkstream('GT');
    const docNoteId = await indexDoc('ref-target', 'Target Doc', 'Important reference material.');

    const result = await createTestTask(db, config, embedder, {
      project: 'GT', workstream: 1, name: 'Graph traversal task',
      references: ['ref-target'],
    });
    expect(result.ok).toBe(true);

    const taskNoteId = findTaskNoteId('GT-01.01');
    const scores = computeGraphScores(db, taskNoteId, 1);

    expect(scores.has(docNoteId)).toBe(true);
    const docScore = scores.get(docNoteId)!;
    expect(docScore.depth).toBe(1);
    expect(docScore.score).toBeCloseTo(0.5);
    expect(docScore.relationType).toBe('references');
  });

  it('two-hop traversal finds doc connected through intermediate node', async () => {
    await seedProjectAndWorkstream('TH');
    const specDoc = await indexDoc('spec-doc', 'Spec', 'Technical specification.');
    const implDoc = await indexDoc('impl-doc', 'Impl Guide', 'Implementation guide.');

    // Create task referencing spec-doc
    const result = await createTestTask(db, config, embedder, {
      project: 'TH', workstream: 1, name: 'Two-hop task',
      references: ['spec-doc'],
    });
    expect(result.ok).toBe(true);

    // Manually add a relation from spec-doc -> impl-doc
    db.upsertRelations(specDoc, [
      { sourceId: specDoc, targetId: implDoc, type: 'related' },
    ]);

    const taskNoteId = findTaskNoteId('TH-01.01');
    const scores = computeGraphScores(db, taskNoteId, 2);

    // spec-doc at depth 1
    expect(scores.has(specDoc)).toBe(true);
    expect(scores.get(specDoc)!.depth).toBe(1);

    // impl-doc at depth 2
    expect(scores.has(implDoc)).toBe(true);
    expect(scores.get(implDoc)!.depth).toBe(2);
    expect(scores.get(implDoc)!.score).toBeCloseTo(0.25);
  });
});
