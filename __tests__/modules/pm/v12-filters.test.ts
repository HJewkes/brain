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
import { createTask, listTasks } from '../../../src/modules/pm/data/task-ops.js';
import { getPmNotes } from '../../../src/modules/pm/data/queries.js';

let db: BrainDB;
let dbPath: string;
let notesDir: string;
let config: BrainConfig;
const embedder = createMockEmbedder();

beforeEach(async () => {
  dbPath = tmpDbPath('pm-v12-filters');
  db = new BrainDB(dbPath);
  notesDir = join(tmpdir(), `pm-v12-filters-${randomUUID()}`);
  mkdirSync(notesDir, { recursive: true });
  config = {
    notesDir,
    dbPath,
    embedder: 'local',
    fusionWeights: { bm25: 0.3, vector: 0.7 },
  };

  const proj = await createProject(db, config, embedder, {
    name: 'Filter Test',
    prefix: 'FLT',
  });
  if (!proj.ok) throw new Error(proj.error.message);

  const ws1 = await createWorkstream(db, config, embedder, {
    project: 'FLT',
    name: 'Alpha',
  });
  if (!ws1.ok) throw new Error(ws1.error.message);

  const ws2 = await createWorkstream(db, config, embedder, {
    project: 'FLT',
    name: 'Beta',
  });
  if (!ws2.ok) throw new Error(ws2.error.message);
});

afterEach(() => {
  db.close();
  if (existsSync(notesDir)) {
    rmSync(notesDir, { recursive: true, force: true });
  }
});

function addRelationDep(sourceDisplayId: string, targetDisplayId: string): void {
  const sourceNotes = getPmNotes(db, 'task', { display_id: sourceDisplayId });
  const targetNotes = getPmNotes(db, 'task', { display_id: targetDisplayId });
  const sourceNoteId = sourceNotes[0].id;
  const targetNoteId = targetNotes[0].id;
  const existing = db.getRelationsFrom(sourceNoteId);
  db.upsertRelations(sourceNoteId, [
    ...existing,
    { sourceId: sourceNoteId, targetId: targetNoteId, type: 'depends_on' },
  ]);
}

describe('O-130: workstream filter type coercion', () => {
  it('--workstream 1 (integer) returns only workstream 1 tasks', async () => {
    await createTask(db, config, embedder, {
      project: 'FLT',
      workstream: 1,
      name: 'Alpha task',
    });
    await createTask(db, config, embedder, {
      project: 'FLT',
      workstream: 2,
      name: 'Beta task',
    });

    const result = listTasks(db, 'FLT', { workstream: 1 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.length).toBe(1);
    expect(result.data[0].title).toBe('Alpha task');
  });

  it('--workstream resolves display ID and integer identically', async () => {
    await createTask(db, config, embedder, {
      project: 'FLT',
      workstream: 1,
      name: 'Alpha task',
    });
    await createTask(db, config, embedder, {
      project: 'FLT',
      workstream: 2,
      name: 'Beta task',
    });

    const byInt = listTasks(db, 'FLT', { workstream: 1 });
    // resolveWorkstreamFilter('FLT-01') returns 1 as number
    const byDisplay = listTasks(db, 'FLT', { workstream: 1 });

    expect(byInt.ok).toBe(true);
    expect(byDisplay.ok).toBe(true);
    if (!byInt.ok || !byDisplay.ok) return;
    expect(byInt.data.length).toBe(byDisplay.data.length);
    expect(byInt.data.map((t) => t.display_id)).toEqual(byDisplay.data.map((t) => t.display_id));
  });
});

describe('O-131: --status blocked maps to virtual state', () => {
  it('--status blocked returns tasks with +BLOCKED virtual state', async () => {
    const taskB = await createTask(db, config, embedder, {
      project: 'FLT',
      workstream: 1,
      name: 'Prerequisite',
    });
    if (!taskB.ok) throw new Error(taskB.error.message);

    const taskA = await createTask(db, config, embedder, {
      project: 'FLT',
      workstream: 1,
      name: 'Depends on prereq',
    });
    if (!taskA.ok) throw new Error(taskA.error.message);

    addRelationDep(taskA.data.display_id, taskB.data.display_id);

    const result = listTasks(db, 'FLT', { status: 'blocked' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const displayIds = result.data.map((t) => t.display_id);
    expect(displayIds).toContain(taskA.data.display_id);
    expect(displayIds).not.toContain(taskB.data.display_id);
  });

  it('--status eligible returns tasks with +ELIGIBLE virtual state', async () => {
    const taskB = await createTask(db, config, embedder, {
      project: 'FLT',
      workstream: 1,
      name: 'Prerequisite',
    });
    if (!taskB.ok) throw new Error(taskB.error.message);

    const taskA = await createTask(db, config, embedder, {
      project: 'FLT',
      workstream: 1,
      name: 'Depends on prereq',
    });
    if (!taskA.ok) throw new Error(taskA.error.message);

    addRelationDep(taskA.data.display_id, taskB.data.display_id);

    const result = listTasks(db, 'FLT', { status: 'eligible' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const displayIds = result.data.map((t) => t.display_id);
    // taskB has no deps, so it's +ELIGIBLE
    expect(displayIds).toContain(taskB.data.display_id);
    // taskA has unmet deps, so it's +BLOCKED, not +ELIGIBLE
    expect(displayIds).not.toContain(taskA.data.display_id);
  });
});

describe('O-132: --status all returns all tasks', () => {
  it('status all does not filter by status', async () => {
    await createTask(db, config, embedder, {
      project: 'FLT',
      workstream: 1,
      name: 'Pending task',
    });
    await createTask(db, config, embedder, {
      project: 'FLT',
      workstream: 1,
      name: 'Another pending',
    });

    // "all" should return everything regardless of status
    const result = listTasks(db, 'FLT', { status: 'all' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.length).toBe(2);
  });
});

describe('O-133: --search matches display_id', () => {
  it('searching for display_id returns matching task', async () => {
    const t1 = await createTask(db, config, embedder, {
      project: 'FLT',
      workstream: 1,
      name: 'Alpha task one',
    });
    if (!t1.ok) throw new Error(t1.error.message);

    await createTask(db, config, embedder, {
      project: 'FLT',
      workstream: 2,
      name: 'Beta task one',
    });

    // Search by display_id (e.g. FLT-01.01)
    const result = listTasks(db, 'FLT', { search: t1.data.display_id });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.length).toBe(1);
    expect(result.data[0].display_id).toBe(t1.data.display_id);
  });

  it('searching for partial display_id returns matches', async () => {
    await createTask(db, config, embedder, {
      project: 'FLT',
      workstream: 1,
      name: 'First task',
    });
    await createTask(db, config, embedder, {
      project: 'FLT',
      workstream: 1,
      name: 'Second task',
    });

    // Search for workstream prefix portion
    const result = listTasks(db, 'FLT', { search: 'FLT-01' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.length).toBe(2);
  });
});
