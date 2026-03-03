import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { BrainDB } from '../../../src/services/brain-db.js';
import { tmpDbPath, createMockEmbedder, makeNote } from '../../helpers.js';
import type { BrainConfig } from '../../../src/types.js';
import {
  createProject,
  listProjects,
  getProject,
  updateProject,
  deleteProject,
} from '../../../src/modules/pm/data/project-ops.js';

let db: BrainDB;
let dbPath: string;
let notesDir: string;
let config: BrainConfig;
const embedder = createMockEmbedder();

beforeEach(() => {
  dbPath = tmpDbPath('pm-project-ops');
  db = new BrainDB(dbPath);
  notesDir = join(tmpdir(), `pm-notes-${randomUUID()}`);
  mkdirSync(notesDir, { recursive: true });
  config = {
    notesDir,
    dbPath,
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

describe('createProject', () => {
  it('writes markdown file and indexes into DB', async () => {
    const result = await createProject(db, config, embedder, {
      name: 'Website Redesign',
      prefix: 'WEB',
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.prefix).toBe('WEB');
      expect(result.data.display_id).toBe('WEB');
      expect(result.data.status).toBe('active');
    }

    const filePath = join(notesDir, 'modules', 'pm', 'WEB', 'project.md');
    expect(existsSync(filePath)).toBe(true);

    const noteIds = db.getModuleNoteIds({ module: 'pm', type: 'project' });
    expect(noteIds).toHaveLength(1);
  });

  it('stores phase and wip_limit when provided', async () => {
    const result = await createProject(db, config, embedder, {
      name: 'API',
      prefix: 'API',
      phase: 'planning',
      wipLimit: 3,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.phase).toBe('planning');
      expect(result.data.wip_limit).toBe(3);
    }
  });

  it('returns PROJECT_EXISTS for duplicate prefix', async () => {
    await createProject(db, config, embedder, { name: 'First', prefix: 'DUP' });
    const result = await createProject(db, config, embedder, { name: 'Second', prefix: 'DUP' });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('PROJECT_EXISTS');
    }
  });

  it('returns INVALID_INPUT for invalid prefix', async () => {
    const result = await createProject(db, config, embedder, { name: 'Bad', prefix: 'toolong' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('INVALID_INPUT');
    }
  });

  it('returns INVALID_INPUT for lowercase prefix', async () => {
    const result = await createProject(db, config, embedder, { name: 'Bad', prefix: 'web' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('INVALID_INPUT');
    }
  });
});

describe('listProjects', () => {
  it('returns empty array when no projects exist', () => {
    const result = listProjects(db);
    expect(result).toEqual({ ok: true, data: [] });
  });

  it('returns one project', async () => {
    await createProject(db, config, embedder, { name: 'Web', prefix: 'WEB' });

    const result = listProjects(db);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toHaveLength(1);
      expect(result.data[0].prefix).toBe('WEB');
    }
  });

  it('returns multiple projects', async () => {
    await createProject(db, config, embedder, { name: 'Web', prefix: 'WEB' });
    await createProject(db, config, embedder, { name: 'API', prefix: 'API' });

    const result = listProjects(db);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toHaveLength(2);
      const prefixes = result.data.map((p) => p.prefix).sort();
      expect(prefixes).toEqual(['API', 'WEB']);
    }
  });
});

describe('getProject', () => {
  it('returns project metadata when found', async () => {
    await createProject(db, config, embedder, { name: 'Web', prefix: 'WEB' });

    const result = getProject(db, 'WEB');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.prefix).toBe('WEB');
      expect(result.data.status).toBe('active');
    }
  });

  it('returns NOT_FOUND when project does not exist', () => {
    const result = getProject(db, 'NOPE');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('NOT_FOUND');
    }
  });

  it('NOT_FOUND error includes available project names (O-98)', async () => {
    await createProject(db, config, embedder, { name: 'Web', prefix: 'WEB' });
    await createProject(db, config, embedder, { name: 'API', prefix: 'API' });

    const result = getProject(db, 'XYZ');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('NOT_FOUND');
      expect(result.error.message).toContain('Available:');
      expect(result.error.message).toContain('WEB');
      expect(result.error.message).toContain('API');
    }
  });

  it('NOT_FOUND error omits available section when no projects exist', () => {
    const result = getProject(db, 'XYZ');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).not.toContain('Available:');
    }
  });
});

describe('updateProject', () => {
  it('updates status', async () => {
    await createProject(db, config, embedder, { name: 'Web', prefix: 'WEB' });

    const result = await updateProject(db, config, embedder, 'WEB', { status: 'paused' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.status).toBe('paused');
    }

    const refreshed = getProject(db, 'WEB');
    expect(refreshed.ok).toBe(true);
    if (refreshed.ok) {
      expect(refreshed.data.status).toBe('paused');
    }
  });

  it('updates phase', async () => {
    await createProject(db, config, embedder, { name: 'Web', prefix: 'WEB' });

    const result = await updateProject(db, config, embedder, 'WEB', { phase: 'development' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.phase).toBe('development');
    }
  });

  it('returns NOT_FOUND for missing project', async () => {
    const result = await updateProject(db, config, embedder, 'NOPE', { status: 'paused' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('NOT_FOUND');
    }
  });
});

describe('deleteProject', () => {
  it('deletes empty project', async () => {
    await createProject(db, config, embedder, { name: 'Web', prefix: 'WEB' });

    const result = await deleteProject(db, config, 'WEB');
    expect(result.ok).toBe(true);

    const check = getProject(db, 'WEB');
    expect(check.ok).toBe(false);

    const filePath = join(notesDir, 'modules', 'pm', 'WEB', 'project.md');
    expect(existsSync(filePath)).toBe(false);
  });

  it('fails with HAS_DEPENDENTS when project has tasks', async () => {
    await createProject(db, config, embedder, { name: 'Web', prefix: 'WEB' });

    db.upsertNote(
      makeNote({
        id: 'web-01-01',
        module: 'pm',
        type: 'task',
        metadata: JSON.stringify({ display_id: 'WEB-01.01', project: 'WEB', status: 'pending' }),
      })
    );

    const result = await deleteProject(db, config, 'WEB');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('HAS_DEPENDENTS');
    }
  });

  it('deletes project with tasks when force is true and cleans up files', async () => {
    await createProject(db, config, embedder, { name: 'Web', prefix: 'WEB' });

    const taskFilePath = join(notesDir, 'modules', 'pm', 'WEB', 'task-01.md');
    const { writeFileSync } = await import('node:fs');
    writeFileSync(taskFilePath, '---\nid: web-01-01\n---\n# Task');

    db.upsertNote(
      makeNote({
        id: 'web-01-01',
        filePath: taskFilePath,
        module: 'pm',
        type: 'task',
        metadata: JSON.stringify({ display_id: 'WEB-01.01', project: 'WEB', status: 'pending' }),
      })
    );

    const result = await deleteProject(db, config, 'WEB', true);
    expect(result.ok).toBe(true);

    const check = getProject(db, 'WEB');
    expect(check.ok).toBe(false);

    expect(existsSync(taskFilePath)).toBe(false);

    const projectDir = join(notesDir, 'modules', 'pm', 'WEB');
    expect(existsSync(projectDir)).toBe(false);
  });

  it('returns NOT_FOUND for missing project', async () => {
    const result = await deleteProject(db, config, 'NOPE');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('NOT_FOUND');
    }
  });
});
