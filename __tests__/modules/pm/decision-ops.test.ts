import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { BrainDB } from '../../../src/services/brain-db.js';
import { tmpDbPath, createMockEmbedder } from '../../helpers.js';
import type { BrainConfig } from '../../../src/types.js';
import { createProject } from '../../../src/modules/pm/data/project-ops.js';
import { createWorkstream } from '../../../src/modules/pm/data/workstream-ops.js';

import {
  createDecision,
  listDecisions,
  getDecision,
  supersedeDecision,
} from '../../../src/modules/pm/data/decision-ops.js';
import { createTestTask } from '../../helpers.js';

let db: BrainDB;
let dbPath: string;
let notesDir: string;
let config: BrainConfig;
const embedder = createMockEmbedder();

async function seedProjectAndTask(): Promise<{ taskDisplayId: string }> {
  await createProject(db, config, embedder, { name: 'Web', prefix: 'WEB' });
  await createWorkstream(db, config, embedder, { project: 'WEB', name: 'Core' });
  const taskResult = await createTestTask(db, config, embedder, {
    project: 'WEB',
    workstream: 1,
    name: 'Build API',
  });
  if (!taskResult.ok) throw new Error('Failed to create seed task');
  return { taskDisplayId: taskResult.data.display_id };
}

beforeEach(() => {
  dbPath = tmpDbPath('pm-decision-ops');
  db = new BrainDB(dbPath);
  notesDir = join(tmpdir(), `pm-notes-${randomUUID()}`);
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

describe('createDecision', () => {
  it('creates decision with accepted status and correct display ID', async () => {
    const { taskDisplayId } = await seedProjectAndTask();

    const result = await createDecision(db, config, embedder, {
      project: 'WEB',
      name: 'Use REST over GraphQL',
      sourceTask: taskDisplayId,
      content: 'REST is simpler for our use case.',
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.display_id).toBe('WEB-D01');
      expect(result.data.status).toBe('accepted');
      expect(result.data.project).toBe('WEB');
      expect(result.data.source_task).toBe(taskDisplayId);
    }

    const filePath = join(notesDir, 'modules', 'pm', 'WEB', 'WEB-D01.md');
    expect(existsSync(filePath)).toBe(true);
  });

  it('creates impacts relations to affected tasks', async () => {
    const { taskDisplayId } = await seedProjectAndTask();

    const task2 = await createTestTask(db, config, embedder, {
      project: 'WEB',
      workstream: 1,
      name: 'Build Frontend',
    });
    if (!task2.ok) throw new Error('Failed to create task 2');

    const result = await createDecision(db, config, embedder, {
      project: 'WEB',
      name: 'Use REST',
      sourceTask: taskDisplayId,
      impacts: [taskDisplayId, task2.data.display_id],
      content: 'REST for everything.',
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.impacts).toEqual([taskDisplayId, task2.data.display_id]);

      const decisionNoteIds = db.getModuleNoteIds({ module: 'pm', type: 'decision' });
      expect(decisionNoteIds).toHaveLength(1);
      const relations = db.getRelationsFrom(decisionNoteIds[0]);
      const impactRelations = relations.filter((r) => r.type === 'impacts');
      expect(impactRelations).toHaveLength(2);
    }
  });

  it('auto-numbers decisions per project', async () => {
    const { taskDisplayId } = await seedProjectAndTask();

    const r1 = await createDecision(db, config, embedder, {
      project: 'WEB',
      name: 'First',
      sourceTask: taskDisplayId,
      content: 'First decision.',
    });
    const r2 = await createDecision(db, config, embedder, {
      project: 'WEB',
      name: 'Second',
      sourceTask: taskDisplayId,
      content: 'Second decision.',
    });

    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
    if (r1.ok && r2.ok) {
      expect(r1.data.display_id).toBe('WEB-D01');
      expect(r2.data.display_id).toBe('WEB-D02');
    }
  });

  it('returns NOT_FOUND for non-existent project', async () => {
    const result = await createDecision(db, config, embedder, {
      project: 'NOPE',
      name: 'Bad',
      sourceTask: 'NOPE-01.01',
      content: 'Should fail.',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('NOT_FOUND');
      expect(result.error.message).toContain('Project');
    }
  });

  it('returns NOT_FOUND for invalid impact targets', async () => {
    const { taskDisplayId } = await seedProjectAndTask();

    const result = await createDecision(db, config, embedder, {
      project: 'WEB',
      name: 'Bad impacts',
      sourceTask: taskDisplayId,
      impacts: ['WEB-99.99'],
      content: 'Should fail.',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('NOT_FOUND');
      expect(result.error.message).toContain('Impact target');
    }
  });

  it('returns NOT_FOUND for invalid source task', async () => {
    await createProject(db, config, embedder, { name: 'Web', prefix: 'WEB' });

    const result = await createDecision(db, config, embedder, {
      project: 'WEB',
      name: 'Bad source',
      sourceTask: 'WEB-99.99',
      content: 'Should fail.',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('NOT_FOUND');
      expect(result.error.message).toContain('Source task');
    }
  });
});

describe('listDecisions', () => {
  it('returns empty array when no decisions exist', async () => {
    await createProject(db, config, embedder, { name: 'Web', prefix: 'WEB' });

    const result = listDecisions(db, 'WEB');
    expect(result).toEqual({ ok: true, data: [] });
  });

  it('returns decisions for a project', async () => {
    const { taskDisplayId } = await seedProjectAndTask();

    await createDecision(db, config, embedder, {
      project: 'WEB',
      name: 'Decision A',
      sourceTask: taskDisplayId,
      content: 'A',
    });
    await createDecision(db, config, embedder, {
      project: 'WEB',
      name: 'Decision B',
      sourceTask: taskDisplayId,
      content: 'B',
    });

    const result = listDecisions(db, 'WEB');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toHaveLength(2);
    }
  });

  it('filters by status', async () => {
    const { taskDisplayId } = await seedProjectAndTask();

    await createDecision(db, config, embedder, {
      project: 'WEB',
      name: 'Accepted',
      sourceTask: taskDisplayId,
      content: 'yes',
    });

    const accepted = listDecisions(db, 'WEB', { status: 'accepted' });
    expect(accepted.ok).toBe(true);
    if (accepted.ok) {
      expect(accepted.data).toHaveLength(1);
    }

    const rejected = listDecisions(db, 'WEB', { status: 'rejected' });
    expect(rejected.ok).toBe(true);
    if (rejected.ok) {
      expect(rejected.data).toHaveLength(0);
    }
  });

  it('filters by source task', async () => {
    const { taskDisplayId } = await seedProjectAndTask();
    const task2 = await createTestTask(db, config, embedder, {
      project: 'WEB',
      workstream: 1,
      name: 'Other',
    });
    if (!task2.ok) throw new Error('Failed to create task 2');

    await createDecision(db, config, embedder, {
      project: 'WEB',
      name: 'From task 1',
      sourceTask: taskDisplayId,
      content: 'from 1',
    });
    await createDecision(db, config, embedder, {
      project: 'WEB',
      name: 'From task 2',
      sourceTask: task2.data.display_id,
      content: 'from 2',
    });

    const result = listDecisions(db, 'WEB', { task: taskDisplayId });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toHaveLength(1);
      expect(result.data[0].source_task).toBe(taskDisplayId);
    }
  });
});

describe('getDecision', () => {
  it('returns decision metadata and content', async () => {
    const { taskDisplayId } = await seedProjectAndTask();

    await createDecision(db, config, embedder, {
      project: 'WEB',
      name: 'Use REST',
      sourceTask: taskDisplayId,
      content: 'REST is simpler for our use case.',
    });

    const result = getDecision(db, 'WEB-D01');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.display_id).toBe('WEB-D01');
      expect(result.data.status).toBe('accepted');
      expect(result.data.content).toBe('REST is simpler for our use case.');
    }
  });

  it('returns NOT_FOUND for non-existent decision', () => {
    const result = getDecision(db, 'WEB-D99');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('NOT_FOUND');
    }
  });
});

