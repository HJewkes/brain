import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { BrainDB } from '../../../src/services/brain-db.js';
import { tmpDbPath, createMockEmbedder } from '../../helpers.js';
import type { BrainConfig } from '../../../src/types.js';
import { createProject, listProjects } from '../../../src/modules/pm/data/project-ops.js';
import { createWorkstream } from '../../../src/modules/pm/data/workstream-ops.js';
import {
  listTasks,
  getTask,
  createTask,
  updateTaskStatus,
} from '../../../src/modules/pm/data/task-ops.js';
import { getPmNotes } from '../../../src/modules/pm/data/queries.js';
import { traverseGraph } from '../../../src/services/graph.js';

let db: BrainDB;
let dbPath: string;
let notesDir: string;
let config: BrainConfig;
const embedder = createMockEmbedder();

beforeEach(async () => {
  dbPath = tmpDbPath('pm-v12-reg');
  db = new BrainDB(dbPath);
  notesDir = join(tmpdir(), `pm-v12-reg-notes-${randomUUID()}`);
  mkdirSync(notesDir, { recursive: true });
  config = {
    notesDir,
    dbPath,
    embedder: 'local',
    fusionWeights: { bm25: 0.3, vector: 0.7 },
  };

  const proj = await createProject(db, config, embedder, { name: 'Regression', prefix: 'REG' });
  if (!proj.ok) throw new Error(proj.error.message);
  const ws = await createWorkstream(db, config, embedder, { project: 'REG', name: 'WS1' });
  if (!ws.ok) throw new Error(ws.error.message);
});

afterEach(() => {
  db.close();
  if (existsSync(notesDir)) {
    rmSync(notesDir, { recursive: true, force: true });
  }
});

// V11 fix confirmed: O-134
describe('O-134: display_id in base task JSON', () => {
  it('taskMetaFromRecord always includes display_id (not gated on --full)', async () => {
    await createTask(db, config, embedder, {
      project: 'REG',
      workstream: 1,
      name: 'Display ID test',
    });

    // Default mode (not full, not short)
    const result = listTasks(db, 'REG');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.length).toBeGreaterThan(0);
      for (const task of result.data) {
        expect(task.display_id).toBeDefined();
        expect(task.display_id).not.toBeNull();
        expect(typeof task.display_id).toBe('string');
        expect(task.display_id.length).toBeGreaterThan(0);
      }
    }

    // Short mode should also have display_id
    const shortResult = listTasks(db, 'REG', undefined, 'short');
    expect(shortResult.ok).toBe(true);
    if (shortResult.ok) {
      for (const task of shortResult.data) {
        expect(task.display_id).toBeDefined();
        expect(task.display_id).not.toBeNull();
      }
    }
  });
});

// V11 fix confirmed: O-135
describe('O-135: project name in pm list JSON', () => {
  it('listProjects returns non-null title for every project', () => {
    const result = listProjects(db);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.length).toBeGreaterThan(0);
      for (const project of result.data) {
        expect(project.title).toBeDefined();
        expect(project.title).not.toBeNull();
        expect(typeof project.title).toBe('string');
      }
    }
  });
});

// V11 fix confirmed: O-84
describe('O-84: dependencies field populated from relations', () => {
  it('task with relation-only dependency has depends_on populated', async () => {
    const t1 = await createTask(db, config, embedder, {
      project: 'REG',
      workstream: 1,
      name: 'Target task',
    });
    expect(t1.ok).toBe(true);

    const t2 = await createTask(db, config, embedder, {
      project: 'REG',
      workstream: 1,
      name: 'Source task',
    });
    expect(t2.ok).toBe(true);

    // Add a depends_on relation directly via DB (not frontmatter)
    const t1Notes = getPmNotes(db, 'task', { display_id: 'REG-01.01' });
    const t2Notes = getPmNotes(db, 'task', { display_id: 'REG-01.02' });
    const t1NoteId = t1Notes[0].id;
    const t2NoteId = t2Notes[0].id;

    const existing = db.getRelationsFrom(t2NoteId);
    db.upsertRelations(t2NoteId, [
      ...existing,
      { sourceId: t2NoteId, targetId: t1NoteId, type: 'depends_on' },
    ]);

    const r = getTask(db, 'REG-01.02');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.depends_on).toBeDefined();
      expect(r.data.depends_on).toContain('REG-01.01');
    }
  });
});

