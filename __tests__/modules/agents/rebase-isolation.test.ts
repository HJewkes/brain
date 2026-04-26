import { describe, it, expect, vi, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';

vi.mock('node:child_process', () => ({
  execFileSync: vi.fn(),
}));

import {
  rebaseInIsolation,
  rebaseInIsolationDetailed,
} from '../../../src/modules/agents/rebase-isolation.js';

const mockExec = execFileSync as ReturnType<typeof vi.fn>;
const branch = 'agent/vnm-48/VNM-48.101';
const projectDir = '/tmp/test-project';

function findCall(args: (string | RegExp)[]): unknown {
  return mockExec.mock.calls.find((c) => {
    const callArgs = c[1] as string[];
    return args.every((a) =>
      typeof a === 'string' ? callArgs?.includes(a) : callArgs?.some((x) => a.test(x))
    );
  });
}

describe('rebaseInIsolation (boolean wrapper)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('succeeds on a clean rebase and pushes with force-with-lease', async () => {
    mockExec.mockReturnValue('');

    const result = await rebaseInIsolation(branch, projectDir);

    expect(result).toBe(true);
    expect(findCall(['worktree', 'add', '--detach'])).toBeDefined();
    expect(findCall(['checkout', branch])).toBeDefined();
    expect(findCall(['fetch', 'origin', 'main'])).toBeDefined();
    expect(findCall(['rebase', '--empty=drop', 'origin/main'])).toBeDefined();
    expect(findCall(['push', '--force-with-lease'])).toBeDefined();
    expect(findCall(['worktree', 'remove'])).toBeDefined();
  });

  it('returns false when setup fails', async () => {
    mockExec.mockImplementation(() => {
      throw new Error('worktree add failed');
    });

    const result = await rebaseInIsolation(branch, projectDir);
    expect(result).toBe(false);
  });

  it('uses a timestamped worktree path under .worktrees', async () => {
    mockExec.mockReturnValue('');
    await rebaseInIsolation(branch, projectDir);
    const worktreePath = mockExec.mock.calls[0][1][3];
    expect(worktreePath).toMatch(/\/tmp\/test-project\/\.worktrees\/rebase-\d+/);
  });
});

