import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { BrainDB } from '../../src/services/brain-db.js';
import { tmpDbPath, makeNote } from '../helpers.js';
import type { BrainConfig } from '../../src/types.js';

let db: BrainDB;
let config: BrainConfig;

vi.mock('../../src/services/brain-service.js', () => ({
  withBrain: vi.fn(async (fn) => fn({ db, config, embedder: {}, modules: {}, close: () => {} })),
}));

import { notesCommand } from '../../src/commands/notes.js';

let stdoutChunks: string[];
let stderrChunks: string[];

function stdout(): string {
  return stdoutChunks.join('');
}

function stderr(): string {
  return stderrChunks.join('');
}

async function run(...args: string[]): Promise<void> {
  await notesCommand.parseAsync(['node', 'notes', ...args], { from: 'node' });
}

beforeEach(() => {
  db = new BrainDB(tmpDbPath('notes-cmd'));
  config = {
    notesDir: '/tmp/test-notes',
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

describe('notes list', () => {
  it('shows empty message when no notes', async () => {
    await run('list');
    expect(stdout()).toContain('No notes found.');
  });

  it('lists notes with type, title, and file path', async () => {
    db.upsertNote(makeNote({ title: 'My Note', type: 'note', tier: 'slow', filePath: '/notes/my-note.md' }));
    await run('list');
    const out = stdout();
    expect(out).toContain('My Note');
    expect(out).toContain('/notes/my-note.md');
  });

  it('filters by --module', async () => {
    db.upsertNote(makeNote({ title: 'PM Note', module: 'pm' }));
    db.upsertNote(makeNote({ title: 'General Note', module: null }));

    await run('list', '--module', 'pm');
    const out = stdout();
    expect(out).toContain('PM Note');
    expect(out).not.toContain('General Note');
  });

  it('filters by --type', async () => {
    db.upsertNote(makeNote({ title: 'Decision', type: 'decision' }));
    db.upsertNote(makeNote({ title: 'Regular', type: 'note' }));

    await run('list', '--type', 'decision');
    const out = stdout();
    expect(out).toContain('Decision');
    expect(out).not.toContain('Regular');
  });

  it('filters by --tier', async () => {
    db.upsertNote(makeNote({ title: 'Fast Note', tier: 'fast' }));
    db.upsertNote(makeNote({ title: 'Slow Note', tier: 'slow' }));

    await run('list', '--tier', 'fast');
    const out = stdout();
    expect(out).toContain('Fast Note');
    expect(out).not.toContain('Slow Note');
  });

  it('respects --limit', async () => {
    for (let i = 0; i < 5; i++) {
      db.upsertNote(makeNote({ title: `Note ${i}` }));
    }
    await run('list', '--limit', '2');
    const err = stderr();
    expect(err).toContain('Showing 2 of 5 notes');
  });

  it('--json outputs valid JSON array', async () => {
    db.upsertNote(makeNote({ title: 'JSON Note', type: 'note', tier: 'slow' }));
    await run('list', '--json');
    const parsed = JSON.parse(stdout());
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed[0]).toHaveProperty('id');
    expect(parsed[0]).toHaveProperty('title', 'JSON Note');
    expect(parsed[0]).toHaveProperty('type', 'note');
    expect(parsed[0]).toHaveProperty('tier', 'slow');
  });
});
