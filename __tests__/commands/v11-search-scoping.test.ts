import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { BrainDB } from '../../src/services/brain-db.js';
import { createMockEmbedder, makeNote, makeChunk, createTestDb } from '../helpers.js';
import type { BrainConfig } from '../../src/types.js';
import { searchCommand } from '../../src/commands/search.js';

let db: BrainDB;
const embedder = createMockEmbedder();
let config: BrainConfig;

vi.mock('../../src/services/brain-service.js', () => ({
  withBrain: vi.fn(async (fn) =>
    fn({ db, embedder, config, modules: { getFilters: () => [] }, close: () => {} })
  ),
  withDb: vi.fn(async (fn) => fn({ db, config, close: () => {} })),
}));

let stdoutChunks: string[];
let stderrChunks: string[];

function stdout(): string {
  return stdoutChunks.join('');
}

async function run(...args: string[]): Promise<void> {
  await searchCommand.parseAsync(['node', 'search', ...args], { from: 'node' });
}

async function indexNote(
  noteOverrides: Parameters<typeof makeNote>[0],
  content: string
): Promise<void> {
  const note = makeNote(noteOverrides);
  db.upsertNote(note);
  const chunk = makeChunk({ noteId: note.id, content });
  const vectors = await embedder.embed([chunk.content]);
  db.upsertChunks(note.id, [chunk], [new Float32Array(vectors[0])]);
}

beforeEach(async () => {
  ({ db } = createTestDb());
  config = {
    notesDir: '/tmp/test-v11-scoping',
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

  db.setEmbeddingModel(embedder.model, embedder.dimensions);
});

afterEach(() => {
  db.close();
  vi.restoreAllMocks();
});

describe('--project flag filters results to specified project', () => {
  it('returns only notes matching the project', async () => {
    await indexNote(
      { id: 'proj-a-note', metadata: JSON.stringify({ project: 'alpha' }) },
      'TypeScript project alpha design'
    );
    await indexNote(
      { id: 'proj-b-note', metadata: JSON.stringify({ project: 'beta' }) },
      'TypeScript project beta design'
    );

    await run('TypeScript', '--json', '--project', 'alpha');

    const parsed = JSON.parse(stdout());
    const noteIds = parsed.notes.map((n: { noteId: string }) => n.noteId);
    expect(noteIds).toContain('proj-a-note');
    expect(noteIds).not.toContain('proj-b-note');
  });

  it('is case-insensitive', async () => {
    await indexNote(
      { id: 'proj-upper', metadata: JSON.stringify({ project: 'Alpha' }) },
      'TypeScript alpha project note'
    );

    await run('TypeScript', '--json', '--project', 'ALPHA');

    const parsed = JSON.parse(stdout());
    const noteIds = parsed.notes.map((n: { noteId: string }) => n.noteId);
    expect(noteIds).toContain('proj-upper');
  });
});

describe('--project excludes brain reference docs', () => {
  it('excludes notes without a project field', async () => {
    await indexNote(
      { id: 'ref-doc', title: 'Brain Reference' },
      'TypeScript reference documentation'
    );
    await indexNote(
      { id: 'proj-note', metadata: JSON.stringify({ project: 'myproj' }) },
      'TypeScript myproj implementation'
    );

    await run('TypeScript', '--json', '--project', 'myproj');

    const parsed = JSON.parse(stdout());
    const noteIds = parsed.notes.map((n: { noteId: string }) => n.noteId);
    expect(noteIds).toContain('proj-note');
    expect(noteIds).not.toContain('ref-doc');
  });
});

describe('private-visibility PM notes included in default search', () => {
  it('includes private PM notes in default search', async () => {
    await indexNote(
      { id: 'private-task', module: 'pm', metadata: JSON.stringify({ visibility: 'private' }) },
      'TypeScript private task details'
    );
    await indexNote({ id: 'public-note' }, 'TypeScript public note content');

    await run('TypeScript', '--json');

    const parsed = JSON.parse(stdout());
    const noteIds = parsed.notes.map((n: { noteId: string }) => n.noteId);
    expect(noteIds).toContain('public-note');
    expect(noteIds).toContain('private-task');
  });

  it('excludes private PM notes with --exclude-pm', async () => {
    await indexNote(
      { id: 'private-task', module: 'pm', metadata: JSON.stringify({ visibility: 'private' }) },
      'TypeScript private task details'
    );
    await indexNote({ id: 'public-note' }, 'TypeScript public note content');

    await run('TypeScript', '--json', '--exclude-pm');

    const parsed = JSON.parse(stdout());
    const noteIds = parsed.notes.map((n: { noteId: string }) => n.noteId);
    expect(noteIds).toContain('public-note');
    expect(noteIds).not.toContain('private-task');
  });
});

describe('--include-tasks surfaces private PM notes', () => {
  it('includes private notes when --include-tasks is set', async () => {
    await indexNote(
      { id: 'private-included', module: 'pm', metadata: JSON.stringify({ visibility: 'private' }) },
      'TypeScript private task to include'
    );

    await run('TypeScript', '--json', '--include-tasks');

    const parsed = JSON.parse(stdout());
    const noteIds = parsed.notes.map((n: { noteId: string }) => n.noteId);
    expect(noteIds).toContain('private-included');
  });
});