describe('supersedeDecision', () => {
  it('marks old decision as superseded and creates new one as accepted', async () => {
    const { taskDisplayId } = await seedProjectAndTask();

    await createDecision(db, config, embedder, {
      project: 'WEB',
      name: 'Use REST',
      sourceTask: taskDisplayId,
      content: 'REST initially.',
    });

    const result = await supersedeDecision(db, config, embedder, 'WEB-D01', {
      project: 'WEB',
      name: 'Use GraphQL instead',
      sourceTask: taskDisplayId,
      content: 'Changed to GraphQL.',
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.old.status).toBe('superseded');
      expect(result.data.old.display_id).toBe('WEB-D01');
      expect(result.data.new.status).toBe('accepted');
      expect(result.data.new.display_id).toBe('WEB-D02');
    }

    const oldCheck = getDecision(db, 'WEB-D01');
    expect(oldCheck.ok).toBe(true);
    if (oldCheck.ok) {
      expect(oldCheck.data.status).toBe('superseded');
    }
  });

  it('creates supersedes relation from new to old', async () => {
    const { taskDisplayId } = await seedProjectAndTask();

    await createDecision(db, config, embedder, {
      project: 'WEB',
      name: 'Original',
      sourceTask: taskDisplayId,
      content: 'Original.',
    });

    await supersedeDecision(db, config, embedder, 'WEB-D01', {
      project: 'WEB',
      name: 'Replacement',
      sourceTask: taskDisplayId,
      content: 'Replacement.',
    });

    const newNoteIds = db.getModuleNoteIds({ module: 'pm', type: 'decision' });
    const newNotes = db.getNotesByIds(newNoteIds);
    let newNoteId: string | undefined;
    for (const [, note] of newNotes) {
      if (!note.metadata) continue;
      const meta = JSON.parse(note.metadata) as Record<string, unknown>;
      if (meta.display_id === 'WEB-D02') {
        newNoteId = note.id;
        break;
      }
    }

    expect(newNoteId).toBeDefined();
    const relations = db.getRelationsFrom(newNoteId!);
    const supersedes = relations.filter((r) => r.type === 'supersedes');
    expect(supersedes).toHaveLength(1);
  });

  it('returns NOT_FOUND when old decision does not exist', async () => {
    await seedProjectAndTask();

    const result = await supersedeDecision(db, config, embedder, 'WEB-D99', {
      project: 'WEB',
      name: 'New',
      sourceTask: 'WEB-01.01',
      content: 'Should fail.',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('NOT_FOUND');
    }
  });
});
