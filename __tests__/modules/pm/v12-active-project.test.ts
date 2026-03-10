import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { BrainDB } from '../../../src/services/brain-db.js';
import { createMockEmbedder, createTestDb } from '../../helpers.js';
import type { BrainConfig } from '../../../src/types.js';
import { createProject } from '../../../src/modules/pm/data/project-ops.js';
import {
  getActiveProject,
  setActiveProject,
  resolveProject,
} from '../../../src/modules/pm/data/queries.js';

let db: BrainDB;
let dbPath: string;
let notesDir: string;
let config: BrainConfig;
const embedder = createMockEmbedder();

beforeEach(() => {
  ({ dbPath, db } = createTestDb());
  notesDir = join(tmpdir(), `pm-v12-active-${randomUUID()}`);
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

describe('O-144: pm status uses resolveProject', () => {
  it('resolveProject auto-resolves single project without active project set', async () => {
    await createProject(db, config, embedder, {
      name: 'Solo Project',
      prefix: 'TST',
    });

    // Clear active project to simulate no `pm use` call
    // createProject sets active project, so we need to clear it
    setActiveProject(db, '');

    const cleared = getActiveProject(db);
    expect(cleared).toBeFalsy();

    // resolveProject should auto-resolve the single project
    const result = resolveProject(db, undefined);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toBe('TST');
    }
  });

  it('resolveProject respects explicit prefix over active project', async () => {
    await createProject(db, config, embedder, {
      name: 'First Project',
      prefix: 'TST',
    });
    await createProject(db, config, embedder, {
      name: 'Second Project',
      prefix: 'TST2',
    });

    // Active project is TST2 (last created)
    const result = resolveProject(db, 'TST');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toBe('TST');
    }
  });
});
