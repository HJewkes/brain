import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { BrainDB } from '../../../src/services/brain-db.js';
import { createMockEmbedder, createTestDb } from '../../helpers.js';
import type { BrainConfig } from '../../../src/types.js';
import { createProject } from '../../../src/modules/pm/data/project-ops.js';
import { createWorkstream } from '../../../src/modules/pm/data/workstream-ops.js';

import {
  assembleWorkstreamContext,
  assembleDispatch,
} from '../../../src/modules/pm/engine/dispatch.js';
import { createTestTask } from '../../helpers.js';

let db: BrainDB;
const embedder = createMockEmbedder();
let config: BrainConfig;

beforeEach(() => {
  ({ db } = createTestDb());
  config = {
    notesDir: `/tmp/v12-json-schema-${Date.now()}`,
    dbPath: ':memory:',
    embedder: 'local',
    fusionWeights: { bm25: 0.3, vector: 0.7 },
  };
});

afterEach(() => {
  db.close();
});

describe('O-138: workstreamDescription in context JSON', () => {
  it('workstream context includes non-empty description', async () => {
    await createProject(db, config, embedder, {
      name: 'Schema Test',
      prefix: 'SCH',
    });

    await createWorkstream(db, config, embedder, {
      project: 'SCH',
      name: 'Design',
      description: 'This workstream covers UI design tasks.',
    });

    const result = await assembleWorkstreamContext(db, 'SCH-01');
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.workstream.description).toBeTruthy();
    expect(result.data.workstream.description).toContain('UI design tasks');
  });

  it('dispatch bundle includes workstreamDescription from note body', async () => {
    await createProject(db, config, embedder, {
      name: 'Schema Test',
      prefix: 'SCH',
    });

    await createWorkstream(db, config, embedder, {
      project: 'SCH',
      name: 'Design',
      description: 'Handles all visual design work.',
    });

    await createTestTask(db, config, embedder, {
      project: 'SCH',
      workstream: 1,
      name: 'Create mockups',
    });

    const result = await assembleDispatch(db, embedder, config, 'SCH-01.01');
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.workstreamDescription).toBeTruthy();
    expect(result.data.workstreamDescription).toContain('visual design work');
  });
});

describe('O-139: --full body not empty for dep-updated tasks', () => {
  it.todo('task created then updated with --depends-on still has readable body');
});

describe('O-140: modified uses ISO timestamp', () => {
  it.todo('dependency update writes ISO timestamp, not bare date');
});
