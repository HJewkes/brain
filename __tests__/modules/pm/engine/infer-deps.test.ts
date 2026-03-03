import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { BrainDB } from '../../../../src/services/brain-db.js';
import { tmpDbPath, createMockEmbedder } from '../../../helpers.js';
import type { BrainConfig } from '../../../../src/types.js';
import { createProject } from '../../../../src/modules/pm/data/project-ops.js';
import { createWorkstream } from '../../../../src/modules/pm/data/workstream-ops.js';

import { getPmNotes } from '../../../../src/modules/pm/data/queries.js';
import { buildDependencyGraph, inferDependencies } from '../../../../src/modules/pm/engine/dependency.js';
import { createTestTask } from '../../../helpers.js';

let db: BrainDB;
let dbPath: string;
let notesDir: string;
let config: BrainConfig;
const embedder = createMockEmbedder();

beforeEach(async () => {
  dbPath = tmpDbPath('pm-infer-deps');
  db = new BrainDB(dbPath);
  notesDir = join(tmpdir(), `pm-infer-deps-notes-${randomUUID()}`);
  mkdirSync(notesDir, { recursive: true });
  config = {
    notesDir,
    dbPath,
    embedder: 'local',
    fusionWeights: { bm25: 0.3, vector: 0.7 },
  };
});

afterEach(() => {
  db.close();
  if (existsSync(notesDir)) {
    rmSync(notesDir, { recursive: true, force: true });
  }
});

