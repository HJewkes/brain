import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { BrainDB } from '../../../src/services/brain-db.js';
import { createMockEmbedder, createTestTask, createTestDb } from '../../helpers.js';
import type { BrainConfig } from '../../../src/types.js';
import { createProject } from '../../../src/modules/pm/data/project-ops.js';
import { createWorkstream } from '../../../src/modules/pm/data/workstream-ops.js';
import { updateTaskStatus } from '../../../src/modules/pm/data/task-ops.js';
import { checkWorkstreamConcurrency } from '../../../src/modules/pm/engine/concurrency.js';

let db: BrainDB;
let dbPath: string;
let notesDir: string;
let config: BrainConfig;
const embedder = createMockEmbedder();

beforeEach(async () => {
  ({ dbPath, db } = createTestDb());
  notesDir = join(tmpdir(), `pm-concurrency-${randomUUID()}`);
  mkdirSync(notesDir, { recursive: true });
  config = {
    notesDir,
    dbPath,
    embedder: 'local',
    fusionWeights: { bm25: 0.3, vector: 0.7 },
  };

  await createProject(db, config, embedder, { name: 'Test', prefix: 'TST' });
  await createWorkstream(db, config, embedder, {
    project: 'TST',
    title: 'Core',
    description: 'Core workstream',
  });
  await createWorkstream(db, config, embedder, {
    project: 'TST',
    title: 'Other',
    description: 'Other workstream',
  });
});

afterEach(() => {
  db.close();
  if (existsSync(notesDir)) {
    rmSync(notesDir, { recursive: true, force: true });
  }
});

describe('checkWorkstreamConcurrency', () => {
  it('allows task when no other task is in-progress in workstream', async () => {
    await createTestTask(db, config, embedder, {
      project: 'TST',
      workstream: 1,
      name: 'Task A',
    });

    const result = checkWorkstreamConcurrency(db, 'TST-01.01');

    expect(result.allowed).toBe(true);
    expect(result.blockingTask).toBeUndefined();
  });

  it('blocks task when another task in same workstream is in-progress', async () => {
    await createTestTask(db, config, embedder, {
      project: 'TST',
      workstream: 1,
      name: 'Task A',
    });
    await createTestTask(db, config, embedder, {
      project: 'TST',
      workstream: 1,
      name: 'Task B',
    });

    await updateTaskStatus(db, config, embedder, 'TST-01.01', 'claimed');
    await updateTaskStatus(db, config, embedder, 'TST-01.01', 'in-progress');

    const result = checkWorkstreamConcurrency(db, 'TST-01.02');

    expect(result.allowed).toBe(false);
    expect(result.blockingTask).toBe('TST-01.01');
  });

  it('allows task that is itself already in-progress', async () => {
    await createTestTask(db, config, embedder, {
      project: 'TST',
      workstream: 1,
      name: 'Task A',
    });

    await updateTaskStatus(db, config, embedder, 'TST-01.01', 'claimed');
    await updateTaskStatus(db, config, embedder, 'TST-01.01', 'in-progress');

    const result = checkWorkstreamConcurrency(db, 'TST-01.01');

    expect(result.allowed).toBe(true);
  });

  it('allows cross-workstream parallelism', async () => {
    await createTestTask(db, config, embedder, {
      project: 'TST',
      workstream: 1,
      name: 'Task in WS1',
    });
    await createTestTask(db, config, embedder, {
      project: 'TST',
      workstream: 2,
      name: 'Task in WS2',
    });

    await updateTaskStatus(db, config, embedder, 'TST-01.01', 'claimed');
    await updateTaskStatus(db, config, embedder, 'TST-01.01', 'in-progress');

    const result = checkWorkstreamConcurrency(db, 'TST-02.01');

    expect(result.allowed).toBe(true);
  });

  it('allows task after blocking task completes', async () => {
    await createTestTask(db, config, embedder, {
      project: 'TST',
      workstream: 1,
      name: 'Task A',
    });
    await createTestTask(db, config, embedder, {
      project: 'TST',
      workstream: 1,
      name: 'Task B',
    });

    await updateTaskStatus(db, config, embedder, 'TST-01.01', 'claimed');
    await updateTaskStatus(db, config, embedder, 'TST-01.01', 'in-progress');
    await updateTaskStatus(db, config, embedder, 'TST-01.01', 'done');

    const result = checkWorkstreamConcurrency(db, 'TST-01.02');

    expect(result.allowed).toBe(true);
  });

  it('allows task with unparseable display ID', () => {
    const result = checkWorkstreamConcurrency(db, 'invalid-id');

    expect(result.allowed).toBe(true);
  });

  it('returns blocking display ID for diagnostics', async () => {
    await createTestTask(db, config, embedder, {
      project: 'TST',
      workstream: 1,
      name: 'Blocker',
    });
    await createTestTask(db, config, embedder, {
      project: 'TST',
      workstream: 1,
      name: 'Blocked',
    });

    await updateTaskStatus(db, config, embedder, 'TST-01.01', 'claimed');
    await updateTaskStatus(db, config, embedder, 'TST-01.01', 'in-progress');

    const result = checkWorkstreamConcurrency(db, 'TST-01.02');

    expect(result).toEqual({
      allowed: false,
      blockingTask: 'TST-01.01',
    });
  });
});