describe('rebaseInIsolationDetailed', () => {
  afterEach(() => vi.restoreAllMocks());

  it('enables rerere before rebasing', async () => {
    mockExec.mockReturnValue('');
    await rebaseInIsolationDetailed(branch, projectDir);

    expect(findCall(['config', 'rerere.enabled', 'true'])).toBeDefined();
    expect(findCall(['config', 'rerere.autoUpdate', 'true'])).toBeDefined();
  });

  it('returns ok=true with no reason on clean rebase', async () => {
    mockExec.mockReturnValue('');
    const result = await rebaseInIsolationDetailed(branch, projectDir);
    expect(result.ok).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  it('returns reason=setup when worktree creation fails', async () => {
    mockExec.mockImplementation((_cmd: string, args: string[]) => {
      if (args?.[0] === 'worktree' && args?.[1] === 'add') {
        throw new Error('worktree add failed');
      }
      return '';
    });

    const result = await rebaseInIsolationDetailed(branch, projectDir);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('setup');
    expect(result.detail).toContain('worktree add failed');
  });

  it('returns reason=conflict with file list on real content conflict', async () => {
    mockExec.mockImplementation((_cmd: string, args: string[]) => {
      if (args?.[0] === 'rebase' && args?.includes('origin/main')) {
        throw new Error('CONFLICT (content)');
      }
      if (args?.[0] === 'status' && args?.includes('--porcelain')) {
        return 'UU src/foo.ts\n';
      }
      return '';
    });

    const result = await rebaseInIsolationDetailed(branch, projectDir);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('conflict');
    expect(result.conflicts).toEqual(['src/foo.ts']);
    expect(result.detail).toContain('src/foo.ts');
    expect(findCall(['rebase', '--abort'])).toBeDefined();
  });

  it('auto-resolves delete/delete conflicts and continues the rebase', async () => {
    let rebaseContinued = false;
    mockExec.mockImplementation((_cmd: string, args: string[]) => {
      if (args?.[0] === 'rebase' && args?.includes('origin/main')) {
        throw new Error('CONFLICT (deletion)');
      }
      if (args?.[0] === 'status' && args?.includes('--porcelain')) {
        if (args.includes('--porcelain=2')) return '# branch.head foo\n';
        if (rebaseContinued) return '';
        return 'DD stale-file.md\n';
      }
      if (args?.[0] === 'rebase' && args?.includes('--continue')) {
        rebaseContinued = true;
        return '';
      }
      return '';
    });

    const result = await rebaseInIsolationDetailed(branch, projectDir);
    expect(result.ok).toBe(true);
    expect(findCall(['rm', '-f', '--', 'stale-file.md'])).toBeDefined();
    expect(findCall(['rebase', '--continue'])).toBeDefined();
    expect(findCall(['push', '--force-with-lease'])).toBeDefined();
  });

  it('auto-resolves deleted-by-them conflicts (UD)', async () => {
    let rebaseContinued = false;
    mockExec.mockImplementation((_cmd: string, args: string[]) => {
      if (args?.[0] === 'rebase' && args?.includes('origin/main')) {
        throw new Error('CONFLICT');
      }
      if (args?.[0] === 'status' && args?.includes('--porcelain')) {
        if (args.includes('--porcelain=2')) return '';
        if (rebaseContinued) return '';
        return 'UD moved-away.ts\n';
      }
      if (args?.[0] === 'rebase' && args?.includes('--continue')) {
        rebaseContinued = true;
        return '';
      }
      return '';
    });

    const result = await rebaseInIsolationDetailed(branch, projectDir);
    expect(result.ok).toBe(true);
    expect(findCall(['rm', '-f', '--', 'moved-away.ts'])).toBeDefined();
  });

  it('skips empty commits when --continue fails with empty error', async () => {
    let stage = 0;
    mockExec.mockImplementation((_cmd: string, args: string[]) => {
      if (args?.[0] === 'rebase' && args?.includes('origin/main')) {
        throw new Error('CONFLICT');
      }
      if (args?.[0] === 'status' && args?.includes('--porcelain')) {
        if (args.includes('--porcelain=2')) return stage >= 2 ? '' : '# rebasing\n';
        return stage === 0 ? 'DD stale.md\n' : '';
      }
      if (args?.[0] === 'rebase' && args?.includes('--continue')) {
        stage = 1;
        throw new Error('empty commit');
      }
      if (args?.[0] === 'rebase' && args?.includes('--skip')) {
        stage = 2;
        return '';
      }
      return '';
    });

    const result = await rebaseInIsolationDetailed(branch, projectDir);
    expect(result.ok).toBe(true);
    expect(findCall(['rebase', '--skip'])).toBeDefined();
  });

  it('returns reason=push when push fails after successful rebase', async () => {
    mockExec.mockImplementation((_cmd: string, args: string[]) => {
      if (args?.includes('push')) {
        throw new Error('stale ref');
      }
      return '';
    });

    const result = await rebaseInIsolationDetailed(branch, projectDir);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('push');
  });

  it('always removes the worktree on exit', async () => {
    mockExec.mockImplementation((_cmd: string, args: string[]) => {
      if (args?.[0] === 'rebase' && args?.includes('origin/main')) {
        throw new Error('fail');
      }
      if (args?.[0] === 'status' && args?.includes('--porcelain')) {
        return 'UU src/foo.ts\n';
      }
      return '';
    });

    await rebaseInIsolationDetailed(branch, projectDir);
    expect(findCall(['worktree', 'remove', '--force'])).toBeDefined();
  });
});
