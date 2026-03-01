import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    rmSync: vi.fn(),
    existsSync: vi.fn(() => true),
  };
});

vi.mock('../../src/services/config.js', () => ({
  loadConfig: vi.fn(() => ({
    notesDir: '/tmp/test-notes',
    dbPath: ':memory:',
    embedder: 'local',
    fusionWeights: { bm25: 0.3, vector: 0.7 },
  })),
  getConfigDir: vi.fn(() => '/tmp/test-config'),
  getDataDir: vi.fn(() => '/tmp/test-data'),
}));

import { resetCommand } from '../../src/commands/reset.js';
import { rmSync, existsSync } from 'node:fs';

let stdoutChunks: string[];
let stderrChunks: string[];

function stdout(): string {
  return stdoutChunks.join('');
}

function stderr(): string {
  return stderrChunks.join('');
}

async function run(...args: string[]): Promise<void> {
  await resetCommand.parseAsync(['node', 'reset', ...args], { from: 'node' });
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
  vi.mocked(rmSync).mockClear();
  vi.mocked(existsSync).mockReturnValue(true);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('reset command', () => {
  it('requires --confirm flag', async () => {
    await run();
    expect(stderr()).toContain('permanently delete');
    expect(stderr()).toContain('--confirm');
    expect(process.exitCode).toBe(1);
  });

  it('removes data, notes, and config with --confirm', async () => {
    await run('--confirm');
    expect(rmSync).toHaveBeenCalledTimes(3);
    expect(stderr()).toContain('Brain reset complete');
  });

  it('--keep-config preserves config dir', async () => {
    await run('--confirm', '--keep-config');
    // Should remove data + notes but not config (2 calls instead of 3)
    expect(rmSync).toHaveBeenCalledTimes(2);
    const calls = vi.mocked(rmSync).mock.calls.map((c) => c[0]);
    expect(calls).not.toContain('/tmp/test-config');
  });

  it('--json outputs removed paths as JSON', async () => {
    await run('--confirm', '--json');
    const parsed = JSON.parse(stdout());
    expect(parsed).toHaveProperty('removed');
    expect(Array.isArray(parsed.removed)).toBe(true);
    expect(parsed.removed.length).toBeGreaterThan(0);
  });

  it('reports nothing to remove when dirs do not exist', async () => {
    vi.mocked(existsSync).mockReturnValue(false);
    await run('--confirm');
    expect(stderr()).toContain('Nothing to remove');
  });
});
