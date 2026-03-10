import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { BrainDB } from '../../../src/services/brain-db.js';
import { makeNote, createMockEmbedder, createTestDb } from '../../helpers.js';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { assembleDispatch } from '../../../src/modules/pm/engine/dispatch.js';
import { computeGraphScores } from '../../../src/services/graph.js';
import type { BrainConfig } from '../../../src/types.js';

let db: BrainDB;
let tempDir: string;
const embedder = createMockEmbedder();

function taskMeta(displayId: string, project: string, overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    display_id: displayId,
    project,
    workstream: 1,
    number: parseInt(displayId.split('.').pop()!, 10) || 1,
    title: overrides.title ?? displayId,
    status: 'pending',
    mode: 'auto',
    category: 'implementation',
    priority: 'medium',
    ...overrides,
  });
}

function makeTaskFile(dir: string, displayId: string, title: string): string {
  const filePath = join(dir, `${displayId}.md`);
  writeFileSync(
    filePath,
    `---\ntitle: ${title}\n---\n\n# ${title}\n\nTask body for ${displayId}\n`
  );
  return filePath;
}

beforeEach(() => {
  ({ db } = createTestDb());
  tempDir = join(tmpdir(), `brain-hybrid-${randomUUID()}`);
  mkdirSync(tempDir, { recursive: true });
});

