import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { evaluateGate, evaluateGates } from '../../../../src/modules/workflow/engine/gates.js';
import type { Gate } from '../../../../src/modules/workflow/types.js';
import { BrainDB } from '../../../../src/services/brain-db.js';
import { tmpDbPath, createMockEmbedder, createTestTask } from '../../../helpers.js';
import { createProject } from '../../../../src/modules/pm/data/project-ops.js';
import { createWorkstream } from '../../../../src/modules/pm/data/workstream-ops.js';
import { updateTaskStatus } from '../../../../src/modules/pm/data/task-ops.js';
import type { BrainConfig } from '../../../../src/types.js';

let db: BrainDB;
let dbPath: string;
let notesDir: string;
let config: BrainConfig;
const embedder = createMockEmbedder();

beforeEach(async () => {
  dbPath = tmpDbPath('wf-gates');
  db = new BrainDB(dbPath);
  notesDir = join(tmpdir(), `wf-gates-${randomUUID()}`);
  mkdirSync(notesDir, { recursive: true });
  config = { notesDir, dbPath, embedder: 'local', fusionWeights: { bm25: 0.3, vector: 0.7 } };
  await createProject(db, config, embedder, { name: 'SDK', prefix: 'SDK' });
  await createWorkstream(db, config, embedder, { project: 'SDK', name: 'Core' });
});

afterEach(() => {
  db.close();
  if (existsSync(notesDir)) {
    rmSync(notesDir, { recursive: true, force: true });
  }
});

// --- AC-06: Gate Evaluation ---

describe('evaluateGate', () => {
  describe('task-complete gate', () => {
    test('AC-06: returns true when referenced task has status done', async () => {
      const taskResult = await createTestTask(db, config, embedder, {
        project: 'SDK',
        workstream: 1,
        name: 'Target task',
      });
      expect(taskResult.ok).toBe(true);
      if (!taskResult.ok) return;
      const displayId = taskResult.data.display_id;

      // Move task to done: pending -> claimed -> in-progress -> done
      await updateTaskStatus(db, config, displayId, 'claimed', { claimToken: 'test' });
      await updateTaskStatus(db, config, displayId, 'in-progress', { claimToken: 'test' });
      await updateTaskStatus(db, config, displayId, 'done', { claimToken: 'test' });

      const gate: Gate = { type: 'task-complete', target: displayId };
      const result = await evaluateGate(gate, db, config);
      expect(result).toBe(true);
    });

    test('AC-06: returns false when referenced task is in-progress', async () => {
      const taskResult = await createTestTask(db, config, embedder, {
        project: 'SDK',
        workstream: 1,
        name: 'In-progress task',
      });
      expect(taskResult.ok).toBe(true);
      if (!taskResult.ok) return;
      const displayId = taskResult.data.display_id;

      await updateTaskStatus(db, config, displayId, 'claimed', { claimToken: 'test' });
      await updateTaskStatus(db, config, displayId, 'in-progress', { claimToken: 'test' });

      const gate: Gate = { type: 'task-complete', target: displayId };
      const result = await evaluateGate(gate, db, config);
      expect(result).toBe(false);
    });
  });

  describe('file-exists gate', () => {
    test('AC-06: returns true when file exists on disk', async () => {
      const filePath = join(notesDir, 'research-brief.md');
      writeFileSync(filePath, '# Research Brief');

      const gate: Gate = { type: 'file-exists', target: filePath };
      const result = await evaluateGate(gate, db, config);
      expect(result).toBe(true);
    });

    test('AC-06: returns false when file does not exist', async () => {
      const gate: Gate = { type: 'file-exists', target: join(notesDir, 'nonexistent.md') };
      const result = await evaluateGate(gate, db, config);
      expect(result).toBe(false);
    });
  });

  describe('cli-pass gate', () => {
    test('AC-06: returns true when command exits with code 0', async () => {
      const gate: Gate = { type: 'cli-pass', target: 'true' };
      const result = await evaluateGate(gate, db, config);
      expect(result).toBe(true);
    });

    test('AC-06: returns false when command exits with non-zero code', async () => {
      const gate: Gate = { type: 'cli-pass', target: 'false' };
      const result = await evaluateGate(gate, db, config);
      expect(result).toBe(false);
    });
  });
});

describe('evaluateGates', () => {
  test('AC-06: all gates must pass for allPassed to be true (AND semantics)', async () => {
    const existingFile = join(notesDir, 'exists.md');
    writeFileSync(existingFile, 'content');

    const gates: Gate[] = [
      { type: 'file-exists', target: existingFile },
      { type: 'cli-pass', target: 'true' },
    ];
    const result = await evaluateGates(gates, db, config);
    expect(result.allPassed).toBe(true);
    expect(result.results).toHaveLength(2);
    expect(result.results.every((r) => r.passed)).toBe(true);
  });

  test('AC-06: allPassed is false when any gate fails', async () => {
    const gates: Gate[] = [
      { type: 'cli-pass', target: 'true' },
      { type: 'cli-pass', target: 'false' },
    ];
    const result = await evaluateGates(gates, db, config);
    expect(result.allPassed).toBe(false);
    expect(result.results.some((r) => !r.passed)).toBe(true);
  });

  test('AC-06: returns empty results with allPassed true for no gates', async () => {
    const result = await evaluateGates([], db, config);
    expect(result.allPassed).toBe(true);
    expect(result.results).toHaveLength(0);
  });
});