// V11 fix confirmed: O-148
describe('O-148: bidirectional graph traversal', () => {
  it('traverseGraph follows related edges in both directions', async () => {
    const t1 = await createTask(db, config, embedder, {
      project: 'REG',
      workstream: 1,
      name: 'Note A',
    });
    expect(t1.ok).toBe(true);

    const t2 = await createTask(db, config, embedder, {
      project: 'REG',
      workstream: 1,
      name: 'Note B',
    });
    expect(t2.ok).toBe(true);

    const aNotes = getPmNotes(db, 'task', { display_id: 'REG-01.01' });
    const bNotes = getPmNotes(db, 'task', { display_id: 'REG-01.02' });
    const aId = aNotes[0].id;
    const bId = bNotes[0].id;

    // Add A -> B with type 'related' (bidirectional type)
    db.upsertRelations(aId, [{ sourceId: aId, targetId: bId, type: 'related' }]);

    // Traverse from B — should find A via reverse direction
    const result = traverseGraph(db, bId, 1);
    const nodeIds = result.nodes.map((n) => n.id);
    expect(nodeIds).toContain(aId);
  });
});

// V11 fix confirmed: O-113
describe('O-113: display_id consistency in human output', () => {
  it('task display_id matches PREFIX-WW.TT format', async () => {
    await createTask(db, config, embedder, {
      project: 'REG',
      workstream: 1,
      name: 'Format test',
    });

    const result = getTask(db, 'REG-01.01');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.display_id).toMatch(/^[A-Z]{2,5}-\d{2}\.\d{2}$/);
    }
  });
});

// V11 fix confirmed: O-114
describe('O-114: newly eligible after dependency completion', () => {
  it('completing a dependency changes dependent to +ELIGIBLE', async () => {
    const t1 = await createTask(db, config, embedder, {
      project: 'REG',
      workstream: 1,
      name: 'Blocking task',
    });
    expect(t1.ok).toBe(true);

    const t2 = await createTask(db, config, embedder, {
      project: 'REG',
      workstream: 1,
      name: 'Blocked task',
    });
    expect(t2.ok).toBe(true);

    // Add relation-only dep: t2 depends_on t1
    const t1Notes = getPmNotes(db, 'task', { display_id: 'REG-01.01' });
    const t2Notes = getPmNotes(db, 'task', { display_id: 'REG-01.02' });
    const existing = db.getRelationsFrom(t2Notes[0].id);
    db.upsertRelations(t2Notes[0].id, [
      ...existing,
      { sourceId: t2Notes[0].id, targetId: t1Notes[0].id, type: 'depends_on' },
    ]);

    // Verify B is BLOCKED while A is pending
    const blockedResult = getTask(db, 'REG-01.02');
    expect(blockedResult.ok).toBe(true);
    if (blockedResult.ok) {
      expect(blockedResult.data.virtualStates).toContain('+BLOCKED');
    }

    // Mark A as done (pending -> claimed -> in-progress -> done)
    await updateTaskStatus(db, config, embedder, 'REG-01.01', 'claimed');
    await updateTaskStatus(db, config, embedder, 'REG-01.01', 'in-progress');
    await updateTaskStatus(db, config, embedder, 'REG-01.01', 'done');

    // Verify B is now ELIGIBLE
    const eligibleResult = getTask(db, 'REG-01.02');
    expect(eligibleResult.ok).toBe(true);
    if (eligibleResult.ok) {
      expect(eligibleResult.data.virtualStates).not.toContain('+BLOCKED');
      expect(eligibleResult.data.virtualStates).toContain('+ELIGIBLE');
    }
  });
});
