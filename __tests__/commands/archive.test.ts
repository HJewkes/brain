import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { makeNote, createTestDb } from '../helpers.js';
import type { BrainConfig } from '../../src/types.js';

let db: BrainDB;
let config: BrainConfig;

vi.mock('../../src/services/brain-service.js', () => ({
  withDb: vi.fn(async (fn) => fn({ db, config, close: () => {} })),
}));

// Mock fs operations so we don't touch real filesystem
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    renameSync: vi.fn(),
    mkdirSync: vi.fn(),
    existsSync: vi.fn(() => true),
  };
});

import { archiveCommand } from '../../src/commands/archive.js';
import { existsSync, renameSync, mkdirSync } from 'node:fs';

let stdoutChunks: string[];

function stdout(): string {
  return stdoutChunks.join('');
}

async function run(...args: string[]): Promise<void> {
  await archiveCommand.parseAsync(['node', 'archive', ...args], { from: 'node' });
}

beforeEach(() => {
  ({ db } = createTestDb());
  config = {
    notesDir: '/tmp/test-notes',
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

describe('archive command', () => {
  it('reports no expired notes when none exist', async () => {
    await run();
    expect(stdout()).toContain('No expired notes to archive.');
  });

  it('reports no expired notes when notes are not fast tier', async () => {
    const note = makeNote({ tier: 'slow', expires: '2020-01-01' });
    db.upsertNote(note);
    await run();
    expect(stdout()).toContain('No expired notes to archive.');
  });

  it('reports no expired notes when fast tier has no expiry', async () => {
    const note = makeNote({ tier: 'fast', expires: null });
    db.upsertNote(note);
    await run();
    expect(stdout()).toContain('No expired notes to archive.');
  });

  it('archives expired fast-tier notes', async () => {
    const note = makeNote({
      tier: 'fast',
      expires: '2020-01-01',
      filePath: '/tmp/test-notes/note.md',
    });
    db.upsertNote(note);

    await run();
    expect(stdout()).toContain('Archived 1 note.');
    expect(renameSync).toHaveBeenCalled();
  });

  it('--dry-run lists files without moving them', async () => {
    const note = makeNote({
      tier: 'fast',
      expires: '2020-01-01',
      filePath: '/tmp/test-notes/note.md',
    });
    db.upsertNote(note);

    await run('--dry-run');
    expect(stdout()).toContain('Would archive');
    expect(stdout()).toContain('note.md');
    expect(renameSync).not.toHaveBeenCalled();
  });

  it('creates archive directory if it does not exist', async () => {
    vi.mocked(existsSync).mockImplementation((p) => {
      if (String(p).includes('archive')) return false;
      return true;
    });

    const note = makeNote({
      tier: 'fast',
      expires: '2020-01-01',
      filePath: '/tmp/test-notes/note.md',
    });
    db.upsertNote(note);

    await run();
    expect(mkdirSync).toHaveBeenCalled();
  });
});
