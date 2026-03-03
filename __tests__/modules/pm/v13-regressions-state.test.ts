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
import {
  createTask,
  updateTaskStatus,
  listTasks,
  getTask,
} from '../../../src/modules/pm/data/task-ops.js';
import {
  validateTransition,
  computeVirtualState,
} from '../../../src/modules/pm/engine/state-machine.js';

let db: BrainDB;
let notesDir: string;
let config: BrainConfig;
const embedder = createMockEmbedder();

beforeEach(async () => {
  db = new BrainDB(tmpDbPath('reg-state'));
  notesDir = join(tmpdir(), `reg-state-${randomUUID()}`);
  mkdirSync(notesDir, { recursive: true });
  config = { notesDir, dbPath: '', embedder: 'local', fusionWeights: { bm25: 0.3, vector: 0.7 } };
  await createProject(db, config, embedder, { name: 'Volt', prefix: 'VOLT' });
  await createWorkstream(db, config, embedder, { project: 'VOLT', name: 'Core' });
});

afterEach(() => {
  db.close();
  if (existsSync(notesDir)) rmSync(notesDir, { recursive: true, force: true });
});

describe('state machine regressions', () => {
  it('O-52: pending to claimed transition succeeds', async () => {
    await createTask(db, config, embedder, { project: 'VOLT', workstream: 1, name: 'Test' });
    const result = await updateTaskStatus(db, config, embedder, 'VOLT-01.01', 'claimed');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.status).toBe('claimed');
    expect(result.data.display_id).toBe('VOLT-01.01');
  });

  it('O-57: claimed task metadata includes claim_token field', async () => {
    await createTask(db, config, embedder, { project: 'VOLT', workstream: 1, name: 'Test' });
    const statusResult = await updateTaskStatus(db, config, embedder, 'VOLT-01.01', 'claimed');
    expect(statusResult.ok).toBe(true);
    if (!statusResult.ok) return;
    expect(statusResult.data.status).toBe('claimed');
    // claim_token field exists on TaskMetadata (set by claim command, undefined after raw status update)
    expect('claim_token' in statusResult.data).toBe(true);
    const taskResult = getTask(db, 'VOLT-01.01');
    expect(taskResult.ok).toBe(true);
    if (!taskResult.ok) return;
    expect(taskResult.data.status).toBe('claimed');
  });

  it('O-58: done to pending transition is invalid', () => {
    const result = validateTransition('done', 'pending');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain('Cannot transition');
    expect(result.error.message).toContain('done');
    expect(result.error.message).toContain('pending');
  });

  it('O-59: pending to blocked is a valid transition', () => {
    const result = validateTransition('pending', 'blocked');
    expect(result.ok).toBe(true);
  });

  it('O-61: updateTaskStatus rejects done to claimed', async () => {
    await createTask(db, config, embedder, { project: 'VOLT', workstream: 1, name: 'Test' });
    await updateTaskStatus(db, config, embedder, 'VOLT-01.01', 'claimed');
    await updateTaskStatus(db, config, embedder, 'VOLT-01.01', 'in-progress');
    await updateTaskStatus(db, config, embedder, 'VOLT-01.01', 'done');
    const result = await updateTaskStatus(db, config, embedder, 'VOLT-01.01', 'claimed');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('INVALID_TRANSITION');
  });

  it('O-62: virtual state +READY and +ELIGIBLE for pending task without deps', () => {
    const states = computeVirtualState({
      status: 'pending',
      hasDependencies: false,
      dependenciesComplete: true,
    });
    expect(states).toContain('+READY');
    expect(states).toContain('+ELIGIBLE');
    expect(states).not.toContain('+BLOCKED');
  });

  it('O-63: listTasks returns tasks with distinct priorities preserved', async () => {
    await createTask(db, config, embedder, {
      project: 'VOLT',
      workstream: 1,
      name: 'A',
      priority: 'critical',
    });
    await createTask(db, config, embedder, {
      project: 'VOLT',
      workstream: 1,
      name: 'B',
      priority: 'high',
    });
    await createTask(db, config, embedder, {
      project: 'VOLT',
      workstream: 1,
      name: 'C',
      priority: 'medium',
    });
    await createTask(db, config, embedder, {
      project: 'VOLT',
      workstream: 1,
      name: 'D',
      priority: 'low',
    });
    const result = listTasks(db, 'VOLT');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.length).toBe(4);
    const priorities = result.data.map((t) => t.priority);
    expect(priorities).toContain('critical');
    expect(priorities).toContain('high');
    expect(priorities).toContain('medium');
    expect(priorities).toContain('low');
    const byName = Object.fromEntries(result.data.map((t) => [t.title, t.priority]));
    expect(byName['A']).toBe('critical');
    expect(byName['D']).toBe('low');
  });
});
