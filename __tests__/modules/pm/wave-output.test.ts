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
import { createTask } from '../../../src/modules/pm/data/task-ops.js';
import { computeWaves } from '../../../src/modules/pm/engine/dependency.js';

let db: BrainDB;
let notesDir: string;
let config: BrainConfig;
const embedder = createMockEmbedder();

beforeEach(async () => {
  db = new BrainDB(tmpDbPath('wave-output'));
  notesDir = join(tmpdir(), `wave-output-${randomUUID()}`);
  mkdirSync(notesDir, { recursive: true });
  config = { notesDir, dbPath: '', embedder: 'local', fusionWeights: { bm25: 0.3, vector: 0.7 } };
  await createProject(db, config, embedder, { name: 'Test', prefix: 'TST' });
  await createWorkstream(db, config, embedder, { project: 'TST', name: 'Core' });
});

afterEach(() => {
  db.close();
  if (existsSync(notesDir)) rmSync(notesDir, { recursive: true, force: true });
});

describe('wave output improvements', () => {
  // O-92: waves produce correct wave grouping
  it('O-92: computeWaves groups independent tasks in wave 1', async () => {
    await createTask(db, config, embedder, { project: 'TST', workstream: 1, name: 'A' });
    await createTask(db, config, embedder, { project: 'TST', workstream: 1, name: 'B' });
    const waves = computeWaves(db, 'TST');
    expect(waves.length).toBeGreaterThan(0);
    expect(waves[0].wave).toBe(0);
    expect(waves[0].taskIds.length).toBe(2);
  });

  it('tasks with dependencies go to later waves', async () => {
    await createTask(db, config, embedder, { project: 'TST', workstream: 1, name: 'First' });
    await createTask(db, config, embedder, {
      project: 'TST', workstream: 1, name: 'Second', dependsOn: ['TST-01.01'],
    });
    const waves = computeWaves(db, 'TST');
    expect(waves.length).toBe(2);
    expect(waves[0].taskIds).toContain('TST-01.01');
    expect(waves[1].taskIds).toContain('TST-01.02');
  });

  // O-145: empty waves shows message
  it('O-145: no tasks produces empty waves', async () => {
    const waves = computeWaves(db, 'TST');
    expect(waves.length).toBe(0);
  });

  it('workstream filter narrows wave results', async () => {
    await createWorkstream(db, config, embedder, { project: 'TST', name: 'Other' });
    await createTask(db, config, embedder, { project: 'TST', workstream: 1, name: 'Core task' });
    await createTask(db, config, embedder, { project: 'TST', workstream: 2, name: 'Other task' });

    const waves = computeWaves(db, 'TST');
    expect(waves.length).toBe(1);
    expect(waves[0].taskIds.length).toBe(2);

    // Simulate workstream filter (as done in the command)
    const filtered = waves.map(w => ({
      ...w,
      taskIds: w.taskIds.filter(id => id.startsWith('TST-01')),
    })).filter(w => w.taskIds.length > 0);

    expect(filtered.length).toBe(1);
    expect(filtered[0].taskIds).toEqual(['TST-01.01']);
  });
});
