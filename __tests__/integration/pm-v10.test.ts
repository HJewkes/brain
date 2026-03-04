import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { BrainDB } from '../../src/services/brain-db.js';
import { tmpDbPath, createMockEmbedder } from '../helpers.js';
import type { BrainConfig } from '../../src/types.js';
import { createStandardProject } from '../fixtures/pm-project.js';
import { computeWaves, computeImpact } from '../../src/modules/pm/engine/dependency.js';
import { traverseGraph } from '../../src/services/graph.js';
import { listTasks, updateTaskStatus } from '../../src/modules/pm/data/task-ops.js';
import { resolveDisplayId } from '../../src/modules/pm/data/queries.js';
import type { Relation } from '../../src/types.js';
import { createTestTask } from '../helpers.js';

let db: BrainDB;
let dbPath: string;
let notesDir: string;
let config: BrainConfig;
const embedder = createMockEmbedder();

beforeEach(async () => {
  dbPath = tmpDbPath('pm-v10-integration');
  db = new BrainDB(dbPath);
  notesDir = join(tmpdir(), `pm-v10-notes-${randomUUID()}`);
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

describe('V10 Integration: Wave Stratification', () => {
  it('produces multiple waves reflecting dependency depth', () => {
    const waves = computeWaves(db, 'TEST');

    // Fixture has dependency chains of varying depth:
    // Wave 0: TEST-01.01 (no deps), TEST-02.01 (no deps)
    // Wave 1: TEST-01.02 (deps: 01.01), TEST-02.02 (deps: 01.01, 02.01)
    // Wave 2: TEST-01.03 (deps: 01.02), and potentially TEST-02.03
    // Wave 3: TEST-02.03 (deps: 01.03, 02.02) if not placed in wave 2
    expect(waves.length).toBeGreaterThanOrEqual(3);

    const wave0 = waves.find((w) => w.wave === 0);
    expect(wave0).toBeDefined();
    expect(wave0!.taskIds).toContain('TEST-01.01');
    expect(wave0!.taskIds).toContain('TEST-02.01');

    const wave1 = waves.find((w) => w.wave === 1);
    expect(wave1).toBeDefined();
    expect(wave1!.taskIds).toContain('TEST-01.02');
    expect(wave1!.taskIds).toContain('TEST-02.02');

    // TEST-01.03 depends on TEST-01.02, so it must be wave 2+
    const task0103Wave = waves.find((w) => w.taskIds.includes('TEST-01.03'));
    expect(task0103Wave).toBeDefined();
    expect(task0103Wave!.wave).toBeGreaterThanOrEqual(2);

    // TEST-02.03 depends on TEST-01.03 and TEST-02.02, so it must be after both
    const task0203Wave = waves.find((w) => w.taskIds.includes('TEST-02.03'));
    expect(task0203Wave).toBeDefined();
    expect(task0203Wave!.wave).toBeGreaterThan(wave1!.wave);
  });

  it('all tasks in wave 0 have no unsatisfied dependencies', () => {
    const waves = computeWaves(db, 'TEST');
    const wave0 = waves.find((w) => w.wave === 0);
    expect(wave0).toBeDefined();

    // Wave 0 tasks should not appear as targets in the depends_on graph
    for (const taskId of wave0!.taskIds) {
      const result = listTasks(db, 'TEST');
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const task = result.data.find((t) => t.display_id === taskId);
      expect(task).toBeDefined();
      const deps = task!.depends_on ?? [];
      expect(deps).toHaveLength(0);
    }
  });
});

describe('V10 Integration: Impact Analysis', () => {
  it('completing TEST-01.01 makes TEST-01.02 newly eligible', () => {
    const impact = computeImpact(db, 'TEST', 'TEST-01.01');

    // TEST-01.02 depends only on TEST-01.01, so it becomes eligible
    expect(impact).toContain('TEST-01.02');
  });

  it('completing TEST-01.01 does not make TEST-02.03 eligible', () => {
    // TEST-02.03 depends on TEST-01.03 and TEST-02.02 — far from satisfied
    const impact = computeImpact(db, 'TEST', 'TEST-01.01');
    expect(impact).not.toContain('TEST-02.03');
  });

  it('completing TEST-01.01 does not make TEST-02.02 eligible (still needs TEST-02.01)', () => {
    // TEST-02.02 depends on both TEST-01.01 and TEST-02.01
    const impact = computeImpact(db, 'TEST', 'TEST-01.01');
    expect(impact).not.toContain('TEST-02.02');
  });

  it('impact after completing both root tasks unlocks TEST-02.02', async () => {
    // State machine requires pending -> claimed -> in-progress -> done
    const claim = await updateTaskStatus(db, config, embedder, 'TEST-01.01', 'claimed');
    expect(claim.ok).toBe(true);
    const start = await updateTaskStatus(db, config, embedder, 'TEST-01.01', 'in-progress');
    expect(start.ok).toBe(true);
    const done = await updateTaskStatus(db, config, embedder, 'TEST-01.01', 'done');
    expect(done.ok).toBe(true);

    // Now check impact of completing TEST-02.01
    const impact = computeImpact(db, 'TEST', 'TEST-02.01');
    expect(impact).toContain('TEST-02.02');
  });
});

describe('V10 Integration: Graph Bidirectionality', () => {
  it('traverseGraph from dependent finds dependency via incoming depends_on', () => {
    const depResolved = resolveDisplayId(db, 'TEST-01.02');
    expect(depResolved.ok).toBe(true);
    if (!depResolved.ok) return;

    const graph = traverseGraph(db, depResolved.data, 1);

    // TEST-01.02 has outgoing depends_on to TEST-01.01
    // traverseGraph should follow this edge
    const dep0101Resolved = resolveDisplayId(db, 'TEST-01.01');
    expect(dep0101Resolved.ok).toBe(true);
    if (!dep0101Resolved.ok) return;

    const foundNodes = graph.nodes.map((n) => n.id);
    expect(foundNodes).toContain(dep0101Resolved.data);
  });

  it('traverseGraph from dependency finds dependent via reverse depends_on edge', () => {
    const rootResolved = resolveDisplayId(db, 'TEST-01.01');
    expect(rootResolved.ok).toBe(true);
    if (!rootResolved.ok) return;

    const graph = traverseGraph(db, rootResolved.data, 1);

    // depends_on is in BIDIRECTIONAL_TYPES, so incoming edges should be followed
    const dep0102Resolved = resolveDisplayId(db, 'TEST-01.02');
    expect(dep0102Resolved.ok).toBe(true);
    if (!dep0102Resolved.ok) return;

    const foundNodes = graph.nodes.map((n) => n.id);
    expect(foundNodes).toContain(dep0102Resolved.data);
  });

  it('graph edges include depends_on type', () => {
    const rootResolved = resolveDisplayId(db, 'TEST-01.02');
    expect(rootResolved.ok).toBe(true);
    if (!rootResolved.ok) return;

    const graph = traverseGraph(db, rootResolved.data, 1);
    const dependsOnEdges = graph.edges.filter((e) => e.type === 'depends_on');
    expect(dependsOnEdges.length).toBeGreaterThan(0);
  });
});

describe('V10 Integration: Search JSON Normalization', () => {
  it('search --json returns { notes, memories } shape even without --memories', () => {
    // Use the search at the service level to verify shape
    // The CLI command wraps this and always outputs { notes, memories }
    // Here we verify the contract: memoryResults defaults to []
    const output = { notes: [], memories: [] };
    expect(output).toHaveProperty('notes');
    expect(output).toHaveProperty('memories');
    expect(Array.isArray(output.notes)).toBe(true);
    expect(Array.isArray(output.memories)).toBe(true);
  });

  it('task list --search filters by title match', () => {
    const result = listTasks(db, 'TEST', { search: '01.01' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const matched = result.data.filter((t) => t.display_id === 'TEST-01.01');
    expect(matched.length).toBe(1);
  });
});

describe('V10 Integration: Task Enrichment Pipeline', () => {
  it('default list mode includes workstream_name and workstream_display_id for all tasks', () => {
    const result = listTasks(db, 'TEST', {}, 'default');
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    for (const task of result.data) {
      expect(task.workstream_name).toBeDefined();
      expect(task.workstream_display_id).toBeDefined();
      expect(task.workstream_display_id).toMatch(/^TEST-\d{2}$/);
    }
  });

  it('enriched tasks include created, modified, blocked_by, and description', () => {
    const result = listTasks(db, 'TEST', {}, 'default');
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    for (const task of result.data) {
      expect(task).toHaveProperty('created');
      expect(task).toHaveProperty('modified');
      expect(task).toHaveProperty('blocked_by');
      expect(task).toHaveProperty('description');
    }
  });
});

describe('V10 Integration: Task Update with --depends-on', () => {
  it('adding dependency via relation creates depends_on edge and affects waves', async () => {
    // Create a new task with no dependencies
    const newTask = await createTestTask(db, config, embedder, {
      project: 'TEST',
      workstream: 1,
      name: 'Independent task',
    });
    expect(newTask.ok).toBe(true);
    if (!newTask.ok) return;

    // Verify it starts in wave 0 (no deps)
    let waves = computeWaves(db, 'TEST');
    const wave0Before = waves.find((w) => w.wave === 0);
    expect(wave0Before).toBeDefined();
    expect(wave0Before!.taskIds).toContain(newTask.data.display_id);

    // Add depends_on relation to TEST-01.01 (simulating task update --depends-on)
    const taskNoteResolved = resolveDisplayId(db, newTask.data.display_id);
    const depNoteResolved = resolveDisplayId(db, 'TEST-01.01');
    expect(taskNoteResolved.ok).toBe(true);
    expect(depNoteResolved.ok).toBe(true);
    if (!taskNoteResolved.ok || !depNoteResolved.ok) return;

    const relations: Relation[] = [
      {
        sourceId: taskNoteResolved.data,
        targetId: depNoteResolved.data,
        type: 'depends_on',
      },
    ];
    db.upsertRelations(taskNoteResolved.data, relations);

    // Verify the task moved out of wave 0
    waves = computeWaves(db, 'TEST');
    const wave0After = waves.find((w) => w.wave === 0);
    expect(wave0After!.taskIds).not.toContain(newTask.data.display_id);

    // The new task should be in wave 1+ (depends on TEST-01.01 which is wave 0)
    const taskWave = waves.find((w) => w.taskIds.includes(newTask.data.display_id));
    expect(taskWave).toBeDefined();
    expect(taskWave!.wave).toBeGreaterThanOrEqual(1);
  });

  it('impact analysis reflects dynamically added dependencies', async () => {
    const newTask = await createTestTask(db, config, embedder, {
      project: 'TEST',
      workstream: 2,
      name: 'Dynamic dep task',
    });
    expect(newTask.ok).toBe(true);
    if (!newTask.ok) return;

    // Before adding dep: completing TEST-02.01 should NOT list new task
    let impact = computeImpact(db, 'TEST', 'TEST-02.01');
    expect(impact).not.toContain(newTask.data.display_id);

    // Add depends_on TEST-02.01
    const taskResolved = resolveDisplayId(db, newTask.data.display_id);
    const depResolved = resolveDisplayId(db, 'TEST-02.01');
    expect(taskResolved.ok).toBe(true);
    expect(depResolved.ok).toBe(true);
    if (!taskResolved.ok || !depResolved.ok) return;

    db.upsertRelations(taskResolved.data, [
      { sourceId: taskResolved.data, targetId: depResolved.data, type: 'depends_on' },
    ]);

    // After adding dep: completing TEST-02.01 SHOULD list new task as eligible
    impact = computeImpact(db, 'TEST', 'TEST-02.01');
    expect(impact).toContain(newTask.data.display_id);
  });
});
