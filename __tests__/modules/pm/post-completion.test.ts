import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { BrainDB } from '../../../src/services/brain-db.js';
import { createMockEmbedder, createTestDb, createTestTask } from '../../helpers.js';
import type { BrainConfig } from '../../../src/types.js';
import { createProject } from '../../../src/modules/pm/data/project-ops.js';
import { createWorkstream } from '../../../src/modules/pm/data/workstream-ops.js';
import { updateTaskStatus } from '../../../src/modules/pm/data/task-ops.js';
import { createActivityNote } from '../../../src/modules/pm/engine/activity.js';
import { getPmNotes } from '../../../src/modules/pm/data/queries.js';
import {
  findPostCompletionActivity,
  runConsistencyCheck,
} from '../../../src/modules/pm/engine/consistency.js';

let db: BrainDB;
let notesDir: string;
let config: BrainConfig;
const embedder = createMockEmbedder();

function getTaskNoteId(taskDisplayId: string): string {
  const notes = getPmNotes(db, 'task', { display_id: taskDisplayId });
  return notes[0].id;
}

beforeEach(async () => {
  ({ db } = createTestDb());
  notesDir = join(tmpdir(), `post-completion-${randomUUID()}`);
  mkdirSync(notesDir, { recursive: true });
  config = { notesDir, dbPath: '', embedder: 'local', fusionWeights: { bm25: 0.3, vector: 0.7 } };
  await createProject(db, config, embedder, { name: 'Test', prefix: 'TST' });
  await createWorkstream(db, config, embedder, { project: 'TST', name: 'Core' });
});

afterEach(() => {
  db.close();
  if (existsSync(notesDir)) rmSync(notesDir, { recursive: true, force: true });
});

describe('findPostCompletionActivity', () => {
  it('returns empty when no tasks have post-completion activity', async () => {
    await createTestTask(db, config, embedder, { project: 'TST', workstream: 1, name: 'Task A' });
    await updateTaskStatus(db, config, embedder, 'TST-01.01', 'claimed');
    await updateTaskStatus(db, config, embedder, 'TST-01.01', 'in-progress');
    await updateTaskStatus(db, config, embedder, 'TST-01.01', 'done');

    const results = findPostCompletionActivity(db, 'TST');

    expect(results).toEqual([]);
  });

  it('returns empty when no activity notes exist', async () => {
    await createTestTask(db, config, embedder, { project: 'TST', workstream: 1, name: 'Task A' });

    const results = findPostCompletionActivity(db, 'TST');

    expect(results).toEqual([]);
  });

  it('detects activity after task completion', async () => {
    await createTestTask(db, config, embedder, { project: 'TST', workstream: 1, name: 'Task A' });
    await updateTaskStatus(db, config, embedder, 'TST-01.01', 'claimed');
    await updateTaskStatus(db, config, embedder, 'TST-01.01', 'in-progress');
    await updateTaskStatus(db, config, embedder, 'TST-01.01', 'done');

    const noteId = getTaskNoteId('TST-01.01');
    await createActivityNote(db, config, embedder, {
      project: 'TST',
      activityType: 'start',
      taskDisplayId: 'TST-01.01',
      taskNoteId: noteId,
      fromState: 'done',
      toState: 'in-progress',
    });

    const results = findPostCompletionActivity(db, 'TST');

    expect(results.length).toBe(1);
    expect(results[0].task).toBe('TST-01.01');
    expect(results[0].activityAfter.length).toBeGreaterThanOrEqual(1);
    expect(results[0].reason).toContain('after completion');
  });

  it('includes task title in result', async () => {
    await createTestTask(db, config, embedder, {
      project: 'TST',
      workstream: 1,
      name: 'Important Feature',
    });
    await updateTaskStatus(db, config, embedder, 'TST-01.01', 'claimed');
    await updateTaskStatus(db, config, embedder, 'TST-01.01', 'in-progress');
    await updateTaskStatus(db, config, embedder, 'TST-01.01', 'done');

    const noteId = getTaskNoteId('TST-01.01');
    await createActivityNote(db, config, embedder, {
      project: 'TST',
      activityType: 'start',
      taskDisplayId: 'TST-01.01',
      taskNoteId: noteId,
      fromState: 'done',
      toState: 'in-progress',
    });

    const results = findPostCompletionActivity(db, 'TST');

    expect(results[0].taskTitle).toBe('Important Feature');
  });

  it('does not flag tasks that were never completed', async () => {
    await createTestTask(db, config, embedder, { project: 'TST', workstream: 1, name: 'Task A' });
    await updateTaskStatus(db, config, embedder, 'TST-01.01', 'claimed');
    await updateTaskStatus(db, config, embedder, 'TST-01.01', 'in-progress');
    await updateTaskStatus(db, config, embedder, 'TST-01.01', 'blocked');

    const results = findPostCompletionActivity(db, 'TST');

    expect(results).toEqual([]);
  });

  it('does not flag different tasks as having post-completion activity', async () => {
    await createTestTask(db, config, embedder, { project: 'TST', workstream: 1, name: 'Task A' });
    await createTestTask(db, config, embedder, { project: 'TST', workstream: 1, name: 'Task B' });
    await updateTaskStatus(db, config, embedder, 'TST-01.01', 'claimed');
    await updateTaskStatus(db, config, embedder, 'TST-01.01', 'in-progress');
    await updateTaskStatus(db, config, embedder, 'TST-01.01', 'done');
    await updateTaskStatus(db, config, embedder, 'TST-01.02', 'claimed');
    await updateTaskStatus(db, config, embedder, 'TST-01.02', 'in-progress');

    const results = findPostCompletionActivity(db, 'TST');

    expect(results).toEqual([]);
  });
});

