import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { BrainDB } from '../../../src/services/brain-db.js';
import { loadModules } from '../../../src/modules/loader.js';
import { tmpDbPath, createMockEmbedder, makeNote } from '../../helpers.js';
import type { BrainConfig } from '../../../src/types.js';
import { pmModule } from '../../../src/modules/pm/index.js';
import { createProject } from '../../../src/modules/pm/data/project-ops.js';
import {
  createWorkstream,
  listWorkstreams,
  getWorkstream,
  updateWorkstream,
  deleteWorkstream,
} from '../../../src/modules/pm/data/workstream-ops.js';

let db: BrainDB;
let notesDir: string;
let config: BrainConfig;
const embedder = createMockEmbedder();

beforeEach(async () => {
  db = new BrainDB(tmpDbPath('pm-wave2'));
  db.setEmbeddingModel(embedder.model, embedder.dimensions);
  notesDir = join(tmpdir(), `pm-wave2-${randomUUID()}`);
  mkdirSync(notesDir, { recursive: true });
  config = {
    notesDir,
    dbPath: '',
    embedder: 'local',
    fusionWeights: { bm25: 0.3, vector: 0.7 },
  };

  await loadModules({ modules: [pmModule] });

  await createProject(db, config, embedder, { name: 'Test Project', prefix: 'TST' });
});

afterEach(() => {
  db.close();
  if (existsSync(notesDir)) {
    rmSync(notesDir, { recursive: true, force: true });
  }
});

describe('Wave 2: Workstream CRUD integration', () => {
  it('creates workstream with correct metadata and display_id = PREFIX-01', async () => {
    const result = await createWorkstream(db, config, embedder, {
      project: 'TST',
      name: 'Frontend',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.display_id).toBe('TST-01');
    expect(result.data.project).toBe('TST');
    expect(result.data.number).toBe(1);
    expect(result.data.status).toBe('active');

    const noteIds = db.getModuleNoteIds({ module: 'pm', type: 'workstream' });
    expect(noteIds).toHaveLength(1);

    const note = db.getNoteById(noteIds[0]);
    expect(note).toBeDefined();
    expect(note!.module).toBe('pm');
    expect(note!.type).toBe('workstream');

    const meta = JSON.parse(note!.metadata!) as Record<string, unknown>;
    expect(meta.display_id).toBe('TST-01');
    expect(meta.project).toBe('TST');
    expect(meta.number).toBe(1);
    expect(meta.status).toBe('active');

    const filePath = join(notesDir, 'modules', 'pm', 'TST', 'TST-01.md');
    expect(existsSync(filePath)).toBe(true);
  });

  it('creates second workstream with display_id = PREFIX-02 (auto-number)', async () => {
    await createWorkstream(db, config, embedder, { project: 'TST', name: 'Frontend' });
    const result = await createWorkstream(db, config, embedder, {
      project: 'TST',
      name: 'Backend',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.display_id).toBe('TST-02');
    expect(result.data.number).toBe(2);

    const noteIds = db.getModuleNoteIds({ module: 'pm', type: 'workstream' });
    expect(noteIds).toHaveLength(2);
  });

  it('lists workstreams for project and returns both', async () => {
    await createWorkstream(db, config, embedder, { project: 'TST', name: 'Frontend' });
    await createWorkstream(db, config, embedder, { project: 'TST', name: 'Backend' });

    const result = listWorkstreams(db, 'TST');
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data).toHaveLength(2);
    const ids = result.data.map((w) => w.display_id).sort();
    expect(ids).toEqual(['TST-01', 'TST-02']);
  });

  it('shows workstream detail with status', async () => {
    await createWorkstream(db, config, embedder, { project: 'TST', name: 'Frontend' });

    const result = getWorkstream(db, 'TST-01');
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.display_id).toBe('TST-01');
    expect(result.data.project).toBe('TST');
    expect(result.data.number).toBe(1);
    expect(result.data.status).toBe('active');
  });

  it('updates workstream status and reflects in DB', async () => {
    await createWorkstream(db, config, embedder, { project: 'TST', name: 'Frontend' });

    const result = await updateWorkstream(db, config, embedder, 'TST-01', { status: 'paused' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.status).toBe('paused');

    const refreshed = getWorkstream(db, 'TST-01');
    expect(refreshed.ok).toBe(true);
    if (refreshed.ok) {
      expect(refreshed.data.status).toBe('paused');
    }
  });

  it('deletes workstream and removes note from DB', async () => {
    await createWorkstream(db, config, embedder, { project: 'TST', name: 'Frontend' });

    const filePath = join(notesDir, 'modules', 'pm', 'TST', 'TST-01.md');
    expect(existsSync(filePath)).toBe(true);

    const result = await deleteWorkstream(db, config, 'TST-01');
    expect(result.ok).toBe(true);

    const check = getWorkstream(db, 'TST-01');
    expect(check.ok).toBe(false);
    expect(existsSync(filePath)).toBe(false);
  });

  it('returns NOT_FOUND when creating workstream for non-existent project', async () => {
    const result = await createWorkstream(db, config, embedder, {
      project: 'NOPE',
      name: 'Orphan',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('NOT_FOUND');
    }
  });

  it('returns HAS_DEPENDENTS when deleting workstream with tasks', async () => {
    await createWorkstream(db, config, embedder, { project: 'TST', name: 'Frontend' });

    db.upsertNote(
      makeNote({
        id: 'tst-01-task',
        module: 'pm',
        type: 'task',
        metadata: JSON.stringify({
          display_id: 'TST-01.01',
          project: 'TST',
          workstream: 1,
          number: 1,
          status: 'pending',
        }),
      })
    );

    const result = await deleteWorkstream(db, config, 'TST-01');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('HAS_DEPENDENTS');
    }
  });
});
