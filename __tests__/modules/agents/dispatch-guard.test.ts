import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('node:child_process', () => ({
  execFileSync: vi.fn(),
}));

import { execFileSync } from 'node:child_process';
import { checkAlreadyCompleted } from '../../../src/modules/agents/dispatch-guard.js';

const mockExecFileSync = execFileSync as ReturnType<typeof vi.fn>;

describe('checkAlreadyCompleted', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns alreadyDone true when git log finds a matching commit', () => {
    mockExecFileSync.mockReturnValue('a1b2c3d Add git-history dedup for VNM-10.15\n');

    const result = checkAlreadyCompleted('VNM-10.15', '/repo');

    expect(result.alreadyDone).toBe(true);
    expect(result.commitHash).toBe('a1b2c3d');
    expect(result.commitMessage).toBe('Add git-history dedup for VNM-10.15');
    expect(mockExecFileSync).toHaveBeenCalledWith(
      'git',
      ['log', '--oneline', '--grep', 'VNM-10.15', 'main'],
      { cwd: '/repo', encoding: 'utf-8', stdio: 'pipe' }
    );
  });

  it('returns alreadyDone false when git log finds no matches', () => {
    mockExecFileSync.mockReturnValue('');

    const result = checkAlreadyCompleted('VNM-10.99', '/repo');

    expect(result.alreadyDone).toBe(false);
    expect(result.commitHash).toBeUndefined();
    expect(result.commitMessage).toBeUndefined();
  });

  it('returns alreadyDone false when git log throws', () => {
    mockExecFileSync.mockImplementation(() => {
      throw new Error('not a git repository');
    });

    const result = checkAlreadyCompleted('VNM-10.01');

    expect(result.alreadyDone).toBe(false);
  });

  it('uses process.cwd() when no projectRoot is provided', () => {
    mockExecFileSync.mockReturnValue('');

    checkAlreadyCompleted('VNM-10.01');

    expect(mockExecFileSync).toHaveBeenCalledWith(
      'git',
      ['log', '--oneline', '--grep', 'VNM-10.01', 'main'],
      { cwd: process.cwd(), encoding: 'utf-8', stdio: 'pipe' }
    );
  });

  it('picks the first commit when multiple matches exist', () => {
    mockExecFileSync.mockReturnValue(
      'abc1234 First commit for VNM-10.02\ndef5678 Second commit for VNM-10.02\n'
    );

    const result = checkAlreadyCompleted('VNM-10.02', '/repo');

    expect(result.alreadyDone).toBe(true);
    expect(result.commitHash).toBe('abc1234');
    expect(result.commitMessage).toBe('First commit for VNM-10.02');
  });

  it('handles whitespace-only git output as no match', () => {
    mockExecFileSync.mockReturnValue('  \n  \n');

    const result = checkAlreadyCompleted('VNM-10.03', '/repo');

    expect(result.alreadyDone).toBe(false);
  });
});
