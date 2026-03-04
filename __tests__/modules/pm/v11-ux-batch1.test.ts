import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { Command } from '@commander-js/extra-typings';
import { BrainDB } from '../../../src/services/brain-db.js';
import { tmpDbPath, createMockEmbedder } from '../../helpers.js';
import type { BrainConfig } from '../../../src/types.js';
import { createStandardProject } from '../../fixtures/pm-project.js';
import { getTask } from '../../../src/modules/pm/data/task-ops.js';
import { pmModule } from '../../../src/modules/pm/index.js';
import { createTestTask } from '../../helpers.js';

let db: BrainDB;
let dbPath: string;
let notesDir: string;
let config: BrainConfig;
const embedder = createMockEmbedder();

beforeEach(async () => {
  dbPath = tmpDbPath('pm-v11-ux');
  db = new BrainDB(dbPath);
  notesDir = join(tmpdir(), `pm-v11-ux-${randomUUID()}`);
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

describe('O-163: projects plural alias', () => {
  it('projects plural alias is registered on pm command', () => {
    const registered: Command[] = [];
    const mockCtx = {
      registerNoteType: () => {},
      registerRelationType: () => {},
      registerExtractionStrategy: () => {},
      registerFilter: () => {},
      registerMigration: () => {},
      registerCommand: (cmd: Command) => {
        registered.push(cmd);
      },
    };
    pmModule.register(mockCtx as never);

    expect(registered.length).toBe(1);
    const pmCmd = registered[0];
    const subNames = pmCmd.commands.map((c: Command) => c.name());
    expect(subNames).toContain('projects');
  });
});

describe('O-143: task JSON has non-null id field', () => {
  it('task JSON has non-null id field matching display_id', async () => {
    await createStandardProject(db, config, embedder);
    const result = await createTestTask(db, config, embedder, {
      project: 'TEST',
      workstream: 1,
      name: 'ID field test',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.id).toBeDefined();
    expect(result.data.id).not.toBeNull();
    expect(result.data.id).toBe(result.data.display_id);
  });

  it('getTask returns id matching display_id', async () => {
    await createStandardProject(db, config, embedder);
    const createResult = await createTestTask(db, config, embedder, {
      project: 'TEST',
      workstream: 1,
      name: 'Get task id test',
    });
    expect(createResult.ok).toBe(true);
    if (!createResult.ok) return;

    const result = getTask(db, createResult.data.display_id);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.id).toBe(result.data.display_id);
  });
});

describe('O-152: createTask returns title', () => {
  it('createTask returns title in result for human-readable output', async () => {
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
