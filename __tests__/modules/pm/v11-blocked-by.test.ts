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
import { listTasks, createTask } from '../../../src/modules/pm/data/task-ops.js';
import { getPmNotes } from '../../../src/modules/pm/data/queries.js';
import { detectCycles, buildDependencyGraph } from '../../../src/modules/pm/engine/dependency.js';

let db: BrainDB;
let dbPath: string;
let notesDir: string;
let config: BrainConfig;
const embedder = createMockEmbedder();

beforeEach(async () => {
  dbPath = tmpDbPath('pm-v11-blocked');
  db = new BrainDB(dbPath);
  notesDir = join(tmpdir(), `pm-v11-blocked-${randomUUID()}`);
  mkdirSync(notesDir, { recursive: true });
  config = {
    notesDir,
    dbPath,
    embedder: 'local',
    fusionWeights: { bm25: 0.3, vector: 0.7 },
  };

  const proj = await createProject(db, config, embedder, { name: 'Block Test', prefix: 'BLK' });
  if (!proj.ok) throw new Error(proj.error.message);
  const ws = await createWorkstream(db, config, embedder, { project: 'BLK', name: 'WS1' });
  if (!ws.ok) throw new Error(ws.error.message);
});

afterEach(() => {
  db.close();
  if (existsSync(notesDir)) {
    rmSync(notesDir, { recursive: true, force: true });
  }
});

describe('blocked_by semantics', () => {
  it('blocked_by contains upstream prerequisites, not downstream dependents', async () => {
    // A depends_on B: A waits on B, so A.blocked_by should include B
    const tB = await createTask(db, config, embedder, {
      project: 'BLK',
      workstream: 1,
      name: 'Task B (prerequisite)',
    });
    expect(tB.ok).toBe(true);

    const tA = await createTask(db, config, embedder, {
      project: 'BLK',
      workstream: 1,
      name: 'Task A (depends on B)',
      dependsOn: ['BLK-01.01'],
    });
    expect(tA.ok).toBe(true);

    const result = listTasks(db, 'BLK', {}, 'full');
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const taskA = result.data.find((t) => t.display_id === 'BLK-01.02');
    const taskB = result.data.find((t) => t.display_id === 'BLK-01.01');

    // A.blocked_by should contain B (upstream prerequisite)
    expect(taskA?.blocked_by).toContain('BLK-01.01');
    // B.blocked_by should NOT contain A
    expect(taskB?.blocked_by ?? []).not.toContain('BLK-01.02');
  });

  it('blocks field contains downstream dependents', async () => {
    // A depends_on B: B blocks A, so B.blocks should include A
    const tB = await createTask(db, config, embedder, {
      project: 'BLK',
      workstream: 1,
      name: 'Task B (prerequisite)',
    });
    expect(tB.ok).toBe(true);

    const tA = await createTask(db, config, embedder, {
      project: 'BLK',
      workstream: 1,
      name: 'Task A (depends on B)',
      dependsOn: ['BLK-01.01'],
    });
    expect(tA.ok).toBe(true);

    const result = listTasks(db, 'BLK', {}, 'full');
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const taskB = result.data.find((t) => t.display_id === 'BLK-01.01');
    const taskA = result.data.find((t) => t.display_id === 'BLK-01.02');

    // B.blocks should contain A (downstream dependent)
    expect(taskB?.blocks).toContain('BLK-01.02');
    // A.blocks should NOT contain B
    expect(taskA?.blocks ?? []).not.toContain('BLK-01.01');
  });
});

describe('cycle detection', () => {
  it('detectCycles returns cycle path for circular deps', () => {
    // A -> B -> C -> A
    const graph = new Map<string, string[]>();
    graph.set('A', ['B']);
    graph.set('B', ['C']);
    graph.set('C', ['A']);

    const cycles = detectCycles(graph);
    expect(cycles.length).toBeGreaterThan(0);
    // The cycle should contain all three nodes
    const cycle = cycles[0];
    expect(cycle).toContain('A');
    expect(cycle).toContain('B');
    expect(cycle).toContain('C');
  });

  it('detectCycles returns empty for acyclic graph', () => {
    const graph = new Map<string, string[]>();
    graph.set('A', ['B']);
    graph.set('B', ['C']);
    graph.set('C', []);

    const cycles = detectCycles(graph);
    expect(cycles).toHaveLength(0);
  });

  it('detectCycles handles self-loop', () => {
    const graph = new Map<string, string[]>();
    graph.set('A', ['A']);

    const cycles = detectCycles(graph);
    expect(cycles.length).toBeGreaterThan(0);
  });
});
