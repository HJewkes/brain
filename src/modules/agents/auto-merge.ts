import { execFileSync } from 'node:child_process';

export interface MergeResult {
  taskId: string;
  prNumber: number;
  merged: boolean;
  error?: string;
}

export interface PrStatus {
  number: number;
  branch: string;
  checksPass: boolean;
  mergeable: boolean;
  mergeStateStatus?: string;
  state: 'open' | 'closed' | 'merged';
  failedChecks: string[];
}

export type MergeStrategy = 'squash' | 'merge' | 'rebase';

export interface AutoMergeOptions {
  projectDir: string;
  strategy: MergeStrategy;
  pullAfterMerge: boolean;
}

const DEFAULT_OPTIONS: AutoMergeOptions = {
  projectDir: process.cwd(),
  strategy: 'squash',
  pullAfterMerge: true,
};

export function getPrForBranch(branch: string, projectDir: string): PrStatus | null {
  try {
    const json = execFileSync(
      'gh',
      [
        'pr',
        'view',
        branch,
        '--json',
        'number,headRefName,state,mergeable,mergeStateStatus,statusCheckRollup',
      ],
      { cwd: projectDir, encoding: 'utf-8', stdio: 'pipe' }
    );
    const data = JSON.parse(json) as {
      number: number;
      headRefName: string;
      state: string;
      mergeable: string;
      mergeStateStatus?: string;
      statusCheckRollup: Array<{ conclusion: string; state: string; name?: string }> | null;
    };

    const checks = data.statusCheckRollup ?? [];
    const isFailure = (c: { conclusion: string; state: string }): boolean => {
      if (c.conclusion) return c.conclusion !== 'SUCCESS' && c.conclusion !== 'NEUTRAL';
      return c.state === 'FAILURE' || c.state === 'ERROR';
    };
    const failedChecks = checks.filter(isFailure).map((c) => c.name ?? '');
    const checksPass = failedChecks.length === 0;

    return {
      number: data.number,
      branch: data.headRefName,
      checksPass,
      mergeable: data.mergeable === 'MERGEABLE',
      mergeStateStatus: data.mergeStateStatus,
      state: data.state.toLowerCase() as PrStatus['state'],
      failedChecks,
    };
  } catch {
    return null;
  }
}

export function mergePr(
  prNumber: number,
  options?: Partial<AutoMergeOptions>
): MergeResult & { taskId: string } {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const result: MergeResult = { taskId: '', prNumber, merged: false };

  try {
    // Update branch if behind main — branch protection may require up-to-date status
    try {
      execFileSync(
        'gh',
        ['api', `repos/{owner}/{repo}/pulls/${prNumber}/update-branch`, '-X', 'PUT'],
        { cwd: opts.projectDir, encoding: 'utf-8', stdio: 'pipe' }
      );
    } catch {
      // May fail if already up-to-date or feature not enabled — non-fatal
    }

    execFileSync('gh', ['pr', 'merge', String(prNumber), `--${opts.strategy}`, '--delete-branch'], {
      cwd: opts.projectDir,
      encoding: 'utf-8',
      stdio: 'pipe',
    });
    result.merged = true;

    if (opts.pullAfterMerge) {
      pullMain(opts.projectDir);
    }
  } catch (err) {
    result.error = (err as Error).message;
  }

  return result;
}

/**
 * Re-run the failed jobs of the latest GitHub Actions workflow run for a branch.
 * Used to retry flaky CI failures once before escalating to a fix agent.
 */
export function rerunPrChecks(branch: string, projectDir: string): boolean {
  try {
    const json = execFileSync(
      'gh',
      ['run', 'list', '--branch', branch, '--limit', '1', '--json', 'databaseId'],
      { cwd: projectDir, encoding: 'utf-8', stdio: 'pipe' }
    );
    const runs = JSON.parse(json) as Array<{ databaseId: number }>;
    if (runs.length === 0) return false;
    execFileSync('gh', ['run', 'rerun', String(runs[0].databaseId), '--failed'], {
      cwd: projectDir,
      encoding: 'utf-8',
      stdio: 'pipe',
    });
    return true;
  } catch {
    return false;
  }
}

export function pullMain(projectDir: string): void {
  try {
    execFileSync('git', ['pull', '--ff-only'], {
      cwd: projectDir,
      encoding: 'utf-8',
      stdio: 'pipe',
    });
  } catch {
    // Non-fatal: merge was successful, pull can be retried
  }
}

export function tryAutoMerge(
  branch: string,
  taskId: string,
  options?: Partial<AutoMergeOptions>
): MergeResult {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const pr = getPrForBranch(branch, opts.projectDir);

  if (!pr) {
    return { taskId, prNumber: 0, merged: false, error: 'No PR found for branch' };
  }

  if (pr.state !== 'open') {
    return {
      taskId,
      prNumber: pr.number,
      merged: pr.state === 'merged',
      error: pr.state === 'merged' ? undefined : `PR is ${pr.state}`,
    };
  }

  if (!pr.checksPass) {
    return { taskId, prNumber: pr.number, merged: false, error: 'CI checks have not passed' };
  }

  if (!pr.mergeable) {
    return { taskId, prNumber: pr.number, merged: false, error: 'PR is not mergeable (conflicts)' };
  }

  const mergeResult = mergePr(pr.number, opts);
  mergeResult.taskId = taskId;
  return mergeResult;
}