afterEach(() => {
  db.close();
  try {
    rmSync(tempDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

describe('computeGraphScores', () => {
  test('returns empty map when root has no relations', () => {
    const note = makeNote({ id: 'root', title: 'Root' });
    db.upsertNote(note);
    const scores = computeGraphScores(db, 'root', 3);
    expect(scores.size).toBe(0);
  });

  test('scores depth-1 neighbor at 0.5', () => {
    const root = makeNote({ id: 'root', title: 'Root' });
    const neighbor = makeNote({ id: 'neighbor', title: 'Neighbor' });
    db.upsertNote(root);
    db.upsertNote(neighbor);
    db.upsertRelations('root', [{ sourceId: 'root', targetId: 'neighbor', type: 'depends_on' }]);

    const scores = computeGraphScores(db, 'root', 3);
    expect(scores.has('neighbor')).toBe(true);
    expect(scores.get('neighbor')!.score).toBeCloseTo(0.5);
    expect(scores.get('neighbor')!.depth).toBe(1);
  });

  test('scores depth-2 neighbor at 0.25', () => {
    const root = makeNote({ id: 'root', title: 'Root' });
    const mid = makeNote({ id: 'mid', title: 'Mid' });
    const far = makeNote({ id: 'far', title: 'Far' });
    db.upsertNote(root);
    db.upsertNote(mid);
    db.upsertNote(far);
    db.upsertRelations('root', [{ sourceId: 'root', targetId: 'mid', type: 'depends_on' }]);
    db.upsertRelations('mid', [{ sourceId: 'mid', targetId: 'far', type: 'depends_on' }]);

    const scores = computeGraphScores(db, 'root', 3);
    expect(scores.get('far')!.score).toBeCloseTo(0.25);
    expect(scores.get('far')!.depth).toBe(2);
  });

  test('excludes root from results', () => {
    const root = makeNote({ id: 'root', title: 'Root' });
    const other = makeNote({ id: 'other', title: 'Other' });
    db.upsertNote(root);
    db.upsertNote(other);
    db.upsertRelations('root', [{ sourceId: 'root', targetId: 'other', type: 'related' }]);

    const scores = computeGraphScores(db, 'root', 3);
    expect(scores.has('root')).toBe(false);
  });
});

describe('hybrid context assembly', () => {
  test('assembleDispatch returns relatedNotes array', async () => {
    const filePath = makeTaskFile(tempDir, 'TST-01.01', 'Build login');
    const note = makeNote({
      id: 'task-1',
      filePath,
      title: 'Build login',
      type: 'task',
      module: 'pm',
      metadata: taskMeta('TST-01.01', 'TST', { title: 'Build login' }),
    });
    db.upsertNote(note);

    // Need a workstream note for assembleContext
    const wsNote = makeNote({
      id: 'ws-1',
      title: 'Core',
      type: 'workstream',
      module: 'pm',
      metadata: JSON.stringify({
        display_id: 'TST-01',
        project: 'TST',
        number: 1,
        title: 'Core',
        status: 'active',
      }),
    });
    db.upsertNote(wsNote);

    const config: BrainConfig = {
      notesDir: tempDir,
      dbPath: '',
      embedder: 'local',
      fusionWeights: { bm25: 0.3, vector: 0.7 },
    };

    const result = await assembleDispatch(db, embedder, config, 'TST-01.01');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.relatedNotes).toBeDefined();
    expect(Array.isArray(result.data.relatedNotes)).toBe(true);
  });

  test('related notes from graph links have source label', async () => {
    const filePath1 = makeTaskFile(tempDir, 'TST-01.01', 'First task');
    const filePath2 = makeTaskFile(tempDir, 'TST-01.02', 'Second task');
    const note1 = makeNote({
      id: 'task-1',
      filePath: filePath1,
      title: 'First task',
      type: 'task',
      module: 'pm',
      metadata: taskMeta('TST-01.01', 'TST', { title: 'First task' }),
    });
    const note2 = makeNote({
      id: 'task-2',
      filePath: filePath2,
      title: 'Second task',
      type: 'task',
      module: 'pm',
      metadata: taskMeta('TST-01.02', 'TST', { title: 'Second task', depends_on: ['TST-01.01'] }),
    });
    db.upsertNote(note1);
    db.upsertNote(note2);
    db.upsertRelations('task-2', [{ sourceId: 'task-2', targetId: 'task-1', type: 'depends_on' }]);

    const wsNote = makeNote({
      id: 'ws-1',
      title: 'Core',
      type: 'workstream',
      module: 'pm',
      metadata: JSON.stringify({
        display_id: 'TST-01',
        project: 'TST',
        number: 1,
        title: 'Core',
        status: 'active',
      }),
    });
    db.upsertNote(wsNote);

    const config: BrainConfig = {
      notesDir: tempDir,
      dbPath: '',
      embedder: 'local',
      fusionWeights: { bm25: 0.3, vector: 0.7 },
    };

    const result = await assembleDispatch(db, embedder, config, 'TST-01.01');
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const graphNotes = result.data.relatedNotes.filter(
      (n) => n.source === 'graph' || n.source === 'linked'
    );
    expect(graphNotes.length).toBeGreaterThanOrEqual(1);
    const task2Related = graphNotes.find((n) => n.title === 'Second task');
    expect(task2Related).toBeDefined();
    expect(task2Related!.source).toMatch(/^(graph|linked)$/);
  });

  test('O-151: related notes exclude self', async () => {
    const filePath = makeTaskFile(tempDir, 'TST-01.01', 'Self test');
    const note = makeNote({
      id: 'task-self',
      filePath,
      title: 'Self test',
      type: 'task',
      module: 'pm',
      metadata: taskMeta('TST-01.01', 'TST', { title: 'Self test' }),
    });
    db.upsertNote(note);

    const wsNote = makeNote({
      id: 'ws-1',
      title: 'Core',
      type: 'workstream',
      module: 'pm',
      metadata: JSON.stringify({
        display_id: 'TST-01',
        project: 'TST',
        number: 1,
        title: 'Core',
        status: 'active',
      }),
    });
    db.upsertNote(wsNote);

    const config: BrainConfig = {
      notesDir: tempDir,
      dbPath: '',
      embedder: 'local',
      fusionWeights: { bm25: 0.3, vector: 0.7 },
    };

    const result = await assembleDispatch(db, embedder, config, 'TST-01.01');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const self = result.data.relatedNotes.find((n) => n.title === 'Self test');
    expect(self).toBeUndefined();
  });

  test('hybrid fusion combines graph and semantic sources', async () => {
    const filePath1 = makeTaskFile(tempDir, 'TST-01.01', 'Main task');
    const filePath2 = makeTaskFile(tempDir, 'TST-01.02', 'Linked task');
    const note1 = makeNote({
      id: 'task-main',
      filePath: filePath1,
      title: 'Main task',
      type: 'task',
      module: 'pm',
      metadata: taskMeta('TST-01.01', 'TST', { title: 'Main task' }),
    });
    const note2 = makeNote({
      id: 'task-linked',
      filePath: filePath2,
      title: 'Linked task',
      type: 'task',
      module: 'pm',
      metadata: taskMeta('TST-01.02', 'TST', { title: 'Linked task' }),
    });
    db.upsertNote(note1);
    db.upsertNote(note2);
    db.upsertRelations('task-main', [
      { sourceId: 'task-main', targetId: 'task-linked', type: 'depends_on' },
    ]);

    const wsNote = makeNote({
      id: 'ws-1',
      title: 'Core',
      type: 'workstream',
      module: 'pm',
      metadata: JSON.stringify({
        display_id: 'TST-01',
        project: 'TST',
        number: 1,
        title: 'Core',
        status: 'active',
      }),
    });
    db.upsertNote(wsNote);

    const config: BrainConfig = {
      notesDir: tempDir,
      dbPath: '',
      embedder: 'local',
      fusionWeights: { bm25: 0.3, vector: 0.7 },
    };

    const result = await assembleDispatch(db, embedder, config, 'TST-01.01');
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // The linked task should appear from graph traversal
    const linked = result.data.relatedNotes.find((n) => n.title === 'Linked task');
    expect(linked).toBeDefined();
    // Graph-only score at depth 1: 0.6 * 0.5 = 0.3
    expect(linked!.score).toBeGreaterThan(0);
  });
});
