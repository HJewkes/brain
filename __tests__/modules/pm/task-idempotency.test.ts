import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import {
  validateTransition,
  isTerminalStatus,
} from '../../../src/modules/pm/engine/state-machine.js';
import { updateTaskStatus } from '../../../src/modules/pm/data/task-ops.js';
import { findPostCompletionActivity } from '../../../src/modules/pm/engine/consistency.js';
import { createProject } from '../../../src/modules/pm/data/project-ops.js';
import { createWorkstream } from '../../../src/modules/pm/data/workstream-ops.js';
import { BrainDB } from '../../../src/services/brain-db.js';
import { createMockEmbedder, createTestDb, createTestTask } from '../../helpers.js';
import type { BrainConfig } from '../../../src/types.js';
import type { TaskStatus } from '../../../src/modules/pm/types.js';

describe('task completion idempotency', () => {
  test('done -> done transition is rejected', () => {
    const result = validateTransition('done', 'done');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('INVALID_TRANSITION');
      expect(result.error.message).toContain('reset');
    }
  });

  test('done -> claimed transition is rejected', () => {
    const result = validateTransition('done', 'claimed');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('INVALID_TRANSITION');
    }
  });

  test('done -> in-progress transition is rejected', () => {
    const result = validateTransition('done', 'in-progress');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('INVALID_TRANSITION');
    }
  });

  test('done -> pending transition is allowed (reset)', () => {
    const result = validateTransition('done', 'pending');
    expect(result.ok).toBe(true);
  });

  test('only reset (done -> pending) is allowed from done', () => {
    const rejected: TaskStatus[] = [
      'claimed',
      'in-progress',
      'done',
      'blocked',
      'cancelled',
      'pruned',
    ];
    for (const target of rejected) {
      const result = validateTransition('done', target);
      expect(result.ok).toBe(false);
    }
    const reset = validateTransition('done', 'pending');
    expect(reset.ok).toBe(true);
  });
});

describe('isTerminalStatus', () => {
  test('done is terminal', () => {
    expect(isTerminalStatus('done')).toBe(true);
  });

  test('cancelled is terminal', () => {
    expect(isTerminalStatus('cancelled')).toBe(true);
  });

  test('pruned is terminal', () => {
    expect(isTerminalStatus('pruned')).toBe(true);
  });

  test('pending is not terminal', () => {
    expect(isTerminalStatus('pending')).toBe(false);
  });

  test('claimed is not terminal', () => {
    expect(isTerminalStatus('claimed')).toBe(false);
  });

  test('in-progress is not terminal', () => {
    expect(isTerminalStatus('in-progress')).toBe(false);
  });

  test('blocked is not terminal', () => {
    expect(isTerminalStatus('blocked')).toBe(false);
  });
});

describe('re-claiming completed tasks', () => {
  test('done -> claimed is rejected by state machine', () => {
    const result = validateTransition('done', 'claimed');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('INVALID_TRANSITION');
      expect(result.error.message).toContain('reset');
    }
  });

  test('cancelled -> claimed is rejected by state machine', () => {
    const result = validateTransition('cancelled', 'claimed');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('INVALID_TRANSITION');
      expect(result.error.message).toContain('terminal state');
    }
  });
});

