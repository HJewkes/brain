import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, existsSync, rmSync, readFileSync } from 'node:fs';
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
  listTasks,
  getTask,
  updateTask,
} from '../../../src/modules/pm/data/task-ops.js';

let db: BrainDB;
let dbPath: string;
let notesDir: string;
let config: BrainConfig;
const embedder = createMockEmbedder();

beforeEach(async () => {
  dbPath = tmpDbPath('pm-temporal');
  db = new BrainDB(dbPath);
  notesDir = join(tmpdir(), `pm-temporal-notes-${randomUUID()}`);
  mkdirSync(notesDir, { recursive: true });
  config = {
    notesDir,
    dbPath,
    embedder: 'local',
    fusionWeights: { bm25: 0.3, vector: 0.7 },
  };

  await createProject(db, config, embedder, { name: 'Test', prefix: 'TST' });
  await createWorkstream(db, config, embedder, { project: 'TST', name: 'Core' });
});

afterEach(() => {
  db.close();
  if (existsSync(notesDir)) {
    rmSync(notesDir, { recursive: true, force: true });
  }
});

describe('temporal fields', () => {
  it('task add with due_date sets due_date in frontmatter', async () => {
    const result = await createTask(db, config, embedder, {
      project: 'TST',
      workstream: 1,
      name: 'Deadline task',
      dueDate: '2026-03-15',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.due_date).toBe('2026-03-15');

    const filePath = join(notesDir, 'modules', 'pm', 'TST', 'TST-01.01.md');
    const content = readFileSync(filePath, 'utf-8');
    expect(content).toContain('due_date: "2026-03-15"');
  });

  it('task add with milestone sets milestone in frontmatter', async () => {
    const result = await createTask(db, config, embedder, {
      project: 'TST',
      workstream: 1,
      name: 'Milestone task',
      milestone: 'v1.0',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.milestone).toBe('v1.0');

    const filePath = join(notesDir, 'modules', 'pm', 'TST', 'TST-01.01.md');
    const content = readFileSync(filePath, 'utf-8');
    expect(content).toContain('milestone: v1.0');
  });

  it('task list --json includes due_date and milestone', async () => {
    await createTask(db, config, embedder, {
      project: 'TST',
      workstream: 1,
      name: 'Full task',
      dueDate: '2026-04-01',
      milestone: 'beta',
    });

    const result = listTasks(db, 'TST');
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data).toHaveLength(1);
    expect(result.data[0].due_date).toBe('2026-04-01');
    expect(result.data[0].milestone).toBe('beta');
  });

  it('task list --due-before filters by date', async () => {
    await createTask(db, config, embedder, {
      project: 'TST',
      workstream: 1,
      name: 'Soon',
      dueDate: '2026-03-10',
    });
    await createTask(db, config, embedder, {
      project: 'TST',
      workstream: 1,
      name: 'Later',
      dueDate: '2026-06-01',
    });
    await createTask(db, config, embedder, {
      project: 'TST',
      workstream: 1,
      name: 'No date',
    });

    const result = listTasks(db, 'TST', { dueBefore: '2026-04-01' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data).toHaveLength(1);
    expect(result.data[0].title).toBe('Soon');
  });

  it('task list --milestone filters by milestone', async () => {
    await createTask(db, config, embedder, {
      project: 'TST',
      workstream: 1,
      name: 'Alpha work',
      milestone: 'alpha',
    });
    await createTask(db, config, embedder, {
      project: 'TST',
      workstream: 1,
      name: 'Beta work',
      milestone: 'beta',
    });

    const result = listTasks(db, 'TST', { milestone: 'alpha' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data).toHaveLength(1);
    expect(result.data[0].title).toBe('Alpha work');
  });

  it('task update --due updates due_date', async () => {
    await createTask(db, config, embedder, {
      project: 'TST',
      workstream: 1,
      name: 'Update me',
      dueDate: '2026-03-15',
    });

    const result = await updateTask(db, config, embedder, 'TST-01.01', {
      due_date: '2026-04-15',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.due_date).toBe('2026-04-15');
  });

  it('+OVERDUE virtual state for past due tasks', async () => {
    await createTask(db, config, embedder, {
      project: 'TST',
      workstream: 1,
      name: 'Overdue task',
      dueDate: '2020-01-01',
    });

    const result = listTasks(db, 'TST');
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data[0].virtualStates).toContain('+OVERDUE');
  });

  it('+OVERDUE not applied to done tasks', async () => {
    const createResult = await createTask(db, config, embedder, {
      project: 'TST',
      workstream: 1,
      name: 'Done overdue',
      dueDate: '2020-01-01',
    });
    expect(createResult.ok).toBe(true);

    // Transition through claim -> in-progress -> done
    const { updateTaskStatus } = await import('../../../src/modules/pm/data/task-ops.js');
    await updateTaskStatus(db, config, embedder, 'TST-01.01', 'claimed');
    await updateTaskStatus(db, config, embedder, 'TST-01.01', 'in-progress');
    await updateTaskStatus(db, config, embedder, 'TST-01.01', 'done');

    const result = getTask(db, 'TST-01.01');
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.virtualStates).not.toContain('+OVERDUE');
  });

  it('+OVERDUE not applied to cancelled tasks', async () => {
    await createTask(db, config, embedder, {
      project: 'TST',
      workstream: 1,
      name: 'Cancelled overdue',
      dueDate: '2020-01-01',
    });

    const { updateTaskStatus } = await import('../../../src/modules/pm/data/task-ops.js');
    await updateTaskStatus(db, config, embedder, 'TST-01.01', 'cancelled');

    const result = getTask(db, 'TST-01.01');
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.virtualStates).not.toContain('+OVERDUE');
  });
});
