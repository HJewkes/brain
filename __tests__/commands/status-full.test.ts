import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import {
  makeNote,
  makeMemoryEntry,
  makeInboxItem,
  createTestDb,
  createMockEmbedder,
} from '../helpers.js';
import { createStandardProject } from '../fixtures/pm-project.js';
import type { BrainDB } from '../../src/services/brain-db.js';
import type { BrainConfig } from '../../src/types.js';

let db: BrainDB;
let config: BrainConfig;
let notesDir: string;

vi.mock('../../src/services/brain-service.js', () => ({
  withDb: vi.fn(async (fn) =>
    fn({
      db,
      config,
      instance: { root: '/tmp/test-status-full', isLocal: false, source: 'test' },
      close: () => {},
    })
  ),
}));

import { statusCommand } from '../../src/commands/status.js';

let stdoutChunks: string[];
let stderrChunks: string[];

const stdout = (): string => stdoutChunks.join('');
const stderr = (): string => stderrChunks.join('');

async function run(...args: string[]): Promise<void> {
  await statusCommand.parseAsync(['node', 'status', ...args], { from: 'node' });
}

function seedCoreBrain(): void {
  db.upsertNote(makeNote({ id: 'src-note', tier: 'slow', type: 'note' }));
  db.upsertNote(makeNote({ tier: 'fast', type: 'decision' }));
  db.upsertFile({ path: '/notes/a.md', hash: 'h', mtime: 1, indexedAt: 1_700_000_000_000 });
  for (let i = 0; i < 3; i++) db.addMemory(makeMemoryEntry({ sourceNoteId: 'src-note' }));
  db.addInboxItem(makeInboxItem({ status: 'pending' }));
  db.addInboxItem(makeInboxItem({ status: 'indexed' }));
}

async function seedFullBrain(): Promise<void> {
  seedCoreBrain();
  const embedder = createMockEmbedder();
  await createStandardProject(db, config, embedder);
}

beforeEach(() => {
  ({ db } = createTestDb());
  notesDir = join(tmpdir(), `status-full-${randomUUID()}`);
  mkdirSync(notesDir, { recursive: true });
  config = {
    notesDir,
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
  rmSync(notesDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('status --full', () => {
  it('prints index, memory, inbox and PM sections for a populated brain', async () => {
    await seedFullBrain();

    await run('--full');

    const out = stdout();
    expect(out).toContain('== Index ==');
    expect(out).toContain('decision=1');
    expect(out).toContain('== Memory ==');
    expect(out).toContain('Active memories: 3');
    expect(out).toContain('== Inbox ==');
    expect(out).toContain('Pending: 1');
    expect(out).toContain('== PM ==');
    expect(out).toContain('Projects: 1');
    expect(out).toMatch(/Tasks: [1-9]/);
    expect(process.exitCode ?? 0).toBe(0);
  });

  it('prints a not initialised line for each empty subsystem and exits 0', async () => {
    await run('--full');

    const out = stdout();
    expect(out).toContain('Index: not initialised');
    expect(out).toContain('PM: not initialised');
    expect(out).toContain('Active memories: 0');
    expect(out).toContain('Pending: 0');
    expect(process.exitCode ?? 0).toBe(0);
  });

  it('prints an unavailable line when a subsystem throws and still reports the others', async () => {
    vi.spyOn(db, 'getInboxItems').mockImplementation(() => {
      throw new Error('no such table: inbox');
    });

    await run('--full');

    const out = stdout();
    expect(out).toContain('Inbox: unavailable (no such table: inbox)');
    expect(out).toContain('== Memory ==');
    expect(process.exitCode ?? 0).toBe(0);
  });

  it('--full --json emits an object keyed by the four sections', async () => {
    await seedFullBrain();

    await run('--full', '--json');

    const parsed = JSON.parse(stdout());
    expect(Object.keys(parsed).sort()).toEqual(['inbox', 'index', 'memory', 'pm']);
    expect(parsed.index.byType.decision).toBe(1);
    expect(parsed.memory.activeMemories).toBe(3);
    expect(parsed.inbox.pending).toBe(1);
    expect(parsed.pm.projects).toBe(1);
  });

  it('--full --json marks an empty subsystem as not initialised', async () => {
    await run('--full', '--json');

    const parsed = JSON.parse(stdout());
    expect(parsed.pm).toEqual({ initialised: false, reason: expect.any(String) });
  });

  it('plain status output is unchanged by the new flag', async () => {
    seedCoreBrain();

    await run();

    expect(stdout()).toBe('');
    expect(stderr()).toBe(
      [
        'Instance: global (/tmp/test-status-full)',
        'Notes: 2',
        'Chunks: 0',
        'By tier: slow=1, fast=1',
        'By type: note=1, decision=1',
        'Embedding: mock-embedder (384d)',
        'Last indexed: 2023-11-14T22:13:20.000Z',
        '',
      ].join('\n')
    );
  });
});
