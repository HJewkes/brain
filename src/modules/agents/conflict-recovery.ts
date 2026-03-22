import { execFileSync } from 'node:child_process';

export interface ConflictResult {
  taskId: string;
  branch: string;
  resolved: boolean;
  strategy: 'rebase' | 'redispatch';
  error?: string;
}

export function detectConflicts(
  branch: string,
  projectDir: string
): boolean {
  try {
    const json = execFileSync(
      'gh',
      ['pr', 'view', branch, '--json', 'mergeable'],
      { cwd: projectDir, encoding: 'utf-8', stdio: 'pipe' }
    );
    const data = JSON.parse(json) as { mergeable: string };
    return data.mergeable === 'CONFLICTING';
  } catch {
    return false;
  }
}

export function tryRebase(
  branch: string,
  projectDir: string
): { success: boolean; hasConflicts: boolean } {
  try {
    execFileSync('git', ['checkout', branch], {
      cwd: projectDir,
      encoding: 'utf-8',
      stdio: 'pipe',
    });

    execFileSync('git', ['rebase', 'main'], {
      cwd: projectDir,
      encoding: 'utf-8',
      stdio: 'pipe',
    });

    execFileSync('git', ['push', '--force-with-lease'], {
      cwd: projectDir,
      encoding: 'utf-8',
      stdio: 'pipe',
    });

    execFileSync('git', ['checkout', 'main'], {
      cwd: projectDir,
      encoding: 'utf-8',
      stdio: 'pipe',
    });

    return { success: true, hasConflicts: false };
  } catch {
    // Abort the rebase if it failed
    try {
      execFileSync('git', ['rebase', '--abort'], {
        cwd: projectDir,
        encoding: 'utf-8',
        stdio: 'pipe',
      });
    } catch {
      // Already aborted or not in rebase state
    }

    try {
      execFileSync('git', ['checkout', 'main'], {
        cwd: projectDir,
        encoding: 'utf-8',
        stdio: 'pipe',
      });
    } catch {
      // Best effort
    }

    return { success: false, hasConflicts: true };
  }
}

export function recoverConflict(
  branch: string,
  taskId: string,
  projectDir: string
): ConflictResult {
  if (!detectConflicts(branch, projectDir)) {
    return { taskId, branch, resolved: true, strategy: 'rebase' };
  }

  const rebaseResult = tryRebase(branch, projectDir);

  if (rebaseResult.success) {
    return { taskId, branch, resolved: true, strategy: 'rebase' };
  }

  return {
    taskId,
    branch,
    resolved: false,
    strategy: 'redispatch',
    error: 'Complex conflicts require agent re-dispatch',
  };
}
