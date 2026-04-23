import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

export type RebaseFailureReason = 'setup' | 'conflict' | 'push';

export interface RebaseResult {
  ok: boolean;
  /** Reason the rebase aborted. Absent on success. */
  reason?: RebaseFailureReason;
  /** Conflicting files (paths) at the point of abort. */
  conflicts?: string[];
  /** Short human-readable diagnostic (suitable for triage/pr-conflict surfaces). */
  detail?: string;
}

const MAX_TRIVIAL_ITERATIONS = 20;

/**
 * Rebase a branch onto origin/main in a temporary worktree.
 *
 * Using an isolated worktree prevents HEAD races when multiple delivery
 * monitors run concurrently — mutating the main repo's HEAD is unsafe
 * under parallelism.
 *
 * Trivial conflicts are auto-resolved:
 *   - Empty commits are dropped (--empty=drop + --skip on "empty" errors)
 *   - Delete/delete, deleted-by-us, deleted-by-them conflicts accept the delete
 *   - Rerere replays previously-recorded conflict resolutions
 *
 * Real content conflicts (UU/AA with non-trivial hunks) abort and surface
 * via RebaseResult so the caller can emit a pr-conflict triage entry.
 */
export async function rebaseInIsolationDetailed(
  branch: string,
  projectDir: string
): Promise<RebaseResult> {
  const tmpPath = resolve(projectDir, '.worktrees', `rebase-${Date.now()}`);
  let worktreeCreated = false;

  try {
    try {
      execFileSync('git', ['worktree', 'add', '--detach', tmpPath], {
        cwd: projectDir,
        encoding: 'utf-8',
        stdio: 'pipe',
      });
      worktreeCreated = true;

      execFileSync('git', ['checkout', branch], {
        cwd: tmpPath,
        encoding: 'utf-8',
        stdio: 'pipe',
      });

      execFileSync('git', ['fetch', 'origin', 'main'], {
        cwd: tmpPath,
        encoding: 'utf-8',
        stdio: 'pipe',
      });

      enableRerere(tmpPath);
    } catch (err) {
      return { ok: false, reason: 'setup', detail: errorMessage(err) };
    }

    const rebased = attemptRebaseWithTrivialRecovery(tmpPath);
    if (!rebased.ok) return rebased;

    try {
      execFileSync('git', ['push', '--force-with-lease', 'origin', branch], {
        cwd: tmpPath,
        encoding: 'utf-8',
        stdio: 'pipe',
      });
    } catch (err) {
      return { ok: false, reason: 'push', detail: errorMessage(err) };
    }

    return { ok: true };
  } finally {
    if (worktreeCreated) {
      try {
        execFileSync('git', ['worktree', 'remove', '--force', tmpPath], {
          cwd: projectDir,
          encoding: 'utf-8',
          stdio: 'pipe',
        });
      } catch {
        // Worktree already removed or never created
      }
    }
  }
}

/**
 * Backwards-compatible boolean wrapper. Callers that need failure detail
 * should prefer rebaseInIsolationDetailed directly.
 */
export async function rebaseInIsolation(branch: string, projectDir: string): Promise<boolean> {
  const result = await rebaseInIsolationDetailed(branch, projectDir);
  return result.ok;
}

function enableRerere(cwd: string): void {
  try {
    execFileSync('git', ['config', 'rerere.enabled', 'true'], {
      cwd,
      encoding: 'utf-8',
      stdio: 'pipe',
    });
    execFileSync('git', ['config', 'rerere.autoUpdate', 'true'], {
      cwd,
      encoding: 'utf-8',
      stdio: 'pipe',
    });
  } catch {
    // rerere is a nice-to-have, not required for correctness
  }
}

function attemptRebaseWithTrivialRecovery(cwd: string): RebaseResult {
  try {
    execFileSync('git', ['rebase', '--empty=drop', 'origin/main'], {
      cwd,
      encoding: 'utf-8',
      stdio: 'pipe',
    });
    return { ok: true };
  } catch (err) {
    return recoverFromRebaseConflict(cwd, errorMessage(err));
  }
}

