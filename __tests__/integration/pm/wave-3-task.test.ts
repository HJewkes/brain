import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { BrainDB } from '../../../src/services/brain-db.js';
import { loadModules } from '../../../src/modules/loader.js';
import { tmpDbPath, createMockEmbedder } from '../../helpers.js';
import type { BrainConfig } from '../../../src/types.js';
import { pmModule } from '../../../src/modules/pm/index.js';
import { createProject } from '../../../src/modules/pm/data/project-ops.js';
import { createWorkstream } from '../../../src/modules/pm/data/workstream-ops.js';
import {
  createTask,
  listTasks,
  getTask,
  updateTaskStatus,
  deleteTask,
} from '../../../src/modules/pm/data/task-ops.js';

let db: BrainDB;
let notesDir: string;
let config: BrainConfig;
const embedder = createMockEmbedder();

beforeEach(async () => {
  db = new BrainDB(tmpDbPath('pm-wave3'));
  db.setEmbeddingModel(embedder.model, embedder.dimensions);
  notesDir = join(tmpdir(), `pm-wave3-${randomUUID()}`);
  mkdirSync(notesDir, { recursive: true });
  config = {
    notesDir,
    dbPath: '',
    embedder: 'local',
    fusionWeights: { bm25: 0.3, vector: 0.7 },
  };

  await loadModules({ modules: [pmModule] });
  await createProject(db, config, embedder, { name: 'Test Project', prefix: 'TST' });
  await createWorkstream(db, config, embedder, { project: 'TST', name: 'Core' });
});

afterEach(() => {
  db.close();
  if (existsSync(notesDir)) {
    rmSync(notesDir, { recursive: true, force: true });
  }
});

