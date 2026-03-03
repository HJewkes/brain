import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { BrainDB } from '../../src/services/brain-db.js';
import { tmpDbPath, createMockEmbedder, makeNote, makeMemoryEntry } from '../helpers.js';
import type { BrainConfig } from '../../src/types.js';
import { memoriesCommand } from '../../src/commands/memories.js';

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
  await memoriesCommand.parseAsync(['node', 'memories', ...args], { from: 'node' });
}

beforeEach(async () => {
  db = new BrainDB(tmpDbPath('memories-cmd'));
  config = {
    notesDir: '/tmp/test-memories-cmd',
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
  db.upsertNote(makeNote({ id: 'test-note', title: 'Test Note' }));

  const mem = makeMemoryEntry({
    id: 'mem-1',
    memory: 'TypeScript is typed',
    sourceNoteId: 'test-note',
  });
  db.addMemory(mem);
  const vec = await embedder.embed([mem.memory]);
  db.upsertMemoryVector(mem.id, new Float32Array(vec[0]));
});

afterEach(() => {
  db.close();
  vi.restoreAllMocks();
});

describe('memories default action (O-130 regression)', () => {
  it('does not crash with stack overflow when no subcommand given', async () => {
    await run();

    const out = stdout();
    expect(out).toContain('TypeScript is typed');
    expect(out).toContain('Total:');
  });
});

describe('memories list', () => {
  it('displays memories as text', async () => {
    await run('list');

    const out = stdout();
    expect(out).toContain('TypeScript is typed');
    expect(out).toContain('Total:');
  });

  it('--json outputs JSON array', async () => {
    await run('list', '--json');

    const parsed = JSON.parse(stdout());
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.length).toBe(1);
    expect(parsed[0]).toHaveProperty('memory');
    expect(parsed[0].memory).toBe('TypeScript is typed');
  });

  it('shows "No memories found" when empty', async () => {
    db.close();
    db = new BrainDB(tmpDbPath('memories-cmd-empty'));
    const embedder = createMockEmbedder();
    db.setEmbeddingModel(embedder.model, embedder.dimensions);

    await run('list');

    expect(stdout()).toContain('No memories found');
  });

  it('--limit restricts output count', async () => {
    await run('list', '--limit', '1', '--json');

    const parsed = JSON.parse(stdout());
    expect(parsed.length).toBeLessThanOrEqual(1);
  });
});

describe('memories stats', () => {
  it('shows active memory count as text', async () => {
    await run('stats');

    const out = stdout();
    expect(out).toContain('Active memories:');
    expect(out).toContain('1');
  });

  it('--json outputs stats object', async () => {
    await run('stats', '--json');

    const parsed = JSON.parse(stdout());
    expect(parsed).toHaveProperty('activeMemories');
    expect(parsed.activeMemories).toBe(1);
  });
});

describe('memories history', () => {
  it('shows error for non-existent memory', async () => {
    await run('history', 'nonexistent-id');

    expect(process.exitCode).toBe(1);
    expect(stderr()).toContain('No history found');
  });

  it('--json outputs chain and history', async () => {
    await run('history', 'mem-1', '--json');

    const parsed = JSON.parse(stdout());
    expect(parsed).toHaveProperty('chain');
    expect(parsed).toHaveProperty('history');
  });
});
