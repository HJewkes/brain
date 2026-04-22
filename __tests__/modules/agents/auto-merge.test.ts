import { describe, it, expect, vi, beforeEach } from 'vitest';
import { execFileSync } from 'node:child_process';

vi.mock('node:child_process', () => ({
  execFileSync: vi.fn(),
}));

const mockExecFileSync = execFileSync as ReturnType<typeof vi.fn>;

import {
  getPrForBranch,
  mergePr,
  tryAutoMerge,
  pullMain,
  rerunPrChecks,
} from '../../../src/modules/agents/auto-merge.js';

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
          statusCheckRollup: [{ conclusion: 'SUCCESS', state: 'COMPLETED' }],
        })
      );

      const result = getPrForBranch('feat/task-01', '/repo');

      expect(result).toEqual({
        number: 42,
        branch: 'feat/task-01',
        checksPass: true,
        mergeable: true,
        state: 'open',
        failedChecks: [],
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

    it('treats null statusCheckRollup as checks passing', () => {
      mockExecFileSync.mockReturnValue(
        JSON.stringify({
          number: 5,
          headRefName: 'feat/no-checks',
          state: 'OPEN',
          mergeable: 'MERGEABLE',
          statusCheckRollup: null,
        })
      );

      const result = getPrForBranch('feat/no-checks', '/repo');

      expect(result?.checksPass).toBe(true);
    });

    it('treats NEUTRAL conclusion as passing', () => {
      mockExecFileSync.mockReturnValue(
        JSON.stringify({
          number: 7,
          headRefName: 'feat/neutral',
          state: 'OPEN',
          mergeable: 'MERGEABLE',
          statusCheckRollup: [{ conclusion: 'NEUTRAL', state: 'COMPLETED' }],
        })
      );

      const result = getPrForBranch('feat/neutral', '/repo');

      expect(result?.checksPass).toBe(true);
    });

    it('reports checks failing when a check has ERROR state and no conclusion', () => {
      mockExecFileSync.mockReturnValue(
        JSON.stringify({
          number: 8,
          headRefName: 'feat/error',
          state: 'OPEN',
          mergeable: 'MERGEABLE',
          statusCheckRollup: [{ conclusion: '', state: 'ERROR' }],
        })
      );

      const result = getPrForBranch('feat/error', '/repo');

      expect(result?.checksPass).toBe(false);
    });

    it('treats pending checks (no conclusion, non-failure state) as passing', () => {
      mockExecFileSync.mockReturnValue(
        JSON.stringify({
          number: 9,
          headRefName: 'feat/pending',
          state: 'OPEN',
          mergeable: 'MERGEABLE',
          statusCheckRollup: [{ conclusion: '', state: 'PENDING' }],
        })
      );

      const result = getPrForBranch('feat/pending', '/repo');

      expect(result?.checksPass).toBe(true);
    });

    it('reports not mergeable when mergeable is CONFLICTING', () => {
      mockExecFileSync.mockReturnValue(
        JSON.stringify({
          number: 11,
          headRefName: 'feat/conflict',
          state: 'OPEN',
          mergeable: 'CONFLICTING',
          statusCheckRollup: [],
        })
      );

      const result = getPrForBranch('feat/conflict', '/repo');

      expect(result?.mergeable).toBe(false);
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

    it('uses specified merge strategy', () => {
      mockExecFileSync.mockReturnValue('');

      mergePr(42, { projectDir: '/repo', strategy: 'rebase' });

      expect(mockExecFileSync).toHaveBeenCalledWith(
        'gh',
        ['pr', 'merge', '42', '--rebase', '--delete-branch'],
        expect.objectContaining({ cwd: '/repo' })
      );
    });

    it('skips pull when pullAfterMerge is false', () => {
      mockExecFileSync.mockReturnValue('');

      const result = mergePr(42, { projectDir: '/repo', pullAfterMerge: false });

      expect(result.merged).toBe(true);
      // update-branch API call + merge call = 2
      expect(mockExecFileSync).toHaveBeenCalledTimes(2);
      expect(mockExecFileSync).toHaveBeenCalledWith(
        'gh',
        expect.arrayContaining(['pr', 'merge']),
        expect.any(Object)
      );
    });

    it('does not attempt pull when merge fails', () => {
      let callCount = 0;
      mockExecFileSync.mockImplementation(() => {
        callCount++;
        // First call is update-branch (succeeds), second is merge (fails)
        if (callCount >= 2) throw new Error('gh merge failed');
        return '';
      });

      mergePr(42, { projectDir: '/repo' });

      // update-branch + merge attempt = 2
      expect(mockExecFileSync).toHaveBeenCalledTimes(2);
    });
  });

  describe('pullMain', () => {
    it('runs git pull --ff-only', () => {
      mockExecFileSync.mockReturnValue('');

      pullMain('/repo');

      expect(mockExecFileSync).toHaveBeenCalledWith(
        'git',
        ['pull', '--ff-only'],
        expect.objectContaining({ cwd: '/repo' })
      );
    });

    it('swallows errors silently', () => {
      mockExecFileSync.mockImplementation(() => {
        throw new Error('cannot fast-forward');
      });

      expect(() => pullMain('/repo')).not.toThrow();
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

    it('returns merged=true with no error for already merged PRs', () => {
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
      expect(result.error).toBeUndefined();
      expect(result.prNumber).toBe(42);
    });

    it('returns error when PR is closed', () => {
      mockExecFileSync.mockReturnValue(
        JSON.stringify({
          number: 42,
          headRefName: 'feat/task-01',
          state: 'CLOSED',
          mergeable: 'UNKNOWN',
          statusCheckRollup: [],
        })
      );

      const result = tryAutoMerge('feat/task-01', 'VNM-11.01', { projectDir: '/repo' });

      expect(result.merged).toBe(false);
      expect(result.error).toContain('closed');
      expect(result.prNumber).toBe(42);
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

    it('propagates merge error from gh command failure', () => {
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
        .mockImplementation(() => {
          throw new Error('gh: merge not allowed');
        });

      const result = tryAutoMerge('feat/task-01', 'VNM-11.01', { projectDir: '/repo' });

      expect(result.merged).toBe(false);
      expect(result.error).toContain('gh: merge not allowed');
      expect(result.taskId).toBe('VNM-11.01');
    });

    it('does not attempt merge for non-open PRs', () => {
      mockExecFileSync.mockReturnValue(
        JSON.stringify({
          number: 42,
          headRefName: 'feat/task-01',
          state: 'CLOSED',
          mergeable: 'UNKNOWN',
          statusCheckRollup: [],
        })
      );

      tryAutoMerge('feat/task-01', 'VNM-11.01', { projectDir: '/repo' });

      // Only one call: getPrForBranch. No merge call.
      expect(mockExecFileSync).toHaveBeenCalledTimes(1);
    });
  });

  describe('getPrForBranch failedChecks', () => {
    it('returns names of failing checks', () => {
      mockExecFileSync.mockReturnValue(
        JSON.stringify({
          number: 1,
          headRefName: 'b',
          state: 'OPEN',
          mergeable: 'MERGEABLE',
          statusCheckRollup: [
            { name: 'lint', conclusion: 'SUCCESS', state: 'COMPLETED' },
            { name: 'integration-tests', conclusion: 'FAILURE', state: 'COMPLETED' },
            { name: 'unit-tests', conclusion: 'FAILURE', state: 'COMPLETED' },
          ],
        })
      );

      const pr = getPrForBranch('b', '/repo');
      expect(pr?.checksPass).toBe(false);
      expect(pr?.failedChecks).toEqual(['integration-tests', 'unit-tests']);
    });

    it('returns empty failedChecks when all checks pass', () => {
      mockExecFileSync.mockReturnValue(
        JSON.stringify({
          number: 1,
          headRefName: 'b',
          state: 'OPEN',
          mergeable: 'MERGEABLE',
          statusCheckRollup: [{ name: 'ci', conclusion: 'SUCCESS', state: 'COMPLETED' }],
        })
      );

      const pr = getPrForBranch('b', '/repo');
      expect(pr?.failedChecks).toEqual([]);
    });
  });

  describe('rerunPrChecks', () => {
    it('reruns the latest failed run for a branch', () => {
      mockExecFileSync
        .mockReturnValueOnce(JSON.stringify([{ databaseId: 9999 }]))
        .mockReturnValueOnce('');

      const ok = rerunPrChecks('feat/x', '/repo');
      expect(ok).toBe(true);
      expect(mockExecFileSync).toHaveBeenNthCalledWith(
        1,
        'gh',
        ['run', 'list', '--branch', 'feat/x', '--limit', '1', '--json', 'databaseId'],
        expect.objectContaining({ cwd: '/repo' })
      );
      expect(mockExecFileSync).toHaveBeenNthCalledWith(
        2,
        'gh',
        ['run', 'rerun', '9999', '--failed'],
        expect.objectContaining({ cwd: '/repo' })
      );
    });

    it('returns false when no runs are found', () => {
      mockExecFileSync.mockReturnValueOnce(JSON.stringify([]));
      expect(rerunPrChecks('feat/x', '/repo')).toBe(false);
    });

    it('returns false when gh throws', () => {
      mockExecFileSync.mockImplementation(() => {
        throw new Error('gh failure');
      });
      expect(rerunPrChecks('feat/x', '/repo')).toBe(false);
    });
  });
});