describe('runConsistencyCheck includes post-completion activity', () => {
  it('includes post-completion activity in standard (non-deep) check', async () => {
    await createTestTask(db, config, embedder, { project: 'TST', workstream: 1, name: 'Task A' });
    await updateTaskStatus(db, config, embedder, 'TST-01.01', 'claimed');
    await updateTaskStatus(db, config, embedder, 'TST-01.01', 'in-progress');
    await updateTaskStatus(db, config, embedder, 'TST-01.01', 'done');

    const noteId = getTaskNoteId('TST-01.01');
    await createActivityNote(db, config, embedder, {
      project: 'TST',
      activityType: 'start',
      taskDisplayId: 'TST-01.01',
      taskNoteId: noteId,
      fromState: 'done',
      toState: 'in-progress',
    });

    const report = runConsistencyCheck(db, 'TST', false);

    expect(report.structural.postCompletionActivity.length).toBe(1);
    expect(report.summary.issuesFound).toBeGreaterThanOrEqual(1);
  });

  it('counts post-completion activity in issuesFound', async () => {
    await createTestTask(db, config, embedder, { project: 'TST', workstream: 1, name: 'Task A' });
    await updateTaskStatus(db, config, embedder, 'TST-01.01', 'claimed');
    await updateTaskStatus(db, config, embedder, 'TST-01.01', 'in-progress');
    await updateTaskStatus(db, config, embedder, 'TST-01.01', 'done');

    const cleanReport = runConsistencyCheck(db, 'TST', false);
    const cleanCount = cleanReport.summary.issuesFound;

    const noteId = getTaskNoteId('TST-01.01');
    await createActivityNote(db, config, embedder, {
      project: 'TST',
      activityType: 'start',
      taskDisplayId: 'TST-01.01',
      taskNoteId: noteId,
      fromState: 'done',
      toState: 'in-progress',
    });

    const dirtyReport = runConsistencyCheck(db, 'TST', false);

    expect(dirtyReport.summary.issuesFound).toBeGreaterThan(cleanCount);
  });
});
