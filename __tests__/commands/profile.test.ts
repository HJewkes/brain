import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { BrainDB } from '../../src/services/brain-db.js';
import { tmpDbPath, makeNote, makeMemoryEntry } from '../helpers.js';
import type { BrainConfig } from '../../src/types.js';

let db: BrainDB;
let config: BrainConfig;

vi.mock('../../src/services/brain-service.js', () => ({
  withDb: vi.fn(async (fn) => fn({ db, config, close: () => {} })),
}));

import { profileCommand } from '../../src/commands/profile.js';

let stdoutChunks: string[];

function stdout(): string {
  return stdoutChunks.join('');
}

async function run(...args: string[]): Promise<void> {
  await profileCommand.parseAsync(['node', 'profile', ...args], { from: 'node' });
}

beforeEach(() => {
  db = new BrainDB(tmpDbPath('profile-cmd'));
  config = {
    notesDir: '/tmp/test-profile',
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

function seedMemory(id: string, memory: string, container = 'default'): void {
  const note = makeNote({ id: `note-${id}` });
  db.upsertNote(note);
  db.addMemory(makeMemoryEntry({ id, memory, sourceNoteId: note.id, containerTag: container }));
}

describe('profile command', () => {
  it('outputs plain text by default', async () => {
    seedMemory('m1', 'User prefers TypeScript');
    await run();
    const out = stdout();
    expect(out).toContain('notes');
    expect(out).toContain('memories');
    expect(out).toContain('User prefers TypeScript');
  });

  it('--json outputs valid JSON with memories and stats', async () => {
    seedMemory('m2', 'Likes Vim');
    await run('--json');
    const parsed = JSON.parse(stdout());
    expect(parsed).toHaveProperty('memories');
    expect(parsed).toHaveProperty('stats');
    expect(parsed.memories[0].fact).toBe('Likes Vim');
  });

  it('--format xml outputs XML structure', async () => {
    seedMemory('m3', 'Uses Linux');
    await run('--format', 'xml');
    const out = stdout();
    expect(out).toContain('<context>');
    expect(out).toContain('<memory');
    expect(out).toContain('Uses Linux');
    expect(out).toContain('</context>');
  });

  it('--format markdown outputs markdown headers', async () => {
    seedMemory('m4', 'Prefers dark mode');
    await run('--format', 'markdown');
    const out = stdout();
    expect(out).toContain('# Context Profile');
    expect(out).toContain('## Known Facts');
    expect(out).toContain('Prefers dark mode');
  });

  it('shows container tag for non-default containers', async () => {
    seedMemory('m5', 'Work fact', 'work');
    await run();
    const out = stdout();
    expect(out).toContain('[work]');
  });

  it('respects --limit', async () => {
    for (let i = 0; i < 5; i++) {
      seedMemory(`lim-${i}`, `Fact ${i}`);
    }
    await run('--json', '--limit', '2');
    const parsed = JSON.parse(stdout());
    expect(parsed.memories.length).toBe(2);
  });
});
