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
import { getTask, listTasks, updateTaskStatus } from '../../../src/modules/pm/data/task-ops.js';
import { getPmNotes } from '../../../src/modules/pm/data/queries.js';
import { computeWaves } from '../../../src/modules/pm/engine/dependency.js';
import { createTestTask } from '../../helpers.js';

let db: BrainDB;
let dbPath: string;
let notesDir: string;
let config: BrainConfig;
const embedder = createMockEmbedder();

beforeEach(async () => {
  dbPath = tmpDbPath('pm-v11-vstate');
  db = new BrainDB(dbPath);
  notesDir = join(tmpdir(), `pm-v11-vstate-${randomUUID()}`);
  mkdirSync(notesDir, { recursive: true });
  config = {
    notesDir,
    dbPath,
    embedder: 'local',
    fusionWeights: { bm25: 0.3, vector: 0.7 },
  };

  const proj = await createProject(db, config, embedder, {
    name: 'VState Test',
    prefix: 'VST',
  });
  if (!proj.ok) throw new Error(proj.error.message);
  const ws = await createWorkstream(db, config, embedder, {
    project: 'VST',
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

describe('virtual state with relation-only dependencies', () => {
  it('computeVirtualState returns +BLOCKED when relation-only dep is pending', async () => {
    await createTestTask(db, config, embedder, {
      project: 'VST',
      workstream: 1,
      name: 'Prerequisite',
    });
    await createTestTask(db, config, embedder, {
      project: 'VST',
      workstream: 1,
      name: 'Blocked by prereq',
    });

    addRelationDep('VST-01.02', 'VST-01.01');

    const r = getTask(db, 'VST-01.02');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.virtualStates).toContain('+BLOCKED');
    expect(r.data.virtualStates).not.toContain('+ELIGIBLE');
    expect(r.data.virtualStates).not.toContain('+READY');
  });

  it('computeVirtualState returns +ELIGIBLE when relation-only dep is done', async () => {
    await createTestTask(db, config, embedder, {
      project: 'VST',
      workstream: 1,
      name: 'Prereq to complete',
    });
    await createTestTask(db, config, embedder, {
      project: 'VST',
      workstream: 1,
      name: 'Waiting on prereq',
    });

    addRelationDep('VST-01.02', 'VST-01.01');

    // Complete the prerequisite
    await updateTaskStatus(db, config, embedder, 'VST-01.01', 'claimed');
    await updateTaskStatus(db, config, embedder, 'VST-01.01', 'in-progress');
    await updateTaskStatus(db, config, embedder, 'VST-01.01', 'done');

    const r = getTask(db, 'VST-01.02');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.virtualStates).toContain('+ELIGIBLE');
    expect(r.data.virtualStates).toContain('+READY');
    expect(r.data.virtualStates).not.toContain('+BLOCKED');
  });

  it('listTasks returns +BLOCKED for tasks with unsatisfied relation deps', async () => {
    await createTestTask(db, config, embedder, {
      project: 'VST',
      workstream: 1,
      name: 'List prereq',
    });
    await createTestTask(db, config, embedder, {
      project: 'VST',
      workstream: 1,
      name: 'List blocked',
    });

    addRelationDep('VST-01.02', 'VST-01.01');

    const result = listTasks(db, 'VST');
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const blocked = result.data.find((t) => t.display_id === 'VST-01.02');
    expect(blocked).toBeDefined();
    expect(blocked!.virtualStates).toContain('+BLOCKED');

    const prereq = result.data.find((t) => t.display_id === 'VST-01.01');
    expect(prereq).toBeDefined();
    expect(prereq!.virtualStates).toContain('+ELIGIBLE');
  });
});

describe('waves JSON with relation-based dependencies', () => {
  it('waves JSON includes depends_on from relations', async () => {
    await createTestTask(db, config, embedder, {
      project: 'VST',
      workstream: 1,
      name: 'Wave 0 task',
    });
    await createTestTask(db, config, embedder, {
      project: 'VST',
      workstream: 1,
      name: 'Wave 1 task',
    });

    addRelationDep('VST-01.02', 'VST-01.01');

    // Simulate the waves JSON serializer path (same as orchestration.ts --json)
    const waves = computeWaves(db, 'VST');
    const jsonResult = waves.map((w) => ({
      wave: w.wave,
      tasks: w.taskIds.map((id) => {
        const r = getTask(db, id);
        if (!r.ok) return { display_id: id, title: undefined, status: 'unknown' };
        return {
          display_id: r.data.display_id,
          title: r.data.title,
          status: r.data.status,
          depends_on: r.data.depends_on ?? [],
        };
      }),
    }));

    expect(jsonResult).toHaveLength(2);

    // Wave 0: VST-01.01 (no deps)
    const wave0 = jsonResult.find((w) => w.wave === 0);
    expect(wave0).toBeDefined();
    const w0Task = wave0!.tasks.find((t) => t.display_id === 'VST-01.01');
    expect(w0Task).toBeDefined();
    expect(w0Task!.depends_on).toEqual([]);

    // Wave 1: VST-01.02 (depends on VST-01.01 via relation)
    const wave1 = jsonResult.find((w) => w.wave === 1);
    expect(wave1).toBeDefined();
    const w1Task = wave1!.tasks.find((t) => t.display_id === 'VST-01.02');
    expect(w1Task).toBeDefined();
    expect(w1Task!.depends_on).toContain('VST-01.01');
  });

  it('waves JSON excludes completed tasks from waves', async () => {
    await createTestTask(db, config, embedder, {
      project: 'VST',
      workstream: 1,
      name: 'Already done',
    });
    await createTestTask(db, config, embedder, {
      project: 'VST',
      workstream: 1,
      name: 'Still pending',
    });

    addRelationDep('VST-01.02', 'VST-01.01');

    // Complete the first task
    await updateTaskStatus(db, config, embedder, 'VST-01.01', 'claimed');
    await updateTaskStatus(db, config, embedder, 'VST-01.01', 'in-progress');
    await updateTaskStatus(db, config, embedder, 'VST-01.01', 'done');

    const waves = computeWaves(db, 'VST');
    const allTaskIds = waves.flatMap((w) => w.taskIds);

    // Done task excluded from waves
    expect(allTaskIds).not.toContain('VST-01.01');
    // Pending task with satisfied dep is in wave 0
    expect(allTaskIds).toContain('VST-01.02');
    expect(waves).toHaveLength(1);
    expect(waves[0].wave).toBe(0);
  });

  it('waves JSON preserves depends_on for multi-hop relation chains', async () => {
    await createTestTask(db, config, embedder, {
      project: 'VST',
      workstream: 1,
      name: 'First',
    });
    await createTestTask(db, config, embedder, {
      project: 'VST',
      workstream: 1,
      name: 'Second',
    });
    await createTestTask(db, config, embedder, {
      project: 'VST',
      workstream: 1,
      name: 'Third',
    });

    addRelationDep('VST-01.02', 'VST-01.01');
    addRelationDep('VST-01.03', 'VST-01.02');

    const waves = computeWaves(db, 'VST');
    expect(waves).toHaveLength(3);

    // Build the JSON the same way orchestration.ts does
    const jsonResult = waves.map((w) => ({
      wave: w.wave,
      tasks: w.taskIds.map((id) => {
        const r = getTask(db, id);
        if (!r.ok) return { display_id: id, depends_on: [] as string[] };
        return {
          display_id: r.data.display_id,
          depends_on: r.data.depends_on ?? [],
        };
      }),
    }));

    const task3 = jsonResult
      .flatMap((w) => w.tasks)
      .find((t) => t.display_id === 'VST-01.03');
    expect(task3).toBeDefined();
    expect(task3!.depends_on).toContain('VST-01.02');
    // Task 3 only directly depends on Task 2 (not transitive)
    expect(task3!.depends_on).not.toContain('VST-01.01');
  });
});
