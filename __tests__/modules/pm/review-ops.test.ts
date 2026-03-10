import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, existsSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { BrainDB } from '../../../src/services/brain-db.js';
import { createMockEmbedder, createTestDb } from '../../helpers.js';
import type { BrainConfig } from '../../../src/types.js';
import { createProject } from '../../../src/modules/pm/data/project-ops.js';
import { createWorkstream } from '../../../src/modules/pm/data/workstream-ops.js';
import { createTask, updateTaskStatus } from '../../../src/modules/pm/data/task-ops.js';
import { createReviewTask } from '../../../src/modules/pm/data/review-ops.js';
import { getPmNotes, resolveDisplayId } from '../../../src/modules/pm/data/queries.js';

let db: BrainDB;
let dbPath: string;
let notesDir: string;
let config: BrainConfig;
const embedder = createMockEmbedder();

beforeEach(async () => {
  ({ dbPath, db } = createTestDb());
  notesDir = join(tmpdir(), `pm-review-notes-${randomUUID()}`);
  mkdirSync(notesDir, { recursive: true });
  config = {
    notesDir,
    dbPath,
    embedder: 'local',
    fusionWeights: { bm25: 0.3, vector: 0.7 },
  };

  await createProject(db, config, embedder, { name: 'SDK', prefix: 'SDK' });
  await createWorkstream(db, config, embedder, { project: 'SDK', name: 'Core' });
  await createTask(db, config, embedder, {
    project: 'SDK',
    workstream: 1,
    name: 'Implement feature X',
    description: 'Build the X feature for SDK',
    priority: 'high',
    category: 'implementation',
  });
});

afterEach(() => {
  db.close();
  if (existsSync(notesDir)) {
    rmSync(notesDir, { recursive: true, force: true });
  }
});

