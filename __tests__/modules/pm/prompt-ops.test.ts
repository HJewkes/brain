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
import { createTask } from '../../../src/modules/pm/data/task-ops.js';
import { createDecision } from '../../../src/modules/pm/data/decision-ops.js';
import {
  writePrompt,
  getPrompt,
  listPrompts,
  getPromptHistory,
  detectStalePrompts,
} from '../../../src/modules/pm/data/prompt-ops.js';

let db: BrainDB;
let dbPath: string;
let notesDir: string;
let config: BrainConfig;
const embedder = createMockEmbedder();

async function seedProjectAndTask(): Promise<{ taskDisplayId: string }> {
  await createProject(db, config, embedder, { name: 'Web', prefix: 'WEB' });
  await createWorkstream(db, config, embedder, { project: 'WEB', name: 'Core' });
  const taskResult = await createTask(db, config, embedder, {
    project: 'WEB',
    workstream: 1,
    name: 'Build API',
  });
  if (!taskResult.ok) throw new Error('Failed to create seed task');
  return { taskDisplayId: taskResult.data.display_id };
}

beforeEach(() => {
  dbPath = tmpDbPath('pm-prompt-ops');
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

describe('writePrompt', () => {
  it('creates prompt note with correct metadata', async () => {
    const { taskDisplayId } = await seedProjectAndTask();

    const result = await writePrompt(db, config, embedder, {
      project: 'WEB',
      task: taskDisplayId,
      content: 'You are an API builder.',
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.display_id).toBe('WEB-P01');
      expect(result.data.prompt_status).toBe('current');
      expect(result.data.project).toBe('WEB');
      expect(result.data.task).toBe(taskDisplayId);
      expect(result.data.version).toBe(1);
    }

    const filePath = join(notesDir, 'modules', 'pm', 'WEB', 'WEB-P01.md');
    expect(existsSync(filePath)).toBe(true);
  });

  it('supersedes current prompt when writing new version for same task', async () => {
    const { taskDisplayId } = await seedProjectAndTask();

    const r1 = await writePrompt(db, config, embedder, {
      project: 'WEB',
      task: taskDisplayId,
      content: 'First version.',
    });
    expect(r1.ok).toBe(true);

    const r2 = await writePrompt(db, config, embedder, {
      project: 'WEB',
      task: taskDisplayId,
      content: 'Second version.',
    });
    expect(r2.ok).toBe(true);
    if (r1.ok && r2.ok) {
      expect(r1.data.display_id).toBe('WEB-P01');
      expect(r2.data.display_id).toBe('WEB-P02');
      expect(r2.data.version).toBe(2);
      expect(r2.data.prompt_status).toBe('current');
    }

    // Check old prompt is superseded
    const oldPrompt = getPrompt(db, taskDisplayId, 1);
    expect(oldPrompt.ok).toBe(true);
    if (oldPrompt.ok) {
      expect(oldPrompt.data.prompt_status).toBe('superseded');
    }
  });

  it('returns NOT_FOUND for non-existent project', async () => {
    const result = await writePrompt(db, config, embedder, {
      project: 'NOPE',
      task: 'NOPE-01.01',
      content: 'Should fail.',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('NOT_FOUND');
      expect(result.error.message).toContain('Project');
    }
  });

  it('returns NOT_FOUND for non-existent task', async () => {
    await createProject(db, config, embedder, { name: 'Web', prefix: 'WEB' });

    const result = await writePrompt(db, config, embedder, {
      project: 'WEB',
      task: 'WEB-99.99',
      content: 'Should fail.',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('NOT_FOUND');
      expect(result.error.message).toContain('Task');
    }
  });
});

describe('getPrompt', () => {
  it('returns latest version when no version specified', async () => {
    const { taskDisplayId } = await seedProjectAndTask();

    await writePrompt(db, config, embedder, {
      project: 'WEB',
      task: taskDisplayId,
      content: 'Version one.',
    });
    await writePrompt(db, config, embedder, {
      project: 'WEB',
      task: taskDisplayId,
      content: 'Version two.',
    });

    const result = getPrompt(db, taskDisplayId);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.version).toBe(2);
      expect(result.data.content).toBe('Version two.');
    }
  });

  it('returns specific version when requested', async () => {
    const { taskDisplayId } = await seedProjectAndTask();

    await writePrompt(db, config, embedder, {
      project: 'WEB',
      task: taskDisplayId,
      content: 'Version one.',
    });
    await writePrompt(db, config, embedder, {
      project: 'WEB',
      task: taskDisplayId,
      content: 'Version two.',
    });

    const result = getPrompt(db, taskDisplayId, 1);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.version).toBe(1);
      expect(result.data.prompt_status).toBe('superseded');
    }
  });

  it('returns NOT_FOUND when no prompts exist for task', () => {
    const result = getPrompt(db, 'WEB-01.01');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('NOT_FOUND');
    }
  });

  it('returns NOT_FOUND for non-existent version', async () => {
    const { taskDisplayId } = await seedProjectAndTask();

    await writePrompt(db, config, embedder, {
      project: 'WEB',
      task: taskDisplayId,
      content: 'Version one.',
    });

    const result = getPrompt(db, taskDisplayId, 99);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('NOT_FOUND');
    }
  });
});

