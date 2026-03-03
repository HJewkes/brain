import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { BrainDB } from '../../src/services/brain-db.js';
import { tmpDbPath, makeInboxItem } from '../helpers.js';
import type { BrainConfig } from '../../src/types.js';

let db: BrainDB;
let config: BrainConfig;

vi.mock('../../src/services/brain-service.js', () => ({
  withDb: vi.fn(async (fn) => fn({ db, config, close: () => {} })),
}));

import { inboxCommand } from '../../src/commands/inbox.js';

let stdoutChunks: string[];
let stderrChunks: string[];

function stdout(): string {
  return stdoutChunks.join('');
}

function stderr(): string {
  return stderrChunks.join('');
}

async function run(...args: string[]): Promise<void> {
  await inboxCommand.parseAsync(['node', 'inbox', ...args], { from: 'node' });
}

beforeEach(() => {
  db = new BrainDB(tmpDbPath('inbox-cmd'));
  config = {
    notesDir: '/tmp/test-inbox',
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

describe('inbox command', () => {
  it('shows empty inbox message', async () => {
    await run();
    expect(stdout()).toContain('Inbox is empty.');
  });

  it('lists inbox items with status and id', async () => {
    db.addInboxItem(
      makeInboxItem({ id: 'item-1', content: 'My thought', source: 'cli', status: 'pending' })
    );
    await run();
    const out = stdout();
    expect(out).toContain('[pending]');
    expect(out).toContain('item-1');
    expect(out).toContain('My thought');
  });

  it('filters by --status', async () => {
    db.addInboxItem(makeInboxItem({ id: 'pending-1', status: 'pending' }));
    db.addInboxItem(makeInboxItem({ id: 'failed-1', status: 'failed' }));

    await run('--status', 'failed');
    const out = stdout();
    expect(out).toContain('failed-1');
    expect(out).not.toContain('pending-1');
  });

  it('rejects invalid --status', async () => {
    await run('--status', 'bogus');
    expect(stderr()).toContain('invalid status');
    expect(process.exitCode).toBe(1);
  });

  it('--count shows just the number', async () => {
    db.addInboxItem(makeInboxItem({ id: 'c1' }));
    db.addInboxItem(makeInboxItem({ id: 'c2' }));
    await run('--count');
    expect(stdout().trim()).toBe('2');
  });

  it('--discard marks item as discarded', async () => {
    db.addInboxItem(makeInboxItem({ id: 'disc-1', status: 'pending' }));
    await run('--discard', 'disc-1');
    expect(stdout()).toContain('Discarded: disc-1');
    const item = db.getInboxItem('disc-1');
    expect(item?.status).toBe('discarded');
  });

  it('--discard errors on missing item', async () => {
    await run('--discard', 'nonexistent');
    expect(stderr()).toContain('not found');
    expect(process.exitCode).toBe(1);
  });

  it('--delete removes item', async () => {
    db.addInboxItem(makeInboxItem({ id: 'del-1', status: 'pending' }));
    await run('--delete', 'del-1');
    expect(stdout()).toContain('Deleted: del-1');
    const item = db.getInboxItem('del-1');
    expect(item).toBeNull();
  });

  it('--delete errors on missing item', async () => {
    await run('--delete', 'nonexistent');
    expect(stderr()).toContain('not found');
    expect(process.exitCode).toBe(1);
  });

  it('rejects mutually exclusive flags', async () => {
    await run('--discard', 'x', '--count');
    expect(stderr()).toContain('mutually exclusive');
    expect(process.exitCode).toBe(1);
  });
});
