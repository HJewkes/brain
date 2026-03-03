import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { BrainDB } from '../../../src/services/brain-db.js';
import { tmpDbPath, createMockEmbedder } from '../../helpers.js';
import type { BrainConfig } from '../../../src/types.js';
import { createProject } from '../../../src/modules/pm/data/project-ops.js';
import { createWorkstream } from '../../../src/modules/pm/data/workstream-ops.js';
import { createTask } from '../../../src/modules/pm/data/task-ops.js';
import { getPmNotes } from '../../../src/modules/pm/data/queries.js';
import { traverseGraph } from '../../../src/services/graph.js';

let db: BrainDB;
let dbPath: string;
let notesDir: string;
let config: BrainConfig;
const embedder = createMockEmbedder();

beforeEach(async () => {
  dbPath = tmpDbPath('pm-v12-hierarchy');
  db = new BrainDB(dbPath);
  notesDir = join(tmpdir(), `pm-v12-hierarchy-${randomUUID()}`);
  mkdirSync(notesDir, { recursive: true });
  config = {
    notesDir,
    dbPath,
    embedder: 'local',
    fusionWeights: { bm25: 0.3, vector: 0.7 },
  };

  const proj = await createProject(db, config, embedder, {
    name: 'Hierarchy Test',
    prefix: 'HRC',
  });
  if (!proj.ok) throw new Error(proj.error.message);

  const ws = await createWorkstream(db, config, embedder, {
    project: 'HRC',
    name: 'Core',
  });
  if (!ws.ok) throw new Error(ws.error.message);
});

afterEach(() => {
  db.close();
  if (existsSync(notesDir)) {
    rmSync(notesDir, { recursive: true, force: true });
  }
});

describe('hierarchy parent edges', () => {
  it('createTask creates parent edge from workstream note to task note', async () => {
    const result = await createTask(db, config, embedder, {
      project: 'HRC',
      workstream: 1,
      name: 'First task',
    });
    expect(result.ok).toBe(true);

    const wsNotes = getPmNotes(db, 'workstream', { display_id: 'HRC-01' });
    expect(wsNotes.length).toBe(1);

    const taskNotes = getPmNotes(db, 'task', { display_id: 'HRC-01.01' });
    expect(taskNotes.length).toBe(1);

    const relationsFromWs = db.getRelationsFrom(wsNotes[0].id);
    const parentEdges = relationsFromWs.filter((r) => r.type === 'parent');
    expect(parentEdges.length).toBe(1);
    expect(parentEdges[0].targetId).toBe(taskNotes[0].id);
  });

  it('graph traversal from workstream note reaches task notes', async () => {
    await createTask(db, config, embedder, {
      project: 'HRC',
      workstream: 1,
      name: 'Task A',
    });
    await createTask(db, config, embedder, {
      project: 'HRC',
      workstream: 1,
      name: 'Task B',
    });

    const wsNotes = getPmNotes(db, 'workstream', { display_id: 'HRC-01' });
    expect(wsNotes.length).toBe(1);

    const graph = traverseGraph(db, wsNotes[0].id, 1);
    const taskNodes = graph.nodes.filter((n) => n.type === 'task');
    expect(taskNodes.length).toBe(2);

    const wsToTaskEdges = graph.edges.filter(
      (e) => e.type === 'parent' && e.sourceId === wsNotes[0].id
    );
    expect(wsToTaskEdges.length).toBe(2);
  });

  it('graph traversal from project note reaches workstream notes', async () => {
    const ws2 = await createWorkstream(db, config, embedder, {
      project: 'HRC',
      name: 'Secondary',
    });
    if (!ws2.ok) throw new Error(ws2.error.message);

    const projectNotes = getPmNotes(db, 'project', { prefix: 'HRC' });
    expect(projectNotes.length).toBe(1);

    const graph = traverseGraph(db, projectNotes[0].id, 1);
    const wsNodes = graph.nodes.filter((n) => n.type === 'workstream');
    expect(wsNodes.length).toBe(2);

    const parentEdges = graph.edges.filter((e) => e.type === 'parent');
    expect(parentEdges.length).toBe(2);
  });

  it('graph traversal from project note reaches tasks at depth 2', async () => {
    await createTask(db, config, embedder, {
      project: 'HRC',
      workstream: 1,
      name: 'Deep task',
    });

    const projectNotes = getPmNotes(db, 'project', { prefix: 'HRC' });
    const graph = traverseGraph(db, projectNotes[0].id, 2);

    const taskNodes = graph.nodes.filter((n) => n.type === 'task');
    expect(taskNodes.length).toBe(1);

    const wsNodes = graph.nodes.filter((n) => n.type === 'workstream');
    expect(wsNodes.length).toBe(1);
  });

  it('multiple tasks in same workstream each get a parent edge', async () => {
    for (let i = 0; i < 3; i++) {
      const r = await createTask(db, config, embedder, {
        project: 'HRC',
        workstream: 1,
        name: `Task ${i + 1}`,
      });
      expect(r.ok).toBe(true);
    }

    const wsNotes = getPmNotes(db, 'workstream', { display_id: 'HRC-01' });
    const relationsFromWs = db.getRelationsFrom(wsNotes[0].id);
    const parentEdges = relationsFromWs.filter((r) => r.type === 'parent');
    expect(parentEdges.length).toBe(3);
  });
});
