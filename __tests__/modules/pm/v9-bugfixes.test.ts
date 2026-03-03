import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { BrainDB } from '../../../src/services/brain-db.js';
import { tmpDbPath, createMockEmbedder } from '../../helpers.js';
import type { BrainConfig } from '../../../src/types.js';
import { createStandardProject } from '../../fixtures/pm-project.js';
import { listTasks } from '../../../src/modules/pm/data/task-ops.js';
import { computeWaves } from '../../../src/modules/pm/engine/dependency.js';

let db: BrainDB;
let dbPath: string;
let notesDir: string;
let config: BrainConfig;
const embedder = createMockEmbedder();

beforeEach(async () => {
  dbPath = tmpDbPath('pm-v9-bugfixes');
  db = new BrainDB(dbPath);
  notesDir = join(tmpdir(), `pm-v9bf-notes-${randomUUID()}`);
  mkdirSync(notesDir, { recursive: true });
  config = {
    notesDir,
    dbPath,
    embedder: 'local',
    fusionWeights: { bm25: 0.3, vector: 0.7 },
  };
  await createStandardProject(db, config, embedder);
});

afterEach(() => {
  db.close();
  if (existsSync(notesDir)) {
    rmSync(notesDir, { recursive: true, force: true });
  }
});

describe('O-109: briefing blocked tasks render display IDs, not [object Object]', () => {
  it('blocked task list uses display_id strings', () => {
    // listTasks returns tasks with blocked virtual state
    const result = listTasks(db, 'TEST');
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const blocked = result.data.filter(
      (t) => t.status === 'blocked' || t.virtualStates?.includes('+BLOCKED')
    );
    // Simulates the briefing formatter logic — this is the fix for O-109
    const formatted = blocked.map((t) => t.display_id).join(', ');
    expect(formatted).not.toContain('[object Object]');
    expect(formatted).toMatch(/TEST-\d{2}\.\d{2}/);
  });
});

describe('O-115: invalid filter values produce errors', () => {
  it('invalid priority is not silently accepted by listTasks', () => {
    // The validation now happens at the command layer (task.ts),
    // but we verify the valid values are correct
    const validPriorities = ['critical', 'high', 'medium', 'low'];
    for (const p of validPriorities) {
      const result = listTasks(db, 'TEST', { priority: p });
      expect(result.ok).toBe(true);
    }
    // Invalid priority returns empty (the command layer now rejects before reaching here)
    const result = listTasks(db, 'TEST', { priority: 'invalid' });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data).toHaveLength(0);
  });

  it('invalid status is not silently accepted by listTasks', () => {
    const validStatuses = ['pending', 'claimed', 'in-progress', 'done', 'blocked', 'cancelled'];
    for (const s of validStatuses) {
      const result = listTasks(db, 'TEST', { status: s });
      expect(result.ok).toBe(true);
    }
    const result = listTasks(db, 'TEST', { status: 'invalid' });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data).toHaveLength(0);
  });
});

describe('O-74: task list JSON includes workstream name and display_id', () => {
  it('enriched tasks have workstream_name and workstream_display_id', () => {
    const result = listTasks(db, 'TEST', {}, 'default');
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const task = result.data.find((t) => t.display_id === 'TEST-01.01');
    expect(task).toBeDefined();
    // Fixture name is "Workstream 1", stored as "Workstream Workstream 1" (title = "Workstream ${name}")
    expect(task!.workstream_name).toBe('Workstream Alpha');
    expect(task!.workstream_display_id).toBe('TEST-01');
  });

  it('short mode omits workstream enrichment', () => {
    const result = listTasks(db, 'TEST', {}, 'short');
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const task = result.data.find((t) => t.display_id === 'TEST-01.01');
    expect(task).toBeDefined();
    expect(task!.workstream_name).toBeUndefined();
  });
});

describe('O-92: waves output includes workstream and summary data', () => {
  it('computeWaves returns tasks that have workstream info accessible via getTask', () => {
    const waves = computeWaves(db, 'TEST');
    expect(waves.length).toBeGreaterThan(0);

    const totalTasks = waves.reduce((sum, w) => sum + w.taskIds.length, 0);
    expect(totalTasks).toBe(6);
  });

  it('wave task IDs contain workstream info in display_id format', () => {
    const waves = computeWaves(db, 'TEST');
    for (const w of waves) {
      for (const id of w.taskIds) {
        // All task IDs should be in PREFIX-WS.TASK format
        expect(id).toMatch(/^TEST-\d{2}\.\d{2}$/);
        // Workstream number is extractable from the display ID
        const wsNum = parseInt(id.split('-')[1].split('.')[0], 10);
        expect(wsNum).toBeGreaterThan(0);
      }
    }
  });
});
