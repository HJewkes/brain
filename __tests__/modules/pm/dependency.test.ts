import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { BrainDB } from '../../../src/services/brain-db.js';
import { createMockEmbedder, createTestTask, createTestDb } from '../../helpers.js';
import type { BrainConfig } from '../../../src/types.js';
import { createStandardProject } from '../../fixtures/pm-project.js';
import { createProject } from '../../../src/modules/pm/data/project-ops.js';
import { createWorkstream } from '../../../src/modules/pm/data/workstream-ops.js';
import { updateTaskStatus } from '../../../src/modules/pm/data/task-ops.js';
import {
  buildDependencyGraph,
  computeEligible,
  detectCycle,
  computeWaves,
  computeImpact,
} from '../../../src/modules/pm/engine/dependency.js';

let db: BrainDB;
let dbPath: string;
let notesDir: string;
let config: BrainConfig;
const embedder = createMockEmbedder();

beforeEach(async () => {
  ({ dbPath, db } = createTestDb());
  notesDir = join(tmpdir(), `pm-dep-notes-${randomUUID()}`);
  mkdirSync(notesDir, { recursive: true });
  config = {
    notesDir,
    dbPath,
    embedder: 'local',
    fusionWeights: { bm25: 0.3, vector: 0.7 },
  };
});

afterEach(() => {
  db.close();
  if (existsSync(notesDir)) {
    rmSync(notesDir, { recursive: true, force: true });
  }
});

describe('buildDependencyGraph', () => {
  it('builds correct adjacency list from fixture', async () => {
    await createStandardProject(db, config, embedder);
    const graph = buildDependencyGraph(db, 'TEST');

    expect(graph.size).toBe(6);
    expect(graph.get('TEST-01.01')).toEqual([]);
    expect(graph.get('TEST-01.02')).toEqual(['TEST-01.01']);
    expect(graph.get('TEST-01.03')).toEqual(['TEST-01.02']);
    expect(graph.get('TEST-02.01')).toEqual([]);
    expect(graph.get('TEST-02.02')!.sort()).toEqual(['TEST-01.01', 'TEST-02.01']);
    expect(graph.get('TEST-02.03')!.sort()).toEqual(['TEST-01.03', 'TEST-02.02']);
  });

  it('empty project returns empty graph', async () => {
    await createProject(db, config, embedder, { name: 'Empty', prefix: 'EMPTY' });
    const graph = buildDependencyGraph(db, 'EMPTY');
    expect(graph.size).toBe(0);
  });
});

describe('computeEligible', () => {
  it('initial state returns TEST-01.01 and TEST-02.01', async () => {
    await createStandardProject(db, config, embedder);
    const eligible = computeEligible(db, 'TEST');
    expect(eligible).toEqual(['TEST-01.01', 'TEST-02.01']);
  });

  it('after completing 01.01, adds 01.02 but NOT 02.02 (still needs 02.01)', async () => {
    await createStandardProject(db, config, embedder);
    await updateTaskStatus(db, config, embedder, 'TEST-01.01', 'claimed');
    await updateTaskStatus(db, config, embedder, 'TEST-01.01', 'in-progress');
    await updateTaskStatus(db, config, embedder, 'TEST-01.01', 'done');

    const eligible = computeEligible(db, 'TEST');
    expect(eligible).toContain('TEST-01.02');
    expect(eligible).toContain('TEST-02.01');
    expect(eligible).not.toContain('TEST-02.02');
  });

  it('after completing 01.01 + 02.01, 02.02 now eligible (diamond resolved)', async () => {
    await createStandardProject(db, config, embedder);

    for (const id of ['TEST-01.01', 'TEST-02.01']) {
      await updateTaskStatus(db, config, embedder, id, 'claimed');
      await updateTaskStatus(db, config, embedder, id, 'in-progress');
      await updateTaskStatus(db, config, embedder, id, 'done');
    }

    const eligible = computeEligible(db, 'TEST');
    expect(eligible).toContain('TEST-01.02');
    expect(eligible).toContain('TEST-02.02');
    expect(eligible).not.toContain('TEST-02.03');
  });

  it('all done returns empty', async () => {
    await createStandardProject(db, config, embedder);

    // Complete in topological order
    const order = [
      'TEST-01.01',
      'TEST-02.01',
      'TEST-01.02',
      'TEST-02.02',
      'TEST-01.03',
      'TEST-02.03',
    ];
    for (const id of order) {
      await updateTaskStatus(db, config, embedder, id, 'claimed');
      await updateTaskStatus(db, config, embedder, id, 'in-progress');
      await updateTaskStatus(db, config, embedder, id, 'done');
    }

    const eligible = computeEligible(db, 'TEST');
    expect(eligible).toEqual([]);
  });
});