describe('updateTaskStatus idempotency guard', () => {
  let db: BrainDB;
  let notesDir: string;
  let config: BrainConfig;
  const embedder = createMockEmbedder();

  beforeEach(async () => {
    ({ db } = createTestDb());
    db.setEmbeddingModel(embedder.model, embedder.dimensions);
    notesDir = join(tmpdir(), `pm-idempotency-${randomUUID()}`);
    mkdirSync(notesDir, { recursive: true });
    config = {
      notesDir,
      dbPath: '',
      embedder: 'local',
      fusionWeights: { bm25: 0.3, vector: 0.7 },
    };
    await createProject(db, config, embedder, { name: 'Idem Test', prefix: 'IDM' });
    await createWorkstream(db, config, embedder, { project: 'IDM', name: 'Core' });
  });

  afterEach(() => {
    db.close();
    if (existsSync(notesDir)) rmSync(notesDir, { recursive: true, force: true });
  });

  test('completing a done task returns INVALID_TRANSITION', async () => {
    await createTestTask(db, config, embedder, {
      project: 'IDM',
      workstream: 1,
      name: 'Double done',
    });

    // Advance through claim -> in-progress -> done
    await updateTaskStatus(db, config, embedder, 'IDM-01.01', 'claimed');
    await updateTaskStatus(db, config, embedder, 'IDM-01.01', 'in-progress');
    const first = await updateTaskStatus(db, config, embedder, 'IDM-01.01', 'done');
    expect(first.ok).toBe(true);

    // Attempt to complete again
    const second = await updateTaskStatus(db, config, embedder, 'IDM-01.01', 'done');
    expect(second.ok).toBe(false);
    if (!second.ok) {
      expect(second.error.code).toBe('INVALID_TRANSITION');
    }
  });

  test('claiming a done task returns INVALID_TRANSITION', async () => {
    await createTestTask(db, config, embedder, {
      project: 'IDM',
      workstream: 1,
      name: 'Reclaim done',
    });

    await updateTaskStatus(db, config, embedder, 'IDM-01.01', 'claimed');
    await updateTaskStatus(db, config, embedder, 'IDM-01.01', 'in-progress');
    await updateTaskStatus(db, config, embedder, 'IDM-01.01', 'done');

    const result = await updateTaskStatus(db, config, embedder, 'IDM-01.01', 'claimed');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('INVALID_TRANSITION');
    }
  });

  test('starting a done task returns INVALID_TRANSITION', async () => {
    await createTestTask(db, config, embedder, {
      project: 'IDM',
      workstream: 1,
      name: 'Restart done',
    });

    await updateTaskStatus(db, config, embedder, 'IDM-01.01', 'claimed');
    await updateTaskStatus(db, config, embedder, 'IDM-01.01', 'in-progress');
    await updateTaskStatus(db, config, embedder, 'IDM-01.01', 'done');

    const result = await updateTaskStatus(db, config, embedder, 'IDM-01.01', 'in-progress');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('INVALID_TRANSITION');
    }
  });
});

describe('findPostCompletionActivity', () => {
  let db: BrainDB;
  let notesDir: string;
  let config: BrainConfig;
  const embedder = createMockEmbedder();

  beforeEach(async () => {
    ({ db } = createTestDb());
    db.setEmbeddingModel(embedder.model, embedder.dimensions);
    notesDir = join(tmpdir(), `pm-postcomp-${randomUUID()}`);
    mkdirSync(notesDir, { recursive: true });
    config = {
      notesDir,
      dbPath: '',
      embedder: 'local',
      fusionWeights: { bm25: 0.3, vector: 0.7 },
    };
    await createProject(db, config, embedder, { name: 'Post Test', prefix: 'PST' });
    await createWorkstream(db, config, embedder, { project: 'PST', name: 'Core' });
  });

  afterEach(() => {
    db.close();
    if (existsSync(notesDir)) rmSync(notesDir, { recursive: true, force: true });
  });

  test('returns empty when no activity notes exist', () => {
    const result = findPostCompletionActivity(db, 'PST');
    expect(result).toEqual([]);
  });

  test('returns empty when task has only completion activity', async () => {
    await createTestTask(db, config, embedder, {
      project: 'PST',
      workstream: 1,
      name: 'Clean task',
    });

    await updateTaskStatus(db, config, embedder, 'PST-01.01', 'claimed');
    await updateTaskStatus(db, config, embedder, 'PST-01.01', 'in-progress');
    await updateTaskStatus(db, config, embedder, 'PST-01.01', 'done');

    const result = findPostCompletionActivity(db, 'PST');
    expect(result).toEqual([]);
  });
});
