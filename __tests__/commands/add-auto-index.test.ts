import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdirSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import type { BrainDB } from '../../src/services/brain-db.js';
import type { Embedder } from '../../src/types.js';
import { search } from '../../src/services/search.js';
import { createTestDb, createMockEmbedder } from '../helpers.js';

const state = vi.hoisted(() => ({
  notesDir: '',
  db: null as unknown as BrainDB,
  embedder: null as unknown as Embedder,
}));

vi.mock('../../src/services/config.js', () => ({
  loadConfig: vi.fn(() => ({ notesDir: state.notesDir, dbPath: ':memory:', embedder: 'local' })),
  resolveInstance: vi.fn(() => ({ root: '/tmp', isLocal: false, source: 'global' })),
  parentResolveOpts: vi.fn(() => ({})),
}));

vi.mock('../../src/services/brain-service.js', () => ({
  withBrain: vi.fn(async (fn) =>
    fn({
      db: state.db,
      embedder: state.embedder,
      config: { notesDir: state.notesDir },
      modules: {},
      close: () => {},
    })
  ),
}));

vi.mock('../../src/services/web-extract.js', () => ({
  fetchAndExtract: vi.fn(async () => ({
    markdown: 'Fetched body about zanzibarquokka habitats.',
    metadata: { title: 'Web Capture Fixture' },
    normalizedUrl: 'https://example.com/fixture',
  })),
}));

let tmpDir: string;
let stderrChunks: string[];

async function run(...args: string[]): Promise<void> {
  vi.resetModules();
  const { addCommand } = await import('../../src/commands/add.js');
  await addCommand.parseAsync(['node', 'add', ...args], { from: 'node' });
}

async function searchIds(query: string): Promise<string[]> {
  const { results } = await search(state.db, state.embedder, query, { limit: 5 });
  return results.map((r) => r.noteId);
}

function savedNoteFiles(): string[] {
  return readdirSync(state.notesDir, { recursive: true, encoding: 'utf-8' }).filter((f) =>
    f.endsWith('.md')
  );
}

function writeInput(body: string): string {
  const path = join(tmpDir, 'input.md');
  writeFileSync(path, body, 'utf-8');
  return path;
}

beforeEach(() => {
  tmpDir = join(tmpdir(), `add-auto-index-${randomUUID().slice(0, 8)}`);
  state.notesDir = join(tmpDir, 'notes');
  mkdirSync(state.notesDir, { recursive: true });
  state.db = createTestDb().db;
  state.embedder = createMockEmbedder();
  stderrChunks = [];
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
    stderrChunks.push(String(chunk));
    return true;
  });
  process.exitCode = undefined;
});

afterEach(() => {
  vi.restoreAllMocks();
  state.db.close();
  rmSync(tmpDir, { recursive: true, force: true });
  process.exitCode = undefined;
});

describe('brain add auto-indexing', () => {
  it('makes a note added from a file findable by search without a manual index', async () => {
    const input = writeInput('Notes on the zanzibarquokka migration pattern.');

    await run(input, '--title', 'Quokka Migration');

    expect(await searchIds('zanzibarquokka')).toContain('quokka-migration');
    expect(process.exitCode).toBeUndefined();
  });

  it('makes a note with existing frontmatter findable by search', async () => {
    const input = writeInput(
      '---\nid: prewritten-note\ntitle: "Prewritten"\ntype: note\ntier: slow\n---\n\nBody mentions flumpelgrass.'
    );

    await run(input);

    expect(await searchIds('flumpelgrass')).toContain('prewritten-note');
  });

  it('makes a note added from a URL findable by search', async () => {
    await run('--url', 'https://example.com/fixture');

    expect(await searchIds('zanzibarquokka')).toContain('web-capture-fixture');
  });

  it('skips indexing when --no-index is passed', async () => {
    const input = writeInput('Bulk import body about snorkelwidget.');

    await run(input, '--title', 'Bulk Item', '--no-index');

    expect(existsSync(join(state.notesDir, 'notes', 'bulk-item.md'))).toBe(true);
    expect(await searchIds('snorkelwidget')).not.toContain('bulk-item');
  });

  it('keeps the note on disk and reports the failure when indexing fails', async () => {
    state.embedder = {
      ...createMockEmbedder(),
      embed: vi.fn().mockRejectedValue(new Error('embedder offline')),
    };
    const input = writeInput('Body that will fail to embed.');

    await run(input, '--title', 'Survives Failure');

    expect(existsSync(join(state.notesDir, 'notes', 'survives-failure.md'))).toBe(true);
    expect(process.exitCode).toBe(1);
    expect(stderrChunks.join('')).toMatch(/saved.*indexing failed.*embedder offline/is);
  });

  it('keeps a URL note on disk and reports the failure when indexing fails', async () => {
    state.embedder = {
      ...createMockEmbedder(),
      embed: vi.fn().mockRejectedValue(new Error('embedder offline')),
    };

    await run('--url', 'https://example.com/fixture');

    expect(savedNoteFiles().some((f) => f.endsWith('web-capture-fixture.md'))).toBe(true);
    expect(process.exitCode).toBe(1);
    expect(stderrChunks.join('')).toMatch(/saved.*indexing failed.*embedder offline/is);
  });
});
