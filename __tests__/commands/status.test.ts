import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { BrainDB } from '../../src/services/brain-db.js';
import { tmpDbPath, makeNote } from '../helpers.js';
import type { BrainConfig } from '../../src/types.js';

let db: BrainDB;
let config: BrainConfig;

vi.mock('../../src/services/brain-service.js', () => ({
  withDb: vi.fn(async (fn) => fn({ db, config, close: () => {} })),
}));

import { statusCommand } from '../../src/commands/status.js';

let stdoutChunks: string[];
let stderrChunks: string[];

function stdout(): string {
  return stdoutChunks.join('');
}

function stderr(): string {
  return stderrChunks.join('');
}

async function run(...args: string[]): Promise<void> {
  await statusCommand.parseAsync(['node', 'status', ...args], { from: 'node' });
}

beforeEach(() => {
  db = new BrainDB(tmpDbPath('status-cmd'));
  config = {
    notesDir: '/tmp/test-status',
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

describe('status command', () => {
  it('shows zero counts for empty database', async () => {
    await run();
    const out = stderr();
    expect(out).toContain('Notes: 0');
    expect(out).toContain('Chunks: 0');
  });

  it('counts notes by tier and type', async () => {
    db.upsertNote(makeNote({ tier: 'slow', type: 'note' }));
    db.upsertNote(makeNote({ tier: 'slow', type: 'decision' }));
    db.upsertNote(makeNote({ tier: 'fast', type: 'note' }));

    await run();
    const out = stderr();
    expect(out).toContain('Notes: 3');
    expect(out).toContain('slow=2');
    expect(out).toContain('fast=1');
    expect(out).toContain('note=2');
    expect(out).toContain('decision=1');
  });

  it('--json outputs complete summary object', async () => {
    db.upsertNote(makeNote({ tier: 'slow', type: 'note' }));
    await run('--json');
    const parsed = JSON.parse(stdout());
    expect(parsed).toHaveProperty('totalNotes', 1);
    expect(parsed).toHaveProperty('totalChunks');
    expect(parsed).toHaveProperty('byTier');
    expect(parsed).toHaveProperty('byType');
    expect(parsed).toHaveProperty('embeddingModel');
    expect(parsed).toHaveProperty('staleNotes');
  });

  it('detects stale notes', async () => {
    const longAgo = new Date(Date.now() - 200 * 86_400_000).toISOString();
    db.upsertNote(makeNote({ lastReviewed: longAgo, reviewInterval: '30d' }));

    await run();
    expect(stderr()).toContain('Stale notes needing review: 1');
  });

  it('--json includes stale note IDs', async () => {
    const longAgo = new Date(Date.now() - 200 * 86_400_000).toISOString();
    db.upsertNote(makeNote({ id: 'stale-id', lastReviewed: longAgo, reviewInterval: '30d' }));

    await run('--json');
    const parsed = JSON.parse(stdout());
    expect(parsed.staleNotes).toBe(1);
    expect(parsed.staleNoteIds).toContain('stale-id');
  });
});
