import { execFileSync, spawn } from 'node:child_process';
import { existsSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { homedir, tmpdir } from 'node:os';
import type { BrainDB } from '../../services/brain-db.js';
import type { DeliveryRecord } from './delivery.js';
import { getSessionBySessionId } from '../sessions/data/session-ops.js';
import { findGitRoot } from './worktree.js';
import { renderTemplate } from '../workflow/engine/templates.js';

interface FixWorktree {
  path: string;
  branch: string;
}

interface FixPromptOpts {
  taskId: string | null;
  sessionSummary: string;
  ciLog: string;
  conflictDiff: string;
  prUrl: string | null;
  branch: string;
}

// Checkout an existing branch into a fresh transient worktree (not PM-tracked).
function checkoutFixWorktree(projectDir: string, branch: string, fixId: string): FixWorktree {
  const worktreePath = resolve(projectDir, '.worktrees', `${fixId}`);
  execFileSync('git', ['worktree', 'add', worktreePath, branch], {
    cwd: projectDir,
    encoding: 'utf-8',
    stdio: 'pipe',
  });
  return { path: worktreePath, branch };
}

function releaseFixWorktree(projectDir: string, worktree: FixWorktree): void {
  try {
    execFileSync('git', ['worktree', 'remove', '--force', worktree.path], {
      cwd: projectDir,
      encoding: 'utf-8',
      stdio: 'pipe',
    });
  } catch {
    // Already removed or never existed
  }
}

function getCiFailureLog(prNumber: number | null): string {
  if (!prNumber) return '';
  try {
    const raw = execFileSync(
      'gh',
      ['pr', 'checks', String(prNumber), '--json', 'name,state,description'],
      { encoding: 'utf-8', stdio: 'pipe' }
    );
    type CheckRow = { name: string; state: string; description?: string };
    const checks = JSON.parse(raw) as CheckRow[];
    const failed = checks.filter((c) => c.state === 'FAILURE' || c.state === 'ERROR');
    if (failed.length === 0) return '';
    return failed
      .map((c) => `- ${c.name}: ${c.state}${c.description ? ` — ${c.description}` : ''}`)
      .join('\n');
  } catch {
    return '';
  }
}

// Show files changed on branch vs origin/main to give the agent conflict context.
function getConflictDiff(worktreePath: string): string {
  try {
    return execFileSync('git', ['diff', '--name-only', 'origin/main...HEAD'], {
      cwd: worktreePath,
      encoding: 'utf-8',
      stdio: 'pipe',
    }).trim();
  } catch {
    return '';
  }
}

function buildFixPrompt(opts: FixPromptOpts): string {
  const lines: string[] = [
    'You are a fix agent. Your goal is to repair a failing pull request.',
    '',
    `Task: ${opts.taskId ?? '(unknown)'}`,
  ];
  if (opts.prUrl) lines.push(`PR: ${opts.prUrl}`);
  lines.push(`Branch: ${opts.branch}`, '');

  if (opts.sessionSummary) {
    lines.push('## Original Session Context', opts.sessionSummary, '');
  }
  if (opts.ciLog) {
    lines.push('## CI Failures', opts.ciLog, '');
  }
  if (opts.conflictDiff) {
    lines.push('## Files Changed on Branch (potential conflict sources)', opts.conflictDiff, '');
  }

  lines.push(
    '## Instructions',
    '1. Investigate and fix the issues described above.',
    '2. Run tests to verify the fix.',
    '3. Commit your changes on the current branch.',
    '4. Push the branch — the PR updates automatically.',
    `5. On success output exactly: DONE ${opts.taskId ?? 'fix'} <one-line summary>`,
    `6. On failure output exactly: FAILED ${opts.taskId ?? 'fix'} <reason>`
  );

  return lines.join('\n');
}

let _claudeBin: string | null = null;
function getClaudeBin(): string {
  if (_claudeBin) return _claudeBin;
  const candidates = [
    join(homedir(), '.local', 'bin', 'claude'),
    '/usr/local/bin/claude',
    '/opt/homebrew/bin/claude',
  ];
  for (const p of candidates) {
    if (existsSync(p)) {
      _claudeBin = p;
      return p;
    }
  }
  try {
    _claudeBin = execFileSync('which', ['claude'], {
      encoding: 'utf-8',
      stdio: 'pipe',
    }).trim();
  } catch {
    _claudeBin = 'claude';
  }
  return _claudeBin;
}

function writeMcpConfig(agentId: string, projectDir: string): string {
  const configPath = join(tmpdir(), `brain-mcp-${agentId}.json`);
  writeFileSync(
    configPath,
    JSON.stringify({
      mcpServers: {
        brain: {
          command: 'node',
          args: [join(projectDir, 'dist', 'cli.js'), 'serve', '--mcp'],
        },
      },
    })
  );
  return configPath;
}

function waitForProcess(
  proc: ReturnType<typeof spawn>,
  mcpConfigPath: string,
  projectDir: string,
  worktree: FixWorktree
): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    let settled = false;
    const settle = (success: boolean) => {
      if (settled) return;
      settled = true;
      try {
        unlinkSync(mcpConfigPath);
      } catch {
        // Already cleaned
      }
      releaseFixWorktree(projectDir, worktree);
      resolve(success);
    };

    proc.on('error', () => settle(false));
    proc.on('exit', (code) => settle(code === 0));
  });
}

