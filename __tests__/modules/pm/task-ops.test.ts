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
  listTasks,
  getTask,
  updateTaskStatus,
  updateTask,
  deleteTask,
} from '../../../src/modules/pm/data/task-ops.js';

let db: BrainDB;
let dbPath: string;
let notesDir: string;
let config: BrainConfig;
const embedder = createMockEmbedder();

beforeEach(async () => {
  dbPath = tmpDbPath('pm-task-ops');
  db = new BrainDB(dbPath);
  notesDir = join(tmpdir(), `pm-task-notes-${randomUUID()}`);
  mkdirSync(notesDir, { recursive: true });
  config = {
    notesDir,
    dbPath,
    embedder: 'local',
    fusionWeights: { bm25: 0.3, vector: 0.7 },
  };

  await createProject(db, config, embedder, { name: 'Web', prefix: 'WEB' });
  await createWorkstream(db, config, embedder, { project: 'WEB', name: 'Frontend' });
});

afterEach(() => {
  db.close();
  if (existsSync(notesDir)) {
    rmSync(notesDir, { recursive: true, force: true });
  }
});

describe('createTask', () => {
  it('creates task with correct metadata, auto-number, and display_id format', async () => {
    const result = await createTask(db, config, embedder, {
      project: 'WEB',
      workstream: 1,
      name: 'Build login page',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.display_id).toBe('WEB-01.01');
    expect(result.data.project).toBe('WEB');
    expect(result.data.workstream).toBe(1);
    expect(result.data.number).toBe(1);
    expect(result.data.status).toBe('pending');
    expect(result.data.mode).toBe('auto');
    expect(result.data.category).toBe('implementation');
    expect(result.data.priority).toBe('medium');

    const filePath = join(notesDir, 'modules', 'pm', 'WEB', 'WEB-01.01.md');
    expect(existsSync(filePath)).toBe(true);

    const noteIds = db.getModuleNoteIds({ module: 'pm', type: 'task' });
    expect(noteIds).toHaveLength(1);
  });

  it('auto-numbers tasks: first = 1, second = 2', async () => {
    const r1 = await createTask(db, config, embedder, {
      project: 'WEB',
      workstream: 1,
      name: 'Task 1',
    });
    const r2 = await createTask(db, config, embedder, {
      project: 'WEB',
      workstream: 1,
      name: 'Task 2',
    });

    expect(r1.ok && r1.data.number).toBe(1);
    expect(r2.ok && r2.data.number).toBe(2);
    if (r1.ok) expect(r1.data.display_id).toBe('WEB-01.01');
    if (r2.ok) expect(r2.data.display_id).toBe('WEB-01.02');
  });

  it('creates task with depends_on and stores relations', async () => {
    const r1 = await createTask(db, config, embedder, {
      project: 'WEB',
      workstream: 1,
      name: 'Task A',
    });
    expect(r1.ok).toBe(true);

    const r2 = await createTask(db, config, embedder, {
      project: 'WEB',
      workstream: 1,
      name: 'Task B',
      dependsOn: ['WEB-01.01'],
    });

    expect(r2.ok).toBe(true);
    if (!r2.ok) return;

    expect(r2.data.depends_on).toEqual(['WEB-01.01']);

    const taskBNotes = db.getModuleNoteIds({ module: 'pm', type: 'task' });
    const noteB = taskBNotes.find((id) => {
      const note = db.getNoteById(id);
      const meta = JSON.parse(note!.metadata!) as Record<string, unknown>;
      return meta.display_id === 'WEB-01.02';
    });
    expect(noteB).toBeDefined();

    const relations = db.getRelationsFrom(noteB!);
    expect(relations).toHaveLength(1);
    expect(relations[0].type).toBe('depends_on');
  });

  it('returns NOT_FOUND for invalid dependency', async () => {
    const result = await createTask(db, config, embedder, {
      project: 'WEB',
      workstream: 1,
      name: 'Task with bad dep',
      dependsOn: ['WEB-01.99'],
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('NOT_FOUND');
    }
  });

  it('returns NOT_FOUND when project does not exist', async () => {
    const result = await createTask(db, config, embedder, {
      project: 'NOPE',
      workstream: 1,
      name: 'Orphan',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('NOT_FOUND');
  });

  it('returns NOT_FOUND when workstream does not exist', async () => {
    const result = await createTask(db, config, embedder, {
      project: 'WEB',
      workstream: 99,
      name: 'Orphan',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('NOT_FOUND');
  });

  it('creates content directory for task', async () => {
    await createTask(db, config, embedder, {
      project: 'WEB',
      workstream: 1,
      name: 'With content dir',
    });

    const contentDir = join(notesDir, 'modules', 'pm', 'WEB', 'WEB-01.01');
    expect(existsSync(contentDir)).toBe(true);
  });
});

describe('listTasks', () => {
  it('lists tasks filtered by workstream', async () => {
    await createWorkstream(db, config, embedder, { project: 'WEB', name: 'Backend' });
    await createTask(db, config, embedder, { project: 'WEB', workstream: 1, name: 'FE Task' });
    await createTask(db, config, embedder, { project: 'WEB', workstream: 2, name: 'BE Task' });

    const ws1Result = listTasks(db, 'WEB', { workstream: 1 });
    expect(ws1Result.ok).toBe(true);
    if (ws1Result.ok) {
      expect(ws1Result.data).toHaveLength(1);
      expect(ws1Result.data[0].display_id).toBe('WEB-01.01');
    }
  });

  it('lists tasks filtered by status', async () => {
    await createTask(db, config, embedder, { project: 'WEB', workstream: 1, name: 'Task 1' });
    await createTask(db, config, embedder, { project: 'WEB', workstream: 1, name: 'Task 2' });
    await updateTaskStatus(db, config, embedder, 'WEB-01.01', 'claimed');

    const claimedResult = listTasks(db, 'WEB', { status: 'claimed' });
    expect(claimedResult.ok).toBe(true);
    if (claimedResult.ok) {
      expect(claimedResult.data).toHaveLength(1);
      expect(claimedResult.data[0].display_id).toBe('WEB-01.01');
    }
  });

  it('filters by virtual state blocked', async () => {
    await createTask(db, config, embedder, { project: 'WEB', workstream: 1, name: 'Dep task' });
    await createTask(db, config, embedder, {
      project: 'WEB', workstream: 1, name: 'Blocked task', dependsOn: ['WEB-01.01'],
    });

    const blockedResult = listTasks(db, 'WEB', { status: 'blocked' });
    expect(blockedResult.ok).toBe(true);
    if (blockedResult.ok) {
      expect(blockedResult.data).toHaveLength(1);
      expect(blockedResult.data[0].display_id).toBe('WEB-01.02');
      expect(blockedResult.data[0].virtualStates).toContain('+BLOCKED');
    }
  });

  it('filters by virtual state ready', async () => {
    await createTask(db, config, embedder, { project: 'WEB', workstream: 1, name: 'Ready task' });

    const readyResult = listTasks(db, 'WEB', { status: 'ready' });
    expect(readyResult.ok).toBe(true);
    if (readyResult.ok) {
      expect(readyResult.data).toHaveLength(1);
      expect(readyResult.data[0].virtualStates).toContain('+READY');
    }
  });

  it('includes virtualStates in listed tasks', async () => {
    await createTask(db, config, embedder, { project: 'WEB', workstream: 1, name: 'Task 1' });

    const result = listTasks(db, 'WEB');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data[0].virtualStates).toBeDefined();
      expect(result.data[0].virtualStates).toContain('+READY');
    }
  });

  it('returns empty array when no tasks exist', () => {
    const result = listTasks(db, 'WEB');
    expect(result).toEqual({ ok: true, data: [] });
  });

  it('filters by priority', async () => {
    await createTask(db, config, embedder, {
      project: 'WEB', workstream: 1, name: 'High task', priority: 'high',
    });
    await createTask(db, config, embedder, {
      project: 'WEB', workstream: 1, name: 'Low task', priority: 'low',
    });

    const result = listTasks(db, 'WEB', { priority: 'high' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toHaveLength(1);
    expect(result.data[0].display_id).toBe('WEB-01.01');
  });

  it('filters by category', async () => {
    await createTask(db, config, embedder, {
      project: 'WEB', workstream: 1, name: 'Impl task', category: 'implementation',
    });
    await createTask(db, config, embedder, {
      project: 'WEB', workstream: 1, name: 'Test task', category: 'testing',
    });

    const result = listTasks(db, 'WEB', { category: 'testing' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toHaveLength(1);
    expect(result.data[0].display_id).toBe('WEB-01.02');
  });

  it('filters by title search (case-insensitive)', async () => {
    await createTask(db, config, embedder, {
      project: 'WEB', workstream: 1, name: 'Setup Auth',
    });
    await createTask(db, config, embedder, {
      project: 'WEB', workstream: 1, name: 'Deploy Pipeline',
    });

    const result = listTasks(db, 'WEB', { search: 'auth' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toHaveLength(1);
    expect(result.data[0].display_id).toBe('WEB-01.01');
  });

  it('combines multiple filters', async () => {
    await createTask(db, config, embedder, {
      project: 'WEB', workstream: 1, name: 'High impl', priority: 'high', category: 'implementation',
    });
    await createTask(db, config, embedder, {
      project: 'WEB', workstream: 1, name: 'High test', priority: 'high', category: 'testing',
    });
    await createTask(db, config, embedder, {
      project: 'WEB', workstream: 1, name: 'Low impl', priority: 'low', category: 'implementation',
    });

    const result = listTasks(db, 'WEB', { priority: 'high', category: 'testing' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toHaveLength(1);
    expect(result.data[0].display_id).toBe('WEB-01.02');
  });

  it('returns empty array when no tasks match filters', async () => {
    await createTask(db, config, embedder, {
      project: 'WEB', workstream: 1, name: 'Medium task', priority: 'medium',
    });

    const result = listTasks(db, 'WEB', { priority: 'low' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toHaveLength(0);
  });

  it('search matches task title only, not workstream name (O-63)', async () => {
    await createWorkstream(db, config, embedder, { project: 'WEB', name: 'Integration' });
    await createTask(db, config, embedder, {
      project: 'WEB', workstream: 2, name: 'Setup CI',
    });
    await createTask(db, config, embedder, {
      project: 'WEB', workstream: 2, name: 'Integration test harness',
    });

    const result = listTasks(db, 'WEB', { search: 'integration' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toHaveLength(1);
    expect(result.data[0].title).toBe('Integration test harness');
  });
});

describe('getTask', () => {
  it('returns task with virtual states (+READY for no deps)', async () => {
    await createTask(db, config, embedder, { project: 'WEB', workstream: 1, name: 'Ready task' });

    const result = getTask(db, 'WEB-01.01');
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.display_id).toBe('WEB-01.01');
    expect(result.data.title).toBe('Ready task');
    expect(result.data.virtualStates).toContain('+READY');
    expect(result.data.virtualStates).toContain('+ELIGIBLE');
  });

  it('returns +BLOCKED when dependencies are incomplete', async () => {
    await createTask(db, config, embedder, { project: 'WEB', workstream: 1, name: 'Task A' });
    await createTask(db, config, embedder, {
      project: 'WEB',
      workstream: 1,
      name: 'Task B',
      dependsOn: ['WEB-01.01'],
    });

    const result = getTask(db, 'WEB-01.02');
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.virtualStates).toContain('+BLOCKED');
  });

  it('returns NOT_FOUND for missing task', () => {
    const result = getTask(db, 'WEB-01.99');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('NOT_FOUND');
  });

  it('suggests correct prefix when task ID has wrong prefix (O-58)', async () => {
    await createTask(db, config, embedder, { project: 'WEB', workstream: 1, name: 'Real task' });

    const result = getTask(db, 'VLT-01.01');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('NOT_FOUND');
      expect(result.error.message).toContain('Did you mean "WEB-01.01"');
    }
  });

  it('returns plain NOT_FOUND when no matching numeric portion exists', () => {
    const result = getTask(db, 'WEB-99.99');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('NOT_FOUND');
      expect(result.error.message).not.toContain('Did you mean');
    }
  });
});

describe('updateTaskStatus', () => {
  it('valid transition: pending → blocked succeeds', async () => {
    await createTask(db, config, embedder, { project: 'WEB', workstream: 1, name: 'Block me' });

    const result = await updateTaskStatus(db, config, embedder, 'WEB-01.01', 'blocked');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.status).toBe('blocked');
    }
  });

  it('invalid transition: pending → done fails with INVALID_TRANSITION', async () => {
    await createTask(db, config, embedder, { project: 'WEB', workstream: 1, name: 'Skip ahead' });

    const result = await updateTaskStatus(db, config, embedder, 'WEB-01.01', 'done');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('INVALID_TRANSITION');
    }
  });

  it('valid lifecycle: pending → claimed → in-progress → done', async () => {
    await createTask(db, config, embedder, {
      project: 'WEB',
      workstream: 1,
      name: 'Full lifecycle',
    });

    const r1 = await updateTaskStatus(db, config, embedder, 'WEB-01.01', 'claimed');
    expect(r1.ok).toBe(true);

    const r2 = await updateTaskStatus(db, config, embedder, 'WEB-01.01', 'in-progress');
    expect(r2.ok).toBe(true);

    const r3 = await updateTaskStatus(db, config, embedder, 'WEB-01.01', 'done');
    expect(r3.ok).toBe(true);
    if (r3.ok) expect(r3.data.status).toBe('done');
  });
});

describe('updateTask', () => {
  it('updates mode and priority', async () => {
    await createTask(db, config, embedder, { project: 'WEB', workstream: 1, name: 'Update me' });

    const result = await updateTask(db, config, embedder, 'WEB-01.01', {
      mode: 'interactive',
      priority: 'high',
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.mode).toBe('interactive');
      expect(result.data.priority).toBe('high');
    }
  });

  it('returns NOT_FOUND for missing task', async () => {
    const result = await updateTask(db, config, embedder, 'WEB-01.99', { mode: 'review' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('NOT_FOUND');
  });
});

describe('deleteTask', () => {
  it('deletes task with no dependents', async () => {
    await createTask(db, config, embedder, { project: 'WEB', workstream: 1, name: 'Delete me' });

    const result = await deleteTask(db, config, 'WEB-01.01');
    expect(result.ok).toBe(true);

    const check = getTask(db, 'WEB-01.01');
    expect(check.ok).toBe(false);

    const filePath = join(notesDir, 'modules', 'pm', 'WEB', 'WEB-01.01.md');
    expect(existsSync(filePath)).toBe(false);

    const contentDir = join(notesDir, 'modules', 'pm', 'WEB', 'WEB-01.01');
    expect(existsSync(contentDir)).toBe(false);
  });

  it('fails with HAS_DEPENDENTS when other tasks depend on it', async () => {
    await createTask(db, config, embedder, { project: 'WEB', workstream: 1, name: 'Dependency' });
    await createTask(db, config, embedder, {
      project: 'WEB',
      workstream: 1,
      name: 'Dependent',
      dependsOn: ['WEB-01.01'],
    });

    const result = await deleteTask(db, config, 'WEB-01.01');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('HAS_DEPENDENTS');
    }
  });

  it('force deletes task even with dependents', async () => {
    await createTask(db, config, embedder, { project: 'WEB', workstream: 1, name: 'Dependency' });
    await createTask(db, config, embedder, {
      project: 'WEB',
      workstream: 1,
      name: 'Dependent',
      dependsOn: ['WEB-01.01'],
    });

    const result = await deleteTask(db, config, 'WEB-01.01', true);
    expect(result.ok).toBe(true);
  });

  it('returns NOT_FOUND for missing task', async () => {
    const result = await deleteTask(db, config, 'WEB-01.99');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('NOT_FOUND');
  });
});
