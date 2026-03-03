import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { BrainDB } from '../../src/services/brain-db.js';
import { tmpDbPath, createMockEmbedder } from '../helpers.js';
import type { BrainConfig, Relation } from '../../src/types.js';
import { createStandardProject } from '../fixtures/pm-project.js';
import {
  computeWaves,
  detectCycles,
  buildDependencyGraph,
} from '../../src/modules/pm/engine/dependency.js';
import {
  listTasks,
  getTask,
  getDependencyDisplayIds,
  updateTaskStatus,
} from '../../src/modules/pm/data/task-ops.js';
import { resolveDisplayId } from '../../src/modules/pm/data/queries.js';
import { assembleContext } from '../../src/modules/pm/engine/dispatch.js';
import { computeVirtualState } from '../../src/modules/pm/engine/state-machine.js';
import { createTestTask } from '../helpers.js';

let db: BrainDB;
let dbPath: string;
let notesDir: string;
let config: BrainConfig;
const embedder = createMockEmbedder();

beforeEach(async () => {
  dbPath = tmpDbPath('pm-v11-integration');
  db = new BrainDB(dbPath);
  notesDir = join(tmpdir(), `pm-v11-notes-${randomUUID()}`);
  mkdirSync(notesDir, { recursive: true });
  config = {
    notesDir,
    dbPath,
    embedder: 'local',
    fusionWeights: { bm25: 0.3, vector: 0.7 },
  };
  await createStandardProject(db, config, embedder);
});

