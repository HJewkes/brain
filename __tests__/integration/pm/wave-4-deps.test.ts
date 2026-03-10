import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { BrainDB } from '../../../src/services/brain-db.js';
import { loadModules } from '../../../src/modules/loader.js';
import { createMockEmbedder, createTestDb } from '../../helpers.js';
import type { BrainConfig } from '../../../src/types.js';
import { pmModule } from '../../../src/modules/pm/index.js';
import { createStandardProject } from '../../fixtures/pm-project.js';
import { getTask, updateTaskStatus } from '../../../src/modules/pm/data/task-ops.js';
import {
  computeEligible,
  computeWaves,
  detectCycle,
} from '../../../src/modules/pm/engine/dependency.js';

let db: BrainDB;
let notesDir: string;
let config: BrainConfig;
const embedder = createMockEmbedder();

beforeEach(async () => {
  ({ db } = createTestDb());
  db.setEmbeddingModel(embedder.model, embedder.dimensions);
  notesDir = join(tmpdir(), `pm-wave4-${randomUUID()}`);
  mkdirSync(notesDir, { recursive: true });
  config = {
    notesDir,
    dbPath: '',
    embedder: 'local',
    fusionWeights: { bm25: 0.3, vector: 0.7 },
  };

  await loadModules({ modules: [pmModule] });
  await createStandardProject(db, config, embedder);
});

afterEach(() => {
  db.close();
  if (existsSync(notesDir)) {
    rmSync(notesDir, { recursive: true, force: true });
  }
});

