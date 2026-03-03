import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID, createHash } from 'node:crypto';
import { BrainDB } from '../../../src/services/brain-db.js';
import { tmpDbPath, createMockEmbedder } from '../../helpers.js';
import type { BrainConfig } from '../../../src/types.js';
import { createProject } from '../../../src/modules/pm/data/project-ops.js';
import { createWorkstream } from '../../../src/modules/pm/data/workstream-ops.js';
import { createTask, updateTaskStatus } from '../../../src/modules/pm/data/task-ops.js';
import { createDecision } from '../../../src/modules/pm/data/decision-ops.js';
import { writePrompt } from '../../../src/modules/pm/data/prompt-ops.js';
import { getPmNotes } from '../../../src/modules/pm/data/queries.js';
import {
  findOrphanedDecisions,
  findBrokenDependencies,
  findBlockedWithoutCause,
  findCancelledDependencies,
  findStalePrompts,
  computeDecisionPairs,
  computeTaskDecisionAlignment,
  computeSupersessionGaps,
  clusterSourceDocuments,
} from '../../../src/modules/pm/engine/consistency.js';
import { indexSingleFile } from '../../../src/services/indexing.js';

let db: BrainDB;
let notesDir: string;
let config: BrainConfig;
const embedder = createMockEmbedder();

async function seedProject(): Promise<void> {
  await createProject(db, config, embedder, { name: 'Check Test', prefix: 'CHK' });
  await createWorkstream(db, config, embedder, { project: 'CHK', name: 'Core' });
}

beforeEach(async () => {
  db = new BrainDB(tmpDbPath('pm-consistency'));
  db.setEmbeddingModel(embedder.model, embedder.dimensions);
  notesDir = join(tmpdir(), `pm-consistency-${randomUUID()}`);
  mkdirSync(notesDir, { recursive: true });
  config = { notesDir, dbPath: '', embedder: 'local', fusionWeights: { bm25: 0.3, vector: 0.7 } };
  await seedProject();
});

afterEach(() => {
  db.close();
  if (existsSync(notesDir)) rmSync(notesDir, { recursive: true, force: true });
});

describe('findOrphanedDecisions', () => {
  it('returns decisions with no impacts', async () => {
    await createTask(db, config, embedder, { project: 'CHK', workstream: 1, name: 'Task A' });
    await createDecision(db, config, embedder, {
      project: 'CHK',
      name: 'Orphan Decision',
      sourceTask: 'CHK-01.01',
      impacts: [],
      content: 'No impacts listed',
    });
    const result = findOrphanedDecisions(db, 'CHK');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('CHK-D01');
    expect(result[0].reason).toContain('No tasks listed');
  });

  it('excludes decisions with impacts', async () => {
    await createTask(db, config, embedder, { project: 'CHK', workstream: 1, name: 'Task A' });
    await createDecision(db, config, embedder, {
      project: 'CHK',
      name: 'Good Decision',
      sourceTask: 'CHK-01.01',
      impacts: ['CHK-01.01'],
      content: 'Has impacts',
    });
    const result = findOrphanedDecisions(db, 'CHK');
    expect(result).toHaveLength(0);
  });
});

describe('findBrokenDependencies', () => {
  it('returns empty when all dependencies exist', async () => {
    await createTask(db, config, embedder, { project: 'CHK', workstream: 1, name: 'Task A' });
    await createTask(db, config, embedder, {
      project: 'CHK',
      workstream: 1,
      name: 'Task B',
      dependsOn: ['CHK-01.01'],
    });
    const result = findBrokenDependencies(db, 'CHK');
    expect(result).toHaveLength(0);
  });

  it('detects dependencies referencing nonexistent tasks', async () => {
    await createTask(db, config, embedder, { project: 'CHK', workstream: 1, name: 'Task A' });
    // Manually patch metadata to include a broken dep (createTask validates deps)
    const taskNotes = getPmNotes(db, 'task', { project: 'CHK', display_id: 'CHK-01.01' });
    expect(taskNotes).toHaveLength(1);
    const note = taskNotes[0];
    const meta = JSON.parse(note.metadata!) as Record<string, unknown>;
    meta.depends_on = ['CHK-99.99'];
    db.upsertNote({ ...note, metadata: JSON.stringify(meta) });

    const result = findBrokenDependencies(db, 'CHK');
    expect(result).toHaveLength(1);
    expect(result[0].task).toBe('CHK-01.01');
    expect(result[0].dependsOn).toBe('CHK-99.99');
    expect(result[0].reason).toContain('does not exist');
  });
});

