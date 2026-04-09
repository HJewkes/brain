import { execFileSync } from 'node:child_process';
import { findAgentByTask } from './data.js';

export interface BranchDiff {
  taskId: string;
  branch: string;
  changedFiles: string[];
}

export interface FileConflict {
  file: string;
  branches: string[];
  taskIds: string[];
}

export interface WaveReviewResult {
  wave: number;
  taskCount: number;
  branches: BranchDiff[];
  conflicts: FileConflict[];
  hasConflicts: boolean;
  typecheckPassed: boolean | null;
  lintPassed: boolean | null;
  summary: string;
}

/**
 * Get the list of files changed on a branch relative to main.
 */
function diffBranchFiles(branch: string, projectDir: string): string[] {
  try {
    const output = execFileSync('git', ['diff', '--name-only', `main...${branch}`], {
      cwd: projectDir,
      encoding: 'utf-8',
      stdio: 'pipe',
    });
    return output.trim().split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Collect diffs for all agent branches in a wave.
 */
function collectBranchDiffs(db: unknown, taskIds: string[], projectDir: string): BranchDiff[] {
  const diffs: BranchDiff[] = [];

  for (const taskId of taskIds) {
    const agent = findAgentByTask(db, taskId);
    if (!agent?.branch) continue;

    const changedFiles = diffBranchFiles(agent.branch, projectDir);
    if (changedFiles.length > 0) {
      diffs.push({ taskId, branch: agent.branch, changedFiles });
    }
  }

  return diffs;
}

/**
 * Detect file-level conflicts: files modified by more than one branch.
 */
function detectFileConflicts(diffs: BranchDiff[]): FileConflict[] {
  const fileMap = new Map<string, { branches: string[]; taskIds: string[] }>();

  for (const diff of diffs) {
    for (const file of diff.changedFiles) {
      const entry = fileMap.get(file);
      if (entry) {
        entry.branches.push(diff.branch);
        entry.taskIds.push(diff.taskId);
      } else {
        fileMap.set(file, {
          branches: [diff.branch],
          taskIds: [diff.taskId],
        });
      }
    }
  }

  const conflicts: FileConflict[] = [];
  for (const [file, entry] of fileMap) {
    if (entry.branches.length > 1) {
      conflicts.push({ file, ...entry });
    }
  }

  return conflicts;
}

/**
 * Run typecheck on a temporary merge of all wave branches.
 * Creates a temporary branch, merges all wave branches into it,
 * runs tsc, then cleans up.
 */
function runTypecheckOnMergedView(branches: string[], projectDir: string): boolean | null {
  if (branches.length === 0) return null;

  const tmpBranch = `wave-review-${Date.now()}`;
  try {
    execFileSync('git', ['checkout', '-b', tmpBranch, 'main'], {
      cwd: projectDir,
      encoding: 'utf-8',
      stdio: 'pipe',
    });

    for (const branch of branches) {
      try {
        execFileSync('git', ['merge', '--no-edit', branch], {
          cwd: projectDir,
          encoding: 'utf-8',
          stdio: 'pipe',
        });
      } catch {
        // Merge conflict — abort and report failure
        try {
          execFileSync('git', ['merge', '--abort'], {
            cwd: projectDir,
            encoding: 'utf-8',
            stdio: 'pipe',
          });
        } catch {
          /* already aborted */
        }
        return false;
      }
    }

    try {
      execFileSync('npx', ['tsc', '--noEmit'], {
        cwd: projectDir,
        encoding: 'utf-8',
        stdio: 'pipe',
        timeout: 120_000,
      });
      return true;
    } catch {
      return false;
    }
  } catch {
    return null;
  } finally {
    // Clean up: return to main, delete tmp branch
    try {
      execFileSync('git', ['checkout', 'main'], {
        cwd: projectDir,
        encoding: 'utf-8',
        stdio: 'pipe',
      });
    } catch {
      /* best effort */
    }
    try {
      execFileSync('git', ['branch', '-D', tmpBranch], {
        cwd: projectDir,
        encoding: 'utf-8',
        stdio: 'pipe',
      });
    } catch {
      /* best effort */
    }
  }
}

/**
 * Run lint on a temporary merge of all wave branches.
 * Assumes the merged view branch is already checked out (called after typecheck).
 */
function runLintOnMergedView(branches: string[], projectDir: string): boolean | null {
  if (branches.length === 0) return null;

  const tmpBranch = `wave-review-lint-${Date.now()}`;
  try {
    execFileSync('git', ['checkout', '-b', tmpBranch, 'main'], {
      cwd: projectDir,
      encoding: 'utf-8',
      stdio: 'pipe',
    });

    for (const branch of branches) {
      try {
        execFileSync('git', ['merge', '--no-edit', branch], {
          cwd: projectDir,
          encoding: 'utf-8',
          stdio: 'pipe',
        });
      } catch {
        try {
          execFileSync('git', ['merge', '--abort'], {
            cwd: projectDir,
            encoding: 'utf-8',
            stdio: 'pipe',
          });
        } catch {
          /* already aborted */
        }
        return false;
      }
    }

    try {
      execFileSync('npx', ['eslint', '.'], {
        cwd: projectDir,
        encoding: 'utf-8',
        stdio: 'pipe',
        timeout: 120_000,
      });
      return true;
    } catch {
      return false;
    }
  } catch {
    return null;
  } finally {
    try {
      execFileSync('git', ['checkout', 'main'], {
        cwd: projectDir,
        encoding: 'utf-8',
        stdio: 'pipe',
      });
    } catch {
      /* best effort */
    }
    try {
      execFileSync('git', ['branch', '-D', tmpBranch], {
        cwd: projectDir,
        encoding: 'utf-8',
        stdio: 'pipe',
      });
    } catch {
      /* best effort */
    }
  }
}

function buildSummary(result: Omit<WaveReviewResult, 'summary'>): string {
  const lines: string[] = [
    `Wave ${result.wave}: ${result.taskCount} task(s), ${result.branches.length} branch(es)`,
  ];

  if (result.conflicts.length > 0) {
    lines.push(`CONFLICTS (${result.conflicts.length}):`);
    for (const c of result.conflicts) {
      lines.push(`  ${c.file} — modified by ${c.taskIds.join(', ')}`);
    }
  }

  if (result.typecheckPassed === false) {
    lines.push('Typecheck: FAILED on merged view');
  } else if (result.typecheckPassed === true) {
    lines.push('Typecheck: passed');
  }

  if (result.lintPassed === false) {
    lines.push('Lint: FAILED on merged view');
  } else if (result.lintPassed === true) {
    lines.push('Lint: passed');
  }

  if (!result.hasConflicts && result.typecheckPassed !== false && result.lintPassed !== false) {
    lines.push('Status: CLEAN — safe to proceed to next wave');
  } else {
    lines.push('Status: BLOCKED — review required before next wave');
  }

  return lines.join('\n');
}

/**
 * Run a post-wave review: diff branches, detect conflicts, run checks.
 *
 * Returns a WaveReviewResult describing the wave health. When hasConflicts
 * is true the caller should pause before proceeding to the next wave.
 */
export function reviewWave(
  db: unknown,
  waveNumber: number,
  taskIds: string[],
  projectDir: string
): WaveReviewResult {
  const diffs = collectBranchDiffs(db, taskIds, projectDir);
  const conflicts = detectFileConflicts(diffs);
  const hasConflicts = conflicts.length > 0;
  const branches = diffs.map((d) => d.branch);

  // Only run typecheck/lint when there are branches and no git-level conflicts
  let typecheckPassed: boolean | null = null;
  let lintPassed: boolean | null = null;

  if (branches.length > 0 && !hasConflicts) {
    typecheckPassed = runTypecheckOnMergedView(branches, projectDir);
    lintPassed = runLintOnMergedView(branches, projectDir);
  } else if (hasConflicts) {
    // Skip merged-view checks when conflicts exist (merge would fail)
    typecheckPassed = null;
    lintPassed = null;
  }

  const partial = {
    wave: waveNumber,
    taskCount: taskIds.length,
    branches: diffs,
    conflicts,
    hasConflicts,
    typecheckPassed,
    lintPassed,
  };

  return { ...partial, summary: buildSummary(partial) };
}
