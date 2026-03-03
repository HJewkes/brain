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
import { updateTaskStatus } from '../../../src/modules/pm/data/task-ops.js';
import { createTestTask } from '../../helpers.js';

let db: BrainDB;
let notesDir: string;
let config: BrainConfig;
const embedder = createMockEmbedder();

beforeEach(async () => {
  db = new BrainDB(tmpDbPath('activity-notes'));
  notesDir = join(tmpdir(), `activity-notes-${randomUUID()}`);
  mkdirSync(notesDir, { recursive: true });
  config = { notesDir, dbPath: '', embedder: 'local', fusionWeights: { bm25: 0.3, vector: 0.7 } };
  await createProject(db, config, embedder, { name: 'Test', prefix: 'TST' });
  await createWorkstream(db, config, embedder, { project: 'TST', name: 'Core' });
});

afterEach(() => {
  db.close();
  if (existsSync(notesDir)) rmSync(notesDir, { recursive: true, force: true });
});

describe('activity notes on state transitions', () => {
  it('completing a task creates an activity note', async () => {
    await createTestTask(db, config, embedder, { project: 'TST', workstream: 1, name: 'Build it' });
    await updateTaskStatus(db, config, embedder, 'TST-01.01', 'claimed');
    await updateTaskStatus(db, config, embedder, 'TST-01.01', 'in-progress');
    await updateTaskStatus(db, config, embedder, 'TST-01.01', 'done');

    const allNotes = db.getAllNotes();
    const activities = allNotes.filter(n => {
      const meta = JSON.parse(n.metadata ?? '{}');
      return meta.activity_type === 'complete';
    });
    expect(activities.length).toBe(1);

    const meta = JSON.parse(activities[0].metadata!);
    expect(meta.task_id).toBe('TST-01.01');
    expect(meta.from_state).toBe('in-progress');
    expect(meta.to_state).toBe('done');
  });

  it('activity note has required relation to task', async () => {
    await createTestTask(db, config, embedder, { project: 'TST', workstream: 1, name: 'Build it' });
    await updateTaskStatus(db, config, embedder, 'TST-01.01', 'claimed');
    await updateTaskStatus(db, config, embedder, 'TST-01.01', 'in-progress');
    await updateTaskStatus(db, config, embedder, 'TST-01.01', 'done');

    const activities = db.getAllNotes().filter(n => {
      const meta = JSON.parse(n.metadata ?? '{}');
      return meta.activity_type === 'complete';
    });
    expect(activities.length).toBe(1);

    const rels = db.getRelationsFrom(activities[0].id);
    const recorded = rels.find(r => r.type === 'recorded_for');
    expect(recorded).toBeDefined();
  });

  it('claiming a task creates a claim activity note', async () => {
    await createTestTask(db, config, embedder, { project: 'TST', workstream: 1, name: 'Claim me' });
    await updateTaskStatus(db, config, embedder, 'TST-01.01', 'claimed');

    const activities = db.getAllNotes().filter(n => {
      const meta = JSON.parse(n.metadata ?? '{}');
      return meta.activity_type === 'claim';
    });
    expect(activities.length).toBe(1);
  });

  it('complete activity includes newly_eligible tasks', async () => {
    await createTestTask(db, config, embedder, { project: 'TST', workstream: 1, name: 'First' });
    await createTestTask(db, config, embedder, {
      project: 'TST', workstream: 1, name: 'Second', dependsOn: ['TST-01.01'],
    });

    await updateTaskStatus(db, config, embedder, 'TST-01.01', 'claimed');
    await updateTaskStatus(db, config, embedder, 'TST-01.01', 'in-progress');
    await updateTaskStatus(db, config, embedder, 'TST-01.01', 'done');

    const activities = db.getAllNotes().filter(n => {
      const meta = JSON.parse(n.metadata ?? '{}');
      return meta.activity_type === 'complete';
    });
    const meta = JSON.parse(activities[0].metadata!);
    expect(meta.newly_eligible).toContain('TST-01.02');
  });

  it('activity note has embed_status: queued', async () => {
    await createTestTask(db, config, embedder, { project: 'TST', workstream: 1, name: 'Test' });
    await updateTaskStatus(db, config, embedder, 'TST-01.01', 'claimed');

    const activities = db.getAllNotes().filter(n => {
      const meta = JSON.parse(n.metadata ?? '{}');
      return meta.activity_type === 'claim';
    });
    const meta = JSON.parse(activities[0].metadata!);
    expect(meta.embed_status).toBe('queued');
  });
});
