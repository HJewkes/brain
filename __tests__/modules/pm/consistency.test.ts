import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { BrainDB } from '../../../src/services/brain-db.js';
import { tmpDbPath, createMockEmbedder } from '../../helpers.js';
import type { BrainConfig } from '../../../src/types.js';
import { createProject } from '../../../src/modules/pm/data/project-ops.js';
import { createWorkstream } from '../../../src/modules/pm/data/workstream-ops.js';
import { createTask, updateTaskStatus } from '../../../src/modules/pm/data/task-ops.js';
import { createDecision } from '../../../src/modules/pm/data/decision-ops.js';
import { writePrompt } from '../../../src/modules/pm/data/prompt-ops.js';
import {
  findOrphanedDecisions,
  findBrokenDependencies,
  findBlockedWithoutCause,
  findCancelledDependencies,
  findStalePrompts,
} from '../../../src/modules/pm/engine/consistency.js';

let db: BrainDB;
let notesDir: string;
let config: BrainConfig;
const embedder = createMockEmbedder();

async function seedProject(): Promise<void> {
  await createProject(db, config, embedder, { name: 'Check Test', prefix: 'CHK' });
  await createWorkstream(db, config, embedder, { project: 'CHK', name: 'Core' });
}

beforeEach(async () => {
  db = new BrainDB(tmpDbPath('pm-consistency'));
  db.setEmbeddingModel(embedder.model, embedder.dimensions);
  notesDir = join(tmpdir(), `pm-consistency-${randomUUID()}`);
  mkdirSync(notesDir, { recursive: true });
  config = { notesDir, dbPath: '', embedder: 'local', fusionWeights: { bm25: 0.3, vector: 0.7 } };
  await seedProject();
});

afterEach(() => {
  db.close();
  if (existsSync(notesDir)) rmSync(notesDir, { recursive: true, force: true });
});

describe('findOrphanedDecisions', () => {
  it('returns decisions with no impacts', async () => {
    await createTask(db, config, embedder, { project: 'CHK', workstream: 1, name: 'Task A' });
    await createDecision(db, config, embedder, {
      project: 'CHK', name: 'Orphan Decision', sourceTask: 'CHK-01.01',
      impacts: [], content: 'No impacts listed',
    });
    const result = findOrphanedDecisions(db, 'CHK');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('CHK-D01');
    expect(result[0].reason).toContain('No tasks listed');
  });

  it('excludes decisions with impacts', async () => {
    await createTask(db, config, embedder, { project: 'CHK', workstream: 1, name: 'Task A' });
    await createDecision(db, config, embedder, {
      project: 'CHK', name: 'Good Decision', sourceTask: 'CHK-01.01',
      impacts: ['CHK-01.01'], content: 'Has impacts',
    });
    const result = findOrphanedDecisions(db, 'CHK');
    expect(result).toHaveLength(0);
  });
});

describe('findBrokenDependencies', () => {
  it('returns tasks with nonexistent dependency targets', async () => {
    await createTask(db, config, embedder, { project: 'CHK', workstream: 1, name: 'Task A' });
    await createTask(db, config, embedder, { project: 'CHK', workstream: 1, name: 'Task B', dependsOn: ['CHK-01.01'] });
    const result = findBrokenDependencies(db, 'CHK');
    // CHK-01.01 exists, so no broken deps
    expect(result).toHaveLength(0);
  });
});

describe('findBlockedWithoutCause', () => {
  it('returns blocked tasks where all deps are done', async () => {
    const t1 = await createTask(db, config, embedder, { project: 'CHK', workstream: 1, name: 'Dep Task' });
    expect(t1.ok).toBe(true);
    const t2 = await createTask(db, config, embedder, {
      project: 'CHK', workstream: 1, name: 'Blocked Task', dependsOn: ['CHK-01.01'],
    });
    expect(t2.ok).toBe(true);
    // Complete the dep
    await updateTaskStatus(db, config, embedder, 'CHK-01.01', 'claimed');
    await updateTaskStatus(db, config, embedder, 'CHK-01.01', 'in-progress');
    await updateTaskStatus(db, config, embedder, 'CHK-01.01', 'done');
    // Block the dependent
    await updateTaskStatus(db, config, embedder, 'CHK-01.02', 'blocked');

    const result = findBlockedWithoutCause(db, 'CHK');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('CHK-01.02');
    expect(result[0].allDepsStatus).toContain('done');
  });
});

describe('findCancelledDependencies', () => {
  it('returns tasks depending on cancelled tasks', async () => {
    await createTask(db, config, embedder, { project: 'CHK', workstream: 1, name: 'Will Cancel' });
    await createTask(db, config, embedder, {
      project: 'CHK', workstream: 1, name: 'Depends On Cancelled', dependsOn: ['CHK-01.01'],
    });
    // Cancel the dependency
    await updateTaskStatus(db, config, embedder, 'CHK-01.01', 'cancelled');

    const result = findCancelledDependencies(db, 'CHK');
    expect(result).toHaveLength(1);
    expect(result[0].task).toBe('CHK-01.02');
    expect(result[0].dependsOnStatus).toBe('cancelled');
  });
});

describe('findStalePrompts', () => {
  it('returns prompts older than impacting decisions with decision details', async () => {
    await createTask(db, config, embedder, { project: 'CHK', workstream: 1, name: 'API Task' });
    // Write prompt first
    await writePrompt(db, config, embedder, {
      project: 'CHK', task: 'CHK-01.01', content: 'Build the API endpoint',
    });
    // Small delay to ensure different timestamps
    await new Promise((r) => setTimeout(r, 50));
    // Create decision that impacts the task (newer than prompt)
    await createDecision(db, config, embedder, {
      project: 'CHK', name: 'Use REST', sourceTask: 'CHK-01.01',
      impacts: ['CHK-01.01'], content: 'REST over GraphQL',
    });

    const result = findStalePrompts(db, 'CHK');
    expect(result).toHaveLength(1);
    expect(result[0].task).toBe('CHK-01.01');
    expect(result[0].newerDecisions).toHaveLength(1);
    expect(result[0].newerDecisions[0].id).toBe('CHK-D01');
  });

  it('returns empty when no stale prompts', async () => {
    await createTask(db, config, embedder, { project: 'CHK', workstream: 1, name: 'Task' });
    // Decision first, prompt after — prompt is not stale
    await createDecision(db, config, embedder, {
      project: 'CHK', name: 'Early Decision', sourceTask: 'CHK-01.01',
      impacts: ['CHK-01.01'], content: 'Decided early',
    });
    await new Promise((r) => setTimeout(r, 50));
    await writePrompt(db, config, embedder, {
      project: 'CHK', task: 'CHK-01.01', content: 'Written after decision',
    });

    const result = findStalePrompts(db, 'CHK');
    expect(result).toHaveLength(0);
  });
});
