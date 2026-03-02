import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { BrainDB } from '../../../src/services/brain-db.js';
import { tmpDbPath, createMockEmbedder } from '../../helpers.js';
import type { BrainConfig } from '../../../src/types.js';
import { createProject } from '../../../src/modules/pm/data/project-ops.js';
import { createWorkstream } from '../../../src/modules/pm/data/workstream-ops.js';
import { createTask } from '../../../src/modules/pm/data/task-ops.js';
import { assembleWorkstreamContext } from '../../../src/modules/pm/engine/dispatch.js';

let db: BrainDB;
const embedder = createMockEmbedder();
let config: BrainConfig;

beforeEach(() => {
  db = new BrainDB(tmpDbPath('v12-ws-context'));
  config = {
    notesDir: `/tmp/v12-ws-context-${Date.now()}`,
    dbPath: ':memory:',
    embedder: 'local',
    fusionWeights: { bm25: 0.3, vector: 0.7 },
  };
});

afterEach(() => {
  db.close();
});

describe('O-149: workstream context includes relatedNotes', () => {
  it('assembleWorkstreamContext returns relatedNotes array', async () => {
    await createProject(db, config, embedder, {
      name: 'Backend API',
      prefix: 'API',
    });

    await createWorkstream(db, config, embedder, {
      project: 'API',
      name: 'Backend API Development',
    });

    await createTask(db, config, embedder, {
      project: 'API',
      workstream: 1,
      name: 'Design REST endpoints',
    });

    const result = await assembleWorkstreamContext(db, 'API-01', embedder, config);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data).toHaveProperty('relatedNotes');
    expect(Array.isArray(result.data.relatedNotes)).toBe(true);
  });

  it('relatedNotes is empty array when embedder not provided', async () => {
    await createProject(db, config, embedder, {
      name: 'Empty Project',
      prefix: 'EMP',
    });

    await createWorkstream(db, config, embedder, {
      project: 'EMP',
      name: 'Empty Workstream',
    });

    const result = await assembleWorkstreamContext(db, 'EMP-01');
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.relatedNotes).toEqual([]);
  });

  it('relatedNotes items have title, excerpt, and score', async () => {
    await createProject(db, config, embedder, {
      name: 'Notes Project',
      prefix: 'NTP',
    });

    await createWorkstream(db, config, embedder, {
      project: 'NTP',
      name: 'API Design',
    });

    await createTask(db, config, embedder, {
      project: 'NTP',
      workstream: 1,
      name: 'REST API patterns',
    });

    const result = await assembleWorkstreamContext(db, 'NTP-01', embedder, config);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    for (const note of result.data.relatedNotes) {
      expect(note).toHaveProperty('title');
      expect(note).toHaveProperty('excerpt');
      expect(note).toHaveProperty('score');
      expect(typeof note.score).toBe('number');
    }
  });
});
