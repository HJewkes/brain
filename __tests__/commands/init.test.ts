import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, existsSync } from 'node:fs';
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

vi.mock('../../src/services/config.js', () => ({
  loadConfig: vi.fn(() => ({
    notesDir: tmpNotesDir,
    dbPath: join(tmpNotesDir, 'brain.db'),
    embedder: 'local',
    fusionWeights: { bm25: 0.3, vector: 0.7 },
  })),
  saveConfig: vi.fn(),
}));

const mockClose = vi.fn();
const mockSetEmbeddingModel = vi.fn();
vi.mock('../../src/services/brain-db.js', () => {
  const MockBrainDB = vi.fn(function (this: Record<string, unknown>) {
    this.setEmbeddingModel = mockSetEmbeddingModel;
    this.close = mockClose;
  });
  return { BrainDB: MockBrainDB };
});

vi.mock('../../src/adapters/index.js', () => ({
  createEmbedder: vi.fn(() => ({
    model: 'mock-embedder',
    dimensions: 384,
    embed: vi.fn().mockResolvedValue([]),
  })),
  getEmbedderInfo: vi.fn(() => ({
    model: 'mock-embedder',
    dimensions: 384,
  })),
}));

vi.mock('../../src/services/ollama.js', () => ({
  checkOllamaHealth: vi.fn(async () => ({ running: false, models: [] })),
  hasModel: vi.fn(() => false),
}));

beforeEach(() => {
  tmpNotesDir = join(tmpdir(), `init-test-${randomUUID().slice(0, 8)}`);
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

  mockClose.mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('init command', () => {
  it('creates subdirectories in notes dir', async () => {
    const { initCommand } = await import('../../src/commands/init.js');
    await initCommand.parseAsync(['node', 'init', '--embedder', 'local'], { from: 'node' });

    expect(existsSync(join(tmpNotesDir, 'notes'))).toBe(true);
    expect(existsSync(join(tmpNotesDir, 'decisions'))).toBe(true);
    expect(existsSync(join(tmpNotesDir, 'inbox'))).toBe(true);
    expect(existsSync(join(tmpNotesDir, 'archive'))).toBe(true);
  });

  it('creates template files', async () => {
    const { initCommand } = await import('../../src/commands/init.js');
    await initCommand.parseAsync(['node', 'init', '--embedder', 'local'], { from: 'node' });

    expect(existsSync(join(tmpNotesDir, '_templates', 'note.md'))).toBe(true);
    expect(existsSync(join(tmpNotesDir, '_templates', 'decision.md'))).toBe(true);
  });

  it('--json outputs summary as JSON', async () => {
    const { initCommand } = await import('../../src/commands/init.js');
    await initCommand.parseAsync(['node', 'init', '--embedder', 'local', '--json'], {
      from: 'node',
    });

    const parsed = JSON.parse(stdout());
    expect(parsed).toHaveProperty('notesDir');
    expect(parsed).toHaveProperty('embedder');
    expect(parsed).toHaveProperty('features');
    expect(parsed.features).toHaveProperty('search', true);
  });

  it('default output shows welcoming message with next steps (O-02)', async () => {
    const { initCommand } = await import('../../src/commands/init.js');
    await initCommand.parseAsync(['node', 'init', '--embedder', 'local'], { from: 'node' });

    const err = stderr();
    expect(err).toContain('Brain initialized');
    expect(err).toContain('Notes directory:');
    expect(err).toContain('Next steps:');
    expect(err).toContain('brain index');
    expect(err).not.toContain('Embedder:');
    expect(err).not.toContain('Features:');
  });

  it('--verbose shows technical details', async () => {
    const { initCommand } = await import('../../src/commands/init.js');
    await initCommand.parseAsync(['node', 'init', '--embedder', 'local', '--verbose'], {
      from: 'node',
    });

    const err = stderr();
    expect(err).toContain('Brain initialized');
    expect(err).toContain('Embedder:');
    expect(err).toContain('Features:');
    expect(err).toContain('Database:');
  });

  it('closes the database after init', async () => {
    const { initCommand } = await import('../../src/commands/init.js');
    await initCommand.parseAsync(['node', 'init', '--embedder', 'local'], { from: 'node' });

    expect(mockClose).toHaveBeenCalled();
  });
});