describe('Wave 4: Dependencies', () => {
  it('initial: next returns TEST-01.01 and TEST-02.01', () => {
    const eligible = computeEligible(db, 'TEST');
    expect(eligible).toEqual(['TEST-01.01', 'TEST-02.01']);
  });

  it('initial: waves shows 3+ waves', () => {
    const waves = computeWaves(db, 'TEST');
    expect(waves.length).toBeGreaterThanOrEqual(3);

    // Wave 0 should contain the two root tasks
    expect(waves[0].taskIds).toContain('TEST-01.01');
    expect(waves[0].taskIds).toContain('TEST-02.01');
  });

  it('complete TEST-01.01 → next includes TEST-01.02', async () => {
    // Move through valid state transitions: pending → claimed → in-progress → done
    await updateTaskStatus(db, config, embedder, 'TEST-01.01', 'claimed');
    await updateTaskStatus(db, config, embedder, 'TEST-01.01', 'in-progress');
    await updateTaskStatus(db, config, embedder, 'TEST-01.01', 'done');

    const eligible = computeEligible(db, 'TEST');
    expect(eligible).toContain('TEST-01.02');
    expect(eligible).toContain('TEST-02.01');
  });

  it('TEST-02.02 still blocked until both 01.01 and 02.01 done', async () => {
    // Complete only TEST-01.01
    await updateTaskStatus(db, config, embedder, 'TEST-01.01', 'claimed');
    await updateTaskStatus(db, config, embedder, 'TEST-01.01', 'in-progress');
    await updateTaskStatus(db, config, embedder, 'TEST-01.01', 'done');

    const eligible = computeEligible(db, 'TEST');
    expect(eligible).not.toContain('TEST-02.02');
  });

  it('complete TEST-02.01 → TEST-02.02 now eligible (diamond resolved)', async () => {
    // Complete both TEST-01.01 and TEST-02.01
    await updateTaskStatus(db, config, embedder, 'TEST-01.01', 'claimed');
    await updateTaskStatus(db, config, embedder, 'TEST-01.01', 'in-progress');
    await updateTaskStatus(db, config, embedder, 'TEST-01.01', 'done');

    await updateTaskStatus(db, config, embedder, 'TEST-02.01', 'claimed');
    await updateTaskStatus(db, config, embedder, 'TEST-02.01', 'in-progress');
    await updateTaskStatus(db, config, embedder, 'TEST-02.01', 'done');

    const eligible = computeEligible(db, 'TEST');
    expect(eligible).toContain('TEST-02.02');
    expect(eligible).toContain('TEST-01.02');
  });

  it('waves updates after completions', async () => {
    // Complete root tasks
    await updateTaskStatus(db, config, embedder, 'TEST-01.01', 'claimed');
    await updateTaskStatus(db, config, embedder, 'TEST-01.01', 'in-progress');
    await updateTaskStatus(db, config, embedder, 'TEST-01.01', 'done');

    await updateTaskStatus(db, config, embedder, 'TEST-02.01', 'claimed');
    await updateTaskStatus(db, config, embedder, 'TEST-02.01', 'in-progress');
    await updateTaskStatus(db, config, embedder, 'TEST-02.01', 'done');

    const waves = computeWaves(db, 'TEST');
    // Completed tasks are excluded from waves
    const allTaskIds = waves.flatMap((w) => w.taskIds);
    expect(allTaskIds).not.toContain('TEST-01.01');
    expect(allTaskIds).not.toContain('TEST-02.01');

    // Remaining 4 tasks should still be grouped
    expect(allTaskIds).toContain('TEST-01.02');
    expect(allTaskIds).toContain('TEST-02.02');
  });

  it('add cyclic dependency → CYCLE_DETECTED error with path', () => {
    // TEST-01.01 → TEST-01.02 → TEST-01.03 chain exists
    // Adding TEST-01.01 depends_on TEST-01.03 would create a cycle
    const result = detectCycle(db, 'TEST', 'TEST-01.01', 'TEST-01.03');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('CYCLE_DETECTED');
      expect(result.error.details?.cycle).toBeDefined();
      const cycle = result.error.details!.cycle as string[];
      expect(cycle).toContain('TEST-01.01');
    }
  });

  it('self-dependency → CYCLE_DETECTED', () => {
    const result = detectCycle(db, 'TEST', 'TEST-01.01', 'TEST-01.01');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('CYCLE_DETECTED');
    }
  });

  it('valid dependency → no cycle detected', () => {
    // TEST-01.03 depending on TEST-02.01 would not create a cycle
    const result = detectCycle(db, 'TEST', 'TEST-01.03', 'TEST-02.01');
    expect(result.ok).toBe(true);
  });

  it('getTask returns virtual states for eligible task', () => {
    const result = getTask(db, 'TEST-01.01');
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.virtualStates).toContain('+READY');
    expect(result.data.virtualStates).toContain('+ELIGIBLE');
  });

  it('getTask returns +BLOCKED for task with incomplete deps', () => {
    const result = getTask(db, 'TEST-01.02');
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.virtualStates).toContain('+BLOCKED');
    expect(result.data.virtualStates).not.toContain('+READY');
  });

  it('computeEligible results match getTask data for JSON output', () => {
    const eligibleIds = computeEligible(db, 'TEST');
    const tasks = eligibleIds.map((id) => {
      const result = getTask(db, id);
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error('unexpected');
      return {
        display_id: result.data.display_id,
        name: result.data.display_id,
        priority: result.data.priority,
        virtualStates: result.data.virtualStates,
      };
    });

    const json = JSON.stringify(tasks);
    const parsed = JSON.parse(json) as Array<Record<string, unknown>>;

    expect(parsed).toHaveLength(2);
    for (const t of parsed) {
      expect(t.display_id).toBeDefined();
      expect(t.priority).toBeDefined();
      expect(t.virtualStates).toBeDefined();
      expect(Array.isArray(t.virtualStates)).toBe(true);
    }
  });

  it('computeWaves results match getTask data for JSON output', () => {
    const waves = computeWaves(db, 'TEST');
    const result = waves.map((w) => ({
      wave: w.wave,
      tasks: w.taskIds.map((id) => {
        const r = getTask(db, id);
        expect(r.ok).toBe(true);
        if (!r.ok) throw new Error('unexpected');
        return {
          display_id: r.data.display_id,
          name: r.data.display_id,
          status: r.data.status,
        };
      }),
    }));

    const json = JSON.stringify(result);
    const parsed = JSON.parse(json) as Array<{
      wave: number;
      tasks: Array<Record<string, unknown>>;
    }>;

    expect(parsed.length).toBeGreaterThanOrEqual(3);
    for (const w of parsed) {
      expect(typeof w.wave).toBe('number');
      expect(Array.isArray(w.tasks)).toBe(true);
      for (const t of w.tasks) {
        expect(t.display_id).toBeDefined();
        expect(t.status).toBeDefined();
      }
    }
  });
});
