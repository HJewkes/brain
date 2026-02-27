import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { BrainDB } from '../../../src/services/brain-db.js';
import { loadModules } from '../../../src/modules/loader.js';
import { tmpDbPath, createMockEmbedder } from '../../helpers.js';
import type { BrainConfig } from '../../../src/types.js';
import { pmModule } from '../../../src/modules/pm/index.js';
import { createStandardProject } from '../../fixtures/pm-project.js';
import {
  createDecision,
  listDecisions,
  supersedeDecision,
} from '../../../src/modules/pm/data/decision-ops.js';
import {
  writePrompt,
  getPrompt,
  listPrompts,
  getPromptHistory,
  detectStalePrompts,
} from '../../../src/modules/pm/data/prompt-ops.js';
import { assembleContext } from '../../../src/modules/pm/engine/dispatch.js';

let db: BrainDB;
let notesDir: string;
let config: BrainConfig;
const embedder = createMockEmbedder();

beforeEach(async () => {
  db = new BrainDB(tmpDbPath('pm-wave6'));
  db.setEmbeddingModel(embedder.model, embedder.dimensions);
  notesDir = join(tmpdir(), `pm-wave6-${randomUUID()}`);
  mkdirSync(notesDir, { recursive: true });
  config = {
    notesDir,
    dbPath: '',
    embedder: 'local',
    fusionWeights: { bm25: 0.3, vector: 0.7 },
  };

  await loadModules({ modules: [pmModule] });
  await createStandardProject(db, config, embedder);
});

afterEach(() => {
  db.close();
  if (existsSync(notesDir)) {
    rmSync(notesDir, { recursive: true, force: true });
  }
});