describe('listPrompts', () => {
  it('returns empty array when no prompts exist', async () => {
    await createProject(db, config, embedder, { name: 'Web', prefix: 'WEB' });

    const result = listPrompts(db, 'WEB');
    expect(result).toEqual({ ok: true, data: [] });
  });

  it('returns prompts for a project', async () => {
    const { taskDisplayId } = await seedProjectAndTask();

    await writePrompt(db, config, embedder, {
      project: 'WEB',
      task: taskDisplayId,
      content: 'First.',
    });

    const result = listPrompts(db, 'WEB');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toHaveLength(1);
    }
  });

  it('filters by status', async () => {
    const { taskDisplayId } = await seedProjectAndTask();

    await writePrompt(db, config, embedder, {
      project: 'WEB',
      task: taskDisplayId,
      content: 'V1.',
    });
    await writePrompt(db, config, embedder, {
      project: 'WEB',
      task: taskDisplayId,
      content: 'V2.',
    });

    const current = listPrompts(db, 'WEB', { status: 'current' });
    expect(current.ok).toBe(true);
    if (current.ok) {
      expect(current.data).toHaveLength(1);
      expect(current.data[0].prompt_status).toBe('current');
    }

    const superseded = listPrompts(db, 'WEB', { status: 'superseded' });
    expect(superseded.ok).toBe(true);
    if (superseded.ok) {
      expect(superseded.data).toHaveLength(1);
      expect(superseded.data[0].prompt_status).toBe('superseded');
    }
  });
});

describe('getPromptHistory', () => {
  it('returns all versions ordered by version number', async () => {
    const { taskDisplayId } = await seedProjectAndTask();

    await writePrompt(db, config, embedder, {
      project: 'WEB',
      task: taskDisplayId,
      content: 'V1.',
    });
    await writePrompt(db, config, embedder, {
      project: 'WEB',
      task: taskDisplayId,
      content: 'V2.',
    });

    const result = getPromptHistory(db, taskDisplayId);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toHaveLength(2);
      expect(result.data[0].version).toBe(1);
      expect(result.data[1].version).toBe(2);
      expect(result.data[0].prompt_status).toBe('superseded');
      expect(result.data[1].prompt_status).toBe('current');
    }
  });

  it('returns NOT_FOUND when no prompts exist', () => {
    const result = getPromptHistory(db, 'WEB-01.01');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('NOT_FOUND');
    }
  });
});

describe('detectStalePrompts', () => {
  it('detects prompt as stale when impacting decision is newer', async () => {
    const { taskDisplayId } = await seedProjectAndTask();

    // Write a prompt
    await writePrompt(db, config, embedder, {
      project: 'WEB',
      task: taskDisplayId,
      content: 'Build REST API.',
    });

    // Create a decision that impacts the task (created after the prompt)
    await createDecision(db, config, embedder, {
      project: 'WEB',
      name: 'Switch to GraphQL',
      sourceTask: taskDisplayId,
      impacts: [taskDisplayId],
      content: 'GraphQL is better.',
    });

    const result = detectStalePrompts(db, 'WEB');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toHaveLength(1);
      expect(result.data[0].task).toBe(taskDisplayId);
      expect(result.data[0].prompt_status).toBe('current');
    }
  });

  it('returns empty when no decisions impact prompt tasks', async () => {
    const { taskDisplayId } = await seedProjectAndTask();

    await writePrompt(db, config, embedder, {
      project: 'WEB',
      task: taskDisplayId,
      content: 'Build REST API.',
    });

    // Decision does NOT impact the prompt's task
    const task2 = await createTask(db, config, embedder, {
      project: 'WEB',
      workstream: 1,
      name: 'Other Task',
    });
    if (!task2.ok) throw new Error('Failed to create task');

    await createDecision(db, config, embedder, {
      project: 'WEB',
      name: 'Unrelated decision',
      sourceTask: taskDisplayId,
      impacts: [task2.data.display_id],
      content: 'Unrelated.',
    });

    const result = detectStalePrompts(db, 'WEB');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toHaveLength(0);
    }
  });
});
