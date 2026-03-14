import { describe, it, expect, vi, beforeEach } from 'vitest';
import { execFileSync } from 'node:child_process';

vi.mock('node:child_process', () => ({
  execFileSync: vi.fn(),
}));

const mockExecFileSync = execFileSync as ReturnType<typeof vi.fn>;

import {
  detectConflicts,
  tryRebase,
  recoverConflict,
} from '../../../src/modules/agents/conflict-recovery.js';

describe('conflict-recovery', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe('detectConflicts', () => {
    it('returns true when PR is CONFLICTING', () => {
      mockExecFileSync.mockReturnValue(JSON.stringify({ mergeable: 'CONFLICTING' }));
      expect(detectConflicts('feat/x', '/repo')).toBe(true);
    });

    it('returns false when PR is MERGEABLE', () => {
      mockExecFileSync.mockReturnValue(JSON.stringify({ mergeable: 'MERGEABLE' }));
      expect(detectConflicts('feat/x', '/repo')).toBe(false);
    });

    it('returns false when gh fails', () => {
      mockExecFileSync.mockImplementation(() => {
        throw new Error('not found');
      });
      expect(detectConflicts('feat/x', '/repo')).toBe(false);
    });
  });

  describe('tryRebase', () => {
    it('rebases and pushes on success', () => {
      mockExecFileSync.mockReturnValue('');

      const result = tryRebase('feat/x', '/repo');

      expect(result.success).toBe(true);
      expect(result.hasConflicts).toBe(false);
    });

    it('aborts rebase on conflict', () => {
      let callCount = 0;
      mockExecFileSync.mockImplementation((_cmd: string, args: string[]) => {
        callCount++;
        // checkout succeeds, rebase fails
        if (args[0] === 'rebase' && args[1] === 'main') {
          throw new Error('CONFLICT');
        }
        return '';
      });

      const result = tryRebase('feat/x', '/repo');

      expect(result.success).toBe(false);
      expect(result.hasConflicts).toBe(true);
    });
  });

  describe('recoverConflict', () => {
    it('returns resolved when no conflicts detected', () => {
      mockExecFileSync.mockReturnValue(JSON.stringify({ mergeable: 'MERGEABLE' }));

      const result = recoverConflict('feat/x', 'VNM-11.01', '/repo');

      expect(result.resolved).toBe(true);
      expect(result.strategy).toBe('rebase');
    });

    it('attempts rebase when conflicts exist', () => {
      // First call: detectConflicts (CONFLICTING)
      // Then: checkout, rebase, push, checkout main
      mockExecFileSync
        .mockReturnValueOnce(JSON.stringify({ mergeable: 'CONFLICTING' }))
        .mockReturnValue(''); // all git ops succeed

      const result = recoverConflict('feat/x', 'VNM-11.01', '/repo');

      expect(result.resolved).toBe(true);
      expect(result.strategy).toBe('rebase');
    });

    it('returns redispatch strategy on complex conflicts', () => {
      let callCount = 0;
      mockExecFileSync.mockImplementation((_cmd: string, args: string[]) => {
        callCount++;
        if (callCount === 1) {
          return JSON.stringify({ mergeable: 'CONFLICTING' });
        }
        if (args[0] === 'rebase' && args[1] === 'main') {
          throw new Error('CONFLICT');
        }
        return '';
      });

      const result = recoverConflict('feat/x', 'VNM-11.01', '/repo');

      expect(result.resolved).toBe(false);
      expect(result.strategy).toBe('redispatch');
      expect(result.error).toContain('Complex conflicts');
    });
  });
});
