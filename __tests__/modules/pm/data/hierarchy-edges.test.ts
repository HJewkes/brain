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
import { deleteTask } from '../../../../src/modules/pm/data/task-ops.js';
import { getPmNotes } from '../../../../src/modules/pm/data/queries.js';
import { createTestTask } from '../../../helpers.js';

let db: BrainDB;
let dbPath: string;
let notesDir: string;
let config: BrainConfig;
const embedder = createMockEmbedder();

beforeEach(async () => {
  dbPath = tmpDbPath('pm-hierarchy-edges');
  db = new BrainDB(dbPath);
  notesDir = join(tmpdir(), `pm-hierarchy-notes-${randomUUID()}`);
  mkdirSync(notesDir, { recursive: true });
  config = {
    notesDir,
    dbPath,
    embedder: 'local',
    fusionWeights: { bm25: 0.3, vector: 0.7 },
  };

  await createProject(db, config, embedder, { name: 'Alpha', prefix: 'ALP' });
});

afterEach(() => {
  db.close();
  if (existsSync(notesDir)) {
    rmSync(notesDir, { recursive: true, force: true });
  }
});

describe('PM hierarchy edges', () => {
  it('createWorkstream creates parent relation from project to workstream', async () => {
    await createWorkstream(db, config, embedder, { project: 'ALP', name: 'Backend' });

    const projectNotes = getPmNotes(db, 'project', { prefix: 'ALP' });
    expect(projectNotes.length).toBeGreaterThan(0);

    const wsNotes = getPmNotes(db, 'workstream', { project: 'ALP' });
    expect(wsNotes.length).toBeGreaterThan(0);

    const relations = db.getRelationsFrom(projectNotes[0].id);
    const parentEdges = relations.filter((r) => r.type === 'parent');

    expect(parentEdges).toHaveLength(1);
    expect(parentEdges[0].targetId).toBe(wsNotes[0].id);
  });

  it('createTask creates parent relation from workstream to task', async () => {
    await createWorkstream(db, config, embedder, { project: 'ALP', name: 'Backend' });
    await createTestTask(db, config, embedder, {
      project: 'ALP',
      workstream: 1,
      name: 'Set up database',
    });

    const wsNotes = getPmNotes(db, 'workstream', { display_id: 'ALP-01' });
    expect(wsNotes.length).toBeGreaterThan(0);

    const taskNotes = getPmNotes(db, 'task', { display_id: 'ALP-01.01' });
    expect(taskNotes.length).toBeGreaterThan(0);

    const relations = db.getRelationsFrom(wsNotes[0].id);
    const parentEdges = relations.filter((r) => r.type === 'parent');

    expect(parentEdges).toHaveLength(1);
    expect(parentEdges[0].targetId).toBe(taskNotes[0].id);
  });

  it('deleting a task removes its parent relation', async () => {
    await createWorkstream(db, config, embedder, { project: 'ALP', name: 'Backend' });
    await createTestTask(db, config, embedder, {
      project: 'ALP',
      workstream: 1,
      name: 'Temporary task',
    });

    const wsNotes = getPmNotes(db, 'workstream', { display_id: 'ALP-01' });

    const beforeRelations = db.getRelationsFrom(wsNotes[0].id);
    expect(beforeRelations.filter((r) => r.type === 'parent')).toHaveLength(1);

    await deleteTask(db, config, 'ALP-01.01');

    const afterRelations = db.getRelationsFrom(wsNotes[0].id);
    expect(afterRelations.filter((r) => r.type === 'parent')).toHaveLength(0);
  });

  it('multiple tasks in same workstream each get parent edge', async () => {
    await createWorkstream(db, config, embedder, { project: 'ALP', name: 'Backend' });

    await createTestTask(db, config, embedder, {
      project: 'ALP',
      workstream: 1,
      name: 'Task one',
    });
    await createTestTask(db, config, embedder, {
      project: 'ALP',
      workstream: 1,
      name: 'Task two',
    });
    await createTestTask(db, config, embedder, {
      project: 'ALP',
      workstream: 1,
      name: 'Task three',
    });

    const wsNotes = getPmNotes(db, 'workstream', { display_id: 'ALP-01' });
    const relations = db.getRelationsFrom(wsNotes[0].id);
    const parentEdges = relations.filter((r) => r.type === 'parent');

    expect(parentEdges).toHaveLength(3);

    const taskNotes = getPmNotes(db, 'task', { project: 'ALP', workstream: 1 });
    const taskIds = new Set(taskNotes.map((n) => n.id));

    for (const edge of parentEdges) {
      expect(taskIds.has(edge.targetId)).toBe(true);
    }
  });
});
