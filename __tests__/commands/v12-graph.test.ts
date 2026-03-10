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

function stderr(): string {
  return stderrChunks.join('');
}

async function run(...args: string[]): Promise<void> {
  await graphCommand.parseAsync(['node', 'graph', ...args], { from: 'node' });
}

beforeEach(() => {
  ({ db } = createTestDb());
  config = {
    notesDir: '/tmp/test-v12-graph',
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

describe('O-150: graph resolves file paths to note IDs', () => {
  it('accepts absolute file path and resolves to note', async () => {
    const embedder = createMockEmbedder();
    db.setEmbeddingModel(embedder.model, embedder.dimensions);
    const note = makeNote({
      id: 'my-note',
      title: 'My Note',
      filePath: '/Users/test/notes/my-note.md',
    });
    db.upsertNote(note);

    await run('/Users/test/notes/my-note.md', '--json');

    const parsed = JSON.parse(stdout());
    expect(parsed.root.id).toBe('my-note');
  });

  it('still works with slug-style note IDs', async () => {
    const embedder = createMockEmbedder();
    db.setEmbeddingModel(embedder.model, embedder.dimensions);
    const note = makeNote({ id: 'slug-note', title: 'Slug Note' });
    db.upsertNote(note);

    await run('slug-note', '--json');

    const parsed = JSON.parse(stdout());
    expect(parsed.root.id).toBe('slug-note');
  });

  it('emits warning for invalid path and falls back to note ID lookup', async () => {
    const embedder = createMockEmbedder();
    db.setEmbeddingModel(embedder.model, embedder.dimensions);

    await run('/nonexistent/path.md', '--json');

    expect(stderr()).toContain('Warning: No note found at path');
    expect(stderr()).toContain('/nonexistent/path.md');
  });

  it('resolves path ending in .md without slashes', async () => {
    const embedder = createMockEmbedder();
    db.setEmbeddingModel(embedder.model, embedder.dimensions);
    const note = makeNote({
      id: 'dotmd-note',
      title: 'DotMd Note',
      filePath: 'relative-note.md',
    });
    db.upsertNote(note);

    await run('relative-note.md', '--json');

    const parsed = JSON.parse(stdout());
    expect(parsed.root.id).toBe('dotmd-note');
  });
});
