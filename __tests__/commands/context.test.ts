import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { makeNote, makeMemoryEntry, createTestDb } from '../helpers.js';
import type { BrainConfig } from '../../src/types.js';

let db: BrainDB;
let config: BrainConfig;

vi.mock('../../src/services/brain-service.js', () => ({
  withDb: vi.fn(async (fn) => fn({ db, config, close: () => {} })),
}));

import { contextCommand } from '../../src/commands/context.js';

let stdoutChunks: string[];
let stderrChunks: string[];

function stdout(): string {
  return stdoutChunks.join('');
}

function stderr(): string {
  return stderrChunks.join('');
}

async function run(...args: string[]): Promise<void> {
  await contextCommand.parseAsync(['node', 'context', ...args], { from: 'node' });
}

beforeEach(() => {
  ({ db } = createTestDb());
  config = {
    notesDir: '/tmp/test-context',
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

describe('context command', () => {
  it('errors when note not found', async () => {
    await run('nonexistent');
    expect(stderr()).toContain('note "nonexistent" not found');
    expect(process.exitCode).toBe(1);
  });

  it('shows note title and type', async () => {
    db.upsertNote(makeNote({ id: 'ctx-1', title: 'Test Note', type: 'note', tier: 'slow' }));
    await run('ctx-1');
    const out = stdout();
    expect(out).toContain('Test Note');
    expect(out).toContain('note');
    expect(out).toContain('slow');
  });

  it('shows no context message when note has no connections', async () => {
    db.upsertNote(makeNote({ id: 'lonely' }));
    await run('lonely');
    expect(stdout()).toContain('No context found for this note.');
  });

  it('shows memories associated with the note', async () => {
    db.upsertNote(makeNote({ id: 'mem-note' }));
    db.addMemory(makeMemoryEntry({ sourceNoteId: 'mem-note', memory: 'Important fact' }));
    await run('mem-note');
    const out = stdout();
    expect(out).toContain('Memories');
    expect(out).toContain('Important fact');
  });

  it('shows related notes via relations', async () => {
    db.upsertNote(makeNote({ id: 'src-note', title: 'Source' }));
    db.upsertNote(makeNote({ id: 'tgt-note', title: 'Target' }));
    db.upsertRelations('src-note', [
      { sourceId: 'src-note', targetId: 'tgt-note', type: 'related-to' },
    ]);

    await run('src-note');
    const out = stdout();
    expect(out).toContain('Related notes');
    expect(out).toContain('Target');
    expect(out).toContain('Relations');
    expect(out).toContain('-> related-to tgt-note');
  });

  it('--json outputs structured JSON', async () => {
    db.upsertNote(makeNote({ id: 'json-ctx', title: 'JSON Note', type: 'decision', tier: 'fast' }));
    db.addMemory(makeMemoryEntry({ sourceNoteId: 'json-ctx', memory: 'A fact' }));

    await run('json-ctx', '--json');
    const parsed = JSON.parse(stdout());
    expect(parsed.note.id).toBe('json-ctx');
    expect(parsed.note.title).toBe('JSON Note');
    expect(parsed.memories.length).toBe(1);
    expect(parsed.memories[0].memory).toBe('A fact');
  });
});
