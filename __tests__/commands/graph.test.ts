import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { BrainDB } from '../../src/services/brain-db.js';
import { createMockEmbedder, makeNote, createTestDb } from '../helpers.js';
import type { BrainConfig } from '../../src/types.js';
import { graphCommand } from '../../src/commands/graph.js';

let db: BrainDB;
let config: BrainConfig;

vi.mock('../../src/services/brain-service.js', () => ({
  withBrain: vi.fn(async (fn) =>
    fn({ db, embedder: createMockEmbedder(), config, modules: {}, close: () => {} })
  ),
  withDb: vi.fn(async (fn) => fn({ db, config, close: () => {} })),
}));

let stdoutChunks: string[];
let stderrChunks: string[];

function stdout(): string {
  return stdoutChunks.join('');
}

async function run(...args: string[]): Promise<void> {
  await graphCommand.parseAsync(['node', 'graph', ...args], { from: 'node' });
}

beforeEach(() => {
  ({ db } = createTestDb());
  config = {
    notesDir: '/tmp/test-graph-cmd',
    dbPath: ':memory:',
    embedder: 'local',
    fusionWeights: { bm25: 0.3, vector: 0.7 },
  };

  stdoutChunks = [];
  stderrChunks = [];
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    stdoutChunks.push(String(chunk));
    return true;
  });
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
    stderrChunks.push(String(chunk));
    return true;
  });
  process.exitCode = undefined;
});

afterEach(() => {
  db.close();
  vi.restoreAllMocks();
});

describe('graph command', () => {
  it('displays tree for a note with no relations', async () => {
    const embedder = createMockEmbedder();
    db.setEmbeddingModel(embedder.model, embedder.dimensions);
    const note = makeNote({ id: 'test-note', title: 'Test Note' });
    db.upsertNote(note);

    await run('test-note');

    const out = stdout();
    expect(out).toContain('test-note');
    expect(out).toContain('note');
  });

  it('--json outputs JSON with root, nodes, and edges', async () => {
    const embedder = createMockEmbedder();
    db.setEmbeddingModel(embedder.model, embedder.dimensions);
    const note = makeNote({ id: 'test-note', title: 'Test Note' });
    db.upsertNote(note);

    await run('test-note', '--json');

    const parsed = JSON.parse(stdout());
    expect(parsed).toHaveProperty('root');
    expect(parsed).toHaveProperty('nodes');
    expect(parsed).toHaveProperty('edges');
    expect(parsed.root.id).toBe('test-note');
  });

  it('shows connected notes in tree view', async () => {
    const embedder = createMockEmbedder();
    db.setEmbeddingModel(embedder.model, embedder.dimensions);
    db.upsertNote(makeNote({ id: 'note-a', title: 'Note A' }));
    db.upsertNote(makeNote({ id: 'note-b', title: 'Note B' }));
    db.upsertRelations('note-a', [
      { sourceId: 'note-a', targetId: 'note-b', type: 'related-to', weight: 1 },
    ]);

    await run('note-a');

    const out = stdout();
    expect(out).toContain('note-a');
    expect(out).toContain('note-b');
    expect(out).toContain('related-to');
  });

  it('--depth 1 limits traversal depth', async () => {
    const embedder = createMockEmbedder();
    db.setEmbeddingModel(embedder.model, embedder.dimensions);
    db.upsertNote(makeNote({ id: 'n1', title: 'N1' }));
    db.upsertNote(makeNote({ id: 'n2', title: 'N2' }));
    db.upsertNote(makeNote({ id: 'n3', title: 'N3' }));
    db.upsertRelations('n1', [{ sourceId: 'n1', targetId: 'n2', type: 'related-to', weight: 1 }]);
    db.upsertRelations('n2', [{ sourceId: 'n2', targetId: 'n3', type: 'related-to', weight: 1 }]);

    await run('n1', '--depth', '1', '--json');

    const parsed = JSON.parse(stdout());
    const nodeIds = parsed.nodes.map((n: { id: string }) => n.id);
    expect(nodeIds).toContain('n1');
    expect(nodeIds).toContain('n2');
    expect(nodeIds).not.toContain('n3');
  });
});
