import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { Command } from '@commander-js/extra-typings';
import { BrainDB } from '../../../src/services/brain-db.js';
import { createMockEmbedder, createTestDb } from '../../helpers.js';
import type { BrainConfig } from '../../../src/types.js';
import { createStandardProject } from '../../fixtures/pm-project.js';
import { resolveProject } from '../../../src/modules/pm/data/queries.js';
import { listTasks } from '../../../src/modules/pm/data/task-ops.js';
import { pmModule } from '../../../src/modules/pm/index.js';
import { createTestTask } from '../../helpers.js';

let db: BrainDB;
let dbPath: string;
let notesDir: string;
let config: BrainConfig;
const embedder = createMockEmbedder();

beforeEach(async () => {
  ({ dbPath, db } = createTestDb());
  notesDir = join(tmpdir(), `pm-v10-ux-${randomUUID()}`);
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

describe('O-138: case-insensitive project lookup', () => {
  it('resolveProject accepts lowercase prefix', async () => {
    await createStandardProject(db, config, embedder);
    const result = resolveProject(db, 'test');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toBe('TEST');
    }
  });

  it('resolveProject accepts mixed-case prefix', async () => {
    await createStandardProject(db, config, embedder);
    const result = resolveProject(db, 'Test');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toBe('TEST');
    }
  });

  it('listTasks works with project resolved from lowercase input', async () => {
    await createStandardProject(db, config, embedder);
    const projectResult = resolveProject(db, 'test');
    expect(projectResult.ok).toBe(true);
    if (!projectResult.ok) return;

    const result = listTasks(db, projectResult.data);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.length).toBeGreaterThan(0);
    }
  });
});

describe('O-143: task JSON id vs display_id', () => {
  it('createTask result contains display_id', async () => {
    await createStandardProject(db, config, embedder);
    const result = await createTestTask(db, config, embedder, {
      project: 'TEST',
      workstream: 1,
      name: 'ID field test',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.display_id).toBeDefined();
    expect(result.data.display_id).toMatch(/^TEST-/);
  });

  // O-143: The `id` field in task JSON output is null; the identifier is in
  // `display_id`. Users expect an `id` field that contains the display
  // identifier. TaskMetadata intentionally has no `id` field — only
  // `display_id` — so JSON output exposes `display_id` but `id` is absent.
  // When serialized via outputResult with --json, the object has no `id` key.
  it('task JSON output has a non-null id field', async () => {
    await createStandardProject(db, config, embedder);
    const result = await createTestTask(db, config, embedder, {
      project: 'TEST',
      workstream: 1,
      name: 'ID field test',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const json = JSON.parse(JSON.stringify(result.data));
    expect(json.id).toBeDefined();
    expect(json.id).not.toBeNull();
    expect(json.id).toBe(result.data.display_id);
  });
});

describe('O-152: task add produces human-readable output', () => {
  it('createTask returns data with display_id and title for output', async () => {
    await createStandardProject(db, config, embedder);
    const result = await createTestTask(db, config, embedder, {
      project: 'TEST',
      workstream: 1,
      name: 'Output test task',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // The returned TaskMetadata must have enough fields for formatTaskLine
    expect(result.data.display_id).toBeDefined();
    expect(result.data.status).toBeDefined();
  });

  // O-152: `brain pm task add` without --json produces no output because
  // outputResult calls formatTaskLine which needs data, but the returned
  // TaskMetadata has no `title` field set (it's undefined). formatTaskLine
  // still produces a line, but the `add` action does call outputResult.
  // Let's verify that title is actually returned so the output is meaningful.
  it('createTask result includes title for human-readable output', async () => {
    await createStandardProject(db, config, embedder);
    const result = await createTestTask(db, config, embedder, {
      project: 'TEST',
      workstream: 1,
      name: 'Output test task',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.title).toBe('Output test task');
  });
});

describe('O-163: projects plural alias', () => {
  it('pm module registers "tasks" plural alias', () => {
    // Build the command tree to inspect registered commands
    const registered: Command[] = [];
    const mockCtx = {
      registerNoteType: () => {},
      registerRelationType: () => {},
      registerExtractionStrategy: () => {},
      registerFilter: () => {},
      registerContentHandler: () => {},
      registerMigration: () => {},
      registerCommand: (cmd: Command) => {
        registered.push(cmd);
      },
    };
    pmModule.register(mockCtx as never);

    expect(registered.length).toBe(1);
    const pmCmd = registered[0];
    const subNames = pmCmd.commands.map((c: Command) => c.name());
    expect(subNames).toContain('tasks');
  });

  it('pm module registers "workstreams" plural alias', () => {
    const registered: Command[] = [];
    const mockCtx = {
      registerNoteType: () => {},
      registerRelationType: () => {},
      registerExtractionStrategy: () => {},
      registerFilter: () => {},
      registerContentHandler: () => {},
      registerMigration: () => {},
      registerCommand: (cmd: Command) => {
        registered.push(cmd);
      },
    };
    pmModule.register(mockCtx as never);

    const pmCmd = registered[0];
    const subNames = pmCmd.commands.map((c: Command) => c.name());
    expect(subNames).toContain('workstreams');
  });

  // O-163: `brain pm projects list` (plural) fails. There is no "projects"
  // alias registered — only "tasks" and "workstreams" have plural aliases.
  it('pm module registers "projects" plural alias', () => {
    const registered: Command[] = [];
    const mockCtx = {
      registerNoteType: () => {},
      registerRelationType: () => {},
      registerExtractionStrategy: () => {},
      registerFilter: () => {},
      registerContentHandler: () => {},
      registerMigration: () => {},
      registerCommand: (cmd: Command) => {
        registered.push(cmd);
      },
    };
    pmModule.register(mockCtx as never);

    const pmCmd = registered[0];
    const subNames = pmCmd.commands.map((c: Command) => c.name());
    expect(subNames).toContain('projects');
  });
});
