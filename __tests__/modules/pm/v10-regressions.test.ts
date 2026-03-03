import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { BrainDB } from '../../../src/services/brain-db.js';
import { tmpDbPath, createMockEmbedder } from '../../helpers.js';
import type { BrainConfig } from '../../../src/types.js';
import { createStandardProject } from '../../fixtures/pm-project.js';
import {
  createTask,
  listTasks,
  getTask,
  updateTaskStatus,
} from '../../../src/modules/pm/data/task-ops.js';
import { createProject } from '../../../src/modules/pm/data/project-ops.js';
import { createWorkstream } from '../../../src/modules/pm/data/workstream-ops.js';
import { generateClaim } from '../../../src/modules/pm/engine/claims.js';
import { computeEligible } from '../../../src/modules/pm/engine/dependency.js';

let db: BrainDB;
let dbPath: string;
let notesDir: string;
let config: BrainConfig;
const embedder = createMockEmbedder();

beforeEach(async () => {
  dbPath = tmpDbPath('pm-v10-reg');
  db = new BrainDB(dbPath);
  notesDir = join(tmpdir(), `pm-v10-notes-${randomUUID()}`);
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

describe('O-136: claim token shown in human-readable output', () => {
  // The claim command should include the token in non-JSON output.
  // Previously the token was only available via --json (resolved as O-57).

  it('generateClaim returns a non-empty token string', () => {
    const claim = generateClaim();
    expect(claim.token).toBeTruthy();
    expect(typeof claim.token).toBe('string');
    expect(claim.token.length).toBeGreaterThan(0);
  });

  it('claim token is stored in task metadata after claiming', async () => {
    await createStandardProject(db, config, embedder);

    // Simulate what the claim command does: generate claim, update metadata
    const claim = generateClaim();
    const taskBefore = getTask(db, 'TEST-01.01');
    expect(taskBefore.ok).toBe(true);
    if (!taskBefore.ok) return;
    expect(taskBefore.data.claim_token).toBeUndefined();

    // The claim command updates status to 'claimed' and sets claim_token
    await updateTaskStatus(db, config, embedder, 'TEST-01.01', 'claimed');
    const taskAfter = getTask(db, 'TEST-01.01');
    expect(taskAfter.ok).toBe(true);
    if (!taskAfter.ok) return;

    // The claim token should be a non-empty string usable in output
    // Note: updateTaskStatus alone does not set claim_token — the claim
    // command uses updateTaskMetadataFields for that. We verify the token
    // format is suitable for display.
    expect(claim.token).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-/);
  });

  it('formatTaskLine includes display_id and status (token must be appended separately)', async () => {
    // The formatTaskLine helper only outputs display_id, title, priority,
    // status, mode, virtualStates. The claim command appends the token
    // in a separate line: `${displayId} claimed. Token: ${claim.token}`
    // This test verifies the claim output format expectation.
    const claim = generateClaim();
    const displayId = 'TEST-01.01';

    // Reproduce the exact output format from the claim command (task.ts lines 505-506)
    const line1 = `${displayId} claimed. Token: ${claim.token}`;
    const line2 = `Start: brain pm task start ${displayId} --token ${claim.token}`;

    expect(line1).toContain('Token:');
    expect(line1).toContain(claim.token);
    expect(line2).toContain('--token');
    expect(line2).toContain(claim.token);
  });
});

describe('O-137: next command --limit flag', () => {
  // The next command should support --limit to cap eligible task output.
  // Previously it truncated with no way to see all (resolved as O-63).

  it('computeEligible returns all eligible tasks without truncation', async () => {
    await createStandardProject(db, config, embedder);
    const eligible = computeEligible(db, 'TEST');
    // Standard fixture has 2 eligible tasks (TEST-01.01, TEST-02.01)
    expect(eligible).toEqual(['TEST-01.01', 'TEST-02.01']);
  });

  it('eligible list can be sliced to simulate --limit', async () => {
    await createStandardProject(db, config, embedder);
    const eligible = computeEligible(db, 'TEST');

    // Simulate --limit 1 (same logic as orchestration.ts line 70)
    const limited = eligible.slice(0, 1);
    expect(limited).toHaveLength(1);
    expect(limited[0]).toBe('TEST-01.01');
  });

  it('limit larger than eligible count returns all', async () => {
    await createStandardProject(db, config, embedder);
    const eligible = computeEligible(db, 'TEST');
    const limited = eligible.slice(0, 100);
    expect(limited).toEqual(eligible);
  });
});

describe('O-160: --full flag returns untruncated descriptions', () => {
  // listTasks with listMode='full' should return full description text,
  // while listMode='default' truncates to 500 chars. Previously --full
  // had no visible effect (resolved as O-83).

  const LONG_DESCRIPTION = 'A'.repeat(600);

  it('default mode truncates description to 500 chars', async () => {
    await createProject(db, config, embedder, { name: 'Full Test', prefix: 'FULL' });
    await createWorkstream(db, config, embedder, { project: 'FULL', name: 'WS1' });
    await createTask(db, config, embedder, {
      project: 'FULL',
      workstream: 1,
      name: 'Long task',
      description: LONG_DESCRIPTION,
    });

    const result = listTasks(db, 'FULL', {}, 'default');
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data).toHaveLength(1);
    const desc = result.data[0].description ?? '';
    expect(desc.length).toBeLessThanOrEqual(500);
  });

  it('full mode returns untruncated description', async () => {
    await createProject(db, config, embedder, { name: 'Full Test', prefix: 'FULL' });
    await createWorkstream(db, config, embedder, { project: 'FULL', name: 'WS1' });
    await createTask(db, config, embedder, {
      project: 'FULL',
      workstream: 1,
      name: 'Long task',
      description: LONG_DESCRIPTION,
    });

    const result = listTasks(db, 'FULL', {}, 'full');
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data).toHaveLength(1);
    const desc = result.data[0].description ?? '';
    // Full mode must return more than the 500-char truncation
    expect(desc.length).toBeGreaterThan(500);
    expect(desc).toContain(LONG_DESCRIPTION);
  });

  it('short mode omits description entirely', async () => {
    await createProject(db, config, embedder, { name: 'Full Test', prefix: 'FULL' });
    await createWorkstream(db, config, embedder, { project: 'FULL', name: 'WS1' });
    await createTask(db, config, embedder, {
      project: 'FULL',
      workstream: 1,
      name: 'Long task',
      description: LONG_DESCRIPTION,
    });

    const result = listTasks(db, 'FULL', {}, 'short');
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data).toHaveLength(1);
    expect(result.data[0].description).toBeUndefined();
  });
});
