import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { BrainDB } from '../../src/services/brain-db.js';
import { tmpDbPath, createMockEmbedder, makeNote, makeChunk } from '../helpers.js';
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

function stderr(): string {
  return stderrChunks.join('');
}

async function run(...args: string[]): Promise<void> {
  await searchCommand.parseAsync(['node', 'search', ...args], { from: 'node' });
}

beforeEach(async () => {
  db = new BrainDB(tmpDbPath('search-cmd'));
  config = {
    notesDir: '/tmp/test-search-cmd',
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
  const note = makeNote({ id: 'test-note', title: 'Test Note', filePath: '/tmp/test.md' });
  db.upsertNote(note);
  const chunk = makeChunk({ noteId: 'test-note', content: 'TypeScript testing patterns' });
  const vectors = await embedder.embed([chunk.content]);
  const embedding = new Float32Array(vectors[0]);
  db.upsertChunks('test-note', [chunk], [embedding]);
});

afterEach(() => {
  db.close();
  vi.restoreAllMocks();
});

describe('search command', () => {
  it('displays results as text with scores', async () => {
    await run('TypeScript');

    const out = stdout();
    expect(out).toContain('/tmp/test.md');
    expect(out).toMatch(/\[\d+\.\d+\]/);
  });

  it('--json always returns { notes, memories } shape (O-112)', async () => {
    await run('TypeScript', '--json');

    const parsed = JSON.parse(stdout());
    expect(parsed).toHaveProperty('notes');
    expect(parsed).toHaveProperty('memories');
    expect(Array.isArray(parsed.notes)).toBe(true);
    expect(Array.isArray(parsed.memories)).toBe(true);
    expect(parsed.notes.length).toBeGreaterThan(0);
    expect(parsed.notes[0]).toHaveProperty('score');
    expect(parsed.notes[0]).toHaveProperty('filePath');
    expect(parsed.memories).toEqual([]);
  });

  it('shows "No results found" when database is empty', async () => {
    db.close();
    db = new BrainDB(tmpDbPath('search-cmd-empty'));
    db.setEmbeddingModel(embedder.model, embedder.dimensions);

    await run('anything');

    expect(stderr()).toContain('No results found');
  });

  it('--limit restricts result count', async () => {
    await run('TypeScript', '--limit', '1', '--json');

    const parsed = JSON.parse(stdout());
    expect(parsed.notes.length).toBeLessThanOrEqual(1);
  });

  it('--json with --memories outputs object with notes and memories keys', async () => {
    await run('TypeScript', '--json', '--memories');

    const parsed = JSON.parse(stdout());
    expect(parsed).toHaveProperty('notes');
    expect(parsed).toHaveProperty('memories');
    expect(Array.isArray(parsed.notes)).toBe(true);
    expect(Array.isArray(parsed.memories)).toBe(true);
  });

  it('no results in text mode writes to stderr only', async () => {
    db.close();
    db = new BrainDB(tmpDbPath('search-cmd-empty2'));
    db.setEmbeddingModel(embedder.model, embedder.dimensions);

    await run('anything');

    expect(stdout()).toBe('');
    expect(stderr()).toContain('No results found');
  });
});

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

describe('O-69: --workstream filter', () => {
  it('filters search results by workstream number', async () => {
    await indexNote(
      { id: 'ws1-note', type: 'task', metadata: JSON.stringify({ workstream: 1 }) },
      'TypeScript workstream one task'
    );
    await indexNote(
      { id: 'ws2-note', type: 'task', metadata: JSON.stringify({ workstream: 2 }) },
      'TypeScript workstream two task'
    );

    await run('TypeScript', '--json', '--workstream', '1');

    const parsed = JSON.parse(stdout());
    const noteIds = parsed.notes.map((n: { noteId: string }) => n.noteId);
    expect(noteIds).toContain('ws1-note');
    expect(noteIds).not.toContain('ws2-note');
  });

  it('filters search results by workstream display ID', async () => {
    await indexNote(
      {
        id: 'ws-alpha',
        type: 'task',
        metadata: JSON.stringify({ workstream: 1, workstream_display_id: 'ALPHA' }),
      },
      'TypeScript alpha workstream task'
    );
    await indexNote(
      {
        id: 'ws-beta',
        type: 'task',
        metadata: JSON.stringify({ workstream: 2, workstream_display_id: 'BETA' }),
      },
      'TypeScript beta workstream task'
    );

    await run('TypeScript', '--json', '--workstream', 'alpha');

    const parsed = JSON.parse(stdout());
    const noteIds = parsed.notes.map((n: { noteId: string }) => n.noteId);
    expect(noteIds).toContain('ws-alpha');
    expect(noteIds).not.toContain('ws-beta');
  });

  it('excludes notes without metadata when workstream filter is set', async () => {
    await run('TypeScript', '--json', '--workstream', '1');

    const parsed = JSON.parse(stdout());
    expect(parsed.notes.map((n: { noteId: string }) => n.noteId)).not.toContain('test-note');
  });
});

describe('O-107: --type and --module filters', () => {
  it('filters search results by note type', async () => {
    await indexNote({ id: 'task-note', type: 'task' }, 'TypeScript task planning');
    await indexNote({ id: 'project-note', type: 'project' }, 'TypeScript project overview');

    await run('TypeScript', '--json', '--type', 'task');

    const parsed = JSON.parse(stdout());
    const noteIds = parsed.notes.map((n: { noteId: string }) => n.noteId);
    expect(noteIds).toContain('task-note');
    expect(noteIds).not.toContain('project-note');
    expect(noteIds).not.toContain('test-note');
  });

  it('filters search results by module', async () => {
    await indexNote({ id: 'pm-note', module: 'pm' }, 'TypeScript PM module note');
    await indexNote({ id: 'other-note', module: 'other' }, 'TypeScript other module note');

    await run('TypeScript', '--json', '--module', 'pm');

    const parsed = JSON.parse(stdout());
    const noteIds = parsed.notes.map((n: { noteId: string }) => n.noteId);
    expect(noteIds).toContain('pm-note');
    expect(noteIds).not.toContain('other-note');
    expect(noteIds).not.toContain('test-note');
  });

  it('combines type and module filters', async () => {
    await indexNote({ id: 'pm-task', type: 'task', module: 'pm' }, 'TypeScript PM task item');
    await indexNote(
      { id: 'pm-project', type: 'project', module: 'pm' },
      'TypeScript PM project item'
    );
    await indexNote(
      { id: 'other-task', type: 'task', module: 'other' },
      'TypeScript other task item'
    );

    await run('TypeScript', '--json', '--type', 'task', '--module', 'pm');

    const parsed = JSON.parse(stdout());
    const noteIds = parsed.notes.map((n: { noteId: string }) => n.noteId);
    expect(noteIds).toContain('pm-task');
    expect(noteIds).not.toContain('pm-project');
    expect(noteIds).not.toContain('other-task');
  });

  it('filters work with text output mode', async () => {
    await indexNote(
      { id: 'task-only', type: 'task', filePath: '/tmp/task-only.md' },
      'TypeScript task content'
    );

    await run('TypeScript', '--type', 'task');

    const out = stdout();
    expect(out).toContain('/tmp/task-only.md');
    expect(out).not.toContain('/tmp/test.md');
  });
});
