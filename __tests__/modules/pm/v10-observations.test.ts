import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { BrainDB } from '../../../src/services/brain-db.js';
import { tmpDbPath, createMockEmbedder } from '../../helpers.js';
import type { BrainConfig } from '../../../src/types.js';
import { createStandardProject } from '../../fixtures/pm-project.js';
import { listTasks, getTask, createTask } from '../../../src/modules/pm/data/task-ops.js';
import { computeWaves, inferDependencies } from '../../../src/modules/pm/engine/dependency.js';

let db: BrainDB;
let dbPath: string;
let notesDir: string;
let config: BrainConfig;
const embedder = createMockEmbedder();

beforeEach(async () => {
  dbPath = tmpDbPath('pm-v10-obs');
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

// ---------- O-131: waves --json broken output ----------

describe('O-131: waves JSON output', () => {
  it('every wave has a non-null wave number', () => {
    const waves = computeWaves(db, 'TEST');
    expect(waves.length).toBeGreaterThan(0);
    for (const w of waves) {
      expect(w.wave).not.toBeNull();
      expect(w.wave).not.toBeUndefined();
      expect(typeof w.wave).toBe('number');
    }
  });

  it('every wave has a non-empty taskIds array', () => {
    const waves = computeWaves(db, 'TEST');
    for (const w of waves) {
      expect(w.taskIds.length).toBeGreaterThan(0);
    }
  });

  it('wave JSON tasks have populated display_id, status, and priority', () => {
    const waves = computeWaves(db, 'TEST');
    for (const w of waves) {
      for (const taskId of w.taskIds) {
        const r = getTask(db, taskId);
        expect(r.ok).toBe(true);
        if (r.ok) {
          expect(r.data.display_id).toBeTruthy();
          expect(r.data.status).toBeTruthy();
          expect(r.data.priority).toBeTruthy();
        }
      }
    }
  });

  // O-131: depends_on arrays should be populated for tasks that have dependencies.
  // The waves JSON serializer reads depends_on from TaskMetadata (frontmatter field).
  // getTask() returns depends_on from frontmatter, which may be undefined even when
  // relation-based dependencies exist.
  it('dependent tasks have populated depends_on arrays in getTask()', () => {
    // TEST-01.02 depends on TEST-01.01 — its depends_on should be non-empty
    const r = getTask(db, 'TEST-01.02');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.depends_on).toBeDefined();
      expect(r.data.depends_on!.length).toBeGreaterThan(0);
      expect(r.data.depends_on).toContain('TEST-01.01');
    }
  });
});

// ---------- O-132: virtualStates eligibility vs blocked_by ----------

describe('O-132: virtualStates blocked vs eligible', () => {
  it('tasks with no dependencies are +ELIGIBLE', () => {
    // TEST-01.01 and TEST-02.01 have no deps — should be eligible
    const r1 = getTask(db, 'TEST-01.01');
    expect(r1.ok).toBe(true);
    if (r1.ok) {
      expect(r1.data.virtualStates).toContain('+ELIGIBLE');
      expect(r1.data.virtualStates).not.toContain('+BLOCKED');
    }

    const r2 = getTask(db, 'TEST-02.01');
    expect(r2.ok).toBe(true);
    if (r2.ok) {
      expect(r2.data.virtualStates).toContain('+ELIGIBLE');
      expect(r2.data.virtualStates).not.toContain('+BLOCKED');
    }
  });

  // O-132: Tasks with unmet blocked_by dependencies should be +BLOCKED, not +ELIGIBLE.
  // computeVirtualState uses hasDependencies from frontmatter depends_on, but if
  // frontmatter doesn't reflect actual relation-based dependencies, tasks with unmet
  // deps may incorrectly compute as +ELIGIBLE.
  it('tasks with unmet dependencies are +BLOCKED (not +ELIGIBLE)', () => {
    // TEST-01.02 depends on TEST-01.01 (pending) — should be blocked
    const r = getTask(db, 'TEST-01.02');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.virtualStates).toContain('+BLOCKED');
      expect(r.data.virtualStates).not.toContain('+ELIGIBLE');
    }
  });

  it('diamond-dependency task with all deps unmet is +BLOCKED', () => {
    // TEST-02.02 depends on TEST-01.01 and TEST-02.01 (both pending)
    const r = getTask(db, 'TEST-02.02');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.virtualStates).toContain('+BLOCKED');
      expect(r.data.virtualStates).not.toContain('+ELIGIBLE');
    }
  });

  it('deep-chain task with unmet deps is +BLOCKED', () => {
    // TEST-02.03 depends on TEST-01.03 and TEST-02.02 (both pending)
    const r = getTask(db, 'TEST-02.03');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.virtualStates).toContain('+BLOCKED');
      expect(r.data.virtualStates).not.toContain('+ELIGIBLE');
    }
  });

  // O-132: listTasks should also reflect correct virtualStates
  it('listTasks returns +BLOCKED for tasks with unmet dependencies', () => {
    const result = listTasks(db, 'TEST');
    expect(result.ok).toBe(true);
    if (result.ok) {
      const t02 = result.data.find((t) => t.display_id === 'TEST-01.02');
      expect(t02).toBeDefined();
      expect(t02!.virtualStates).toContain('+BLOCKED');
      expect(t02!.virtualStates).not.toContain('+ELIGIBLE');
    }
  });
});

