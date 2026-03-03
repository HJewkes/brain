import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { BrainDB } from '../../../src/services/brain-db.js';
import { tmpDbPath, createMockEmbedder, makeNote } from '../../helpers.js';
import type { BrainConfig } from '../../../src/types.js';
import { createProject } from '../../../src/modules/pm/data/project-ops.js';
import {
  createWorkstream,
  listWorkstreams,
  getWorkstream,
  updateWorkstream,
  deleteWorkstream,
} from '../../../src/modules/pm/data/workstream-ops.js';

let db: BrainDB;
let dbPath: string;
let notesDir: string;
let config: BrainConfig;
const embedder = createMockEmbedder();

beforeEach(() => {
  dbPath = tmpDbPath('pm-workstream-ops');
  db = new BrainDB(dbPath);
  notesDir = join(tmpdir(), `pm-ws-notes-${randomUUID()}`);
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

describe('createWorkstream', () => {
  it('creates workstream linked to project with correct metadata', async () => {
    await createProject(db, config, embedder, { name: 'Web', prefix: 'WEB' });

    const result = await createWorkstream(db, config, embedder, {
      project: 'WEB',
      name: 'Frontend',
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.display_id).toBe('WEB-01');
      expect(result.data.project).toBe('WEB');
      expect(result.data.number).toBe(1);
      expect(result.data.status).toBe('active');
    }

    const filePath = join(notesDir, 'modules', 'pm', 'WEB', 'WEB-01.md');
    expect(existsSync(filePath)).toBe(true);

    const noteIds = db.getModuleNoteIds({ module: 'pm', type: 'workstream' });
    expect(noteIds).toHaveLength(1);
  });

  it('auto-numbers: first = 1, second = 2', async () => {
    await createProject(db, config, embedder, { name: 'Web', prefix: 'WEB' });

    const r1 = await createWorkstream(db, config, embedder, { project: 'WEB', name: 'Frontend' });
    const r2 = await createWorkstream(db, config, embedder, { project: 'WEB', name: 'Backend' });

    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
    if (r1.ok && r2.ok) {
      expect(r1.data.number).toBe(1);
      expect(r1.data.display_id).toBe('WEB-01');
      expect(r2.data.number).toBe(2);
      expect(r2.data.display_id).toBe('WEB-02');
    }
  });

  it('returns NOT_FOUND when project does not exist', async () => {
    const result = await createWorkstream(db, config, embedder, {
      project: 'NOPE',
      name: 'Orphan',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('NOT_FOUND');
    }
  });
});

describe('listWorkstreams', () => {
  it('lists workstreams for a project', async () => {
    await createProject(db, config, embedder, { name: 'Web', prefix: 'WEB' });
    await createWorkstream(db, config, embedder, { project: 'WEB', name: 'Frontend' });
    await createWorkstream(db, config, embedder, { project: 'WEB', name: 'Backend' });

    const result = listWorkstreams(db, 'WEB');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toHaveLength(2);
      const ids = result.data.map((w) => w.display_id).sort();
      expect(ids).toEqual(['WEB-01', 'WEB-02']);
    }
  });

  it('includes description in list results', async () => {
    await createProject(db, config, embedder, { name: 'Web', prefix: 'WEB' });
    await createWorkstream(db, config, embedder, {
      project: 'WEB',
      name: 'Frontend',
      description: 'React components and state management.',
    });

    const result = listWorkstreams(db, 'WEB');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data[0].description).toBe('React components and state management.');
    }
  });

  it('returns empty array when no workstreams exist', async () => {
    const result = listWorkstreams(db, 'WEB');
    expect(result).toEqual({ ok: true, data: [] });
  });

  it('filters by project correctly', async () => {
    await createProject(db, config, embedder, { name: 'Web', prefix: 'WEB' });
    await createProject(db, config, embedder, { name: 'API', prefix: 'API' });
    await createWorkstream(db, config, embedder, { project: 'WEB', name: 'Frontend' });
    await createWorkstream(db, config, embedder, { project: 'API', name: 'Auth' });

    const webResult = listWorkstreams(db, 'WEB');
    expect(webResult.ok).toBe(true);
    if (webResult.ok) {
      expect(webResult.data).toHaveLength(1);
      expect(webResult.data[0].project).toBe('WEB');
    }

    const apiResult = listWorkstreams(db, 'API');
    expect(apiResult.ok).toBe(true);
    if (apiResult.ok) {
      expect(apiResult.data).toHaveLength(1);
      expect(apiResult.data[0].project).toBe('API');
    }
  });
});

