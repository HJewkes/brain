import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { BrainDB } from '../../../src/services/brain-db.js';
import { tmpDbPath, createMockEmbedder } from '../../helpers.js';
import type { BrainConfig } from '../../../src/types.js';
import { executeImport, type ImportProjectDef } from '../../../src/modules/pm/commands/import.js';
import { listTasks } from '../../../src/modules/pm/data/task-ops.js';
import { listWorkstreams } from '../../../src/modules/pm/data/workstream-ops.js';
import { getProject } from '../../../src/modules/pm/data/project-ops.js';

let db: BrainDB;
let notesDir: string;
let config: BrainConfig;
const embedder = createMockEmbedder();

beforeEach(() => {
  db = new BrainDB(tmpDbPath('pm-import'));
  notesDir = join(tmpdir(), `pm-import-notes-${randomUUID()}`);
  mkdirSync(notesDir, { recursive: true });
  config = {
    notesDir,
    dbPath: '',
    embedder: 'local',
    fusionWeights: { bm25: 0.3, vector: 0.7 },
  };
});

afterEach(() => {
  db.close();
  if (existsSync(notesDir)) {
    rmSync(notesDir, { recursive: true, force: true });
  }
});

describe('executeImport', () => {
  it('creates project, workstreams, and tasks from definition', async () => {
    const def: ImportProjectDef = {
      name: 'My Project',
      prefix: 'MYP',
      workstreams: [
        {
          name: 'Backend',
          tasks: [
            { name: 'Setup DB', priority: 'high' },
            { name: 'Build API', priority: 'medium' },
          ],
        },
        {
          name: 'Frontend',
          tasks: [{ name: 'Design UI' }],
        },
      ],
    };

    const result = await executeImport(db, config, embedder, def);

    expect(result.errors).toHaveLength(0);
    expect(result.created).toHaveLength(6);

    expect(result.created[0]).toEqual({
      type: 'project',
      display_id: 'MYP',
      name: 'My Project',
    });

    const projectResult = getProject(db, 'MYP');
    expect(projectResult.ok).toBe(true);

    const wsResult = listWorkstreams(db, 'MYP');
    expect(wsResult.ok).toBe(true);
    if (wsResult.ok) {
      expect(wsResult.data).toHaveLength(2);
    }

    const taskResult = listTasks(db, 'MYP');
    expect(taskResult.ok).toBe(true);
    if (taskResult.ok) {
      expect(taskResult.data).toHaveLength(3);
      const highPriorityTask = taskResult.data.find((t) => t.display_id === 'MYP-01.01');
      expect(highPriorityTask?.priority).toBe('high');
    }
  });

  it('creates dependencies between tasks in second pass', async () => {
    const def: ImportProjectDef = {
      name: 'Dep Project',
      prefix: 'DEP',
      workstreams: [
        {
          name: 'Main',
          tasks: [{ name: 'First task' }, { name: 'Second task', depends_on: ['DEP-01.01'] }],
        },
      ],
    };

    const result = await executeImport(db, config, embedder, def);

    expect(result.errors).toHaveLength(0);
    expect(result.created).toHaveLength(4);

    const secondTaskDisplayId = 'DEP-01.02';
    const firstTaskDisplayId = 'DEP-01.01';

    const taskNoteIds = db.getModuleNoteIds({ module: 'pm', type: 'task' });
    const taskNotes = db.getNotesByIds(taskNoteIds);

    let secondTaskNoteId: string | undefined;
    let firstTaskNoteId: string | undefined;
    for (const [, note] of taskNotes) {
      const meta = JSON.parse(note.metadata!) as Record<string, unknown>;
      if (meta.display_id === secondTaskDisplayId) secondTaskNoteId = note.id;
      if (meta.display_id === firstTaskDisplayId) firstTaskNoteId = note.id;
    }

    expect(secondTaskNoteId).toBeDefined();
    expect(firstTaskNoteId).toBeDefined();

    const relations = db.getRelationsFrom(secondTaskNoteId!);
    const depRelation = relations.find(
      (r) => r.type === 'depends_on' && r.targetId === firstTaskNoteId
    );
    expect(depRelation).toBeDefined();
  });

  it('handles project with no workstreams', async () => {
    const def: ImportProjectDef = {
      name: 'Empty Project',
      prefix: 'EMP',
    };

    const result = await executeImport(db, config, embedder, def);

    expect(result.errors).toHaveLength(0);
    expect(result.created).toHaveLength(1);
    expect(result.created[0].type).toBe('project');
  });

  it('reports error for duplicate prefix', async () => {
    const def: ImportProjectDef = {
      name: 'First',
      prefix: 'DUP',
    };

    await executeImport(db, config, embedder, def);

    const result = await executeImport(db, config, embedder, {
      name: 'Second',
      prefix: 'DUP',
    });

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].code).toBe('PROJECT_EXISTS');
    expect(result.created).toHaveLength(0);
  });

  it('reports error for invalid dependency target', async () => {
    const def: ImportProjectDef = {
      name: 'Bad Deps',
      prefix: 'BAD',
      workstreams: [
        {
          name: 'Main',
          tasks: [{ name: 'First' }, { name: 'Second', depends_on: ['BAD-99.99'] }],
        },
      ],
    };

    const result = await executeImport(db, config, embedder, def);

    expect(result.created.length).toBeGreaterThanOrEqual(3);
    expect(result.errors.length).toBeGreaterThan(0);
    const depError = result.errors.find((e) => e.context.includes('BAD-99.99'));
    expect(depError).toBeDefined();
    expect(depError!.code).toBe('NOT_FOUND');
  });

  it('normalizes prefix to uppercase', async () => {
    const def: ImportProjectDef = {
      name: 'Lower',
      prefix: 'low',
    };

    const result = await executeImport(db, config, embedder, def);

    expect(result.errors).toHaveLength(0);
    expect(result.created[0].display_id).toBe('LOW');
  });

  it('creates cross-workstream dependencies', async () => {
    const def: ImportProjectDef = {
      name: 'Cross Deps',
      prefix: 'XDP',
      workstreams: [
        {
          name: 'WS1',
          tasks: [{ name: 'Foundation' }],
        },
        {
          name: 'WS2',
          tasks: [{ name: 'Depends on WS1', depends_on: ['XDP-01.01'] }],
        },
      ],
    };

    const result = await executeImport(db, config, embedder, def);

    expect(result.errors).toHaveLength(0);

    const taskNoteIds = db.getModuleNoteIds({ module: 'pm', type: 'task' });
    const taskNotes = db.getNotesByIds(taskNoteIds);

    let ws2TaskNoteId: string | undefined;
    let ws1TaskNoteId: string | undefined;
    for (const [, note] of taskNotes) {
      const meta = JSON.parse(note.metadata!) as Record<string, unknown>;
      if (meta.display_id === 'XDP-02.01') ws2TaskNoteId = note.id;
      if (meta.display_id === 'XDP-01.01') ws1TaskNoteId = note.id;
    }

    const relations = db.getRelationsFrom(ws2TaskNoteId!);
    expect(relations.some((r) => r.type === 'depends_on' && r.targetId === ws1TaskNoteId)).toBe(
      true
    );
  });
});
