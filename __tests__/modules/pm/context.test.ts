import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { BrainDB } from '../../../src/services/brain-db.js';
import { tmpDbPath, makeNote } from '../../helpers.js';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import {
  assembleDispatch,
  assembleContext,
  type ContextBundle,
} from '../../../src/modules/pm/engine/dispatch.js';

let db: BrainDB;
let dbPath: string;
let tempDir: string;

function taskMeta(displayId: string, project: string, overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    display_id: displayId,
    project,
    workstream: 1,
    number: parseInt(displayId.split('.').pop()!, 10) || 1,
    status: 'pending',
    mode: 'auto',
    category: 'implementation',
    priority: 'medium',
    title: overrides.title ?? 'Test Task',
    ...overrides,
  });
}

beforeEach(() => {
  dbPath = tmpDbPath('pm-context-semantic');
  db = new BrainDB(dbPath);
  tempDir = join(tmpdir(), `brain-context-${randomUUID()}`);
  mkdirSync(tempDir, { recursive: true });
});

afterEach(() => {
  db.close();
  rmSync(tempDir, { recursive: true, force: true });
});

describe('O-123: context semantic fallback', () => {
  test('relatedNotes include source field when populated by assembleDispatch', async () => {
    const filePath = join(tempDir, 'TST-01.01.md');
    writeFileSync(
      filePath,
      [
        '---',
        'title: "Setup CI"',
        'type: task',
        'module: pm',
        '---',
        '',
        '# Setup CI',
        '',
        'Configure GitHub Actions for continuous integration.',
      ].join('\n')
    );

    db.upsertNote({
      ...makeNote({ id: 'task-001' }),
      filePath,
      title: 'Setup CI',
      type: 'task',
      module: 'pm',
      metadata: taskMeta('TST-01.01', 'TST', { title: 'Setup CI' }),
    });

    const mockEmbedder = {
      embed: vi.fn().mockResolvedValue(new Float32Array(384)),
      dimensions: 384,
    };

    const config = { fusionWeights: { bm25: 0.4, vector: 0.6 } } as never;

    const result = await assembleDispatch(db, mockEmbedder, config, 'TST-01.01');
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // relatedNotes items should all have a source field
    for (const note of result.data.relatedNotes) {
      expect(note.source).toBe('semantic');
    }
  });

  test('assembleContext returns empty relatedNotes for task with no graph edges', () => {
    db.upsertNote(
      makeNote({
        id: 'task-isolated',
        title: 'Isolated Task',
        module: 'pm',
        type: 'task',
        metadata: taskMeta('TST-01.01', 'TST', { title: 'Isolated Task' }),
      })
    );

    const result = assembleContext(db, 'TST-01.01');
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.relatedNotes).toEqual([]);
    expect(result.data.dependencies).toEqual([]);
    expect(result.data.decisions).toEqual([]);
  });

  test('source field is graph or semantic on ContextBundle relatedNotes type', () => {
    // Type-level check: ensure the source field accepts the right values
    const item: ContextBundle['relatedNotes'][number] = {
      title: 'Test',
      excerpt: '',
      score: 0.5,
      source: 'semantic',
    };
    expect(item.source).toBe('semantic');

    const graphItem: ContextBundle['relatedNotes'][number] = {
      title: 'Graph',
      excerpt: '',
      score: 0.8,
      source: 'graph',
    };
    expect(graphItem.source).toBe('graph');
  });

  test('dependencies have no source field (graph edges are separate)', () => {
    db.upsertNote(
      makeNote({
        id: 'task-dep',
        title: 'Dependency',
        module: 'pm',
        type: 'task',
        metadata: taskMeta('TST-01.01', 'TST', { status: 'done', title: 'Dependency' }),
      })
    );

    db.upsertNote(
      makeNote({
        id: 'task-main',
        title: 'Main Task',
        module: 'pm',
        type: 'task',
        metadata: taskMeta('TST-01.02', 'TST', {
          depends_on: ['TST-01.01'],
          title: 'Main Task',
        }),
      })
    );

    const result = assembleContext(db, 'TST-01.02');
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Task with dependencies has graph context
    expect(result.data.dependencies).toHaveLength(1);
    // relatedNotes is still empty from assembleContext (no search yet)
    expect(result.data.relatedNotes).toEqual([]);
  });
});