describe('findBlockedWithoutCause', () => {
  it('returns blocked tasks where all deps are done', async () => {
    const t1 = await createTask(db, config, embedder, {
      project: 'CHK',
      workstream: 1,
      name: 'Dep Task',
    });
    expect(t1.ok).toBe(true);
    const t2 = await createTask(db, config, embedder, {
      project: 'CHK',
      workstream: 1,
      name: 'Blocked Task',
      dependsOn: ['CHK-01.01'],
    });
    expect(t2.ok).toBe(true);
    // Complete the dep
    await updateTaskStatus(db, config, embedder, 'CHK-01.01', 'claimed');
    await updateTaskStatus(db, config, embedder, 'CHK-01.01', 'in-progress');
    await updateTaskStatus(db, config, embedder, 'CHK-01.01', 'done');
    // Block the dependent
    await updateTaskStatus(db, config, embedder, 'CHK-01.02', 'blocked');

    const result = findBlockedWithoutCause(db, 'CHK');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('CHK-01.02');
    expect(result[0].allDepsStatus).toContain('done');
  });
});

describe('findCancelledDependencies', () => {
  it('returns tasks depending on cancelled tasks', async () => {
    await createTask(db, config, embedder, { project: 'CHK', workstream: 1, name: 'Will Cancel' });
    await createTask(db, config, embedder, {
      project: 'CHK',
      workstream: 1,
      name: 'Depends On Cancelled',
      dependsOn: ['CHK-01.01'],
    });
    // Cancel the dependency
    await updateTaskStatus(db, config, embedder, 'CHK-01.01', 'cancelled');

    const result = findCancelledDependencies(db, 'CHK');
    expect(result).toHaveLength(1);
    expect(result[0].task).toBe('CHK-01.02');
    expect(result[0].dependsOnStatus).toBe('cancelled');
  });
});

describe('findStalePrompts', () => {
  it('returns prompts older than impacting decisions with decision details', async () => {
    await createTask(db, config, embedder, { project: 'CHK', workstream: 1, name: 'API Task' });
    // Write prompt first
    await writePrompt(db, config, embedder, {
      project: 'CHK',
      task: 'CHK-01.01',
      content: 'Build the API endpoint',
    });
    // Small delay to ensure different timestamps
    await new Promise((r) => setTimeout(r, 50));
    // Create decision that impacts the task (newer than prompt)
    await createDecision(db, config, embedder, {
      project: 'CHK',
      name: 'Use REST',
      sourceTask: 'CHK-01.01',
      impacts: ['CHK-01.01'],
      content: 'REST over GraphQL',
    });

    const result = findStalePrompts(db, 'CHK');
    expect(result).toHaveLength(1);
    expect(result[0].task).toBe('CHK-01.01');
    expect(result[0].newerDecisions).toHaveLength(1);
    expect(result[0].newerDecisions[0].id).toBe('CHK-D01');
  });

  it('returns empty when no stale prompts', async () => {
    await createTask(db, config, embedder, { project: 'CHK', workstream: 1, name: 'Task' });
    // Decision first, prompt after — prompt is not stale
    await createDecision(db, config, embedder, {
      project: 'CHK',
      name: 'Early Decision',
      sourceTask: 'CHK-01.01',
      impacts: ['CHK-01.01'],
      content: 'Decided early',
    });
    await new Promise((r) => setTimeout(r, 50));
    await writePrompt(db, config, embedder, {
      project: 'CHK',
      task: 'CHK-01.01',
      content: 'Written after decision',
    });

    const result = findStalePrompts(db, 'CHK');
    expect(result).toHaveLength(0);
  });
});

describe('computeDecisionPairs', () => {
  it('returns pairs of decisions sharing impact targets', async () => {
    await createTask(db, config, embedder, { project: 'CHK', workstream: 1, name: 'Shared Task' });
    await createDecision(db, config, embedder, {
      project: 'CHK',
      name: 'Use REST',
      sourceTask: 'CHK-01.01',
      impacts: ['CHK-01.01'],
      content: 'REST API design',
    });
    await createDecision(db, config, embedder, {
      project: 'CHK',
      name: 'Use GraphQL',
      sourceTask: 'CHK-01.01',
      impacts: ['CHK-01.01'],
      content: 'GraphQL API design',
    });

    const pairs = computeDecisionPairs(db, 'CHK');
    expect(pairs).toHaveLength(1);
    expect(pairs[0].sharedImpacts).toContain('CHK-01.01');
    expect(pairs[0].decision1.id).not.toBe(pairs[0].decision2.id);
  });

  it('returns empty when no overlapping impacts', async () => {
    await createTask(db, config, embedder, { project: 'CHK', workstream: 1, name: 'Task A' });
    await createTask(db, config, embedder, { project: 'CHK', workstream: 1, name: 'Task B' });
    await createDecision(db, config, embedder, {
      project: 'CHK',
      name: 'Dec A',
      sourceTask: 'CHK-01.01',
      impacts: ['CHK-01.01'],
      content: 'Only A',
    });
    await createDecision(db, config, embedder, {
      project: 'CHK',
      name: 'Dec B',
      sourceTask: 'CHK-01.02',
      impacts: ['CHK-01.02'],
      content: 'Only B',
    });

    const pairs = computeDecisionPairs(db, 'CHK');
    expect(pairs).toHaveLength(0);
  });
});