function recoverFromRebaseConflict(cwd: string, initialError: string): RebaseResult {
  for (let iter = 0; iter < MAX_TRIVIAL_ITERATIONS; iter++) {
    const conflicts = parseUnmergedFiles(cwd);
    const nonTrivial = conflicts.filter((c) => !isTrivialConflict(c));
    if (nonTrivial.length > 0) {
      abortRebase(cwd);
      return {
        ok: false,
        reason: 'conflict',
        conflicts: nonTrivial.map((c) => c.path),
        detail: `non-trivial conflicts in ${nonTrivial.map((c) => c.path).join(', ')}`,
      };
    }

    if (conflicts.length > 0) {
      applyTrivialResolutions(cwd, conflicts);
    }

    const continued = continueOrSkip(cwd);
    if (continued === 'done') return { ok: true };
    if (continued === 'failed') {
      abortRebase(cwd);
      return {
        ok: false,
        reason: 'conflict',
        detail: `rebase could not continue after trivial recovery (${initialError})`,
      };
    }
    // 'progress' — another commit hit a conflict; loop and retry.
  }

  abortRebase(cwd);
  return {
    ok: false,
    reason: 'conflict',
    detail: 'exceeded trivial-conflict recovery iterations',
  };
}

interface UnmergedFile {
  path: string;
  /** Two-char index/worktree status from `git status --porcelain`. */
  xy: string;
}

function parseUnmergedFiles(cwd: string): UnmergedFile[] {
  let out = '';
  try {
    out = execFileSync('git', ['status', '--porcelain'], {
      cwd,
      encoding: 'utf-8',
      stdio: 'pipe',
    });
  } catch {
    return [];
  }
  const files: UnmergedFile[] = [];
  for (const line of out.split('\n')) {
    if (line.length < 3) continue;
    const xy = line.slice(0, 2);
    const path = line.slice(3);
    if (isUnmergedCode(xy)) files.push({ path, xy });
  }
  return files;
}

function isUnmergedCode(xy: string): boolean {
  return (
    xy === 'DD' ||
    xy === 'AU' ||
    xy === 'UD' ||
    xy === 'UA' ||
    xy === 'DU' ||
    xy === 'AA' ||
    xy === 'UU'
  );
}

/**
 * A conflict is trivial when it only involves delete semantics:
 *   DD — both sides deleted
 *   UD — they deleted; our modifications are lost but rebase semantics
 *        already threw away context, so accept the delete
 *   DU — we deleted; keep our delete
 *
 * AA, AU, UA, UU require content merging and are NEVER trivial.
 */
function isTrivialConflict(f: UnmergedFile): boolean {
  return f.xy === 'DD' || f.xy === 'UD' || f.xy === 'DU';
}

function applyTrivialResolutions(cwd: string, conflicts: UnmergedFile[]): void {
  for (const c of conflicts) {
    try {
      execFileSync('git', ['rm', '-f', '--', c.path], {
        cwd,
        encoding: 'utf-8',
        stdio: 'pipe',
      });
    } catch {
      // Path may already be gone; ignore
    }
  }
}

type ContinueResult = 'done' | 'progress' | 'failed';

function continueOrSkip(cwd: string): ContinueResult {
  const continueAttempt = tryRebaseContinue(cwd);
  if (continueAttempt === 'done' || continueAttempt === 'progress') return continueAttempt;

  // 'empty' error or similar — try --skip to drop the now-empty commit.
  try {
    execFileSync('git', ['rebase', '--skip'], {
      cwd,
      encoding: 'utf-8',
      stdio: 'pipe',
      env: { ...process.env, GIT_EDITOR: 'true' },
    });
    return isRebaseInProgress(cwd) ? 'progress' : 'done';
  } catch {
    return 'failed';
  }
}

function tryRebaseContinue(cwd: string): ContinueResult {
  try {
    execFileSync('git', ['rebase', '--continue'], {
      cwd,
      encoding: 'utf-8',
      stdio: 'pipe',
      env: { ...process.env, GIT_EDITOR: 'true' },
    });
    return isRebaseInProgress(cwd) ? 'progress' : 'done';
  } catch {
    // Either a new conflict on a later commit (progress) or genuine failure.
    return isRebaseInProgress(cwd) ? 'progress' : 'failed';
  }
}

function isRebaseInProgress(cwd: string): boolean {
  try {
    const out = execFileSync('git', ['status', '--porcelain=2', '--branch'], {
      cwd,
      encoding: 'utf-8',
      stdio: 'pipe',
    });
    return /rebase/i.test(out) || hasUnmerged(out);
  } catch {
    return false;
  }
}

function hasUnmerged(porcelainV2: string): boolean {
  for (const line of porcelainV2.split('\n')) {
    if (line.startsWith('u ')) return true;
  }
  return false;
}

function abortRebase(cwd: string): void {
  try {
    execFileSync('git', ['rebase', '--abort'], {
      cwd,
      encoding: 'utf-8',
      stdio: 'pipe',
    });
  } catch {
    // Not in a rebase state
  }
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message.split('\n')[0].slice(0, 200);
  return String(err).slice(0, 200);
}
