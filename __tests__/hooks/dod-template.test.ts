import { describe, it, expect, vi, beforeEach } from 'vitest';
import { execSync } from 'node:child_process';
import { dodCheck } from '../../src/hooks/checks/dod.js';
import { DEFAULT_HOOK_CONFIG } from '../../src/hooks/config.js';
import type { HookConfig, HookInput } from '../../src/hooks/types.js';

vi.mock('node:child_process', () => ({ execSync: vi.fn() }));

const config: HookConfig = {
  ...DEFAULT_HOOK_CONFIG,
  enforcement: { ...DEFAULT_HOOK_CONFIG.enforcement, dod: true },
};

const repoRootInput: HookInput = {
  event: 'task-completed',
  raw: '',
  parsed: {},
  cwd: process.cwd(),
};

function failWhenCommandIncludes(script: string): void {
  vi.mocked(execSync).mockImplementation((command: string) => {
    if (command.includes(script)) throw Object.assign(new Error('failed'), { stderr: 'boom' });
    return '';
  });
}

describe('code-change DoD template', () => {
  beforeEach(() => {
    vi.mocked(execSync).mockReset();
  });

  it('allows completion when every gate passes', () => {
    vi.mocked(execSync).mockReturnValue('');

    expect(dodCheck.run(repoRootInput, config).exitCode).toBe(0);
  });

  it.each([
    ['format:check', 'format clean'],
    ['run build', 'build succeeds'],
    ['typecheck', 'types check'],
    ['npm test', 'tests pass'],
    ['run lint', 'lint clean'],
  ])('blocks completion when the %s gate fails', (script, criterionName) => {
    failWhenCommandIncludes(script);

    const result = dodCheck.run(repoRootInput, config);

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain(criterionName);
  });
});
