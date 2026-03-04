import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { configCommand } from '../../src/commands/config.js';

const mockConfig = {
  notesDir: '/tmp/brain-notes',
  dbPath: '/tmp/brain.db',
  embedder: 'local',
  fusionWeights: { bm25: 0.3, vector: 0.7 },
};

vi.mock('../../src/services/config.js', () => ({
  loadConfig: vi.fn(() => ({ ...mockConfig, fusionWeights: { ...mockConfig.fusionWeights } })),
  saveConfig: vi.fn(),
  resolveInstance: vi.fn(() => ({ root: '/tmp', isLocal: false, source: 'global' })),
  parentResolveOpts: vi.fn(() => ({})),
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
  await configCommand.parseAsync(['node', 'config', ...args], { from: 'node' });
}

beforeEach(() => {
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
  vi.restoreAllMocks();
});

describe('config get', () => {
  it('outputs entire config as JSON when no key specified', async () => {
    await run('get');

    const parsed = JSON.parse(stdout());
    expect(parsed).toHaveProperty('notesDir');
    expect(parsed).toHaveProperty('embedder');
  });

  it('outputs a single string value', async () => {
    await run('get', 'embedder');

    expect(stdout().trim()).toBe('local');
  });

  it('outputs a nested object value as JSON', async () => {
    await run('get', 'fusion-weights');

    const parsed = JSON.parse(stdout());
    expect(parsed).toHaveProperty('bm25', 0.3);
    expect(parsed).toHaveProperty('vector', 0.7);
  });

  it('outputs nested value with dot notation', async () => {
    await run('get', 'fusion-weights.bm25');

    expect(stdout().trim()).toBe('0.3');
  });

  it('errors for unknown key', async () => {
    await run('get', 'nonexistent-key');

    expect(process.exitCode).toBe(1);
    expect(stderr()).toContain('unknown config key');
  });
});

describe('config set', () => {
  it('sets a string value', async () => {
    const { saveConfig } = await import('../../src/services/config.js');
    await run('set', 'notes-dir', '/new/path');

    expect(saveConfig).toHaveBeenCalled();
    expect(stdout()).toContain('Set notes-dir');
  });

  it('sets a numeric value for nested key', async () => {
    await run('set', 'fusion-weights.bm25', '0.5');

    expect(stdout()).toContain('Set fusion-weights.bm25');
  });

  it('errors for unknown key', async () => {
    await run('set', 'nonexistent-key', 'value');

    expect(process.exitCode).toBe(1);
    expect(stderr()).toContain('unknown config key');
  });

  it('errors for type mismatch', async () => {
    await run('set', 'fusion-weights.bm25', 'not-a-number');

    expect(process.exitCode).toBe(1);
    expect(stderr()).toContain('type mismatch');
  });

  it('parses boolean values correctly', async () => {
    await run('set', 'embedder', 'true');

    expect(process.exitCode).toBe(1);
    expect(stderr()).toContain('type mismatch');
  });
});
