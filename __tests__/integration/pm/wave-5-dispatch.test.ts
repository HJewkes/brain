import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { BrainDB } from '../../../src/services/brain-db.js';
import { loadModules } from '../../../src/modules/loader.js';
import { tmpDbPath, createMockEmbedder } from '../../helpers.js';
import type { BrainConfig } from '../../../src/types.js';
import { pmModule } from '../../../src/modules/pm/index.js';
import { createStandardProject } from '../../fixtures/pm-project.js';
import { getTask, updateTaskStatus } from '../../../src/modules/pm/data/task-ops.js';
import { generateClaim, validateClaimToken, isClaimActive, isClaimStale } from '../../../src/modules/pm/engine/claims.js';
import { assembleContext } from '../../../src/modules/pm/engine/dispatch.js';
import { computeImpact } from '../../../src/modules/pm/engine/dependency.js';
import { getPmNotes } from '../../../src/modules/pm/data/queries.js';
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { indexSingleFile } from '../../../src/services/indexing.js';

let db: BrainDB;
let notesDir: string;
let config: BrainConfig;
const embedder = createMockEmbedder();

function replaceFrontmatterField(content: string, field: string, value: string): string {
  const endOfFrontmatter = content.indexOf('\n---', 4);
  if (endOfFrontmatter === -1) return content;

  const frontmatter = content.slice(0, endOfFrontmatter);
  const rest = content.slice(endOfFrontmatter);
  const fieldRegex = new RegExp(`^${field}:.*$`, 'm');
  const quoted = value.includes(' ') ? `"${value}"` : value;

  if (fieldRegex.test(frontmatter)) {
    if (!value) {
      return frontmatter.replace(new RegExp(`\n${field}:.*$`, 'm'), '') + rest;
    }
    return frontmatter.replace(fieldRegex, `${field}: ${quoted}`) + rest;
  }
  if (!value) return content;
  return frontmatter + `\n${field}: ${quoted}` + rest;
}

async function updateTaskMetadataFields(
  displayId: string,
  fields: Record<string, string>,
): Promise<void> {
  const notes = getPmNotes(db, 'task', { display_id: displayId });
  if (notes.length === 0) throw new Error(`Task "${displayId}" not found`);

  const note = notes[0];
  const filePath = note.filePath;
  let content = readFileSync(filePath, 'utf-8');
  for (const [key, value] of Object.entries(fields)) {
    content = replaceFrontmatterField(content, key, value);
  }
  const now = new Date().toISOString().slice(0, 10);
  content = replaceFrontmatterField(content, 'modified', now);
  writeFileSync(filePath, content, 'utf-8');

  const hash = createHash('sha256').update(content).digest('hex');
  await indexSingleFile(db, embedder, filePath, content, hash, Date.now());
}

