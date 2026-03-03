import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { BrainDB } from '../../src/services/brain-db.js';
import { tmpDbPath } from '../helpers.js';
import type { BrainConfig } from '../../src/types.js';

let db: BrainDB;
let config: BrainConfig;

vi.mock('../../src/services/brain-service.js', () => ({
  withDb: vi.fn(async (fn) => fn({ db, config, close: () => {} })),
}));

import { quickCommand } from '../../src/commands/quick.js';

let stdoutChunks: string[];
let stderrChunks: string[];

function stdout(): string {
  return stdoutChunks.join('');
}

function stderr(): string {
  return stderrChunks.join('');
}

async function run(...args: string[]): Promise<void> {
  await quickCommand.parseAsync(['node', 'quick', ...args], { from: 'node' });
}

beforeEach(() => {
  db = new BrainDB(tmpDbPath('quick-cmd'));
  config = {
    notesDir: '/tmp/test-quick',
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

describe('quick command', () => {
  it('captures text arguments to inbox', async () => {
    await run('hello', 'world');
    expect(stdout()).toContain('Captured to inbox:');
  });

  it('sets source to cli by default', async () => {
    await run('test thought');
    const items = db.getInboxItems();
    expect(items.length).toBe(1);
    expect(items[0].source).toBe('cli');
    expect(items[0].content).toBe('test thought');
  });

  it('accepts --title option', async () => {
    await run('--title', 'My Title', 'some content');
    const items = db.getInboxItems();
    expect(items[0].title).toBe('My Title');
  });

  it('accepts --source option', async () => {
    await run('--source', 'api', 'content here');
    const items = db.getInboxItems();
    expect(items[0].source).toBe('api');
  });

  it('accepts --url option', async () => {
    await run('--url', 'https://example.com', 'content');
    const items = db.getInboxItems();
    expect(items[0].sourceUrl).toBe('https://example.com');
  });

  it('errors on invalid source', async () => {
    await run('--source', 'invalid', 'content');
    expect(stderr()).toContain('invalid source');
    expect(process.exitCode).toBe(1);
  });

  it('errors when no text provided and stdin is TTY', async () => {
    const origIsTTY = process.stdin.isTTY;
    Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });

    await run();

    expect(stderr()).toContain('provide text as arguments or pipe via stdin');
    expect(process.exitCode).toBe(1);

    Object.defineProperty(process.stdin, 'isTTY', { value: origIsTTY, configurable: true });
  });
});
