import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

/**
 * Rebase a branch onto origin/main in a temporary worktree.
 *
 * Using an isolated worktree prevents HEAD races when multiple delivery
 * monitors run concurrently — conflict-recovery.tryRebase mutates the main
 * repo's HEAD, which is unsafe under parallelism.
 */
export async function rebaseInIsolation(branch: string, projectDir: string): Promise<boolean> {
  const tmpPath = resolve(projectDir, '.worktrees', `rebase-${Date.now()}`);

  try {
    execFileSync('git', ['worktree', 'add', '--detach', tmpPath], {
      cwd: projectDir,
      encoding: 'utf-8',
      stdio: 'pipe',
    });

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

    execFileSync('git', ['rebase', 'origin/main'], {
      cwd: tmpPath,
      encoding: 'utf-8',
      stdio: 'pipe',
    });

    execFileSync('git', ['push', '--force-with-lease', 'origin', branch], {
      cwd: tmpPath,
      encoding: 'utf-8',
      stdio: 'pipe',
    });

    return true;
  } catch {
    try {
      execFileSync('git', ['rebase', '--abort'], {
        cwd: tmpPath,
        encoding: 'utf-8',
        stdio: 'pipe',
      });
    } catch {
      // Not in a rebase state or worktree already gone
    }
    return false;
  } finally {
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