describe('inferDependencies', () => {
  it('testing task depends on implementation task in same workstream', async () => {
    await createProject(db, config, embedder, { name: 'Proj', prefix: 'INF' });
    await createWorkstream(db, config, embedder, { project: 'INF', name: 'WS1' });
    await createTestTask(db, config, embedder, {
      project: 'INF', workstream: 1, name: 'Build feature', category: 'implementation',
    });
    await createTestTask(db, config, embedder, {
      project: 'INF', workstream: 1, name: 'Test feature', category: 'testing',
    });

    const created = inferDependencies(db, 'INF');

    expect(created).toBe(1);
    const graph = buildDependencyGraph(db, 'INF');
    expect(graph.get('INF-01.02')).toEqual(['INF-01.01']);
  });

  it('docs task depends on implementation task', async () => {
    await createProject(db, config, embedder, { name: 'Proj', prefix: 'DOC' });
    await createWorkstream(db, config, embedder, { project: 'DOC', name: 'WS1' });
    await createTestTask(db, config, embedder, {
      project: 'DOC', workstream: 1, name: 'Build it', category: 'implementation',
    });
    await createTestTask(db, config, embedder, {
      project: 'DOC', workstream: 1, name: 'Document it', category: 'documentation',
    });

    const created = inferDependencies(db, 'DOC');

    expect(created).toBe(1);
    const graph = buildDependencyGraph(db, 'DOC');
    expect(graph.get('DOC-01.02')).toEqual(['DOC-01.01']);
  });

  it('review task depends on implementation + testing tasks', async () => {
    await createProject(db, config, embedder, { name: 'Proj', prefix: 'REV' });
    await createWorkstream(db, config, embedder, { project: 'REV', name: 'WS1' });
    await createTestTask(db, config, embedder, {
      project: 'REV', workstream: 1, name: 'Build', category: 'implementation',
    });
    await createTestTask(db, config, embedder, {
      project: 'REV', workstream: 1, name: 'Test', category: 'testing',
    });
    await createTestTask(db, config, embedder, {
      project: 'REV', workstream: 1, name: 'Review', category: 'review',
    });

    const created = inferDependencies(db, 'REV');

    // testing->impl (1) + review->impl (1) + review->testing (1) = 3
    expect(created).toBe(3);
    const graph = buildDependencyGraph(db, 'REV');
    expect(graph.get('REV-01.03')!.sort()).toEqual(['REV-01.01', 'REV-01.02']);
  });

  it('research tasks are never depended upon by auto-inference', async () => {
    await createProject(db, config, embedder, { name: 'Proj', prefix: 'RES' });
    await createWorkstream(db, config, embedder, { project: 'RES', name: 'WS1' });
    await createTestTask(db, config, embedder, {
      project: 'RES', workstream: 1, name: 'Investigate', category: 'research',
    });
    await createTestTask(db, config, embedder, {
      project: 'RES', workstream: 1, name: 'Build', category: 'implementation',
    });

    const created = inferDependencies(db, 'RES');

    // No rules create edges TO research, and research has no rules to depend on others
    expect(created).toBe(0);
    const graph = buildDependencyGraph(db, 'RES');
    expect(graph.get('RES-01.01')).toEqual([]);
    expect(graph.get('RES-01.02')).toEqual([]);
  });

  it('no cross-workstream dependencies created', async () => {
    await createProject(db, config, embedder, { name: 'Proj', prefix: 'CRS' });
    await createWorkstream(db, config, embedder, { project: 'CRS', name: 'WS1' });
    await createWorkstream(db, config, embedder, { project: 'CRS', name: 'WS2' });
    await createTestTask(db, config, embedder, {
      project: 'CRS', workstream: 1, name: 'Build in WS1', category: 'implementation',
    });
    await createTestTask(db, config, embedder, {
      project: 'CRS', workstream: 2, name: 'Test in WS2', category: 'testing',
    });

    const created = inferDependencies(db, 'CRS');

    expect(created).toBe(0);
    const graph = buildDependencyGraph(db, 'CRS');
    expect(graph.get('CRS-01.01')).toEqual([]);
    expect(graph.get('CRS-02.01')).toEqual([]);
  });

  it('no self-dependencies', async () => {
    await createProject(db, config, embedder, { name: 'Proj', prefix: 'SLF' });
    await createWorkstream(db, config, embedder, { project: 'SLF', name: 'WS1' });
    await createTestTask(db, config, embedder, {
      project: 'SLF', workstream: 1, name: 'Solo impl', category: 'implementation',
    });

    const created = inferDependencies(db, 'SLF');

    expect(created).toBe(0);
    const graph = buildDependencyGraph(db, 'SLF');
    expect(graph.get('SLF-01.01')).toEqual([]);
  });

  it('existing explicit dependencies preserved and not duplicated', async () => {
    const p = await createProject(db, config, embedder, { name: 'Proj', prefix: 'EXP' });
    if (!p.ok) throw new Error(p.error.message);
    const ws = await createWorkstream(db, config, embedder, { project: 'EXP', name: 'WS1' });
    if (!ws.ok) throw new Error(ws.error.message);
    const t1 = await createTestTask(db, config, embedder, {
      project: 'EXP', workstream: 1, name: 'Build', category: 'implementation',
    });
    if (!t1.ok) throw new Error(t1.error.message);
    const t2 = await createTestTask(db, config, embedder, {
      project: 'EXP', workstream: 1, name: 'Test', category: 'testing',
    });
    if (!t2.ok) throw new Error(t2.error.message);

    // Manually create explicit dependency: testing -> implementation
    const implNotes = getPmNotes(db, 'task', { display_id: 'EXP-01.01' });
    const testNotes = getPmNotes(db, 'task', { display_id: 'EXP-01.02' });
    db.upsertRelations(testNotes[0].id, [
      { sourceId: testNotes[0].id, targetId: implNotes[0].id, type: 'depends_on' },
    ]);

    // Verify explicit dependency exists
    const graphBefore = buildDependencyGraph(db, 'EXP');
    expect(graphBefore.get('EXP-01.02')).toEqual(['EXP-01.01']);

    const created = inferDependencies(db, 'EXP');

    // Should skip the already-existing edge
    expect(created).toBe(0);
    const graphAfter = buildDependencyGraph(db, 'EXP');
    expect(graphAfter.get('EXP-01.02')).toEqual(['EXP-01.01']);
  });

  it('returns count of edges created', async () => {
    await createProject(db, config, embedder, { name: 'Proj', prefix: 'CNT' });
    await createWorkstream(db, config, embedder, { project: 'CNT', name: 'WS1' });
    await createTestTask(db, config, embedder, {
      project: 'CNT', workstream: 1, name: 'Build A', category: 'implementation',
    });
    await createTestTask(db, config, embedder, {
      project: 'CNT', workstream: 1, name: 'Build B', category: 'implementation',
    });
    await createTestTask(db, config, embedder, {
      project: 'CNT', workstream: 1, name: 'Test', category: 'testing',
    });
    await createTestTask(db, config, embedder, {
      project: 'CNT', workstream: 1, name: 'Docs', category: 'documentation',
    });

    const created = inferDependencies(db, 'CNT');

    // testing depends on 2 impl tasks = 2 edges
    // docs depends on 2 impl tasks = 2 edges
    // total = 4
    expect(created).toBe(4);
  });
});
