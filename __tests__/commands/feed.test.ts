import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { BrainDB } from '../../src/services/brain-db.js';
import { tmpDbPath, createMockEmbedder, makeFeedRecord } from '../helpers.js';
import type { BrainConfig } from '../../src/types.js';
import { feedCommand } from '../../src/commands/feed.js';

let db: BrainDB;
let config: BrainConfig;

vi.mock('../../src/services/brain-service.js', () => ({
  withBrain: vi.fn(async (fn) => fn({ db, embedder: createMockEmbedder(), config, modules: {}, close: () => {} })),
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
  await feedCommand.parseAsync(['node', 'feed', ...args], { from: 'node' });
}

beforeEach(() => {
  db = new BrainDB(tmpDbPath('feed-cmd'));
  config = {
    notesDir: '/tmp/test-feed-cmd',
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

describe('feed add', () => {
  it('adds a new feed subscription', async () => {
    await run('add', 'https://example.com/feed.xml');

    const out = stdout();
    expect(out).toContain('Added feed:');
    expect(out).toContain('example.com');
  });

  it('uses --name option for display name', async () => {
    await run('add', 'https://example.com/feed.xml', '--name', 'My Feed');

    const out = stdout();
    expect(out).toContain('My Feed');
  });

  it('rejects invalid URL', async () => {
    await run('add', 'not-a-url');

    expect(process.exitCode).toBe(1);
    expect(stderr()).toContain('invalid URL');
  });

  it('rejects duplicate feed URL', async () => {
    const feed = makeFeedRecord({ url: 'https://dupe.com/feed.xml' });
    db.addFeed(feed);

    await run('add', 'https://dupe.com/feed.xml');

    expect(process.exitCode).toBe(1);
    expect(stderr()).toContain('already exists');
  });
});

describe('feed list', () => {
  it('shows "No feeds configured" when empty', async () => {
    await run('list');

    expect(stdout()).toContain('No feeds configured');
  });

  it('lists all feeds', async () => {
    const feed = makeFeedRecord({ name: 'Test Feed', url: 'https://test.com/rss' });
    db.addFeed(feed);

    await run('list');

    const out = stdout();
    expect(out).toContain('Test Feed');
    expect(out).toContain('https://test.com/rss');
    expect(out).toContain('never polled');
  });
});

describe('feed remove', () => {
  it('removes an existing feed', async () => {
    const feed = makeFeedRecord({ id: 'remove-me', name: 'Remove Me' });
    db.addFeed(feed);

    await run('remove', 'remove-me');

    expect(stdout()).toContain('Removed feed: Remove Me');
  });

  it('errors when feed not found', async () => {
    await run('remove', 'nonexistent');

    expect(process.exitCode).toBe(1);
    expect(stderr()).toContain('not found');
  });
});