describe('Wave 3: Task CRUD integration', () => {
  it('creates task with correct metadata and display_id = PREFIX-NN.MM', async () => {
    const result = await createTask(db, config, embedder, {
      project: 'TST',
      workstream: 1,
      name: 'Setup CI',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.display_id).toBe('TST-01.01');
    expect(result.data.project).toBe('TST');
    expect(result.data.workstream).toBe(1);
    expect(result.data.number).toBe(1);
    expect(result.data.status).toBe('pending');
    expect(result.data.mode).toBe('auto');
    expect(result.data.category).toBe('implementation');
    expect(result.data.priority).toBe('medium');

    const noteIds = db.getModuleNoteIds({ module: 'pm', type: 'task' });
    expect(noteIds).toHaveLength(1);

    const note = db.getNoteById(noteIds[0]);
    expect(note).toBeDefined();
    expect(note!.module).toBe('pm');
    expect(note!.type).toBe('task');

    const meta = JSON.parse(note!.metadata!) as Record<string, unknown>;
    expect(meta.display_id).toBe('TST-01.01');
    expect(meta.project).toBe('TST');
    expect(meta.workstream).toBe(1);

    const filePath = join(notesDir, 'modules', 'pm', 'TST', 'TST-01.01.md');
    expect(existsSync(filePath)).toBe(true);
  });

  it('creates task with depends_on and stores relation in relations table', async () => {
    await createTask(db, config, embedder, { project: 'TST', workstream: 1, name: 'Task A' });
    const r2 = await createTask(db, config, embedder, {
      project: 'TST',
      workstream: 1,
      name: 'Task B',
      dependsOn: ['TST-01.01'],
    });

    expect(r2.ok).toBe(true);
    if (!r2.ok) return;
    expect(r2.data.depends_on).toEqual(['TST-01.01']);

    const taskBIds = db.getModuleNoteIds({ module: 'pm', type: 'task' });
    const taskBNoteId = taskBIds.find((id) => {
      const note = db.getNoteById(id);
      const meta = JSON.parse(note!.metadata!) as Record<string, unknown>;
      return meta.display_id === 'TST-01.02';
    });

    const relations = db.getRelationsFrom(taskBNoteId!);
    expect(relations).toHaveLength(1);
    expect(relations[0].type).toBe('depends_on');
  });

  it('shows task with virtual states (+READY for no deps)', async () => {
    await createTask(db, config, embedder, { project: 'TST', workstream: 1, name: 'Ready task' });

    const result = getTask(db, 'TST-01.01');
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.virtualStates).toContain('+READY');
    expect(result.data.virtualStates).toContain('+ELIGIBLE');
  });

  it('full lifecycle: pending → claimed → in-progress → done', async () => {
    await createTask(db, config, embedder, { project: 'TST', workstream: 1, name: 'Lifecycle task' });

    const r1 = await updateTaskStatus(db, config, embedder, 'TST-01.01', 'claimed');
    expect(r1.ok).toBe(true);
    if (r1.ok) expect(r1.data.status).toBe('claimed');

    const r2 = await updateTaskStatus(db, config, embedder, 'TST-01.01', 'in-progress');
    expect(r2.ok).toBe(true);
    if (r2.ok) expect(r2.data.status).toBe('in-progress');

    const r3 = await updateTaskStatus(db, config, embedder, 'TST-01.01', 'done');
    expect(r3.ok).toBe(true);
    if (r3.ok) expect(r3.data.status).toBe('done');
  });

  it('invalid transition: done on pending returns INVALID_TRANSITION', async () => {
    await createTask(db, config, embedder, { project: 'TST', workstream: 1, name: 'Bad transition' });

    const result = await updateTaskStatus(db, config, embedder, 'TST-01.01', 'done');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('INVALID_TRANSITION');
    }
  });

  it('block → unblock round-trip', async () => {
    await createTask(db, config, embedder, { project: 'TST', workstream: 1, name: 'Blockable' });

    const r1 = await updateTaskStatus(db, config, embedder, 'TST-01.01', 'blocked');
    expect(r1.ok).toBe(true);
    if (r1.ok) expect(r1.data.status).toBe('blocked');

    const r2 = await updateTaskStatus(db, config, embedder, 'TST-01.01', 'pending');
    expect(r2.ok).toBe(true);
    if (r2.ok) expect(r2.data.status).toBe('pending');
  });

  it('task with content_dir has directory created on disk', async () => {
    await createTask(db, config, embedder, { project: 'TST', workstream: 1, name: 'With dir' });

    const contentDir = join(notesDir, 'modules', 'pm', 'TST', 'TST-01.01');
    expect(existsSync(contentDir)).toBe(true);
  });

  it('lists tasks with filters and returns correct subset', async () => {
    await createWorkstream(db, config, embedder, { project: 'TST', name: 'Other' });
    await createTask(db, config, embedder, { project: 'TST', workstream: 1, name: 'Task 1' });
    await createTask(db, config, embedder, { project: 'TST', workstream: 1, name: 'Task 2' });
    await createTask(db, config, embedder, { project: 'TST', workstream: 2, name: 'Task 3' });

    const allResult = listTasks(db, 'TST');
    expect(allResult.ok).toBe(true);
    if (allResult.ok) expect(allResult.data).toHaveLength(3);

    const ws1Result = listTasks(db, 'TST', { workstream: 1 });
    expect(ws1Result.ok).toBe(true);
    if (ws1Result.ok) expect(ws1Result.data).toHaveLength(2);

    await updateTaskStatus(db, config, embedder, 'TST-01.01', 'blocked');
    const blockedResult = listTasks(db, 'TST', { status: 'blocked' });
    expect(blockedResult.ok).toBe(true);
    if (blockedResult.ok) {
      expect(blockedResult.data).toHaveLength(1);
      expect(blockedResult.data[0].display_id).toBe('TST-01.01');
    }
  });

  it('JSON output parses as valid JSON with expected fields', async () => {
    await createTask(db, config, embedder, {
      project: 'TST',
      workstream: 1,
      name: 'JSON test',
      priority: 'high',
      mode: 'review',
    });

    const result = getTask(db, 'TST-01.01');
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const json = JSON.stringify(result.data);
    const parsed = JSON.parse(json) as Record<string, unknown>;
    expect(parsed.display_id).toBe('TST-01.01');
    expect(parsed.project).toBe('TST');
    expect(parsed.priority).toBe('high');
    expect(parsed.mode).toBe('review');
    expect(parsed.virtualStates).toBeDefined();
    expect(Array.isArray(parsed.virtualStates)).toBe(true);
  });

  it('deletes task and removes note and content_dir', async () => {
    await createTask(db, config, embedder, { project: 'TST', workstream: 1, name: 'Delete me' });

    const filePath = join(notesDir, 'modules', 'pm', 'TST', 'TST-01.01.md');
    const contentDir = join(notesDir, 'modules', 'pm', 'TST', 'TST-01.01');
    expect(existsSync(filePath)).toBe(true);
    expect(existsSync(contentDir)).toBe(true);

    const result = await deleteTask(db, config, 'TST-01.01');
    expect(result.ok).toBe(true);

    const check = getTask(db, 'TST-01.01');
    expect(check.ok).toBe(false);
    expect(existsSync(filePath)).toBe(false);
    expect(existsSync(contentDir)).toBe(false);
  });
});
