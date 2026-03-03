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
import { listTasks, getTask } from '../../../src/modules/pm/data/task-ops.js';
import { getPmNotes } from '../../../src/modules/pm/data/queries.js';
import { createTestTask } from '../../helpers.js';

let db: BrainDB;
let dbPath: string;
let notesDir: string;
let config: BrainConfig;
const embedder = createMockEmbedder();

beforeEach(async () => {
  dbPath = tmpDbPath('pm-v11-dep');
  db = new BrainDB(dbPath);
  notesDir = join(tmpdir(), `pm-v11-notes-${randomUUID()}`);
  mkdirSync(notesDir, { recursive: true });
  config = {
    notesDir,
    dbPath,
    embedder: 'local',
    fusionWeights: { bm25: 0.3, vector: 0.7 },
  };

  // Create minimal project + workstream
  const proj = await createProject(db, config, embedder, { name: 'Dep Test', prefix: 'DEP' });
  if (!proj.ok) throw new Error(proj.error.message);
  const ws = await createWorkstream(db, config, embedder, { project: 'DEP', name: 'WS1' });
  if (!ws.ok) throw new Error(ws.error.message);
});

afterEach(() => {
  db.close();
  if (existsSync(notesDir)) {
    rmSync(notesDir, { recursive: true, force: true });
  }
});

describe('relations as single source of truth for depends_on', () => {
  it('getTask() returns depends_on from relations table, not just frontmatter', async () => {
    // Create two tasks with NO explicit dependsOn in frontmatter
    const t1 = await createTestTask(db, config, embedder, {
      project: 'DEP',
      workstream: 1,
      name: 'Target task',
    });
    expect(t1.ok).toBe(true);

    const t2 = await createTestTask(db, config, embedder, {
      project: 'DEP',
      workstream: 1,
      name: 'Source task',
    });
    expect(t2.ok).toBe(true);

    // Add a depends_on relation directly via DB (not frontmatter)
    const t1Notes = getPmNotes(db, 'task', { display_id: 'DEP-01.01' });
    const t2Notes = getPmNotes(db, 'task', { display_id: 'DEP-01.02' });
    const t1NoteId = t1Notes[0].id;
    const t2NoteId = t2Notes[0].id;

    const existing = db.getRelationsFrom(t2NoteId);
    db.upsertRelations(t2NoteId, [
      ...existing,
      { sourceId: t2NoteId, targetId: t1NoteId, type: 'depends_on' },
    ]);

    // getTask should include DEP-01.01 in depends_on
    const r = getTask(db, 'DEP-01.02');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.depends_on).toBeDefined();
      expect(r.data.depends_on).toContain('DEP-01.01');
    }
  });

  it('areDependenciesComplete returns false when relation-only dep is not done', async () => {
    const t1 = await createTestTask(db, config, embedder, {
      project: 'DEP',
      workstream: 1,
      name: 'Blocking task',
    });
    expect(t1.ok).toBe(true);

    const t2 = await createTestTask(db, config, embedder, {
      project: 'DEP',
      workstream: 1,
      name: 'Blocked task',
    });
    expect(t2.ok).toBe(true);

    // Add relation-only dep
    const t1Notes = getPmNotes(db, 'task', { display_id: 'DEP-01.01' });
    const t2Notes = getPmNotes(db, 'task', { display_id: 'DEP-01.02' });
    const existing = db.getRelationsFrom(t2Notes[0].id);
    db.upsertRelations(t2Notes[0].id, [
      ...existing,
      { sourceId: t2Notes[0].id, targetId: t1Notes[0].id, type: 'depends_on' },
    ]);

    // getTask should show +BLOCKED since DEP-01.01 is still pending
    const r = getTask(db, 'DEP-01.02');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.virtualStates).toContain('+BLOCKED');
      expect(r.data.virtualStates).not.toContain('+ELIGIBLE');
    }
  });

  it('areDependenciesComplete returns true when relation-only dep is done', async () => {
    const t1 = await createTestTask(db, config, embedder, {
      project: 'DEP',
      workstream: 1,
      name: 'Done task',
    });
    expect(t1.ok).toBe(true);

    const t2 = await createTestTask(db, config, embedder, {
      project: 'DEP',
      workstream: 1,
      name: 'Waiting task',
    });
    expect(t2.ok).toBe(true);

    // Add relation-only dep
    const t1Notes = getPmNotes(db, 'task', { display_id: 'DEP-01.01' });
    const t2Notes = getPmNotes(db, 'task', { display_id: 'DEP-01.02' });
    const existing = db.getRelationsFrom(t2Notes[0].id);
    db.upsertRelations(t2Notes[0].id, [
      ...existing,
      { sourceId: t2Notes[0].id, targetId: t1Notes[0].id, type: 'depends_on' },
    ]);

    // Mark DEP-01.01 as done via updateTaskStatus (pending -> claimed -> in-progress -> done)
    const { updateTaskStatus } = await import('../../../src/modules/pm/data/task-ops.js');
    await updateTaskStatus(db, config, embedder, 'DEP-01.01', 'claimed');
    await updateTaskStatus(db, config, embedder, 'DEP-01.01', 'in-progress');
    await updateTaskStatus(db, config, embedder, 'DEP-01.01', 'done');

    // getTask should show +ELIGIBLE (dep is satisfied)
    const r = getTask(db, 'DEP-01.02');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.virtualStates).not.toContain('+BLOCKED');
      expect(r.data.virtualStates).toContain('+ELIGIBLE');
    }
  });

  it('listTasks enrichment reads depends_on from relations', async () => {
    const t1 = await createTestTask(db, config, embedder, {
      project: 'DEP',
      workstream: 1,
      name: 'List target',
    });
    expect(t1.ok).toBe(true);

    const t2 = await createTestTask(db, config, embedder, {
      project: 'DEP',
      workstream: 1,
      name: 'List source',
    });
    expect(t2.ok).toBe(true);

    // Add relation-only dep
    const t1Notes = getPmNotes(db, 'task', { display_id: 'DEP-01.01' });
    const t2Notes = getPmNotes(db, 'task', { display_id: 'DEP-01.02' });
    const existing = db.getRelationsFrom(t2Notes[0].id);
    db.upsertRelations(t2Notes[0].id, [
      ...existing,
      { sourceId: t2Notes[0].id, targetId: t1Notes[0].id, type: 'depends_on' },
    ]);

    const result = listTasks(db, 'DEP');
    expect(result.ok).toBe(true);
    if (result.ok) {
      const t = result.data.find((task) => task.display_id === 'DEP-01.02');
      expect(t).toBeDefined();
      expect(t!.depends_on).toBeDefined();
      expect(t!.depends_on).toContain('DEP-01.01');
    }
  });
});
