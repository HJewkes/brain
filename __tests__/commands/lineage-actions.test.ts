import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { BrainDB } from '../../src/services/brain-db.js';
import { tmpDbPath, createMockEmbedder, makeNote } from '../helpers.js';
import type { BrainConfig } from '../../src/types.js';
import { lineageCommand } from '../../src/commands/lineage.js';

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

function stderr(): string {
  return stderrChunks.join('');
}

async function run(...args: string[]): Promise<void> {
  await lineageCommand.parseAsync(['node', 'lineage', ...args], { from: 'node' });
}

beforeEach(() => {
  db = new BrainDB(tmpDbPath('lineage-cmd'));
  config = {
    notesDir: '/tmp/test-lineage-cmd',
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

  const embedder = createMockEmbedder();
  db.setEmbeddingModel(embedder.model, embedder.dimensions);
});

afterEach(() => {
  db.close();
  vi.restoreAllMocks();
});

describe('lineage tree', () => {
  it('shows tree for note with no descendants', async () => {
    db.upsertNote(makeNote({ id: 'root-note', title: 'Root Note' }));

    await run('tree', 'root-note');

    const out = stdout();
    expect(out).toContain('Root Note');
    expect(out).toContain('no derived notes');
  });

  it('errors when note not found', async () => {
    await run('tree', 'nonexistent');

    expect(process.exitCode).toBe(1);
    expect(stderr()).toContain('Note not found');
  });

  it('shows tree with derived notes', async () => {
    db.upsertNote(makeNote({ id: 'parent', title: 'Parent' }));
    db.upsertNote(makeNote({ id: 'child', title: 'Child' }));
    db.upsertRelations('child', [
      { sourceId: 'child', targetId: 'parent', type: 'derived-from', weight: 1 },
    ]);

    await run('tree', 'parent');

    const out = stdout();
    expect(out).toContain('Parent');
    expect(out).toContain('Child');
    expect(out).toContain('1 derived note(s)');
  });
});

describe('lineage delete', () => {
  it('shows preview without --force', async () => {
    db.upsertNote(makeNote({ id: 'del-note', title: 'Delete Me' }));

    await run('delete', 'del-note');

    const out = stdout();
    expect(out).toContain('Will delete');
    expect(out).toContain('--force');
  });

  it('shows preview for a note without --force', async () => {
    db.upsertNote(makeNote({ id: 'preview-note', title: 'Preview' }));

    await run('delete', 'preview-note');

    const out = stdout();
    expect(out).toContain('Will delete');
    expect(out).toContain('preview-note');
    expect(out).toContain('--force');
  });

  it('deletes with --force', async () => {
    db.upsertNote(makeNote({ id: 'force-del', title: 'Force Delete' }));

    await run('delete', 'force-del', '--force');

    const out = stdout();
    expect(out).toContain('Deleted');
  });
});

describe('lineage archive', () => {
  it('errors when note not found', async () => {
    await run('archive', 'nonexistent');

    expect(process.exitCode).toBe(1);
    expect(stderr()).toContain('Note not found');
  });
});
