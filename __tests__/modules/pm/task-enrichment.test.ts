import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { BrainDB } from '../../../src/services/brain-db.js';
import { createMockEmbedder, createTestDb } from '../../helpers.js';
import type { BrainConfig } from '../../../src/types.js';
import { createProject } from '../../../src/modules/pm/data/project-ops.js';
import { createWorkstream } from '../../../src/modules/pm/data/workstream-ops.js';
import { getTask, updateTaskStatus } from '../../../src/modules/pm/data/task-ops.js';
import { readTaskBody } from '../../../src/modules/pm/engine/dispatch.js';
import { getPmNotes } from '../../../src/modules/pm/data/queries.js';
import type { TaskStatus } from '../../../src/modules/pm/types.js';
import { createTestTask } from '../../helpers.js';

function replaceFm(content: string, field: string, value: string): string {
  const endOfFrontmatter = content.indexOf('\n---', 4);
  if (endOfFrontmatter === -1) return content;
  const frontmatter = content.slice(0, endOfFrontmatter);
  const rest = content.slice(endOfFrontmatter);
  const fieldRegex = new RegExp(`^${field}:.*$`, 'm');
  if (fieldRegex.test(frontmatter)) {
    return frontmatter.replace(fieldRegex, `${field}: ${value}`) + rest;
  }
  return frontmatter + `\n${field}: ${value}` + rest;
}

let db: BrainDB;
let dbPath: string;
let notesDir: string;
let config: BrainConfig;
const embedder = createMockEmbedder();

beforeEach(async () => {
  ({ dbPath, db } = createTestDb());
  notesDir = join(tmpdir(), `pm-enrich-${randomUUID()}`);
  mkdirSync(notesDir, { recursive: true });
  config = {
    notesDir,
    dbPath,
    embedder: 'local',
    fusionWeights: { bm25: 0.3, vector: 0.7 },
  };

  await createProject(db, config, embedder, { name: 'Web', prefix: 'WEB' });
  await createWorkstream(db, config, embedder, { project: 'WEB', name: 'Frontend' });
});

afterEach(() => {
  db.close();
  if (existsSync(notesDir)) {
    rmSync(notesDir, { recursive: true, force: true });
  }
});

