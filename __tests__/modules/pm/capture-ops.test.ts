import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { BrainDB } from '../../../src/services/brain-db.js';
import { tmpDbPath, createMockEmbedder } from '../../helpers.js';
import type { BrainConfig } from '../../../src/types.js';
import {
  createCapture,
  listCaptures,
  processCapture,
} from '../../../src/modules/pm/data/capture-ops.js';
import { createProject } from '../../../src/modules/pm/data/project-ops.js';
import { createWorkstream } from '../../../src/modules/pm/data/workstream-ops.js';

let db: BrainDB;
let dbPath: string;
let notesDir: string;
let config: BrainConfig;
const embedder = createMockEmbedder();

beforeEach(() => {
  dbPath = tmpDbPath('pm-capture-ops');
  db = new BrainDB(dbPath);
  notesDir = join(tmpdir(), `pm-capture-notes-${randomUUID()}`);
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

describe('createCapture', () => {
  it('creates a capture note in the DB with correct metadata', async () => {
    const result = await createCapture(db, config, embedder, {
      content: 'Remember to refactor the auth module',
      source: 'cli',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.content).toBe('Remember to refactor the auth module');
    expect(result.data.source).toBe('cli');
    expect(result.data.processed).toBe(false);
    expect(result.data.noteId).toBeTruthy();

    const noteIds = db.getModuleNoteIds({ module: 'pm', type: 'capture' });
    expect(noteIds).toHaveLength(1);
  });

  it('creates capture with project scope', async () => {
    const result = await createCapture(db, config, embedder, {
      content: 'Add tests for login flow',
      project: 'WEB',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.project).toBe('WEB');
  });

  it('rejects empty content', async () => {
    const result = await createCapture(db, config, embedder, {
      content: '',
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('INVALID_INPUT');
  });

  it('defaults source to cli', async () => {
    const result = await createCapture(db, config, embedder, {
      content: 'A quick thought',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.source).toBe('cli');
  });
});

describe('listCaptures', () => {
  it('lists all captures', async () => {
    await createCapture(db, config, embedder, { content: 'First capture' });
    await createCapture(db, config, embedder, { content: 'Second capture' });

    const result = listCaptures(db);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toHaveLength(2);
  });

  it('filters by unprocessed status', async () => {
    const cap1 = await createCapture(db, config, embedder, { content: 'Will be processed' });
    await createCapture(db, config, embedder, { content: 'Stay unprocessed' });

    if (cap1.ok) {
      const note = db.getNoteById(cap1.data.noteId)!;
      const meta = JSON.parse(note.metadata!) as Record<string, unknown>;
      meta.processed = true;
      db.upsertNote({ ...note, metadata: JSON.stringify(meta) });
    }

    const result = listCaptures(db, { processed: false });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toHaveLength(1);
  });

  it('filters by project', async () => {
    await createCapture(db, config, embedder, { content: 'Web thing', project: 'WEB' });
    await createCapture(db, config, embedder, { content: 'API thing', project: 'API' });

    const result = listCaptures(db, { project: 'WEB' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toHaveLength(1);
    expect(result.data[0].project).toBe('WEB');
  });
});

describe('processCapture', () => {
  async function setupProject(): Promise<void> {
    await createProject(db, config, embedder, { name: 'Test', prefix: 'TST' });
    await createWorkstream(db, config, embedder, { project: 'TST', name: 'Main' });
  }

  it('converts capture to a task and marks it processed', async () => {
    await setupProject();

    const cap = await createCapture(db, config, embedder, { content: 'Build login page' });
    expect(cap.ok).toBe(true);
    if (!cap.ok) return;

    const result = await processCapture(db, config, embedder, cap.data.noteId, {
      project: 'TST',
      workstream: 1,
      name: 'Build login page',
      description: 'Build login page for the application.',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.display_id).toMatch(/^TST-01\.\d{2}$/);

    const captureNote = db.getNoteById(cap.data.noteId)!;
    const meta = JSON.parse(captureNote.metadata!) as Record<string, unknown>;
    expect(meta.processed).toBe(true);
  });

  it('rejects processing an already-processed capture', async () => {
    await setupProject();

    const cap = await createCapture(db, config, embedder, { content: 'Do something' });
    expect(cap.ok).toBe(true);
    if (!cap.ok) return;

    await processCapture(db, config, embedder, cap.data.noteId, {
      project: 'TST',
      workstream: 1,
      name: 'First processing',
      description: 'First processing of the capture.',
    });

    const result = await processCapture(db, config, embedder, cap.data.noteId, {
      project: 'TST',
      workstream: 1,
      name: 'Second processing',
      description: 'Second processing of the capture.',
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('INVALID_INPUT');
    expect(result.error.message).toContain('already been processed');
  });

  it('returns NOT_FOUND for missing capture', async () => {
    const result = await processCapture(db, config, embedder, 'nonexistent', {
      project: 'TST',
      workstream: 1,
      name: 'Test',
      description: 'Test task for capture processing.',
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('NOT_FOUND');
  });
});
