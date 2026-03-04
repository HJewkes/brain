import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { BrainDB } from '../../../src/services/brain-db.js';
import { tmpDbPath, createMockEmbedder } from '../../helpers.js';
import type { BrainConfig } from '../../../src/types.js';
import { createStandardProject } from '../../fixtures/pm-project.js';
import { createWorkstream, getWorkstream, listWorkstreams } from '../../../src/modules/pm/data/workstream-ops.js';
import { listTasks } from '../../../src/modules/pm/data/task-ops.js';
import { computeEligible } from '../../../src/modules/pm/engine/dependency.js';
import { search } from '../../../src/services/search.js';
import { createTestTask } from '../../helpers.js';

let db: BrainDB;
let dbPath: string;
let notesDir: string;
let config: BrainConfig;
const embedder = createMockEmbedder();

beforeEach(async () => {
  dbPath = tmpDbPath('pm-v14-reg');
  db = new BrainDB(dbPath);
  notesDir = join(tmpdir(), `pm-v14-reg-${randomUUID()}`);
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

// ---------- O-216: search returns scored results ----------

describe('O-216: search score field baseline', () => {
  it('search results include a numeric score field', async () => {
    const results = await search(
      db,
      embedder,
      'Task',
      { limit: 5 }
    );
    expect(results.length).toBeGreaterThan(0);
    for (const r of results) {
      expect(typeof r.score).toBe('number');
      expect(r.score).toBeGreaterThanOrEqual(0);
    }
  });

  it('search results are sorted by score descending', async () => {
    const results = await search(
      db,
      embedder,
      'Task',
      { limit: 10 }
    );
    expect(results.length).toBeGreaterThan(1);
    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score);
    }
  });
});

// ---------- O-234: --search matches body content ----------

describe('O-234: task list --search searches body content', () => {
  it('finds task by unique keyword in description body, not title', async () => {
    const result = await createTestTask(db, config, embedder, {
      project: 'TEST',
      workstream: 1,
      name: 'Generic task name',
      description: 'This task involves refactoring the xylophone handler',
    });
    expect(result.ok).toBe(true);

    const listResult = listTasks(db, 'TEST', { search: 'xylophone' });
    expect(listResult.ok).toBe(true);
    if (!listResult.ok) return;
    expect(listResult.data.length).toBe(1);
    expect(listResult.data[0].title).toBe('Generic task name');
  });

  it('search is case-insensitive for body content', async () => {
    await createTestTask(db, config, embedder, {
      project: 'TEST',
      workstream: 1,
      name: 'Another task',
      description: 'Must handle ZephyrProtocol edge cases',
    });

    const listResult = listTasks(db, 'TEST', { search: 'zephyrprotocol' });
    expect(listResult.ok).toBe(true);
    if (!listResult.ok) return;
    expect(listResult.data.length).toBe(1);
  });
});

// ---------- O-230: briefing output includes eligible count ----------

describe('O-230: briefing eligible count baseline', () => {
  it('computeEligible returns correct count for standard project', () => {
    const eligible = computeEligible(db, 'TEST');
    // Standard project has TEST-01.01 and TEST-02.01 with no deps => eligible
    expect(eligible.length).toBe(2);
    expect(eligible).toContain('TEST-01.01');
    expect(eligible).toContain('TEST-02.01');
  });

  it('eligible count changes when a dependency is completed', async () => {
    const beforeEligible = computeEligible(db, 'TEST');
    expect(beforeEligible.length).toBe(2);

    // Complete TEST-01.01 to unblock TEST-01.02
    await import('../../../src/modules/pm/data/task-ops.js').then(
      async (mod) => {
        const claimResult = await mod.updateTaskStatus(db, config, embedder, 'TEST-01.01', 'claimed');
        expect(claimResult.ok).toBe(true);
        const startResult = await mod.updateTaskStatus(db, config, embedder, 'TEST-01.01', 'in-progress');
        expect(startResult.ok).toBe(true);
        const doneResult = await mod.updateTaskStatus(db, config, embedder, 'TEST-01.01', 'done');
        expect(doneResult.ok).toBe(true);
      }
    );

    const afterEligible = computeEligible(db, 'TEST');
    // TEST-01.01 is done, so TEST-01.02 becomes eligible (deps met)
    // TEST-02.02 still blocked by TEST-02.01 (pending)
    expect(afterEligible).toContain('TEST-01.02');
    expect(afterEligible).toContain('TEST-02.01');
    expect(afterEligible).not.toContain('TEST-01.01'); // done tasks are not eligible
  });
});

// ---------- O-213: briefing --json eligible field matches text output ----------

describe('O-213: briefing JSON eligible field consistency', () => {
  it('eligible array from computeEligible matches listTasks eligible filter', () => {
    const eligible = computeEligible(db, 'TEST');
    const listResult = listTasks(db, 'TEST', { status: 'eligible' });
    expect(listResult.ok).toBe(true);
    if (!listResult.ok) return;

    const listEligibleIds = listResult.data.map((t) => t.display_id).sort();
    const computedIds = [...eligible].sort();

    expect(listEligibleIds).toEqual(computedIds);
  });
});

// ---------- O-96: workstreams alias routes show and add ----------

describe('O-96: workstreams alias routing', () => {
  it('workstream show returns detail for a valid workstream', () => {
    const result = getWorkstream(db, 'TEST-01');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.display_id).toBe('TEST-01');
    expect(result.data.project).toBe('TEST');
  });

  it('workstream add creates a new workstream and list includes it', async () => {
    const result = await createWorkstream(db, config, embedder, {
      project: 'TEST',
      name: 'Gamma',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.display_id).toBe('TEST-03');

    const listResult = listWorkstreams(db, 'TEST');
    expect(listResult.ok).toBe(true);
    if (!listResult.ok) return;
    const displayIds = listResult.data.map((w) => w.display_id);
    expect(displayIds).toContain('TEST-03');
  });
});

// ---------- O-222: tasks alias forwards --priority and --status flags ----------

describe('O-222: tasks alias flag forwarding', () => {
  it('listTasks with priority filter returns only matching tasks', async () => {
    await createTestTask(db, config, embedder, {
      project: 'TEST',
      workstream: 1,
      name: 'Critical fix',
      priority: 'critical',
    });
    await createTestTask(db, config, embedder, {
      project: 'TEST',
      workstream: 1,
      name: 'Low effort cleanup',
      priority: 'low',
    });

    const criticalResult = listTasks(db, 'TEST', { priority: 'critical' });
    expect(criticalResult.ok).toBe(true);
    if (!criticalResult.ok) return;
    expect(criticalResult.data.length).toBe(1);
    expect(criticalResult.data[0].title).toBe('Critical fix');
  });

  it('listTasks with status filter returns only matching tasks', () => {
    // All standard project tasks are pending
    const pendingResult = listTasks(db, 'TEST', { status: 'pending' });
    expect(pendingResult.ok).toBe(true);
    if (!pendingResult.ok) return;
    expect(pendingResult.data.length).toBe(6); // standard project has 6 tasks

    const doneResult = listTasks(db, 'TEST', { status: 'done' });
    expect(doneResult.ok).toBe(true);
    if (!doneResult.ok) return;
    expect(doneResult.data.length).toBe(0);
  });

  it('listTasks with combined priority and status filters works', async () => {
    await createTestTask(db, config, embedder, {
      project: 'TEST',
      workstream: 2,
      name: 'High priority task',
      priority: 'high',
    });

    const result = listTasks(db, 'TEST', { priority: 'high', status: 'pending' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.length).toBe(1);
    expect(result.data[0].title).toBe('High priority task');
  });
});
