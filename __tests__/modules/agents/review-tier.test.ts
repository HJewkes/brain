import { afterEach, describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import type { TaskMetadata } from '../../../src/modules/pm/types.js';
import {
  computeReviewTier,
  getChangedFiles,
  getDiffStats,
  type ReviewTier,
  type ReviewTierInput,
} from '../../../src/modules/agents/review-tier.js';

vi.mock('node:child_process', () => ({
  execFileSync: vi.fn(),
}));

const mockExec = execFileSync as ReturnType<typeof vi.fn>;

function makeTask(overrides: Partial<TaskMetadata & { review_tier?: ReviewTier }> = {}) {
  const base: TaskMetadata = {
    display_id: 'TEST-01.01',
    project: 'TEST',
    workstream: 1,
    number: 1,
    status: 'pending',
    mode: 'agent',
    category: 'feature',
    priority: 'medium',
  };
  return { ...base, ...overrides };
}

function makeInput(overrides: Partial<ReviewTierInput> = {}): ReviewTierInput {
  return {
    task: makeTask(),
    diffStats: { filesChanged: 0, insertions: 0, deletions: 0 },
    filePaths: [],
    downstreamCount: 0,
    ...overrides,
  };
}

describe('computeReviewTier', () => {
  it('returns ci-only for a small docs change', () => {
    const result = computeReviewTier(
      makeInput({
        task: makeTask({ category: 'documentation', priority: 'low' }),
        diffStats: { filesChanged: 1, insertions: 30, deletions: 20 },
        filePaths: ['README.md'],
      })
    );
    expect(result.tier).toBe('ci-only');
    expect(result.score).toBe(0);
  });

  it('returns ci-only for a standard medium bug fix', () => {
    const result = computeReviewTier(
      makeInput({
        task: makeTask({ category: 'bug', priority: 'medium' }),
        diffStats: { filesChanged: 1, insertions: 40, deletions: 40 },
        filePaths: ['src/services/foo.ts'],
        downstreamCount: 1,
      })
    );
    expect(result.tier).toBe('ci-only');
    expect(result.score).toBe(2);
    expect(result.breakdown).toMatchObject({ priority: 1, category: 1 });
  });

  it('returns ai-review for a high-priority feature with moderate diff and downstream impact', () => {
    const result = computeReviewTier(
      makeInput({
        task: makeTask({ category: 'feature', priority: 'high' }),
        diffStats: { filesChanged: 4, insertions: 200, deletions: 80 },
        filePaths: ['src/services/bar.ts'],
        downstreamCount: 2,
      })
    );
    expect(result.tier).toBe('ai-review');
    expect(result.score).toBe(5);
    expect(result.breakdown).toMatchObject({
      priority: 2,
      category: 1,
      'diff-size': 1,
      'blast-radius': 1,
    });
  });

  it('returns human-review for a high-priority infrastructure change', () => {
    const result = computeReviewTier(
      makeInput({
        task: makeTask({ category: 'infrastructure', priority: 'high' }),
        diffStats: { filesChanged: 5, insertions: 180, deletions: 120 },
        filePaths: ['scripts/deploy.ts'],
        downstreamCount: 3,
      })
    );
    expect(result.tier).toBe('human-review');
    expect(result.score).toBeGreaterThanOrEqual(7);
  });

  it('returns human-review for a critical migration touching contract files', () => {
    const result = computeReviewTier(
      makeInput({
        task: makeTask({ category: 'migration', priority: 'critical' }),
        diffStats: { filesChanged: 3, insertions: 300, deletions: 100 },
        filePaths: ['src/modules/pm/types.ts'],
        downstreamCount: 5,
      })
    );
    expect(result.tier).toBe('human-review');
    expect(result.breakdown['contract-change']).toBe(2);
    expect(result.breakdown.priority).toBe(4);
    expect(result.breakdown.category).toBe(3);
  });

  it('scores security-path files highest even when other patterns also match', () => {
    const result = computeReviewTier(
      makeInput({
        task: makeTask({ category: 'documentation', priority: 'low' }),
        diffStats: { filesChanged: 1, insertions: 10, deletions: 10 },
        filePaths: ['src/auth/token.ts'],
      })
    );
    expect(result.breakdown['security-path']).toBe(3);
    expect(result.breakdown['contract-change']).toBeUndefined();
    expect(result.tier).toBe('ci-only');
    expect(result.score).toBe(3);
  });

  it('escalates security-path change to ai-review when paired with high priority', () => {
    const result = computeReviewTier(
      makeInput({
        task: makeTask({ category: 'improvement', priority: 'high' }),
        diffStats: { filesChanged: 1, insertions: 10, deletions: 10 },
        filePaths: ['src/security/crypto.ts'],
      })
    );
    expect(result.tier).toBe('ai-review');
    expect(result.score).toBe(6);
  });

  it('honors task-level review_tier override and skips scoring', () => {
    const result = computeReviewTier(
      makeInput({
        task: makeTask({
          category: 'feature',
          priority: 'medium',
          review_tier: 'human-review',
        }),
        diffStats: { filesChanged: 1, insertions: 10, deletions: 0 },
      })
    );
    expect(result.tier).toBe('human-review');
    expect(result.breakdown).toHaveProperty('override');
    expect(result.breakdown).not.toHaveProperty('priority');
  });

  it('forces human-review when task mode is review', () => {
    const result = computeReviewTier(makeInput({ task: makeTask({ mode: 'review' }) }));
    expect(result.tier).toBe('human-review');
    expect(result.breakdown).toHaveProperty('mode-override');
  });

  it('forces human-review when task mode is human', () => {
    const result = computeReviewTier(makeInput({ task: makeTask({ mode: 'human' }) }));
    expect(result.tier).toBe('human-review');
    expect(result.breakdown).toHaveProperty('mode-override');
  });

  it('respects a custom human threshold', () => {
    const midRisk = makeInput({
      task: makeTask({ category: 'feature', priority: 'high' }),
      diffStats: { filesChanged: 2, insertions: 100, deletions: 60 },
      filePaths: ['src/services/bar.ts'],
      downstreamCount: 2,
    });
    const defaultResult = computeReviewTier(midRisk);
    const strictResult = computeReviewTier(midRisk, 4);
    expect(defaultResult.score).toBe(4);
    expect(defaultResult.tier).toBe('ai-review');
    expect(strictResult.tier).toBe('human-review');
    expect(defaultResult.score).toBe(strictResult.score);
  });

  it('adds blast-radius 2 when downstreamCount >= 5', () => {
    const result = computeReviewTier(
      makeInput({
        task: makeTask({ category: 'feature', priority: 'low' }),
        downstreamCount: 6,
      })
    );
    expect(result.breakdown['blast-radius']).toBe(2);
  });
});

describe('getDiffStats', () => {
  afterEach(() => {
    mockExec.mockReset();
  });

  it('parses git diff --stat summary line', () => {
    mockExec.mockReturnValueOnce(
      ' src/a.ts | 5 +++++\n src/b.ts | 3 ---\n 2 files changed, 5 insertions(+), 3 deletions(-)\n'
    );
    const stats = getDiffStats('feature', 'main', '/tmp/p');
    expect(stats).toEqual({ filesChanged: 2, insertions: 5, deletions: 3 });
  });

  it('handles singular forms (1 file changed, 1 insertion)', () => {
    mockExec.mockReturnValueOnce(' src/a.ts | 1 +\n 1 file changed, 1 insertion(+)\n');
    const stats = getDiffStats('feature', 'main', '/tmp/p');
    expect(stats).toEqual({ filesChanged: 1, insertions: 1, deletions: 0 });
  });

  it('returns zeros when git invocation fails', () => {
    mockExec.mockImplementationOnce(() => {
      throw new Error('git failure');
    });
    const stats = getDiffStats('bad', 'main', '/tmp/p');
    expect(stats).toEqual({ filesChanged: 0, insertions: 0, deletions: 0 });
  });
});

describe('getChangedFiles', () => {
  afterEach(() => {
    mockExec.mockReset();
  });

  it('splits name-only output into an array and drops blanks', () => {
    mockExec.mockReturnValueOnce('src/a.ts\nsrc/b.ts\n\n');
    const files = getChangedFiles('feature', 'main', '/tmp/p');
    expect(files).toEqual(['src/a.ts', 'src/b.ts']);
  });

  it('returns [] on failure', () => {
    mockExec.mockImplementationOnce(() => {
      throw new Error('boom');
    });
    expect(getChangedFiles('x', 'y', '/tmp/p')).toEqual([]);
  });
});