// ---------- O-131 / O-132: relation-only dependencies (inferDependencies path) ----------

describe('O-131 + O-132: relation-only dependencies via inferDependencies', () => {
  // When inferDependencies adds depends_on relations without updating frontmatter,
  // getTask() returns depends_on as undefined, and virtualStates incorrectly shows
  // +ELIGIBLE instead of +BLOCKED.

  it.skip('O-132: inferred-dep task has +BLOCKED virtualState (not +ELIGIBLE)', async () => {
    // Create a testing task and an implementation task in same workstream.
    // inferDependencies should add testing->implementation dep via relations only.
    const implTask = await createTask(db, config, embedder, {
      project: 'TEST',
      workstream: 1,
      name: 'Impl task',
      category: 'implementation',
    });
    expect(implTask.ok).toBe(true);

    const testTask = await createTask(db, config, embedder, {
      project: 'TEST',
      workstream: 1,
      name: 'Test task',
      category: 'testing',
      // No explicit dependsOn — inferDependencies should add the relation
    });
    expect(testTask.ok).toBe(true);

    const inferred = inferDependencies(db, 'TEST');
    expect(inferred).toBeGreaterThan(0);

    // The testing task now has a relation-based dependency on the implementation task.
    // getTask should reflect this in virtualStates as +BLOCKED (impl is still pending).
    if (testTask.ok) {
      const r = getTask(db, testTask.data.display_id);
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.data.virtualStates).toContain('+BLOCKED');
        expect(r.data.virtualStates).not.toContain('+ELIGIBLE');
      }
    }
  });

  it.skip('O-131: inferred-dep task has populated depends_on in waves JSON', async () => {
    const implTask = await createTask(db, config, embedder, {
      project: 'TEST',
      workstream: 1,
      name: 'Impl task for waves',
      category: 'implementation',
    });
    expect(implTask.ok).toBe(true);

    const testTask = await createTask(db, config, embedder, {
      project: 'TEST',
      workstream: 1,
      name: 'Test task for waves',
      category: 'testing',
    });
    expect(testTask.ok).toBe(true);

    inferDependencies(db, 'TEST');

    // The waves JSON serializer reads depends_on from getTask(), which uses frontmatter.
    // After inferDependencies, the relation exists but frontmatter depends_on is empty.
    if (testTask.ok) {
      const r = getTask(db, testTask.data.display_id);
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.data.depends_on).toBeDefined();
        expect(r.data.depends_on!.length).toBeGreaterThan(0);
      }
    }
  });
});

// ---------- O-164: Wave 0 label in text output ----------

describe('O-164: Wave 0 label', () => {
  it('computeWaves includes wave 0 in results', () => {
    const waves = computeWaves(db, 'TEST');
    const wave0 = waves.find((w) => w.wave === 0);
    expect(wave0).toBeDefined();
    expect(wave0!.taskIds.length).toBeGreaterThan(0);
  });

  it('wave 0 header would render as "Wave 0:" (not empty)', () => {
    const waves = computeWaves(db, 'TEST');
    expect(waves.length).toBeGreaterThan(0);

    // Simulate the text formatter from orchestration.ts (line 148)
    const lines: string[] = [];
    for (const w of waves) {
      lines.push(`Wave ${w.wave}:`);
      for (const id of w.taskIds) {
        lines.push(`  ${id}`);
      }
    }
    const output = lines.join('\n');

    // Wave 0 should have a labeled header
    expect(output).toContain('Wave 0:');
    // Every task should appear under a "Wave N:" header
    const allTaskIds = waves.flatMap((w) => w.taskIds);
    for (const id of allTaskIds) {
      expect(output).toContain(id);
    }
  });
});