describe('detectCycle', () => {
  it('no cycle returns ok', async () => {
    await createStandardProject(db, config, embedder);
    // Adding TEST-02.01 depends on TEST-01.01 would be fine (no cycle)
    const result = detectCycle(db, 'TEST', 'TEST-02.01', 'TEST-01.01');
    expect(result.ok).toBe(true);
  });

  it('direct cycle A depends on B, B depends on A returns CYCLE_DETECTED', async () => {
    await createProject(db, config, embedder, { name: 'Cycle', prefix: 'CYC' });
    await createWorkstream(db, config, embedder, { project: 'CYC', name: 'WS1' });
    await createTestTask(db, config, embedder, { project: 'CYC', workstream: 1, name: 'A' });
    await createTestTask(db, config, embedder, {
      project: 'CYC',
      workstream: 1,
      name: 'B',
      dependsOn: ['CYC-01.01'],
    });

    // B already depends on A. Adding A depends on B would create A -> B -> A
    const result = detectCycle(db, 'CYC', 'CYC-01.01', 'CYC-01.02');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('CYCLE_DETECTED');
      expect(result.error.details?.cycle).toBeDefined();
      const cycle = result.error.details!.cycle as string[];
      expect(cycle).toContain('CYC-01.01');
      expect(cycle).toContain('CYC-01.02');
    }
  });

  it('transitive cycle A->B->C->A returns CYCLE_DETECTED with full path', async () => {
    await createStandardProject(db, config, embedder);
    // In fixture: 01.03 -> 01.02 -> 01.01
    // Adding 01.01 depends on 01.03 would create: 01.01 -> 01.03 -> 01.02 -> 01.01
    const result = detectCycle(db, 'TEST', 'TEST-01.01', 'TEST-01.03');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('CYCLE_DETECTED');
      const cycle = result.error.details!.cycle as string[];
      expect(cycle.length).toBeGreaterThanOrEqual(3);
      expect(cycle[0]).toBe('TEST-01.01');
      expect(cycle[cycle.length - 1]).toBe('TEST-01.01');
    }
  });

  it('adding non-cyclic edge returns ok', async () => {
    await createStandardProject(db, config, embedder);
    // Adding 02.03 depends on 01.01 is fine (01.01 has no deps)
    const result = detectCycle(db, 'TEST', 'TEST-02.03', 'TEST-01.01');
    expect(result.ok).toBe(true);
  });

  it('self-dependency returns CYCLE_DETECTED', async () => {
    await createStandardProject(db, config, embedder);
    const result = detectCycle(db, 'TEST', 'TEST-01.01', 'TEST-01.01');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('CYCLE_DETECTED');
    }
  });
});

describe('computeWaves', () => {
  it('initial: wave 0 = [01.01, 02.01], wave 1 = [01.02], etc', async () => {
    await createStandardProject(db, config, embedder);
    const waves = computeWaves(db, 'TEST');

    expect(waves.length).toBeGreaterThanOrEqual(4);

    expect(waves[0].wave).toBe(0);
    expect(waves[0].taskIds).toEqual(['TEST-01.01', 'TEST-02.01']);

    expect(waves[1].wave).toBe(1);
    expect(waves[1].taskIds).toContain('TEST-01.02');

    // TEST-02.02 needs both 01.01 (wave 0) and 02.01 (wave 0), so wave 1
    expect(waves[1].taskIds).toContain('TEST-02.02');

    expect(waves[2].wave).toBe(2);
    expect(waves[2].taskIds).toContain('TEST-01.03');

    // TEST-02.03 needs 01.03 (wave 2) and 02.02 (wave 1), so wave 3
    expect(waves[3].wave).toBe(3);
    expect(waves[3].taskIds).toContain('TEST-02.03');
  });

  it('in-progress tasks included, done tasks excluded', async () => {
    await createStandardProject(db, config, embedder);
    await updateTaskStatus(db, config, embedder, 'TEST-01.01', 'claimed');
    await updateTaskStatus(db, config, embedder, 'TEST-01.01', 'in-progress');
    await updateTaskStatus(db, config, embedder, 'TEST-01.01', 'done');

    const waves = computeWaves(db, 'TEST');
    const allTaskIds = waves.flatMap((w) => w.taskIds);
    expect(allTaskIds).not.toContain('TEST-01.01');
    expect(allTaskIds).toContain('TEST-01.02');
    expect(allTaskIds).toContain('TEST-02.01');
  });
});

describe('computeImpact', () => {
  it('completing 01.01 unblocks 01.02 (02.02 still needs 02.01)', async () => {
    await createStandardProject(db, config, embedder);
    const impact = computeImpact(db, 'TEST', 'TEST-01.01');
    expect(impact).toContain('TEST-01.02');
    expect(impact).not.toContain('TEST-02.02');
  });

  it('completing task with no dependents returns empty', async () => {
    await createStandardProject(db, config, embedder);
    // TEST-02.03 has no dependents
    const impact = computeImpact(db, 'TEST', 'TEST-02.03');
    expect(impact).toEqual([]);
  });

  it('completing both 01.01 and 02.01 together: 02.01 unlocks 02.02', async () => {
    await createStandardProject(db, config, embedder);
    // First complete 01.01
    await updateTaskStatus(db, config, embedder, 'TEST-01.01', 'claimed');
    await updateTaskStatus(db, config, embedder, 'TEST-01.01', 'in-progress');
    await updateTaskStatus(db, config, embedder, 'TEST-01.01', 'done');

    // Now check impact of completing 02.01 (01.01 is already done)
    const impact = computeImpact(db, 'TEST', 'TEST-02.01');
    expect(impact).toContain('TEST-02.02');
  });
});
