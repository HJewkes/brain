import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { BrainDB } from '../../src/services/brain-db.js';
import { tmpDbPath, createMockEmbedder } from '../helpers.js';
import type { BrainConfig } from '../../src/types.js';
import { ingestCommand } from '../../src/commands/ingest.js';

let db: BrainDB;
let config: BrainConfig;

vi.mock('../../src/services/brain-service.js', () => ({
  withBrain: vi.fn(async (fn) => fn({ db, embedder: createMockEmbedder(), config, modules: {}, close: () => {} })),
  withDb: vi.fn(async (fn) => fn({ db, config, close: () => {} })),
}));

let stdoutChunks: string[];
let stderrChunks: string[];
let tmpDir: string;

function stdout(): string {
  return stdoutChunks.join('');
}

function stderr(): string {
  return stderrChunks.join('');
}

async function run(...args: string[]): Promise<void> {
  await ingestCommand.parseAsync(['node', 'ingest', ...args], { from: 'node' });
}

beforeEach(() => {
  db = new BrainDB(tmpDbPath('ingest-cmd'));
  config = {
    notesDir: '/tmp/test-ingest-cmd',
    dbPath: ':memory:',
    embedder: 'local',
    fusionWeights: { bm25: 0.3, vector: 0.7 },
  };

  tmpDir = join(tmpdir(), `ingest-test-${randomUUID().slice(0, 8)}`);
  mkdirSync(tmpDir, { recursive: true });

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

describe('ingest command', () => {
  it('errors when no files provided', async () => {
    await run();

    expect(process.exitCode).toBe(1);
    expect(stderr()).toContain('provide file arguments');
  });

  it('ingests a single file', async () => {
    const filePath = join(tmpDir, 'test.md');
    writeFileSync(filePath, '# Test\n\nSome content here', 'utf-8');

    await run(filePath);

    expect(stdout()).toContain('Ingested 1 item');
  });

  it('ingests multiple files', async () => {
    const file1 = join(tmpDir, 'a.md');
    const file2 = join(tmpDir, 'b.md');
    writeFileSync(file1, 'Content A', 'utf-8');
    writeFileSync(file2, 'Content B', 'utf-8');

    await run(file1, file2);

    expect(stdout()).toContain('Ingested 2 items');
  });

  it('skips missing files', async () => {
    await run('/nonexistent/file.md');

    expect(stderr()).toContain('Skipping');
    expect(stderr()).toContain('not found');
    expect(stdout()).toContain('Ingested 0 items');
  });

  it('skips empty files', async () => {
    const filePath = join(tmpDir, 'empty.md');
    writeFileSync(filePath, '', 'utf-8');

    await run(filePath);

    expect(stderr()).toContain('Skipping');
    expect(stderr()).toContain('empty');
    expect(stdout()).toContain('Ingested 0 items');
  });

  it('rejects invalid source', async () => {
    const filePath = join(tmpDir, 'test.md');
    writeFileSync(filePath, 'content', 'utf-8');

    await run(filePath, '--source', 'invalid-source');

    expect(process.exitCode).toBe(1);
    expect(stderr()).toContain('invalid source');
  });

  it('accepts valid source option', async () => {
    const filePath = join(tmpDir, 'test.md');
    writeFileSync(filePath, 'content', 'utf-8');

    await run(filePath, '--source', 'crawler');

    expect(stdout()).toContain('Ingested 1 item');
  });
});