/**
 * Spawn a fix agent to resolve CI failures or merge conflicts on a PR branch.
 *
 * Loads the original agent's session context, allocates a fresh transient
 * worktree (not PM-tracked), builds a repair prompt, and spawns a claude
 * agent (sonnet) targeting the same branch. The PR updates automatically
 * when the fix agent pushes. Returns true on clean exit (exit code 0).
 */
export async function spawnFixAgent(db: BrainDB, delivery: DeliveryRecord): Promise<boolean> {
  const projectDir = findGitRoot();

  const session = delivery.session_id ? getSessionBySessionId(db, delivery.session_id) : null;
  const sessionSummary = session?.summary ?? (session?.tasks_completed ?? []).join(', ');

  if (!delivery.branch) return false;

  const fixId = `fix-${delivery.task_id ?? 'unknown'}-${Date.now()}`;
  let worktree: FixWorktree;
  try {
    worktree = checkoutFixWorktree(projectDir, delivery.branch, fixId);
  } catch {
    return false;
  }

  const ciLog = getCiFailureLog(delivery.pr_number);
  const conflictDiff = getConflictDiff(worktree.path);

  const templateResult = renderTemplate('fix-agent', {
    TASK_ID: delivery.task_id ?? '(unknown)',
    BRANCH_NAME: delivery.branch,
    PR_URL: delivery.pr_url ?? '(no PR)',
    WORKTREE_PATH: worktree.path,
    SESSION_SUMMARY: sessionSummary || '(no session context available)',
    CI_FAILURES: ciLog ? `### CI Failures\n${ciLog}` : '',
    CONFLICT_FILES: conflictDiff
      ? `### Files Changed on Branch (potential conflict sources)\n${conflictDiff}`
      : '',
  });

  const prompt = templateResult.ok
    ? templateResult.data
    : buildFixPrompt({
        taskId: delivery.task_id,
        sessionSummary,
        ciLog,
        conflictDiff,
        prUrl: delivery.pr_url,
        branch: delivery.branch,
      });

  const agentId = randomUUID();
  const sessionId = randomUUID();
  const mcpConfigPath = writeMcpConfig(agentId, projectDir);

  const proc = spawn(
    getClaudeBin(),
    [
      '-p',
      '--output-format',
      'json',
      '--model',
      'claude-sonnet-4-6',
      '--session-id',
      sessionId,
      '--allowed-tools',
      'Bash,Edit,Read,Write,Glob,Grep',
      '--mcp-config',
      mcpConfigPath,
      '--max-budget-usd',
      '5.0',
    ],
    {
      cwd: worktree.path,
      env: { ...process.env, BRAIN_AGENT_ID: agentId, AGENT_WORKTREE_PATH: worktree.path },
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: true,
    }
  );

  proc.stdin.write(prompt);
  proc.stdin.end();

  return waitForProcess(proc, mcpConfigPath, projectDir, worktree);
}
