import { describe, it, expect, vi, beforeEach } from 'vitest';
import { execFileSync } from 'node:child_process';

vi.mock('node:child_process', () => ({
  execFileSync: vi.fn(),
}));

vi.mock('../../../src/modules/agents/data.js', () => ({
  findAgentByTask: vi.fn(),
}));

const mockExecFileSync = execFileSync as ReturnType<typeof vi.fn>;

import { findAgentByTask } from '../../../src/modules/agents/data.js';
import { reviewWave } from '../../../src/modules/agents/wave-review.js';

const mockFindAgent = findAgentByTask as ReturnType<typeof vi.fn>;
const fakeDb = {};

describe('wave-review', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('returns clean result when no branches have changes', () => {
    mockFindAgent.mockReturnValue({ branch: 'agent/VNM-45/VNM-45.01' });
    mockExecFileSync.mockReturnValue('');

    const result = reviewWave(fakeDb, 1, ['VNM-45.01'], '/repo');

    expect(result.wave).toBe(1);
    expect(result.taskCount).toBe(1);
    expect(result.branches).toHaveLength(0);
    expect(result.hasConflicts).toBe(false);
    expect(result.summary).toContain('CLEAN');
  });

  it('returns clean result when agents have no branch', () => {
    mockFindAgent.mockReturnValue({ branch: null });

    const result = reviewWave(fakeDb, 1, ['VNM-45.01'], '/repo');

    expect(result.branches).toHaveLength(0);
    expect(result.hasConflicts).toBe(false);
  });

  it('returns clean result when agent not found', () => {
    mockFindAgent.mockReturnValue(null);

    const result = reviewWave(fakeDb, 1, ['VNM-45.01'], '/repo');

    expect(result.branches).toHaveLength(0);
    expect(result.hasConflicts).toBe(false);
  });

  it('detects file-level conflicts across branches', () => {
    mockFindAgent
      .mockReturnValueOnce({ branch: 'agent/VNM-45/VNM-45.01' })
      .mockReturnValueOnce({ branch: 'agent/VNM-45/VNM-45.02' });

    mockExecFileSync
      // diff for branch 1
      .mockReturnValueOnce('src/shared.ts\nsrc/only-a.ts\n')
      // diff for branch 2
      .mockReturnValueOnce('src/shared.ts\nsrc/only-b.ts\n');

    const result = reviewWave(fakeDb, 1, ['VNM-45.01', 'VNM-45.02'], '/repo');

    expect(result.hasConflicts).toBe(true);
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0].file).toBe('src/shared.ts');
    expect(result.conflicts[0].taskIds).toContain('VNM-45.01');
    expect(result.conflicts[0].taskIds).toContain('VNM-45.02');
    expect(result.summary).toContain('CONFLICTS');
    expect(result.summary).toContain('BLOCKED');
  });

  it('reports no conflicts when branches touch different files', () => {
    mockFindAgent
      .mockReturnValueOnce({ branch: 'agent/VNM-45/VNM-45.01' })
      .mockReturnValueOnce({ branch: 'agent/VNM-45/VNM-45.02' });

    mockExecFileSync
      .mockReturnValueOnce('src/a.ts\n')
      .mockReturnValueOnce('src/b.ts\n')
      // typecheck merge: checkout, merge, tsc
      .mockReturnValue('');

    const result = reviewWave(fakeDb, 1, ['VNM-45.01', 'VNM-45.02'], '/repo');

    expect(result.hasConflicts).toBe(false);
    expect(result.conflicts).toHaveLength(0);
  });

  it('reports typecheck failure on merged view', () => {
    mockFindAgent.mockReturnValueOnce({ branch: 'agent/VNM-45/VNM-45.01' });

    // git diff --name-only
    mockExecFileSync.mockReturnValueOnce('src/a.ts\n');

    // Typecheck merge: checkout -b (ok), merge (ok), tsc (fail)
    mockExecFileSync
      .mockReturnValueOnce('') // git checkout -b
      .mockReturnValueOnce('') // git merge
      .mockImplementationOnce(() => {
        throw new Error('tsc error');
      }) // npx tsc
      .mockReturnValueOnce('') // git checkout main (cleanup)
      .mockReturnValueOnce('') // git branch -D (cleanup)
      // Lint merge: checkout -b, merge, eslint
      .mockReturnValueOnce('') // git checkout -b
      .mockReturnValueOnce('') // git merge
      .mockReturnValueOnce('') // eslint passes
      .mockReturnValueOnce('') // git checkout main (cleanup)
      .mockReturnValueOnce(''); // git branch -D (cleanup)

    const result = reviewWave(fakeDb, 1, ['VNM-45.01'], '/repo');

    expect(result.typecheckPassed).toBe(false);
    expect(result.summary).toContain('Typecheck: FAILED');
    expect(result.summary).toContain('BLOCKED');
  });

  it('skips typecheck and lint when conflicts are detected', () => {
    mockFindAgent
      .mockReturnValueOnce({ branch: 'agent/VNM-45/VNM-45.01' })
      .mockReturnValueOnce({ branch: 'agent/VNM-45/VNM-45.02' });

    mockExecFileSync.mockReturnValueOnce('src/shared.ts\n').mockReturnValueOnce('src/shared.ts\n');

    const result = reviewWave(fakeDb, 1, ['VNM-45.01', 'VNM-45.02'], '/repo');

    expect(result.hasConflicts).toBe(true);
    expect(result.typecheckPassed).toBeNull();
    expect(result.lintPassed).toBeNull();
  });

  it('handles git diff failure gracefully', () => {
    mockFindAgent.mockReturnValue({ branch: 'agent/VNM-45/VNM-45.01' });
    mockExecFileSync.mockImplementation(() => {
      throw new Error('git error');
    });

    const result = reviewWave(fakeDb, 1, ['VNM-45.01'], '/repo');

    expect(result.branches).toHaveLength(0);
    expect(result.hasConflicts).toBe(false);
  });

  it('summary includes wave number and task count', () => {
    mockFindAgent.mockReturnValue(null);

    const result = reviewWave(fakeDb, 3, ['VNM-45.01', 'VNM-45.02', 'VNM-45.03'], '/repo');

    expect(result.summary).toContain('Wave 3');
    expect(result.summary).toContain('3 task(s)');
  });
});
