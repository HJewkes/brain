import { describe, it, expect, vi, beforeEach } from 'vitest';
import { execFileSync } from 'node:child_process';

vi.mock('node:child_process', () => ({
  execFileSync: vi.fn(),
}));

const mockExecFileSync = execFileSync as ReturnType<typeof vi.fn>;

import { getPrForBranch, mergePr, tryAutoMerge } from '../../../src/modules/agents/auto-merge.js';

describe('auto-merge', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe('getPrForBranch', () => {
    it('returns PR status when gh succeeds', () => {
      mockExecFileSync.mockReturnValue(
        JSON.stringify({
          number: 42,
          headRefName: 'feat/task-01',
          state: 'OPEN',
          mergeable: 'MERGEABLE',
          statusCheckRollup: [
            { conclusion: 'SUCCESS', state: 'COMPLETED' },
          ],
        })
      );

      const result = getPrForBranch('feat/task-01', '/repo');

      expect(result).toEqual({
        number: 42,
        branch: 'feat/task-01',
        checksPass: true,
        mergeable: true,
        state: 'open',
      });
    });

    it('returns null when gh fails', () => {
      mockExecFileSync.mockImplementation(() => {
        throw new Error('no PR');
      });

      expect(getPrForBranch('nonexistent', '/repo')).toBeNull();
    });

    it('reports checks failing when a check has FAILURE conclusion', () => {
      mockExecFileSync.mockReturnValue(
        JSON.stringify({
          number: 10,
          headRefName: 'feat/x',
          state: 'OPEN',
          mergeable: 'MERGEABLE',
          statusCheckRollup: [
            { conclusion: 'SUCCESS', state: 'COMPLETED' },
            { conclusion: 'FAILURE', state: 'COMPLETED' },
          ],
        })
      );

      const result = getPrForBranch('feat/x', '/repo');
      expect(result?.checksPass).toBe(false);
    });
  });

  describe('mergePr', () => {
    it('merges and pulls on success', () => {
      mockExecFileSync.mockReturnValue('');

      const result = mergePr(42, { projectDir: '/repo' });

      expect(result.merged).toBe(true);
      expect(mockExecFileSync).toHaveBeenCalledWith(
        'gh',
        ['pr', 'merge', '42', '--squash', '--delete-branch'],
        expect.objectContaining({ cwd: '/repo' })
      );
      // Second call is git pull
      expect(mockExecFileSync).toHaveBeenCalledWith(
        'git',
        ['pull', '--ff-only'],
        expect.objectContaining({ cwd: '/repo' })
      );
    });

    it('returns error when merge fails', () => {
      mockExecFileSync.mockImplementation(() => {
        throw new Error('merge conflict');
      });

      const result = mergePr(42, { projectDir: '/repo' });

      expect(result.merged).toBe(false);
      expect(result.error).toContain('merge conflict');
    });
  });

  describe('tryAutoMerge', () => {
    it('merges when PR is open with passing checks', () => {
      mockExecFileSync
        .mockReturnValueOnce(
          JSON.stringify({
            number: 42,
            headRefName: 'feat/task-01',
            state: 'OPEN',
            mergeable: 'MERGEABLE',
            statusCheckRollup: [],
          })
        )
        .mockReturnValue(''); // merge + pull

      const result = tryAutoMerge('feat/task-01', 'VNM-11.01', { projectDir: '/repo' });

      expect(result.merged).toBe(true);
      expect(result.taskId).toBe('VNM-11.01');
    });

    it('skips merge when checks fail', () => {
      mockExecFileSync.mockReturnValue(
        JSON.stringify({
          number: 42,
          headRefName: 'feat/task-01',
          state: 'OPEN',
          mergeable: 'MERGEABLE',
          statusCheckRollup: [{ conclusion: 'FAILURE', state: 'COMPLETED' }],
        })
      );

      const result = tryAutoMerge('feat/task-01', 'VNM-11.01', { projectDir: '/repo' });

      expect(result.merged).toBe(false);
      expect(result.error).toContain('CI checks');
    });

    it('returns merged=true for already merged PRs', () => {
      mockExecFileSync.mockReturnValue(
        JSON.stringify({
          number: 42,
          headRefName: 'feat/task-01',
          state: 'MERGED',
          mergeable: 'UNKNOWN',
          statusCheckRollup: [],
        })
      );

      const result = tryAutoMerge('feat/task-01', 'VNM-11.01', { projectDir: '/repo' });

      expect(result.merged).toBe(true);
    });

    it('returns error when no PR found', () => {
      mockExecFileSync.mockImplementation(() => {
        throw new Error('no PR');
      });

      const result = tryAutoMerge('feat/task-01', 'VNM-11.01', { projectDir: '/repo' });

      expect(result.merged).toBe(false);
      expect(result.error).toContain('No PR found');
    });

    it('returns error when PR has conflicts', () => {
      mockExecFileSync.mockReturnValue(
        JSON.stringify({
          number: 42,
          headRefName: 'feat/task-01',
          state: 'OPEN',
          mergeable: 'CONFLICTING',
          statusCheckRollup: [],
        })
      );

      const result = tryAutoMerge('feat/task-01', 'VNM-11.01', { projectDir: '/repo' });

      expect(result.merged).toBe(false);
      expect(result.error).toContain('not mergeable');
    });
  });
});