describe('getWorkstream', () => {
  it('returns workstream metadata when found', async () => {
    await createProject(db, config, embedder, { name: 'Web', prefix: 'WEB' });
    await createWorkstream(db, config, embedder, { project: 'WEB', name: 'Frontend' });

    const result = getWorkstream(db, 'WEB-01');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.display_id).toBe('WEB-01');
      expect(result.data.status).toBe('active');
    }
  });

  it('returns NOT_FOUND when workstream does not exist', () => {
    const result = getWorkstream(db, 'WEB-99');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('NOT_FOUND');
    }
  });

  it('includes description from note body', async () => {
    await createProject(db, config, embedder, { name: 'Web', prefix: 'WEB' });
    await createWorkstream(db, config, embedder, {
      project: 'WEB',
      name: 'API Layer',
      description: 'Backend REST API endpoints and middleware.',
    });

    const result = getWorkstream(db, 'WEB-01');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.description).toBe('Backend REST API endpoints and middleware.');
    }
  });
});

describe('updateWorkstream', () => {
  it('updates status', async () => {
    await createProject(db, config, embedder, { name: 'Web', prefix: 'WEB' });
    await createWorkstream(db, config, embedder, { project: 'WEB', name: 'Frontend' });

    const result = await updateWorkstream(db, config, embedder, 'WEB-01', { status: 'paused' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.status).toBe('paused');
    }

    const refreshed = getWorkstream(db, 'WEB-01');
    expect(refreshed.ok).toBe(true);
    if (refreshed.ok) {
      expect(refreshed.data.status).toBe('paused');
    }
  });

  it('returns NOT_FOUND for missing workstream', async () => {
    const result = await updateWorkstream(db, config, embedder, 'WEB-99', { status: 'paused' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('NOT_FOUND');
    }
  });
});

describe('deleteWorkstream', () => {
  it('deletes empty workstream', async () => {
    await createProject(db, config, embedder, { name: 'Web', prefix: 'WEB' });
    await createWorkstream(db, config, embedder, { project: 'WEB', name: 'Frontend' });

    const result = await deleteWorkstream(db, config, 'WEB-01');
    expect(result.ok).toBe(true);

    const check = getWorkstream(db, 'WEB-01');
    expect(check.ok).toBe(false);

    const filePath = join(notesDir, 'modules', 'pm', 'WEB', 'WEB-01.md');
    expect(existsSync(filePath)).toBe(false);
  });

  it('fails with HAS_DEPENDENTS when workstream has tasks', async () => {
    await createProject(db, config, embedder, { name: 'Web', prefix: 'WEB' });
    await createWorkstream(db, config, embedder, { project: 'WEB', name: 'Frontend' });

    db.upsertNote(
      makeNote({
        id: 'web-01-task',
        module: 'pm',
        type: 'task',
        metadata: JSON.stringify({
          display_id: 'WEB-01.01',
          project: 'WEB',
          workstream: 1,
          number: 1,
          status: 'pending',
        }),
      })
    );

    const result = await deleteWorkstream(db, config, 'WEB-01');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('HAS_DEPENDENTS');
    }
  });

  it('returns NOT_FOUND for missing workstream', async () => {
    const result = await deleteWorkstream(db, config, 'WEB-99');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('NOT_FOUND');
    }
  });
});
