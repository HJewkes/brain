import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { BrainDB } from '../../src/services/brain-db.js';
import { tmpDbPath, createMockEmbedder, makeNote, makeChunk } from '../helpers.js';
import type { BrainConfig } from '../../src/types.js';
import { searchCommand } from '../../src/commands/search.js';

let db: BrainDB;
const embedder = createMockEmbedder();
let config: BrainConfig;

vi.mock('../../src/services/brain-service.js', () => ({
  withBrain: vi.fn(async (fn) => fn({ db, embedder, config, modules: {}, close: () => {} })),
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
  await searchCommand.parseAsync(['node', 'search', ...args], { from: 'node' });
}

beforeEach(async () => {
  db = new BrainDB(tmpDbPath('search-cmd'));
  config = {
    notesDir: '/tmp/test-search-cmd',
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

  db.setEmbeddingModel(embedder.model, embedder.dimensions);
  const note = makeNote({ id: 'test-note', title: 'Test Note', filePath: '/tmp/test.md' });
  db.upsertNote(note);
  const chunk = makeChunk({ noteId: 'test-note', content: 'TypeScript testing patterns' });
  const vectors = await embedder.embed([chunk.content]);
  const embedding = new Float32Array(vectors[0]);
  db.upsertChunks('test-note', [chunk], [embedding]);
});

afterEach(() => {
  db.close();
  vi.restoreAllMocks();
});

describe('search command', () => {
  it('displays results as text with scores', async () => {
    await run('TypeScript');

    const out = stdout();
    expect(out).toContain('/tmp/test.md');
    expect(out).toMatch(/\[\d+\.\d+\]/);
  });

  it('--json outputs JSON array of results', async () => {
    await run('TypeScript', '--json');

    const parsed = JSON.parse(stdout());
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.length).toBeGreaterThan(0);
    expect(parsed[0]).toHaveProperty('score');
    expect(parsed[0]).toHaveProperty('filePath');
  });

  it('shows "No results found" when database is empty', async () => {
    db.close();
    db = new BrainDB(tmpDbPath('search-cmd-empty'));
    db.setEmbeddingModel(embedder.model, embedder.dimensions);

    await run('anything');

    expect(stderr()).toContain('No results found');
  });

  it('--limit restricts result count', async () => {
    await run('TypeScript', '--limit', '1', '--json');

    const parsed = JSON.parse(stdout());
    expect(parsed.length).toBeLessThanOrEqual(1);
  });

  it('--json with --memories outputs object with notes and memories keys', async () => {
    await run('TypeScript', '--json', '--memories');

    const parsed = JSON.parse(stdout());
    expect(parsed).toHaveProperty('notes');
    expect(parsed).toHaveProperty('memories');
    expect(Array.isArray(parsed.notes)).toBe(true);
    expect(Array.isArray(parsed.memories)).toBe(true);
  });

  it('no results in text mode writes to stderr only', async () => {
    db.close();
    db = new BrainDB(tmpDbPath('search-cmd-empty2'));
    db.setEmbeddingModel(embedder.model, embedder.dimensions);

    await run('anything');

    expect(stdout()).toBe('');
    expect(stderr()).toContain('No results found');
  });
});