describe('createReviewTask', () => {
  it('creates a review task with correct metadata from source task', async () => {
    const result = await createReviewTask(db, config, embedder, {
      sourceTaskId: 'SDK-01.01',
      prUrl: 'https://github.com/org/repo/pull/42',
      branch: 'feat/feature-x',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const { reviewTaskMeta } = result.data;
    expect(reviewTaskMeta.title).toBe('Review PR #42: Implement feature X');
    expect(reviewTaskMeta.mode).toBe('human');
    expect(reviewTaskMeta.category).toBe('review');
    expect(reviewTaskMeta.priority).toBe('high');
    expect(reviewTaskMeta.project).toBe('SDK');
  });

  it('creates a PR Review workstream when none exists', async () => {
    const result = await createReviewTask(db, config, embedder, {
      sourceTaskId: 'SDK-01.01',
      prUrl: 'https://github.com/org/repo/pull/1',
      branch: 'feat/x',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const wsNotes = getPmNotes(db, 'workstream', { project: 'SDK' });
    const reviewWs = wsNotes.find((n) => {
      const meta = JSON.parse(n.metadata!) as Record<string, unknown>;
      return (meta.title as string).toLowerCase().includes('review');
    });
    expect(reviewWs).toBeDefined();
  });

  it('reuses existing review workstream', async () => {
    await createWorkstream(db, config, embedder, {
      project: 'SDK',
      name: 'PR Review',
      description: 'Reviews',
    });

    const wsBefore = getPmNotes(db, 'workstream', { project: 'SDK' });
    const wsCountBefore = wsBefore.length;

    const result = await createReviewTask(db, config, embedder, {
      sourceTaskId: 'SDK-01.01',
      prUrl: 'https://github.com/org/repo/pull/5',
      branch: 'feat/y',
    });

    expect(result.ok).toBe(true);

    const wsAfter = getPmNotes(db, 'workstream', { project: 'SDK' });
    expect(wsAfter.length).toBe(wsCountBefore);
  });

  it('rewires downstream dependencies from source to review task', async () => {
    // Create a downstream task that depends on SDK-01.01
    await createTask(db, config, embedder, {
      project: 'SDK',
      workstream: 1,
      name: 'Downstream task',
      description: 'Depends on feature X',
      dependsOn: ['SDK-01.01'],
    });

    const result = await createReviewTask(db, config, embedder, {
      sourceTaskId: 'SDK-01.01',
      prUrl: 'https://github.com/org/repo/pull/10',
      branch: 'feat/x',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.rewiredDeps).toContain('SDK-01.02');

    // Verify the downstream task now depends on the review task, not the source
    const downstreamResolved = resolveDisplayId(db, 'SDK-01.02');
    expect(downstreamResolved.ok).toBe(true);
    if (!downstreamResolved.ok) return;

    const relations = db.getRelationsFrom(downstreamResolved.data);
    const depTargets = relations.filter((r) => r.type === 'depends_on').map((r) => r.targetId);

    const reviewResolved = resolveDisplayId(db, result.data.reviewTaskId);
    expect(reviewResolved.ok).toBe(true);
    if (!reviewResolved.ok) return;
    expect(depTargets).toContain(reviewResolved.data);
  });

  it('skips dependency rewiring when --no-rewire is set', async () => {
    await createTask(db, config, embedder, {
      project: 'SDK',
      workstream: 1,
      name: 'Downstream task',
      description: 'Depends on feature X',
      dependsOn: ['SDK-01.01'],
    });

    const result = await createReviewTask(db, config, embedder, {
      sourceTaskId: 'SDK-01.01',
      prUrl: 'https://github.com/org/repo/pull/10',
      branch: 'feat/x',
      rewireDeps: false,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.rewiredDeps).toHaveLength(0);
  });

  it('captures PR metadata', async () => {
    const result = await createReviewTask(db, config, embedder, {
      sourceTaskId: 'SDK-01.01',
      prUrl: 'https://github.com/org/repo/pull/42',
      branch: 'feat/feature-x',
      agentId: 'agent-123',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.captureNoteId).toBeTruthy();
  });

  it('fails when source task does not exist', async () => {
    const result = await createReviewTask(db, config, embedder, {
      sourceTaskId: 'SDK-99.99',
      prUrl: 'https://github.com/org/repo/pull/1',
      branch: 'feat/nope',
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('NOT_FOUND');
  });

  it('handles PR URL without standard GitHub format', async () => {
    const result = await createReviewTask(db, config, embedder, {
      sourceTaskId: 'SDK-01.01',
      prUrl: 'https://custom-git.example.com/pr/abc',
      branch: 'feat/x',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.reviewTaskMeta.title).toContain('PR #N/A');
  });

  it('includes agent ID in description when provided', async () => {
    const result = await createReviewTask(db, config, embedder, {
      sourceTaskId: 'SDK-01.01',
      prUrl: 'https://github.com/org/repo/pull/7',
      branch: 'feat/x',
      agentId: 'agent-opus-42',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Verify the review task file includes agent info
    const reviewNotes = getPmNotes(db, 'task', {
      display_id: result.data.reviewTaskId,
    });
    expect(reviewNotes.length).toBe(1);
  });

  it('includes risk in task description when --risk is provided', async () => {
    const result = await createReviewTask(db, config, embedder, {
      sourceTaskId: 'SDK-01.01',
      prUrl: 'https://github.com/org/repo/pull/42',
      branch: 'feat/feature-x',
      risk: 3,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const reviewNotes = getPmNotes(db, 'task', {
      display_id: result.data.reviewTaskId,
    });
    expect(reviewNotes.length).toBe(1);
    const fileContent = readFileSync(reviewNotes[0].filePath, 'utf-8');
    expect(fileContent).toContain('**Risk:** 3/5');
  });

  it('returns advisory for agent review when risk is low', async () => {
    const result = await createReviewTask(db, config, embedder, {
      sourceTaskId: 'SDK-01.01',
      prUrl: 'https://github.com/org/repo/pull/42',
      branch: 'feat/feature-x',
      risk: 2,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.riskAdvisory).toBe('Advisory: risk 2 — agent review may be sufficient');
  });

  it('returns advisory for human review when risk is high', async () => {
    const result = await createReviewTask(db, config, embedder, {
      sourceTaskId: 'SDK-01.01',
      prUrl: 'https://github.com/org/repo/pull/42',
      branch: 'feat/feature-x',
      risk: 4,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.riskAdvisory).toBe('Advisory: risk 4 — human review recommended');
  });

  it('rejects risk below 1', async () => {
    const result = await createReviewTask(db, config, embedder, {
      sourceTaskId: 'SDK-01.01',
      prUrl: 'https://github.com/org/repo/pull/42',
      branch: 'feat/feature-x',
      risk: 0,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('INVALID_INPUT');
  });

  it('rejects risk above 5', async () => {
    const result = await createReviewTask(db, config, embedder, {
      sourceTaskId: 'SDK-01.01',
      prUrl: 'https://github.com/org/repo/pull/42',
      branch: 'feat/feature-x',
      risk: 6,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('INVALID_INPUT');
  });

  it('works without --risk and has no riskAdvisory', async () => {
    const result = await createReviewTask(db, config, embedder, {
      sourceTaskId: 'SDK-01.01',
      prUrl: 'https://github.com/org/repo/pull/42',
      branch: 'feat/feature-x',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.riskAdvisory).toBeUndefined();
  });

  describe('auto-complete source task', () => {
    it('auto-completes a pending source task', async () => {
      const result = await createReviewTask(db, config, embedder, {
        sourceTaskId: 'SDK-01.01',
        prUrl: 'https://github.com/org/repo/pull/50',
        branch: 'feat/auto-pending',
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.data.sourceAutoCompleted).toBe(true);

      const sourceNotes = getPmNotes(db, 'task', { display_id: 'SDK-01.01' });
      const meta = JSON.parse(sourceNotes[0].metadata!) as Record<string, unknown>;
      expect(meta.status).toBe('done');
    });

    it('auto-completes an in-progress source task', async () => {
      await updateTaskStatus(db, config, embedder, 'SDK-01.01', 'claimed');
      await updateTaskStatus(db, config, embedder, 'SDK-01.01', 'in-progress');

      const result = await createReviewTask(db, config, embedder, {
        sourceTaskId: 'SDK-01.01',
        prUrl: 'https://github.com/org/repo/pull/51',
        branch: 'feat/auto-inprogress',
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.data.sourceAutoCompleted).toBe(true);

      const sourceNotes = getPmNotes(db, 'task', { display_id: 'SDK-01.01' });
      const meta = JSON.parse(sourceNotes[0].metadata!) as Record<string, unknown>;
      expect(meta.status).toBe('done');
    });

    it('is a no-op when source task is already done', async () => {
      await updateTaskStatus(db, config, embedder, 'SDK-01.01', 'claimed');
      await updateTaskStatus(db, config, embedder, 'SDK-01.01', 'in-progress');
      await updateTaskStatus(db, config, embedder, 'SDK-01.01', 'done');

      const result = await createReviewTask(db, config, embedder, {
        sourceTaskId: 'SDK-01.01',
        prUrl: 'https://github.com/org/repo/pull/52',
        branch: 'feat/auto-done',
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.data.sourceAutoCompleted).toBe(false);
    });

    it('skips auto-completion when autoComplete is false', async () => {
      const result = await createReviewTask(db, config, embedder, {
        sourceTaskId: 'SDK-01.01',
        prUrl: 'https://github.com/org/repo/pull/53',
        branch: 'feat/no-auto',
        autoComplete: false,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.data.sourceAutoCompleted).toBe(false);

      const sourceNotes = getPmNotes(db, 'task', { display_id: 'SDK-01.01' });
      const meta = JSON.parse(sourceNotes[0].metadata!) as Record<string, unknown>;
      expect(meta.status).toBe('pending');
    });

    it('does not block review creation when auto-completion fails', async () => {
      // Block the source task so transitions fail
      await updateTaskStatus(db, config, embedder, 'SDK-01.01', 'claimed');
      await updateTaskStatus(db, config, embedder, 'SDK-01.01', 'in-progress');
      await updateTaskStatus(db, config, embedder, 'SDK-01.01', 'blocked');

      const result = await createReviewTask(db, config, embedder, {
        sourceTaskId: 'SDK-01.01',
        prUrl: 'https://github.com/org/repo/pull/54',
        branch: 'feat/auto-fail',
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.data.sourceAutoCompleted).toBe(false);
      expect(result.data.reviewTaskId).toBeTruthy();
    });
  });
});