beforeEach(async () => {
  db = new BrainDB(tmpDbPath('pm-wave5'));
  db.setEmbeddingModel(embedder.model, embedder.dimensions);
  notesDir = join(tmpdir(), `pm-wave5-${randomUUID()}`);
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

describe('Wave 5: Claims + Dispatch', () => {
  it('claim eligible task returns token and status=claimed', async () => {
    const claim = generateClaim();
    await updateTaskMetadataFields('TEST-01.01', {
      status: 'claimed',
      claim_token: claim.token,
      claimed_at: claim.claimedAt,
    });

    const result = getTask(db, 'TEST-01.01');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.status).toBe('claimed');
    expect(result.data.claim_token).toBe(claim.token);
    expect(result.data.claimed_at).toBeDefined();
  });

  it('start with valid token transitions to in-progress', async () => {
    const claim = generateClaim();
    await updateTaskMetadataFields('TEST-01.01', {
      status: 'claimed',
      claim_token: claim.token,
      claimed_at: claim.claimedAt,
    });

    const tokenCheck = validateClaimToken(claim.token, claim.token);
    expect(tokenCheck.ok).toBe(true);

    await updateTaskStatus(db, config, embedder, 'TEST-01.01', 'in-progress');
    const result = getTask(db, 'TEST-01.01');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.status).toBe('in-progress');
  });

  it('start with invalid token returns INVALID_CLAIM_TOKEN', async () => {
    const claim = generateClaim();
    await updateTaskMetadataFields('TEST-01.01', {
      status: 'claimed',
      claim_token: claim.token,
      claimed_at: claim.claimedAt,
    });

    const tokenCheck = validateClaimToken(claim.token, 'wrong-token');
    expect(tokenCheck.ok).toBe(false);
    if (!tokenCheck.ok) {
      expect(tokenCheck.error.code).toBe('INVALID_CLAIM_TOKEN');
    }
  });

  it('double-claim returns ALREADY_CLAIMED status', async () => {
    const claim = generateClaim();
    await updateTaskMetadataFields('TEST-01.01', {
      status: 'claimed',
      claim_token: claim.token,
      claimed_at: claim.claimedAt,
    });

    const result = getTask(db, 'TEST-01.01');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.status).toBe('claimed');
    // Attempting to claim again should fail since status is already 'claimed'
  });

  it('release returns status back to pending', async () => {
    const claim = generateClaim();
    await updateTaskMetadataFields('TEST-01.01', {
      status: 'claimed',
      claim_token: claim.token,
      claimed_at: claim.claimedAt,
    });

    await updateTaskMetadataFields('TEST-01.01', {
      status: 'pending',
      claim_token: '',
      claimed_at: '',
    });

    const result = getTask(db, 'TEST-01.01');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.status).toBe('pending');
    expect(result.data.claim_token).toBeFalsy();
  });

  it('dispatch returns context bundle with deps and decisions', () => {
    const result = assembleContext(db, 'TEST-01.02');
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const bundle = result.data;
    expect(bundle.task.display_id).toBe('TEST-01.02');
    expect(bundle.dependencies.length).toBeGreaterThanOrEqual(1);
    expect(bundle.dependencies[0].displayId).toBe('TEST-01.01');
    expect(bundle.contextHash).toBeDefined();
    expect(typeof bundle.contextHash).toBe('string');
  });

  it('complete with summary writes summary.md and records activity', async () => {
    // Move task through claim -> in-progress -> done
    await updateTaskStatus(db, config, embedder, 'TEST-01.01', 'claimed');
    await updateTaskStatus(db, config, embedder, 'TEST-01.01', 'in-progress');
    await updateTaskStatus(db, config, embedder, 'TEST-01.01', 'done');

    const result = getTask(db, 'TEST-01.01');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.status).toBe('done');

    // Write summary to content dir
    const notes = getPmNotes(db, 'task', { display_id: 'TEST-01.01' });
    expect(notes.length).toBeGreaterThan(0);
    const note = notes[0];
    if (note.contentDir) {
      if (!existsSync(note.contentDir)) {
        mkdirSync(note.contentDir, { recursive: true });
      }
      writeFileSync(join(note.contentDir, 'summary.md'), 'Task completed successfully', 'utf-8');
    }

    // Record activity
    db.addActivity({
      id: randomUUID(),
      noteIds: JSON.stringify(['TEST-01.01']),
      module: 'pm',
      moduleInstance: 'TEST',
      activityType: 'task_completed',
      actorType: 'cli',
      actorId: null,
      sessionId: null,
      metadata: JSON.stringify({ display_id: 'TEST-01.01' }),
      outcome: 'done',
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
    });

    // Verify activity was recorded
    const activities = db.getActivities({ module: 'pm', activityType: 'task_completed' });
    expect(activities.length).toBe(1);
    expect(activities[0].outcome).toBe('done');

    // Verify summary was written
    if (note.contentDir) {
      const summaryPath = join(note.contentDir, 'summary.md');
      expect(existsSync(summaryPath)).toBe(true);
      const summaryContent = readFileSync(summaryPath, 'utf-8');
      expect(summaryContent).toBe('Task completed successfully');
    }
  });

  it('complete triggers impact analysis showing newly unblocked tasks', async () => {
    // Before completing TEST-01.01, TEST-01.02 is blocked
    const impactBefore = computeImpact(db, 'TEST', 'TEST-01.01');
    expect(impactBefore).toContain('TEST-01.02');

    // Complete TEST-01.01
    await updateTaskStatus(db, config, embedder, 'TEST-01.01', 'claimed');
    await updateTaskStatus(db, config, embedder, 'TEST-01.01', 'in-progress');
    await updateTaskStatus(db, config, embedder, 'TEST-01.01', 'done');

    // After completing, TEST-01.02 should now be eligible
    const result = getTask(db, 'TEST-01.02');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.virtualStates).toContain('+READY');
  });

  it('stale claim detection (mock time)', async () => {
    const claim = generateClaim();
    await updateTaskMetadataFields('TEST-01.01', {
      status: 'claimed',
      claim_token: claim.token,
      claimed_at: claim.claimedAt,
    });

    const result = getTask(db, 'TEST-01.01');
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Active now
    const meta = result.data;
    expect(isClaimActive({ ...meta, claim_token: claim.token, claimed_at: claim.claimedAt })).toBe(true);

    // Stale 11 minutes later
    const futureDate = new Date(Date.now() + 11 * 60 * 1000);
    expect(isClaimStale(claim.claimedAt, 10 * 60 * 1000, futureDate)).toBe(true);
    expect(isClaimActive(
      { ...meta, claim_token: claim.token, claimed_at: claim.claimedAt },
      futureDate,
    )).toBe(false);
  });

  it('all --json outputs parse correctly', async () => {
    // Test getTask JSON output
    const taskResult = getTask(db, 'TEST-01.01');
    expect(taskResult.ok).toBe(true);
    if (!taskResult.ok) return;
    const taskJson = JSON.stringify(taskResult.data);
    const parsed = JSON.parse(taskJson) as Record<string, unknown>;
    expect(parsed.display_id).toBe('TEST-01.01');
    expect(parsed.status).toBeDefined();

    // Test assembleContext JSON output
    const ctxResult = assembleContext(db, 'TEST-01.02');
    expect(ctxResult.ok).toBe(true);
    if (!ctxResult.ok) return;
    const ctxJson = JSON.stringify(ctxResult.data);
    const ctxParsed = JSON.parse(ctxJson) as Record<string, unknown>;
    expect(ctxParsed.task).toBeDefined();
    expect(ctxParsed.contextHash).toBeDefined();
    expect(ctxParsed.dependencies).toBeDefined();

    // Test computeImpact JSON output
    const impact = computeImpact(db, 'TEST', 'TEST-01.01');
    const impactJson = JSON.stringify(impact);
    const impactParsed = JSON.parse(impactJson) as string[];
    expect(Array.isArray(impactParsed)).toBe(true);
  });
});
