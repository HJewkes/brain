import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
let stdoutChunks: string[];
let stderrChunks: string[];
let tmpNotesDir: string;

function stdout(): string {
  return stdoutChunks.join('');
}

function stderr(): string {
  return stderrChunks.join('');
}

const mockIndexFiles = vi.fn().mockResolvedValue({
  indexed: 0,
  deleted: 0,
  unchanged: 0,
  indexedNoteIds: [],
});

const mockProcessInbox = vi.fn().mockResolvedValue(0);
const mockGenerateNoteIndex = vi.fn();
const mockIsSkippedFile = vi.fn().mockReturnValue(false);

vi.mock('../../src/services/config.js', () => ({
  loadConfig: vi.fn(() => ({
    notesDir: tmpNotesDir,
    dbPath: ':memory:',
    embedder: 'local',
    fusionWeights: { bm25: 0.3, vector: 0.7 },
  })),
  resolveInstance: vi.fn(() => ({ root: '/tmp', isLocal: false, source: 'global' })),
  parentResolveOpts: vi.fn(() => ({})),
}));

vi.mock('../../src/services/brain-db.js', () => {
  return {
    BrainDB: vi.fn(function (this: Record<string, unknown>) {
      this.getAllNotes = vi.fn().mockReturnValue([]);
      this.getAllFiles = vi.fn().mockReturnValue([]);
      this.close = vi.fn();
    }),
  };
});

vi.mock('../../src/adapters/index.js', () => ({
  createEmbedder: vi.fn(async () => ({
    model: 'mock',
    dimensions: 384,
    embed: vi.fn().mockResolvedValue([]),
  })),
}));

vi.mock('../../src/services/indexing.js', () => ({
  indexFiles: mockIndexFiles,
  processInbox: mockProcessInbox,
  generateNoteIndex: mockGenerateNoteIndex,
  indexSingleFile: vi.fn(),
  isSkippedFile: mockIsSkippedFile,
}));

vi.mock('../../src/services/ollama.js', () => ({
  checkOllamaHealth: vi.fn().mockResolvedValue({ running: false, models: [] }),
  hasModel: vi.fn().mockReturnValue(false),
  createOllamaClient: vi.fn(),
}));

vi.mock('../../src/services/file-scanner.js', () => ({
  scanForChanges: vi.fn().mockResolvedValue({ new: [], modified: [], deleted: [] }),
}));

beforeEach(() => {
  tmpNotesDir = join(tmpdir(), `index-test-${randomUUID().slice(0, 8)}`);
  mkdirSync(tmpNotesDir, { recursive: true });

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

  mockIndexFiles.mockClear();
  mockProcessInbox.mockClear();
  mockGenerateNoteIndex.mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('index command', () => {
  it('runs basic indexing and reports summary as text', async () => {
    mockIndexFiles.mockResolvedValueOnce({
      indexed: 3,
      deleted: 1,
      unchanged: 5,
      indexedNoteIds: ['a', 'b', 'c'],
    });

    const { indexCommand } = await import('../../src/commands/index-cmd.js');
    await indexCommand.parseAsync(['node', 'index'], { from: 'node' });

    const err = stderr();
    expect(err).toContain('Indexed 3');
    expect(err).toContain('deleted 1');
    expect(err).toContain('unchanged 5');
  });

  it('--json outputs summary as JSON', async () => {
    mockIndexFiles.mockResolvedValueOnce({
      indexed: 2,
      deleted: 0,
      unchanged: 3,
      indexedNoteIds: ['x', 'y'],
    });

    const { indexCommand } = await import('../../src/commands/index-cmd.js');
    await indexCommand.parseAsync(['node', 'index', '--json'], { from: 'node' });

    const parsed = JSON.parse(stdout());
    expect(parsed).toHaveProperty('indexed', 2);
    expect(parsed).toHaveProperty('deleted', 0);
    expect(parsed).toHaveProperty('unchanged', 3);
    expect(parsed).toHaveProperty('total');
  });

  it('--quiet suppresses text output', async () => {
    mockIndexFiles.mockResolvedValueOnce({
      indexed: 1,
      deleted: 0,
      unchanged: 0,
      indexedNoteIds: ['z'],
    });

    const { indexCommand } = await import('../../src/commands/index-cmd.js');
    await indexCommand.parseAsync(['node', 'index', '--quiet'], { from: 'node' });

    expect(stderr()).toBe('');
    expect(stdout()).toBe('');
  });

  it('--inbox processes inbox items', async () => {
    mockIndexFiles.mockResolvedValueOnce({
      indexed: 0,
      deleted: 0,
      unchanged: 0,
      indexedNoteIds: [],
    });
    mockProcessInbox.mockResolvedValueOnce(5);

    const { indexCommand } = await import('../../src/commands/index-cmd.js');
    await indexCommand.parseAsync(['node', 'index', '--inbox'], { from: 'node' });

    expect(mockProcessInbox).toHaveBeenCalled();
    expect(stderr()).toContain('Inbox: processed 5');
  });
});