describe('computeTaskDecisionAlignment', () => {
  it('returns tasks with their impacting decisions', async () => {
    await createTask(db, config, embedder, { project: 'CHK', workstream: 1, name: 'API Task' });
    await createDecision(db, config, embedder, {
      project: 'CHK',
      name: 'Use REST',
      sourceTask: 'CHK-01.01',
      impacts: ['CHK-01.01'],
      content: 'REST design',
    });

    const alignments = computeTaskDecisionAlignment(db, 'CHK');
    const match = alignments.find((a) => a.task.id === 'CHK-01.01');
    expect(match).toBeDefined();
    expect(match!.decisions).toHaveLength(1);
    expect(match!.decisions[0].id).toBe('CHK-D01');
  });

  it('skips tasks with no impacting decisions', async () => {
    await createTask(db, config, embedder, { project: 'CHK', workstream: 1, name: 'No decisions' });
    const alignments = computeTaskDecisionAlignment(db, 'CHK');
    expect(alignments).toHaveLength(0);
  });
});

describe('computeSupersessionGaps', () => {
  it('returns decision pairs on same source task without supersession relation', async () => {
    await createTask(db, config, embedder, { project: 'CHK', workstream: 1, name: 'Task' });
    await createDecision(db, config, embedder, {
      project: 'CHK',
      name: 'Old approach',
      sourceTask: 'CHK-01.01',
      impacts: ['CHK-01.01'],
      content: 'Version 1',
    });
    await new Promise((r) => setTimeout(r, 50));
    await createDecision(db, config, embedder, {
      project: 'CHK',
      name: 'New approach',
      sourceTask: 'CHK-01.01',
      impacts: ['CHK-01.01'],
      content: 'Version 2',
    });

    const gaps = computeSupersessionGaps(db, 'CHK');
    expect(gaps).toHaveLength(1);
    expect(gaps[0].older.id).toBe('CHK-D01');
    expect(gaps[0].newer.id).toBe('CHK-D02');
    expect(gaps[0].reason).toContain('no supersession');
  });
});

describe('clusterSourceDocuments', () => {
  it('groups documents with similar titles', async () => {
    const doc1Path = join(notesDir, 'auth-design-v1.md');
    const doc1Content =
      '---\nid: auth-design-v1\ntitle: "Auth Design v1"\ntype: note\ntier: fast\nsource: google-docs\n---\n\nOriginal auth approach using JWT.';
    writeFileSync(doc1Path, doc1Content);
    const hash1 = createHash('sha256').update(doc1Content).digest('hex');
    await indexSingleFile(db, embedder, doc1Path, doc1Content, hash1, Date.now() - 100000);

    const doc2Path = join(notesDir, 'auth-design-v2.md');
    const doc2Content =
      '---\nid: auth-design-v2\ntitle: "Auth Design v2"\ntype: note\ntier: fast\nsource: google-docs\n---\n\nRevised auth approach using sessions.';
    writeFileSync(doc2Path, doc2Content);
    const hash2 = createHash('sha256').update(doc2Content).digest('hex');
    await indexSingleFile(db, embedder, doc2Path, doc2Content, hash2, Date.now());

    const clusters = clusterSourceDocuments(db);
    const authCluster = clusters.find((c) => c.topic.toLowerCase().includes('auth'));
    expect(authCluster).toBeDefined();
    expect(authCluster!.documents).toHaveLength(2);
    expect(authCluster!.documents[0].title).toContain('v2');
  });

  it('returns empty when no source documents cluster', () => {
    const clusters = clusterSourceDocuments(db);
    expect(clusters).toHaveLength(0);
  });

  it('excludes PM module notes from clustering', async () => {
    await createTask(db, config, embedder, { project: 'CHK', workstream: 1, name: 'Task A' });
    await createTask(db, config, embedder, { project: 'CHK', workstream: 1, name: 'Task B' });

    const clusters = clusterSourceDocuments(db);
    expect(clusters).toHaveLength(0);
  });

  it('only returns clusters with 2+ documents', async () => {
    const docPath = join(notesDir, 'solo-doc.md');
    const docContent =
      '---\nid: solo-doc\ntitle: "Solo Document"\ntype: note\ntier: fast\n---\n\nA single document with no siblings.';
    writeFileSync(docPath, docContent);
    const hash = createHash('sha256').update(docContent).digest('hex');
    await indexSingleFile(db, embedder, docPath, docContent, hash, Date.now());

    const clusters = clusterSourceDocuments(db);
    expect(clusters).toHaveLength(0);
  });
});