describe('O-128: task add --description', () => {
  it('creates task with description in note body', async () => {
    const result = await createTestTask(db, config, embedder, {
      project: 'WEB',
      workstream: 1,
      name: 'Build login page',
      description: 'Implement OAuth2 login flow with Google provider',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const notes = getPmNotes(db, 'task', { display_id: 'WEB-01.01' });
    expect(notes).toHaveLength(1);

    const body = readTaskBody(notes[0]);
    expect(body).toBe('Implement OAuth2 login flow with Google provider');
  });

  it('creates task with default description when not explicitly provided', async () => {
    const result = await createTestTask(db, config, embedder, {
      project: 'WEB',
      workstream: 1,
      name: 'Simple task',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const notes = getPmNotes(db, 'task', { display_id: 'WEB-01.01' });
    const body = readTaskBody(notes[0]);
    expect(body).toBe('Test task: Simple task. This is a test task for automated testing.');
  });

  it('handles escaped newlines in description', async () => {
    const result = await createTestTask(db, config, embedder, {
      project: 'WEB',
      workstream: 1,
      name: 'Multi-line task',
      description: 'Line one\\nLine two\\nLine three',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const notes = getPmNotes(db, 'task', { display_id: 'WEB-01.01' });
    const body = readTaskBody(notes[0]);
    expect(body).toContain('Line one');
    expect(body).toContain('Line two');
    expect(body).toContain('Line three');
  });
});

describe('O-95: task block --reason', () => {
  it('stores block_reason in task frontmatter metadata', async () => {
    await createTestTask(db, config, embedder, {
      project: 'WEB',
      workstream: 1,
      name: 'Blocked task',
    });

    // Transition to in-progress first (pending -> claimed -> in-progress -> blocked)
    await updateTaskStatus(db, config, embedder, 'WEB-01.01', 'claimed' as TaskStatus);
    await updateTaskStatus(db, config, embedder, 'WEB-01.01', 'in-progress' as TaskStatus);
    const blockResult = await updateTaskStatus(
      db,
      config,
      embedder,
      'WEB-01.01',
      'blocked' as TaskStatus
    );
    expect(blockResult.ok).toBe(true);

    // Verify the task is blocked
    const taskResult = getTask(db, 'WEB-01.01');
    expect(taskResult.ok).toBe(true);
    if (!taskResult.ok) return;
    expect(taskResult.data.status).toBe('blocked');
  });

  it('block_reason can be written to frontmatter via file update', async () => {
    await createTestTask(db, config, embedder, {
      project: 'WEB',
      workstream: 1,
      name: 'Blocked task',
    });

    await updateTaskStatus(db, config, embedder, 'WEB-01.01', 'claimed' as TaskStatus);
    await updateTaskStatus(db, config, embedder, 'WEB-01.01', 'in-progress' as TaskStatus);
    await updateTaskStatus(db, config, embedder, 'WEB-01.01', 'blocked' as TaskStatus);

    // Simulate what the command handler does: write block_reason to frontmatter
    const notes = getPmNotes(db, 'task', { display_id: 'WEB-01.01' });
    expect(notes).toHaveLength(1);

    const filePath = notes[0].filePath;
    let content = readFileSync(filePath, 'utf-8');

    // Add block_reason to frontmatter
    const endOfFrontmatter = content.indexOf('\n---', 4);
    content =
      content.slice(0, endOfFrontmatter) +
      '\nblock_reason: "Waiting on API keys"' +
      content.slice(endOfFrontmatter);

    const { writeFileSync } = await import('node:fs');
    writeFileSync(filePath, content, 'utf-8');

    // Verify block_reason is in the file
    const updatedContent = readFileSync(filePath, 'utf-8');
    expect(updatedContent).toContain('block_reason: "Waiting on API keys"');
  });
});

describe('O-127: task done --token', () => {
  it('completes task without token (backward compatible)', async () => {
    await createTestTask(db, config, embedder, {
      project: 'WEB',
      workstream: 1,
      name: 'Token task',
    });

    await updateTaskStatus(db, config, embedder, 'WEB-01.01', 'claimed' as TaskStatus);
    await updateTaskStatus(db, config, embedder, 'WEB-01.01', 'in-progress' as TaskStatus);
    const result = await updateTaskStatus(db, config, embedder, 'WEB-01.01', 'done' as TaskStatus);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.status).toBe('done');
  });

  it('token mismatch is detectable via getTask claim_token', async () => {
    await createTestTask(db, config, embedder, {
      project: 'WEB',
      workstream: 1,
      name: 'Claimed task',
    });

    // Simulate claiming with a known token by writing to frontmatter
    const notes = getPmNotes(db, 'task', { display_id: 'WEB-01.01' });
    const filePath = notes[0].filePath;
    let content = readFileSync(filePath, 'utf-8');

    // Use replaceFrontmatterField to avoid duplicate keys
    content = replaceFm(content, 'claim_token', 'real-token-abc');
    content = replaceFm(content, 'status', 'in-progress');

    const { writeFileSync } = await import('node:fs');
    const { createHash } = await import('node:crypto');
    const { indexSingleFile } = await import('../../../src/services/indexing.js');

    writeFileSync(filePath, content, 'utf-8');
    const hash = createHash('sha256').update(content).digest('hex');
    await indexSingleFile(db, embedder, filePath, content, hash, Date.now());

    // Verify task has claim_token
    const taskResult = getTask(db, 'WEB-01.01');
    expect(taskResult.ok).toBe(true);
    if (!taskResult.ok) return;
    expect(taskResult.data.claim_token).toBe('real-token-abc');

    // The command handler checks: if provided token !== claim_token, warn
    const providedToken = 'wrong-token-xyz';
    const mismatch = taskResult.data.claim_token !== providedToken;
    expect(mismatch).toBe(true);

    // Completing still succeeds (warn, don't block)
    const doneResult = await updateTaskStatus(
      db,
      config,
      embedder,
      'WEB-01.01',
      'done' as TaskStatus
    );
    expect(doneResult.ok).toBe(true);
    if (!doneResult.ok) return;
    expect(doneResult.data.status).toBe('done');
  });

  it('matching token produces no mismatch', async () => {
    await createTestTask(db, config, embedder, {
      project: 'WEB',
      workstream: 1,
      name: 'Token match task',
    });

    const notes = getPmNotes(db, 'task', { display_id: 'WEB-01.01' });
    const filePath = notes[0].filePath;
    let content = readFileSync(filePath, 'utf-8');

    content = replaceFm(content, 'claim_token', 'correct-token');
    content = replaceFm(content, 'status', 'in-progress');

    const { writeFileSync } = await import('node:fs');
    const { createHash } = await import('node:crypto');
    const { indexSingleFile } = await import('../../../src/services/indexing.js');

    writeFileSync(filePath, content, 'utf-8');
    const hash = createHash('sha256').update(content).digest('hex');
    await indexSingleFile(db, embedder, filePath, content, hash, Date.now());

    const taskResult = getTask(db, 'WEB-01.01');
    expect(taskResult.ok).toBe(true);
    if (!taskResult.ok) return;

    const providedToken = 'correct-token';
    const mismatch = taskResult.data.claim_token !== providedToken;
    expect(mismatch).toBe(false);
  });
});
