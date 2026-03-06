import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { createInstallHooksCommand } from '../../../src/modules/pm/commands/install-hooks.js';

let stderrChunks: string[];

function stderr(): string {
  return stderrChunks.join('');
}

async function run(...args: string[]): Promise<void> {
  await createInstallHooksCommand().parseAsync(['node', 'install-hooks', ...args], {
    from: 'node',
  });
}

beforeEach(() => {
  stderrChunks = [];
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
    stderrChunks.push(String(chunk));
    return true;
  });
  process.exitCode = undefined;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('install-hooks deprecation', () => {
  test('outputs deprecation warning and sets exitCode=1', async () => {
    await run();

    expect(stderr()).toContain('DEPRECATED');
    expect(stderr()).toContain('ao hook install');
    expect(process.exitCode).toBe(1);
  });

  test('--remove outputs deprecation warning', async () => {
    await run('--remove');

    expect(stderr()).toContain('DEPRECATED');
    expect(process.exitCode).toBe(1);
  });

  test('--dry-run outputs deprecation warning', async () => {
    await run('--dry-run');

    expect(stderr()).toContain('DEPRECATED');
    expect(process.exitCode).toBe(1);
  });
});
