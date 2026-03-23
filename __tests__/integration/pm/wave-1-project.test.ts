import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { BrainDB } from '../../../src/services/brain-db.js';
import { loadModules } from '../../../src/modules/loader.js';
import { createMockEmbedder, createTestDb } from '../../helpers.js';
import type { BrainConfig } from '../../../src/types.js';
import { pmModule } from '../../../src/modules/pm/index.js';
import {
  createProject,
  listProjects,
  getProject,
  updateProject,
  deleteProject,
} from '../../../src/modules/pm/data/project-ops.js';
import { getActiveProject, setActiveProject } from '../../../src/modules/pm/data/queries.js';

let db: BrainDB;
let notesDir: string;
let config: BrainConfig;
const embedder = createMockEmbedder();

beforeEach(async () => {
  ({ db } = createTestDb());
  db.setEmbeddingModel(embedder.model, embedder.dimensions);
  notesDir = join(tmpdir(), `pm-wave1-${randomUUID()}`);
  mkdirSync(notesDir, { recursive: true });
  config = {
    notesDir,
    dbPath: '',
    embedder: 'local',
    fusionWeights: { bm25: 0.3, vector: 0.7 },
  };

  await loadModules({ modules: [pmModule] });
});

afterEach(() => {
  db.close();
  if (existsSync(notesDir)) {
    rmSync(notesDir, { recursive: true, force: true });
  }
});

describe('Wave 1: Project CRUD integration', () => {
  it('creates a project with correct metadata in DB', async () => {
    const result = await createProject(db, config, embedder, {
      name: 'Test Project',
      prefix: 'TST',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.prefix).toBe('TST');
    expect(result.data.display_id).toBe('TST');
    expect(result.data.status).toBe('active');

    const noteIds = db.getModuleNoteIds({ module: 'pm', type: 'project' });
    expect(noteIds).toHaveLength(1);

    const note = db.getNoteById(noteIds[0]);
    expect(note).toBeDefined();
    expect(note!.module).toBe('pm');
    expect(note!.type).toBe('project');

    const meta = JSON.parse(note!.metadata!) as Record<string, unknown>;
    expect(meta.prefix).toBe('TST');
    expect(meta.display_id).toBe('TST');
    expect(meta.status).toBe('active');

    const filePath = join(notesDir, 'modules', 'pm', 'TST', 'project.md');
    expect(existsSync(filePath)).toBe(true);
  });

  it('lists projects after creation', async () => {
    await createProject(db, config, embedder, { name: 'Alpha', prefix: 'ALP' });
    await createProject(db, config, embedder, { name: 'Beta', prefix: 'BET' });

    const result = listProjects(db);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data).toHaveLength(2);
    const prefixes = result.data.map((p) => p.prefix).sort();
    expect(prefixes).toEqual(['ALP', 'BET']);
  });

  it('gets project status with zero tasks', async () => {
    await createProject(db, config, embedder, { name: 'Status', prefix: 'STA' });

    const result = getProject(db, 'STA');
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.prefix).toBe('STA');
    expect(result.data.status).toBe('active');

    const taskIds = db.getModuleNoteIds({ module: 'pm', type: 'task' });
    expect(taskIds).toHaveLength(0);
  });

  it('sets active project in db_meta', async () => {
    await createProject(db, config, embedder, { name: 'Active', prefix: 'ACT' });

    expect(getActiveProject(db)).toBeNull();

    setActiveProject(db, 'ACT');
    expect(getActiveProject(db)).toBe('ACT');
  });

  it('updates project status', async () => {
    await createProject(db, config, embedder, { name: 'Update', prefix: 'UPD' });

    const result = await updateProject(db, config, embedder, 'UPD', { status: 'paused' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.status).toBe('paused');

    const refreshed = getProject(db, 'UPD');
    expect(refreshed.ok).toBe(true);
    if (refreshed.ok) {
      expect(refreshed.data.status).toBe('paused');
    }
  });

  it('deletes project and removes file', async () => {
    await createProject(db, config, embedder, { name: 'Delete', prefix: 'DEL' });

    const filePath = join(notesDir, 'modules', 'pm', 'DEL', 'project.md');
    expect(existsSync(filePath)).toBe(true);

    const result = await deleteProject(db, config, 'DEL');
    expect(result.ok).toBe(true);

    const check = getProject(db, 'DEL');
    expect(check.ok).toBe(false);
    expect(existsSync(filePath)).toBe(false);
  });

  it('returns PROJECT_EXISTS for duplicate prefix', async () => {
    await createProject(db, config, embedder, { name: 'First', prefix: 'DUP' });
    const result = await createProject(db, config, embedder, { name: 'Second', prefix: 'DUP' });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('PROJECT_EXISTS');
    }
  });

  it('returns INVALID_INPUT for lowercase prefix', async () => {
    const result = await createProject(db, config, embedder, { name: 'Bad', prefix: 'bad' });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('INVALID_INPUT');
    }
  });
});

describe('Wave 1: Module registration', () => {
  it('PM module loads via loadModules', async () => {
    const { registry, errors } = await loadModules({ modules: [pmModule] });

    expect(errors).toHaveLength(0);
    expect(registry.getModule('pm')).toBeDefined();
    expect(registry.getModuleNames()).toContain('pm');
  });

  it('registers all 6 note types', async () => {
    const { registry } = await loadModules({ modules: [pmModule] });

    expect(registry.getNoteType('project')).toBeDefined();
    expect(registry.getNoteType('workstream')).toBeDefined();
    expect(registry.getNoteType('task')).toBeDefined();
    expect(registry.getNoteType('decision')).toBeDefined();
    expect(registry.getNoteType('prompt')).toBeDefined();
    expect(registry.getNoteType('capture')).toBeDefined();
  });

  it('registers all 4 relation types', async () => {
    const { registry } = await loadModules({ modules: [pmModule] });

    expect(registry.getRelationType('depends_on')).toBeDefined();
    expect(registry.getRelationType('depends_on')!.inverse).toBe('blocks');
    expect(registry.getRelationType('blocks')).toBeDefined();
    expect(registry.getRelationType('blocks')!.inverse).toBe('depends_on');
    expect(registry.getRelationType('impacts')).toBeDefined();
    expect(registry.getRelationType('supersedes')).toBeDefined();
  });

  it('registers extraction strategy that skips PM notes', async () => {
    const { registry } = await loadModules({ modules: [pmModule] });

    const strategy = registry.getExtractionStrategy('pm');
    expect(strategy).toBeDefined();
    expect(strategy!.shouldExtract({} as never)).toBe(false);
  });

  it('registers private filter', async () => {
    const { registry } = await loadModules({ modules: [pmModule] });

    const filter = registry.getFilterForModule('pm');
    expect(filter).toBeDefined();
    expect(filter!.visibility).toBe('private');
  });

  it('registers pm command', async () => {
    const { registry } = await loadModules({ modules: [pmModule] });

    const commands = registry.getCommands();
    const pmCmd = commands.find((c) => c.module === 'pm');
    expect(pmCmd).toBeDefined();
    expect(pmCmd!.command.name()).toBe('pm');
  });

  it('registers migration v1', async () => {
    const { registry } = await loadModules({ modules: [pmModule] });

    const migrations = registry.getMigrations('pm');
    expect(migrations).toHaveLength(2);
    expect(migrations[0].migration.version).toBe(1);
    expect(migrations[0].migration.description).toBe('Create PM metadata indexes');
    expect(migrations[1].migration.version).toBe(2);
    expect(migrations[1].migration.description).toBe(
      'Add activity note indexes for dashboard flow metrics'
    );
  });
});