describe('Wave 6: Decisions + Prompts', () => {
  // Decision tests
  it('add decision with impacts creates relations in DB', async () => {
    const result = await createDecision(db, config, embedder, {
      project: 'TEST',
      name: 'Use PostgreSQL',
      sourceTask: 'TEST-01.01',
      impacts: ['TEST-01.01', 'TEST-01.02'],
      content: 'PostgreSQL for data layer.',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.display_id).toBe('TEST-D01');
    expect(result.data.impacts).toEqual(['TEST-01.01', 'TEST-01.02']);

    const decisionNoteIds = db.getModuleNoteIds({ module: 'pm', type: 'decision' });
    expect(decisionNoteIds).toHaveLength(1);
    const relations = db.getRelationsFrom(decisionNoteIds[0]);
    const impactRelations = relations.filter((r) => r.type === 'impacts');
    expect(impactRelations).toHaveLength(2);
  });

  it('list decisions returns created decisions', async () => {
    await createDecision(db, config, embedder, {
      project: 'TEST',
      name: 'Decision A',
      sourceTask: 'TEST-01.01',
      content: 'A',
    });
    await createDecision(db, config, embedder, {
      project: 'TEST',
      name: 'Decision B',
      sourceTask: 'TEST-02.01',
      content: 'B',
    });

    const result = listDecisions(db, 'TEST');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toHaveLength(2);
    }
  });

  it('supersede decision changes statuses and creates relation', async () => {
    await createDecision(db, config, embedder, {
      project: 'TEST',
      name: 'Original approach',
      sourceTask: 'TEST-01.01',
      content: 'First approach.',
    });

    const result = await supersedeDecision(db, config, embedder, 'TEST-D01', {
      project: 'TEST',
      name: 'Better approach',
      sourceTask: 'TEST-01.01',
      content: 'Improved.',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.old.status).toBe('superseded');
    expect(result.data.new.status).toBe('accepted');
    expect(result.data.new.display_id).toBe('TEST-D02');

    // Verify supersedes relation
    const decisionNoteIds = db.getModuleNoteIds({ module: 'pm', type: 'decision' });
    const notes = db.getNotesByIds(decisionNoteIds);
    let newNoteId: string | undefined;
    for (const [, note] of notes) {
      if (!note.metadata) continue;
      const meta = JSON.parse(note.metadata) as Record<string, unknown>;
      if (meta.display_id === 'TEST-D02') {
        newNoteId = note.id;
        break;
      }
    }
    expect(newNoteId).toBeDefined();
    const relations = db.getRelationsFrom(newNoteId!);
    expect(relations.some((r) => r.type === 'supersedes')).toBe(true);
  });

  // Prompt tests
  it('write prompt for task creates prompt note', async () => {
    const result = await writePrompt(db, config, embedder, {
      project: 'TEST',
      task: 'TEST-01.01',
      content: 'Implement the API endpoint.',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.display_id).toBe('TEST-P01');
    expect(result.data.prompt_status).toBe('current');
    expect(result.data.task).toBe('TEST-01.01');
    expect(result.data.version).toBe(1);
  });

  it('write second prompt supersedes first and creates new current', async () => {
    await writePrompt(db, config, embedder, {
      project: 'TEST',
      task: 'TEST-01.01',
      content: 'First draft.',
    });

    const result = await writePrompt(db, config, embedder, {
      project: 'TEST',
      task: 'TEST-01.01',
      content: 'Refined prompt.',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.version).toBe(2);
    expect(result.data.prompt_status).toBe('current');

    // Old prompt should be superseded
    const old = getPrompt(db, 'TEST-01.01', 1);
    expect(old.ok).toBe(true);
    if (old.ok) {
      expect(old.data.prompt_status).toBe('superseded');
    }
  });

  it('prompt history returns both versions ordered', async () => {
    await writePrompt(db, config, embedder, {
      project: 'TEST',
      task: 'TEST-01.01',
      content: 'V1.',
    });
    await writePrompt(db, config, embedder, {
      project: 'TEST',
      task: 'TEST-01.01',
      content: 'V2.',
    });

    const result = getPromptHistory(db, 'TEST-01.01');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toHaveLength(2);
      expect(result.data[0].version).toBe(1);
      expect(result.data[1].version).toBe(2);
    }
  });

  // Integration: staleness flow
  it('write prompt then add impacting decision marks prompt stale', async () => {
    // Write a prompt for the task
    await writePrompt(db, config, embedder, {
      project: 'TEST',
      task: 'TEST-01.01',
      content: 'Build the REST API.',
    });

    // Create a decision that impacts the same task (newer than prompt)
    await createDecision(db, config, embedder, {
      project: 'TEST',
      name: 'Switch to GraphQL',
      sourceTask: 'TEST-02.01',
      impacts: ['TEST-01.01'],
      content: 'GraphQL is better for our use case.',
    });

    const stale = detectStalePrompts(db, 'TEST');
    expect(stale.ok).toBe(true);
    if (stale.ok) {
      expect(stale.data).toHaveLength(1);
      expect(stale.data[0].task).toBe('TEST-01.01');
    }
  });

  it('dispatch includes prompt in context bundle', async () => {
    await writePrompt(db, config, embedder, {
      project: 'TEST',
      task: 'TEST-01.01',
      content: 'Implement REST endpoints.',
    });

    const result = assembleContext(db, 'TEST-01.01');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.prompt).toBeDefined();
  });

  // Listing
  it('list prompts by status returns correct results', async () => {
    await writePrompt(db, config, embedder, {
      project: 'TEST',
      task: 'TEST-01.01',
      content: 'V1.',
    });
    await writePrompt(db, config, embedder, {
      project: 'TEST',
      task: 'TEST-01.01',
      content: 'V2.',
    });
    await writePrompt(db, config, embedder, {
      project: 'TEST',
      task: 'TEST-02.01',
      content: 'Another prompt.',
    });

    const current = listPrompts(db, 'TEST', { status: 'current' });
    expect(current.ok).toBe(true);
    if (current.ok) {
      expect(current.data).toHaveLength(2);
    }

    const superseded = listPrompts(db, 'TEST', { status: 'superseded' });
    expect(superseded.ok).toBe(true);
    if (superseded.ok) {
      expect(superseded.data).toHaveLength(1);
    }

    const all = listPrompts(db, 'TEST');
    expect(all.ok).toBe(true);
    if (all.ok) {
      expect(all.data).toHaveLength(3);
    }
  });
});
