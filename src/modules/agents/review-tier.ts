import { execFileSync } from 'node:child_process';
import type { TaskCategory, TaskMetadata, TaskPriority } from '../pm/types.js';

export type ReviewTier = 'ci-only' | 'ai-review' | 'human-review';

export interface DiffStats {
  filesChanged: number;
  insertions: number;
  deletions: number;
}

export interface ReviewTierInput {
  task: TaskMetadata & { review_tier?: ReviewTier };
  diffStats: DiffStats;
  filePaths: string[];
  downstreamCount: number;
}

export interface ReviewTierResult {
  tier: ReviewTier;
  score: number;
  breakdown: Record<string, number>;
}

const PRIORITY_SCORES: Record<TaskPriority, number> = {
  critical: 4,
  high: 2,
  medium: 1,
  low: 0,
};

const HIGH_RISK_CATEGORIES: TaskCategory[] = ['infrastructure', 'migration'];
// Refactors touch production code and warrant the same standard scoring as
// feature/improvement/bug — never score them as 0.
const STANDARD_CATEGORIES: TaskCategory[] = ['feature', 'improvement', 'bug', 'refactor'];

// Sorted by points descending so the first match is the highest-severity one.
const SENSITIVE_PATHS: ReadonlyArray<{ pattern: RegExp; points: number; label: string }> = [
  { pattern: /\/(protocol|auth|security)\//i, points: 3, label: 'security-path' },
  { pattern: /\/types\.ts$|\/schema\/|\/migration/i, points: 2, label: 'contract-change' },
  { pattern: /\/cli\.ts$/i, points: 1, label: 'entry-point' },
]
  .slice()
  .sort((a, b) => b.points - a.points);

const DEFAULT_AI_THRESHOLD = 4;
const DEFAULT_HUMAN_THRESHOLD = 7;
/** Score marker used when a task-level review_tier override short-circuits scoring. */
export const OVERRIDE_SCORE = -1;
/** Score marker used when task mode forces human review (e.g. mode: 'review' or 'human'). */
export const MODE_OVERRIDE_SCORE = -2;

export function computeReviewTier(
  input: ReviewTierInput,
  humanThreshold?: number
): ReviewTierResult {
  const override = checkOverrides(input.task);
  if (override) return override;

  const breakdown: Record<string, number> = {};
  let score = 0;
  score += addScore(breakdown, 'priority', PRIORITY_SCORES[input.task.priority] ?? 0);
  score += addScore(breakdown, 'category', scoreCategory(input.task.category));
  score += addScore(breakdown, 'diff-size', scoreDiff(input.diffStats));
  const fileMatch = scoreFiles(input.filePaths);
  if (fileMatch) score += addScore(breakdown, fileMatch.label, fileMatch.points);
  score += addScore(breakdown, 'blast-radius', scoreBlast(input.downstreamCount));

  const hThreshold = humanThreshold ?? DEFAULT_HUMAN_THRESHOLD;
  const tier: ReviewTier =
    score >= hThreshold ? 'human-review' : score >= DEFAULT_AI_THRESHOLD ? 'ai-review' : 'ci-only';
  return { tier, score, breakdown };
}

function checkOverrides(
  task: TaskMetadata & { review_tier?: ReviewTier }
): ReviewTierResult | null {
  if (task.review_tier) {
    return {
      tier: task.review_tier,
      score: OVERRIDE_SCORE,
      breakdown: { override: OVERRIDE_SCORE },
    };
  }
  if (task.mode === 'review' || task.mode === 'human') {
    return {
      tier: 'human-review',
      score: MODE_OVERRIDE_SCORE,
      breakdown: { 'mode-override': MODE_OVERRIDE_SCORE },
    };
  }
  return null;
}

function addScore(breakdown: Record<string, number>, label: string, points: number): number {
  if (points > 0) breakdown[label] = points;
  return points;
}

function scoreCategory(category: TaskCategory): number {
  if (HIGH_RISK_CATEGORIES.includes(category)) return 3;
  if (STANDARD_CATEGORIES.includes(category)) return 1;
  return 0;
}

function scoreDiff(diff: DiffStats): number {
  const total = diff.insertions + diff.deletions;
  if (total > 500) return 2;
  if (total > 200) return 1;
  return 0;
}

function scoreFiles(filePaths: string[]): { label: string; points: number } | null {
  for (const { pattern, points, label } of SENSITIVE_PATHS) {
    if (filePaths.some((f) => pattern.test(f))) return { label, points };
  }
  return null;
}

function scoreBlast(downstreamCount: number): number {
  if (downstreamCount >= 5) return 2;
  if (downstreamCount >= 2) return 1;
  return 0;
}

export function getDiffStats(branch: string, base: string, projectDir: string): DiffStats {
  try {
    const stat = execFileSync('git', ['diff', '--stat', `${base}...${branch}`], {
      cwd: projectDir,
      encoding: 'utf-8',
      stdio: 'pipe',
    });
    const summary = stat.trim().split('\n').pop() ?? '';
    const files = parseInt(summary.match(/(\d+)\s+files?\s+changed/)?.[1] ?? '0', 10);
    const ins = parseInt(summary.match(/(\d+)\s+insertions?/)?.[1] ?? '0', 10);
    const del = parseInt(summary.match(/(\d+)\s+deletions?/)?.[1] ?? '0', 10);
    return { filesChanged: files, insertions: ins, deletions: del };
  } catch {
    return { filesChanged: 0, insertions: 0, deletions: 0 };
  }
}

export function getChangedFiles(branch: string, base: string, projectDir: string): string[] {
  try {
    const output = execFileSync('git', ['diff', '--name-only', `${base}...${branch}`], {
      cwd: projectDir,
      encoding: 'utf-8',
      stdio: 'pipe',
    });
    return output.trim().split('\n').filter(Boolean);
  } catch {
    return [];
  }
}