afterEach(() => {
  db.close();
  if (existsSync(notesDir)) {
    rmSync(notesDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Group 1: Dependency source of truth (O-131, O-132)
// Relations table is the single source of truth for dependencies
// ---------------------------------------------------------------------------
describe('V11 Integration: Dependency source of truth', () => {
  it('getTask populates depends_on from relations table', () => {
    const result = getTask(db, 'TEST-01.02');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.depends_on).toContain('TEST-01.01');
  });

  it('getDependencyDisplayIds reads from relations table', () => {
    const noteResult = resolveDisplayId(db, 'TEST-01.02');
    expect(noteResult.ok).toBe(true);
    if (!noteResult.ok) return;

    const deps = getDependencyDisplayIds(db, noteResult.data);
    expect(deps).toContain('TEST-01.01');
  });

  it('relation-only dep (no frontmatter) is recognized by getTask', async () => {
    // Create a task with no depends_on in frontmatter
    const newTask = await createTestTask(db, config, embedder, {
      project: 'TEST',
      workstream: 1,
      name: 'Relation-only dep task',
    });
    expect(newTask.ok).toBe(true);
    if (!newTask.ok) return;

    // Add dependency via relation only (not frontmatter)
    const taskNoteResult = resolveDisplayId(db, newTask.data.display_id);
    const depNoteResult = resolveDisplayId(db, 'TEST-02.01');
    expect(taskNoteResult.ok).toBe(true);
    expect(depNoteResult.ok).toBe(true);
    if (!taskNoteResult.ok || !depNoteResult.ok) return;

    const relations: Relation[] = [
      { sourceId: taskNoteResult.data, targetId: depNoteResult.data, type: 'depends_on' },
    ];
    db.upsertRelations(taskNoteResult.data, relations);

    // getTask should pick up the relation-only dependency
    const taskResult = getTask(db, newTask.data.display_id);
    expect(taskResult.ok).toBe(true);
    if (!taskResult.ok) return;
    expect(taskResult.data.depends_on).toContain('TEST-02.01');
  });

  it('dependent task has +BLOCKED virtual state, changes to +ELIGIBLE when dep completes', async () => {
    // TEST-01.02 depends on TEST-01.01 which is pending => should be +BLOCKED
    const taskResult = getTask(db, 'TEST-01.02');
    expect(taskResult.ok).toBe(true);
    if (!taskResult.ok) return;
    expect(taskResult.data.virtualStates).toContain('+BLOCKED');

    // Complete TEST-01.01: pending -> claimed -> in-progress -> done
    const claim = await updateTaskStatus(db, config, embedder, 'TEST-01.01', 'claimed');
    expect(claim.ok).toBe(true);
    const start = await updateTaskStatus(db, config, embedder, 'TEST-01.01', 'in-progress');
    expect(start.ok).toBe(true);
    const done = await updateTaskStatus(db, config, embedder, 'TEST-01.01', 'done');
    expect(done.ok).toBe(true);

    // Now TEST-01.02 should be +ELIGIBLE (all deps complete)
    const afterResult = getTask(db, 'TEST-01.02');
    expect(afterResult.ok).toBe(true);
    if (!afterResult.ok) return;
    expect(afterResult.data.virtualStates).toContain('+ELIGIBLE');
    expect(afterResult.data.virtualStates).not.toContain('+BLOCKED');
  });
});

// ---------------------------------------------------------------------------
// Group 2: Wave computation with relations (O-108, O-131)
// ---------------------------------------------------------------------------
describe('V11 Integration: Wave computation with relations', () => {
  it('chain A->B->C produces waves 0, 1, 2', () => {
    // Standard fixture has TEST-01.01 -> TEST-01.02 -> TEST-01.03
    const waves = computeWaves(db, 'TEST');

    const waveOf = (displayId: string) =>
      waves.find((w) => w.taskIds.includes(displayId))?.wave;

    expect(waveOf('TEST-01.01')).toBe(0);
    expect(waveOf('TEST-01.02')).toBe(1);
    expect(waveOf('TEST-01.03')).toBe(2);
  });

  it('completing root task shifts dependents forward', async () => {
    // Complete TEST-01.01
    await updateTaskStatus(db, config, embedder, 'TEST-01.01', 'claimed');
    await updateTaskStatus(db, config, embedder, 'TEST-01.01', 'in-progress');
    await updateTaskStatus(db, config, embedder, 'TEST-01.01', 'done');

    const waves = computeWaves(db, 'TEST');

    // TEST-01.02 should now be wave 0 (its only dep is done)
    const wave0102 = waves.find((w) => w.taskIds.includes('TEST-01.02'));
    expect(wave0102).toBeDefined();
    expect(wave0102!.wave).toBe(0);
  });

  it('relation-only deps are reflected in wave computation', async () => {
    const newTask = await createTestTask(db, config, embedder, {
      project: 'TEST',
      workstream: 1,
      name: 'Wave test task',
    });
    expect(newTask.ok).toBe(true);
    if (!newTask.ok) return;

    // Initially wave 0 (no deps)
    let waves = computeWaves(db, 'TEST');
    const initialWave = waves.find((w) => w.taskIds.includes(newTask.data.display_id));
    expect(initialWave?.wave).toBe(0);

    // Add relation-only dep on TEST-01.03 (wave 2)
    const taskNote = resolveDisplayId(db, newTask.data.display_id);
    const depNote = resolveDisplayId(db, 'TEST-01.03');
    if (!taskNote.ok || !depNote.ok) return;

    db.upsertRelations(taskNote.data, [
      { sourceId: taskNote.data, targetId: depNote.data, type: 'depends_on' },
    ]);

    waves = computeWaves(db, 'TEST');
    const afterWave = waves.find((w) => w.taskIds.includes(newTask.data.display_id));
    expect(afterWave).toBeDefined();
    expect(afterWave!.wave).toBeGreaterThanOrEqual(3);
  });
});

// ---------------------------------------------------------------------------
// Group 3: Cycle detection (O-146)
// ---------------------------------------------------------------------------
describe('V11 Integration: Cycle detection', () => {
  it('detects cycle in A->B->C->A', async () => {
    // Create 3 tasks that form a cycle
    const a = await createTestTask(db, config, embedder, {
      project: 'TEST',
      workstream: 1,
      name: 'Cycle A',
    });
    const b = await createTestTask(db, config, embedder, {
      project: 'TEST',
      workstream: 1,
      name: 'Cycle B',
    });
    const c = await createTestTask(db, config, embedder, {
      project: 'TEST',
      workstream: 1,
      name: 'Cycle C',
    });
    expect(a.ok && b.ok && c.ok).toBe(true);
    if (!a.ok || !b.ok || !c.ok) return;

    // Resolve note IDs
    const aN = resolveDisplayId(db, a.data.display_id);
    const bN = resolveDisplayId(db, b.data.display_id);
    const cN = resolveDisplayId(db, c.data.display_id);
    if (!aN.ok || !bN.ok || !cN.ok) return;

    // A depends_on B, B depends_on C, C depends_on A
    db.upsertRelations(aN.data, [
      { sourceId: aN.data, targetId: bN.data, type: 'depends_on' },
    ]);
    db.upsertRelations(bN.data, [
      { sourceId: bN.data, targetId: cN.data, type: 'depends_on' },
    ]);
    db.upsertRelations(cN.data, [
      { sourceId: cN.data, targetId: aN.data, type: 'depends_on' },
    ]);

    const graph = buildDependencyGraph(db, 'TEST');
    const cycles = detectCycles(graph);
    expect(cycles.length).toBeGreaterThan(0);

    // Verify all three cycle tasks appear in at least one cycle
    const cycleMembers = new Set(cycles.flat());
    expect(cycleMembers.has(a.data.display_id)).toBe(true);
    expect(cycleMembers.has(b.data.display_id)).toBe(true);
    expect(cycleMembers.has(c.data.display_id)).toBe(true);
  });

  it('no cycles in standard fixture', () => {
    const graph = buildDependencyGraph(db, 'TEST');
    const cycles = detectCycles(graph);
    expect(cycles).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Group 4: Context with deps (O-149, O-155)
// ---------------------------------------------------------------------------
describe('V11 Integration: Context assembly with dependencies', () => {
  it('assembleContext includes upstream and downstream dependencies', () => {
    // TEST-01.02 depends on TEST-01.01 (upstream) and TEST-01.03 depends on it (downstream)
    const result = assembleContext(db, 'TEST-01.02');
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const upstream = result.data.dependencies.filter((d) => d.direction === 'upstream');
    const downstream = result.data.dependencies.filter((d) => d.direction === 'downstream');

    expect(upstream.map((d) => d.displayId)).toContain('TEST-01.01');
    expect(downstream.map((d) => d.displayId)).toContain('TEST-01.03');
  });

  it('assembleContext with deps=false omits dependencies', () => {
    const result = assembleContext(db, 'TEST-01.02', { deps: false });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.dependencies).toHaveLength(0);
  });

  it('assembleContext reflects relation-only deps', async () => {
    const newTask = await createTestTask(db, config, embedder, {
      project: 'TEST',
      workstream: 1,
      name: 'Context dep task',
    });
    expect(newTask.ok).toBe(true);
    if (!newTask.ok) return;

    const taskNote = resolveDisplayId(db, newTask.data.display_id);
    const depNote = resolveDisplayId(db, 'TEST-02.01');
    if (!taskNote.ok || !depNote.ok) return;

    db.upsertRelations(taskNote.data, [
      { sourceId: taskNote.data, targetId: depNote.data, type: 'depends_on' },
    ]);

    const ctx = assembleContext(db, newTask.data.display_id);
    expect(ctx.ok).toBe(true);
    if (!ctx.ok) return;

    const upstream = ctx.data.dependencies.filter((d) => d.direction === 'upstream');
    expect(upstream.map((d) => d.displayId)).toContain('TEST-02.01');
  });
});

// ---------------------------------------------------------------------------
// Group 5: Search scoping (O-162, O-72)
// ---------------------------------------------------------------------------
describe('V11 Integration: Search scoping', () => {
  it('listTasks with --project scopes results to that project only', () => {
    // All tasks should belong to TEST project
    const result = listTasks(db, 'TEST');
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    for (const task of result.data) {
      expect(task.project).toBe('TEST');
    }

    // A non-existent project should return empty
    const emptyResult = listTasks(db, 'NONEXISTENT');
    expect(emptyResult.ok).toBe(true);
    if (!emptyResult.ok) return;
    expect(emptyResult.data).toHaveLength(0);
  });

  it('task notes belong to pm module and are scoped out of general search', () => {
    // PM task notes have module: pm, and the PM module registers visibility: private filter
    // This means they are excluded from default brain search
    const result = listTasks(db, 'TEST');
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    for (const task of result.data) {
      const noteResult = resolveDisplayId(db, task.display_id);
      expect(noteResult.ok).toBe(true);
      if (!noteResult.ok) continue;

      const note = db.getNoteById(noteResult.data);
      expect(note).toBeDefined();
      // PM notes are stored with module: pm
      expect(note!.module).toBe('pm');
    }
  });
});

// ---------------------------------------------------------------------------
// Group 6: blocked_by semantics (O-147)
// ---------------------------------------------------------------------------
describe('V11 Integration: blocked_by semantics', () => {
  it('blocked_by contains upstream prerequisites, blocks contains downstream dependents', () => {
    const result = listTasks(db, 'TEST', {}, 'default');
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // TEST-01.02 depends on TEST-01.01
    // So: TEST-01.02.blocked_by should contain TEST-01.01
    //     TEST-01.01.blocks should contain TEST-01.02
    const task0102 = result.data.find((t) => t.display_id === 'TEST-01.02');
    const task0101 = result.data.find((t) => t.display_id === 'TEST-01.01');

    expect(task0102).toBeDefined();
    expect(task0101).toBeDefined();
    if (!task0102 || !task0101) return;

    // blocked_by = upstream (tasks I wait on)
    expect(task0102.blocked_by).toContain('TEST-01.01');

    // blocks = downstream (tasks waiting on me)
    expect(task0101.blocks).toContain('TEST-01.02');
  });

  it('blocked_by is NOT inverted (old behavior)', () => {
    const result = listTasks(db, 'TEST', {}, 'default');
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const task0101 = result.data.find((t) => t.display_id === 'TEST-01.01');
    expect(task0101).toBeDefined();
    if (!task0101) return;

    // TEST-01.01 has no dependencies — blocked_by should be empty/undefined
    expect(task0101.blocked_by).toBeUndefined();

    // TEST-01.01 blocks TEST-01.02 and TEST-02.02 (they depend on it)
    expect(task0101.blocks).toBeDefined();
    expect(task0101.blocks).toContain('TEST-01.02');
    expect(task0101.blocks).toContain('TEST-02.02');
  });

  it('diamond dependency: TEST-02.02 blocked_by both TEST-01.01 and TEST-02.01', () => {
    const result = listTasks(db, 'TEST', {}, 'default');
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const task0202 = result.data.find((t) => t.display_id === 'TEST-02.02');
    expect(task0202).toBeDefined();
    if (!task0202) return;

    expect(task0202.blocked_by).toContain('TEST-01.01');
    expect(task0202.blocked_by).toContain('TEST-02.01');
  });
});
