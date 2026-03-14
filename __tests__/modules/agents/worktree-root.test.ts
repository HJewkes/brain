import { describe, it, expect, vi, beforeEach } from 'vitest';
import { execFileSync } from 'node:child_process';

vi.mock('node:child_process', () => ({
  execFileSync: vi.fn(),
}));

const mockedExecFileSync = vi.mocked(execFileSync);

// Re-import after mocking
const { findGitRoot } = await import('../../../src/modules/agents/worktree.js');

describe('findGitRoot', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns parent of git-common-dir for a normal repo', () => {
    mockedExecFileSync.mockReturnValue('/Users/dev/my-project/.git\n');

    const result = findGitRoot();

    expect(result).toBe('/Users/dev/my-project');
    expect(mockedExecFileSync).toHaveBeenCalledWith(
      'git',
      ['rev-parse', '--path-format=absolute', '--git-common-dir'],
      { encoding: 'utf-8', stdio: 'pipe' }
    );
  });

  it('resolves through worktree to the main repo root', () => {
    // Inside a worktree, --git-common-dir still points to the main repo's .git
    mockedExecFileSync.mockReturnValue('/Users/dev/my-project/.git\n');

    const result = findGitRoot();

    expect(result).toBe('/Users/dev/my-project');
  });

  it('falls back to process.cwd() when git command fails', () => {
    mockedExecFileSync.mockImplementation(() => {
      throw new Error('not a git repository');
    });

    const result = findGitRoot();

    expect(result).toBe(process.cwd());
  });

  it('trims trailing whitespace from git output', () => {
    mockedExecFileSync.mockReturnValue('  /Users/dev/project/.git  \n');

    const result = findGitRoot();

    expect(result).toBe('/Users/dev/project');
  });
});
