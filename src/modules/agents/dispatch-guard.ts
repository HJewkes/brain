import { execFileSync } from 'node:child_process';

export interface CompletionCheck {
  alreadyDone: boolean;
  commitHash?: string;
  commitMessage?: string;
}

/**
 * Check git history on main for commits mentioning a task display ID.
 * If found, the task was already completed and should not be dispatched again.
 */
export function checkAlreadyCompleted(
  taskDisplayId: string,
  projectRoot?: string
): CompletionCheck {
  const cwd = projectRoot ?? process.cwd();

  try {
    const output = execFileSync('git', ['log', '--oneline', '--grep', taskDisplayId, 'main'], {
      cwd,
      encoding: 'utf-8',
      stdio: 'pipe',
    });

    const firstLine = output.trim().split('\n')[0]?.trim();
    if (!firstLine) {
      return { alreadyDone: false };
    }

    const spaceIdx = firstLine.indexOf(' ');
    const commitHash = spaceIdx > 0 ? firstLine.slice(0, spaceIdx) : firstLine;
    const commitMessage = spaceIdx > 0 ? firstLine.slice(spaceIdx + 1) : '';

    return { alreadyDone: true, commitHash, commitMessage };
  } catch {
    // git log failure (e.g. not a git repo, no main branch) — assume not done
    return { alreadyDone: false };
  }
}
