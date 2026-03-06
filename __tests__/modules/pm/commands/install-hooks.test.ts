import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createInstallHooksCommand } from '../../../../src/modules/pm/commands/install-hooks.js';

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

describe('install-hooks deprecation stub', () => {
  it('outputs deprecation warning on default invocation', async () => {
    await run();

    expect(stderr()).toContain('DEPRECATED');
    expect(stderr()).toContain('ao hook install');
    expect(process.exitCode).toBe(1);
  });

  it('outputs deprecation warning with --remove flag', async () => {
    await run('--remove');

    expect(stderr()).toContain('DEPRECATED');
    expect(stderr()).toContain('ao hook install');
    expect(process.exitCode).toBe(1);
  });

  it('outputs deprecation warning with --dry-run flag', async () => {
    await run('--dry-run');

    expect(stderr()).toContain('DEPRECATED');
    expect(stderr()).toContain('ao hook install');
    expect(process.exitCode).toBe(1);
  });
});
