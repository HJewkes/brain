import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { BrainDB } from '../../src/services/brain-db.js';
import { createMockEmbedder, makeNote, makeChunk, createTestDb } from '../helpers.js';
import type { BrainConfig } from '../../src/types.js';
import { extractCommand } from '../../src/commands/extract.js';

let db: BrainDB;
const embedder = createMockEmbedder();
let config: BrainConfig;

vi.mock('../../src/services/brain-service.js', () => ({
  withBrain: vi.fn(async (fn) => fn({ db, embedder, config, modules: {}, close: () => {} })),
  withDb: vi.fn(async (fn) => fn({ db, config, close: () => {} })),
}));

const mockGenerate = vi.fn().mockResolvedValue('["Test fact about TypeScript"]');
vi.mock('../../src/services/ollama.js', () => ({
  requireOllama: vi.fn(async () => ({
    model: 'mock-model',
    generate: mockGenerate,
  })),
  checkOllamaHealth: vi.fn(async () => ({ running: true, models: ['mock-model'] })),
  hasModel: vi.fn(() => true),
  createOllamaClient: vi.fn(() => ({ model: 'mock-model', generate: mockGenerate })),
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
  await extractCommand.parseAsync(['node', 'extract', ...args], { from: 'node' });
}

beforeEach(async () => {
  ({ db } = createTestDb());
  config = {
    notesDir: '/tmp/test-extract-cmd',
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
  db.upsertNote(makeNote({ id: 'test-note', title: 'Test Note' }));
  const chunk = makeChunk({ noteId: 'test-note', content: 'TypeScript is great' });
  const vecs = await embedder.embed([chunk.content]);
  db.upsertChunks('test-note', [chunk], [new Float32Array(vecs[0])]);

  mockGenerate.mockClear();
});

afterEach(() => {
  db.close();
  vi.restoreAllMocks();
});

describe('extract command', () => {
  it('requires --note or --all', async () => {
    await run();

    expect(process.exitCode).toBe(1);
    expect(stderr()).toContain('specify --note <id> or --all');
  });

  it('errors when note not found', async () => {
    await run('--note', 'nonexistent-note');

    expect(process.exitCode).toBe(1);
    expect(stderr()).toContain('not found');
  });

  it('--note extracts from a specific note with --json', async () => {
    await run('--note', 'test-note', '--json');

    const out = stdout();
    const parsed = JSON.parse(out);
    expect(parsed).toHaveProperty('processed');
    expect(parsed.processed).toBe(1);
  });

  it('--all processes all notes with --json', async () => {
    await run('--all', '--json');

    const out = stdout();
    const parsed = JSON.parse(out);
    expect(parsed).toHaveProperty('processed');
    expect(parsed.processed).toBeGreaterThanOrEqual(1);
  });

  it('--quiet suppresses progress output', async () => {
    await run('--note', 'test-note', '--quiet');

    const err = stderr();
    expect(err).not.toContain('Extracting from');
    expect(err).not.toContain('Processed');
  });
});
