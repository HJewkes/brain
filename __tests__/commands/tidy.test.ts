import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { BrainDB } from '../../src/services/brain-db.js';
import { tmpDbPath, createMockEmbedder, makeNote } from '../helpers.js';
import type { BrainConfig } from '../../src/types.js';
import { tidyCommand } from '../../src/commands/tidy.js';

let db: BrainDB;
let config: BrainConfig;

vi.mock('../../src/services/brain-service.js', () => ({
  withBrain: vi.fn(async (fn) => fn({ db, embedder: createMockEmbedder(), config, modules: {}, close: () => {} })),
  withDb: vi.fn(async (fn) => fn({ db, config, close: () => {} })),
}));

const mockGenerate = vi.fn().mockResolvedValue('- Add a summary field\n- Consider splitting into sections');
vi.mock('../../src/services/ollama.js', () => ({
  requireOllama: vi.fn(async () => ({
    model: 'mock-model',
    generate: mockGenerate,
  })),
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
  await tidyCommand.parseAsync(['node', 'tidy', ...args], { from: 'node' });
}

beforeEach(() => {
  db = new BrainDB(tmpDbPath('tidy-cmd'));
  config = {
    notesDir: '/tmp/test-tidy-cmd',
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

  mockGenerate.mockClear();
  mockGenerate.mockResolvedValue('- Add a summary field\n- Consider splitting into sections');
});

afterEach(() => {
  db.close();
  vi.restoreAllMocks();
});

describe('tidy command', () => {
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

  it('--note analyzes a specific note and shows suggestions as text', async () => {
    const tmpDir = join(tmpdir(), `tidy-${randomUUID().slice(0, 8)}`);
    mkdirSync(tmpDir, { recursive: true });
    const filePath = join(tmpDir, 'tidy-note.md');
    writeFileSync(filePath, '---\ntitle: Tidy Test\n---\n\n# Content\n\nSome note content', 'utf-8');
    const note = makeNote({ id: 'tidy-note', title: 'Tidy Test', filePath });
    db.upsertNote(note);

    await run('--note', 'tidy-note');

    const out = stdout();
    expect(out).toContain('Tidy Test');
    expect(out).toContain('Add a summary field');
  });

  it('--json outputs JSON array of results', async () => {
    const tmpDir = join(tmpdir(), `tidy-json-${randomUUID().slice(0, 8)}`);
    mkdirSync(tmpDir, { recursive: true });
    const filePath = join(tmpDir, 'tidy-json.md');
    writeFileSync(filePath, '---\ntitle: JSON Tidy\n---\n\n# Content\n\nNote content', 'utf-8');
    const note = makeNote({ id: 'tidy-json', title: 'JSON Tidy', filePath });
    db.upsertNote(note);

    await run('--note', 'tidy-json', '--json');

    const parsed = JSON.parse(stdout());
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.length).toBe(1);
    expect(parsed[0]).toHaveProperty('noteId');
    expect(parsed[0]).toHaveProperty('suggestions');
  });

  it('skips files that do not exist on disk', async () => {
    const note = makeNote({ id: 'missing-file', title: 'Missing', filePath: '/nonexistent/path.md' });
    db.upsertNote(note);

    await run('--note', 'missing-file');

    expect(stderr()).toContain('Skipping: file not found');
  });
});
