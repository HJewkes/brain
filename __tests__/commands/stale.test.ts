import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { BrainDB } from '../../src/services/brain-db.js';
import { tmpDbPath, makeNote } from '../helpers.js';
import type { BrainConfig } from '../../src/types.js';

let db: BrainDB;
let config: BrainConfig;

vi.mock('../../src/services/brain-service.js', () => ({
  withDb: vi.fn(async (fn) => fn({ db, config, close: () => {} })),
}));

import { staleCommand } from '../../src/commands/stale.js';

let stdoutChunks: string[];

function stdout(): string {
  return stdoutChunks.join('');
}

async function run(...args: string[]): Promise<void> {
  await staleCommand.parseAsync(['node', 'stale', ...args], { from: 'node' });
}

beforeEach(() => {
  db = new BrainDB(tmpDbPath('stale-cmd'));
  config = {
    notesDir: '/tmp/test-stale',
    dbPath: ':memory:',
    embedder: 'local',
    fusionWeights: { bm25: 0.3, vector: 0.7 },
  };

  stdoutChunks = [];
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    stdoutChunks.push(String(chunk));
    return true;
  });
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  process.exitCode = undefined;
});

afterEach(() => {
  db.close();
  vi.restoreAllMocks();
});

describe('stale command', () => {
  it('reports no stale notes when none exist', async () => {
    await run();
    expect(stdout()).toContain('No stale notes found.');
  });

  it('finds overdue notes based on review interval', async () => {
    const longAgo = new Date(Date.now() - 200 * 86_400_000).toISOString();
    db.upsertNote(makeNote({ id: 'stale-1', lastReviewed: longAgo, reviewInterval: '30d' }));

    await run();
    expect(stdout()).toContain('stale-1');
    expect(stdout()).toContain('days overdue');
  });

  it('does not flag recently reviewed notes', async () => {
    const recent = new Date(Date.now() - 5 * 86_400_000).toISOString();
    db.upsertNote(makeNote({ id: 'fresh-1', lastReviewed: recent, reviewInterval: '90d' }));

    await run();
    expect(stdout()).toContain('No stale notes found.');
  });

  it('--days overrides the review interval', async () => {
    const tenDaysAgo = new Date(Date.now() - 10 * 86_400_000).toISOString();
    db.upsertNote(makeNote({ id: 'days-test', lastReviewed: tenDaysAgo, reviewInterval: '90d' }));

    await run('--days', '5');
    expect(stdout()).toContain('days-test');
  });

  it('--tier filters by note tier', async () => {
    const longAgo = new Date(Date.now() - 200 * 86_400_000).toISOString();
    db.upsertNote(
      makeNote({ id: 'slow-note', tier: 'slow', lastReviewed: longAgo, reviewInterval: '30d' })
    );
    db.upsertNote(
      makeNote({ id: 'fast-note', tier: 'fast', lastReviewed: longAgo, reviewInterval: '30d' })
    );

    await run('--tier', 'slow');
    const out = stdout();
    expect(out).toContain('slow-note');
    expect(out).not.toContain('fast-note');
  });

  it('--json outputs valid JSON array sorted by overdue days', async () => {
    const veryOld = new Date(Date.now() - 365 * 86_400_000).toISOString();
    const old = new Date(Date.now() - 200 * 86_400_000).toISOString();
    db.upsertNote(makeNote({ id: 'less-stale', lastReviewed: old, reviewInterval: '30d' }));
    db.upsertNote(makeNote({ id: 'more-stale', lastReviewed: veryOld, reviewInterval: '30d' }));

    await run('--json');
    const parsed = JSON.parse(stdout());
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.length).toBe(2);
    expect(parsed[0].noteId).toBe('more-stale');
    expect(parsed[0].daysOverdue).toBeGreaterThan(parsed[1].daysOverdue);
  });
});
