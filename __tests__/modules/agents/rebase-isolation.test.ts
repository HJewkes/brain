import { describe, it, expect, vi, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';

vi.mock('node:child_process', () => ({
  execFileSync: vi.fn(),
}));

import { rebaseInIsolation } from '../../../src/modules/agents/rebase-isolation.js';

const mockExec = execFileSync as ReturnType<typeof vi.fn>;
const branch = 'agent/vnm-48/VNM-48.101';
const projectDir = '/tmp/test-project';

describe('rebaseInIsolation', () => {
  afterEach(() => vi.restoreAllMocks());

  it('creates worktree, checks out branch, fetches, rebases, pushes, and cleans up', async () => {
    mockExec.mockReturnValue('');

    const result = await rebaseInIsolation(branch, projectDir);

    expect(result).toBe(true);

    const calls = mockExec.mock.calls;
    // 1. worktree add --detach
    expect(calls[0][0]).toBe('git');
    expect(calls[0][1]).toContain('worktree');
    expect(calls[0][1]).toContain('add');
    expect(calls[0][1]).toContain('--detach');

    // 2. checkout branch
    expect(calls[1][1]).toEqual(['checkout', branch]);

    // 3. fetch origin main
    expect(calls[2][1]).toEqual(['fetch', 'origin', 'main']);

    // 4. rebase origin/main
    expect(calls[3][1]).toEqual(['rebase', 'origin/main']);

    // 5. push --force-with-lease
    expect(calls[4][1]).toContain('push');
    expect(calls[4][1]).toContain('--force-with-lease');

    // 6. cleanup: worktree remove (in finally)
    expect(calls[5][1]).toContain('worktree');
    expect(calls[5][1]).toContain('remove');
  });

  it('returns false and aborts rebase on conflict', async () => {
    let callCount = 0;
    mockExec.mockImplementation((cmd: string, args: string[]) => {
      callCount++;
      // Fail on rebase (4th call)
      if (callCount === 4 && args?.includes('rebase') && args?.includes('origin/main')) {
        throw new Error('CONFLICT');
      }
      return '';
    });

    const result = await rebaseInIsolation(branch, projectDir);

    expect(result).toBe(false);
    // Should have attempted rebase --abort
    const abortCall = mockExec.mock.calls.find(
      (c) => c[1]?.includes('rebase') && c[1]?.includes('--abort')
    );
    expect(abortCall).toBeDefined();
  });

  it('cleans up worktree even when rebase fails', async () => {
    let callCount = 0;
    mockExec.mockImplementation((_cmd: string, args: string[]) => {
      callCount++;
      if (callCount === 4) throw new Error('rebase failed');
      return '';
    });

    await rebaseInIsolation(branch, projectDir);

    // Finally block should remove worktree
    const removeCall = mockExec.mock.calls.find(
      (c) => c[1]?.includes('worktree') && c[1]?.includes('remove')
    );
    expect(removeCall).toBeDefined();
  });

  it('returns false when worktree creation fails', async () => {
    mockExec.mockImplementation(() => {
      throw new Error('worktree add failed');
    });

    const result = await rebaseInIsolation(branch, projectDir);

    expect(result).toBe(false);
  });

  it('uses a timestamped worktree path under .worktrees', async () => {
    mockExec.mockReturnValue('');

    await rebaseInIsolation(branch, projectDir);

    const worktreePath = mockExec.mock.calls[0][1][3]; // 4th arg to git worktree add --detach <path>
    expect(worktreePath).toMatch(/\/tmp\/test-project\/\.worktrees\/rebase-\d+/);
  });
});
