import type Database from 'better-sqlite3';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { existsSync, unlinkSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DeliveryRecord } from './delivery.js';
import { parseSignals } from '../workflow/runtime/signals.js';
import { renderTemplate } from '../workflow/engine/templates.js';

export type ReviewTier = 'ci-only' | 'ai-review' | 'human-review';

export interface DeliveryReviewResult {
  approved: boolean;
  riskScore: number;
  escalated: boolean;
  fixupIterations: number;
  reviewAgentId: string;
}

interface ReviewRunOutput {
  agentId: string;
  output: string;
  success: boolean;
}

const MAX_FIXUP_ITERATIONS = 3;
const REVIEW_MODEL = 'claude-sonnet-4-6';
const RESEARCH_TOOLS = 'Bash,Read,Glob,Grep,WebSearch,WebFetch';
const FIXUP_TOOLS = 'Bash,Edit,Read,Write,Glob,Grep';
const REVIEW_BUDGET_USD = '5.0';

/**
 * Run the review phase of delivery.
 *
 * - ci-only: no-op, returns immediately approved.
 * - ai-review: dispatches review-agent, parses signals, runs fixup loop up to
 *   MAX_FIXUP_ITERATIONS. De-escalates to merge when risk <= 2 and approved.
 *   Escalates to human-review tier on high_risk or exhausted fixups.
 * - human-review: dispatches review-agent but returns unapproved+escalated so
 *   the caller can route to the human gate (implemented in VNM-56.30).
 */
export async function runDeliveryReview(
  db: Database.Database,
  delivery: DeliveryRecord,
  tier: ReviewTier,
  projectDir: string
): Promise<DeliveryReviewResult> {
  persistReviewTier(db, delivery.agent_id, tier);

  if (tier === 'ci-only') {
    return approved(0, '');
  }

  const first = await runReviewAgent(db, delivery, projectDir);
  const riskScore = parseRiskScore(first.output);
  const signal = parseSignals('review', 'delivery', first.output);

  if (tier === 'human-review' || signal === 'high_risk') {
    return escalate(riskScore, first.agentId, 0);
  }

  if (signal === 'approved' || signal === null) {
    return approved(riskScore, first.agentId);
  }

  if (signal !== 'needs_fixes') {
    return approved(riskScore, first.agentId);
  }

  return runFixupLoop(db, delivery, projectDir, first.agentId, riskScore);
}

async function runFixupLoop(
  db: Database.Database,
  delivery: DeliveryRecord,
  projectDir: string,
  initialReviewAgentId: string,
  initialRisk: number
): Promise<DeliveryReviewResult> {
  let fixupIterations = 0;
  let latestReviewAgentId = initialReviewAgentId;
  let latestRisk = initialRisk;

  while (fixupIterations < MAX_FIXUP_ITERATIONS) {
    fixupIterations++;
    await runFixupAgent(db, delivery, projectDir);

    const reReview = await runReviewAgent(db, delivery, projectDir);
    latestReviewAgentId = reReview.agentId;
    latestRisk = parseRiskScore(reReview.output);
    const signal = parseSignals('review', 'delivery', reReview.output);

    if (signal === 'high_risk') {
      return escalate(latestRisk, latestReviewAgentId, fixupIterations);
    }
    if (signal === 'approved' || signal === null) {
      return {
        approved: true,
        riskScore: latestRisk,
        escalated: false,
        fixupIterations,
        reviewAgentId: latestReviewAgentId,
      };
    }
  }

  return escalate(latestRisk, latestReviewAgentId, fixupIterations);
}

function approved(riskScore: number, reviewAgentId: string): DeliveryReviewResult {
  return {
    approved: true,
    riskScore,
    escalated: false,
    fixupIterations: 0,
    reviewAgentId,
  };
}

function escalate(
  riskScore: number,
  reviewAgentId: string,
  fixupIterations: number
): DeliveryReviewResult {
  return {
    approved: false,
    riskScore,
    escalated: true,
    fixupIterations,
    reviewAgentId,
  };
}

async function runReviewAgent(
  db: Database.Database,
  delivery: DeliveryRecord,
  projectDir: string
): Promise<ReviewRunOutput> {
  const prompt = buildReviewPrompt(delivery, projectDir);
  const result = await spawnClaudeReview(prompt, projectDir, RESEARCH_TOOLS);
  persistReviewAgentId(db, delivery.agent_id, result.agentId);
  return result;
}

async function runFixupAgent(
  db: Database.Database,
  delivery: DeliveryRecord,
  projectDir: string
): Promise<ReviewRunOutput> {
  const prompt = buildFixupPrompt(delivery, projectDir);
  const result = await spawnClaudeReview(prompt, projectDir, FIXUP_TOOLS);
  void db;
  return result;
}

function buildReviewPrompt(delivery: DeliveryRecord, projectDir: string): string {
  const repo = getRepoInfo(projectDir);
  const prefix = delivery.task_id ? delivery.task_id.split('.')[0] : 'VNM';
  const vars: Record<string, string> = {
    OWNER: repo.owner,
    REPO: repo.repo,
    PR_NUMBER: delivery.pr_number ? String(delivery.pr_number) : '',
    BRANCH: delivery.branch ?? '',
    BASE: 'main',
    REPO_PATH: projectDir,
    PROJECT_PREFIX: prefix,
    REVIEW_THRESHOLD: '4',
  };
  const rendered = renderTemplate('review-agent', vars);
  return rendered.ok ? rendered.data : fallbackReviewPrompt(delivery, projectDir, repo);
}

function buildFixupPrompt(delivery: DeliveryRecord, projectDir: string): string {
  const repo = getRepoInfo(projectDir);
  const vars: Record<string, string> = {
    TASK_ID: delivery.task_id ?? '(unknown)',
    REPO_PATH: projectDir,
    BRANCH_NAME: delivery.branch ?? '',
    OWNER: repo.owner,
    REPO: repo.repo,
    PR_NUMBER: delivery.pr_number ? String(delivery.pr_number) : '',
    BUILD_CMD: 'npm run build',
    TEST_CMD: 'npm test',
    TYPECHECK_CMD: 'npm run typecheck',
    LINT_CMD: 'npm run lint',
  };
  const rendered = renderTemplate('review-fixup', vars);
  return rendered.ok ? rendered.data : fallbackFixupPrompt(delivery);
}

function fallbackReviewPrompt(
  delivery: DeliveryRecord,
  projectDir: string,
  repo: { owner: string; repo: string }
): string {
  return [
    `Review PR #${delivery.pr_number ?? '?'} in ${repo.owner}/${repo.repo}.`,
    `Branch: ${delivery.branch ?? ''} targeting main`,
    `Repo path: ${projectDir}`,
    '',
    'Read the diff, evaluate code quality, and post a GitHub review.',
    'Output Verdict: PASS or NEEDS WORK, and Risk: <1-5> in an orchestrator summary.',
  ].join('\n');
}

function fallbackFixupPrompt(delivery: DeliveryRecord): string {
  return [
    `Address review feedback for PR #${delivery.pr_number ?? '?'} on branch ${delivery.branch ?? ''}.`,
    'Fetch review comments, implement [FIX] items, run verification, commit changes.',
    'Do not push — the orchestrator handles delivery.',
  ].join('\n');
}

function parseRiskScore(output: string): number {
  const match = output.match(/Risk\s*(?:Score|Level)?\s*:\s*(\d+)/i);
  return match ? parseInt(match[1], 10) : 0;
}

function getRepoInfo(projectDir: string): { owner: string; repo: string } {
  try {
    const remote = execFileSync('git', ['config', '--get', 'remote.origin.url'], {
      cwd: projectDir,
      encoding: 'utf-8',
      stdio: 'pipe',
    }).trim();
    const match = /[:/]([^/:]+)\/([^/]+?)(?:\.git)?$/.exec(remote);
    if (match) return { owner: match[1], repo: match[2] };
  } catch {
    /* fall through */
  }
  return { owner: 'unknown', repo: 'unknown' };
}

function persistReviewTier(db: Database.Database, agentId: string, tier: ReviewTier): void {
  try {
    db.prepare('UPDATE delivery_states SET review_tier = ? WHERE agent_id = ?').run(tier, agentId);
  } catch {
    /* columns from VNM-56.27 migration not yet present */
  }
}

function persistReviewAgentId(db: Database.Database, agentId: string, reviewAgentId: string): void {
  try {
    db.prepare('UPDATE delivery_states SET review_agent_id = ? WHERE agent_id = ?').run(
      reviewAgentId,
      agentId
    );
  } catch {
    /* columns from VNM-56.27 migration not yet present */
  }
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
    _claudeBin = execFileSync('which', ['claude'], { encoding: 'utf-8', stdio: 'pipe' }).trim();
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

function collectProcessOutput(
  proc: ChildProcess
): Promise<{ stdout: string; code: number | null }> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    proc.stdout!.on('data', (chunk: Buffer) => chunks.push(chunk));
    proc.stderr!.on('data', () => {
      /* ignore */
    });
    proc.on('error', () =>
      resolve({ stdout: Buffer.concat(chunks).toString('utf-8'), code: null })
    );
    proc.on('exit', (code) => resolve({ stdout: Buffer.concat(chunks).toString('utf-8'), code }));
  });
}

async function spawnClaudeReview(
  prompt: string,
  projectDir: string,
  allowedTools: string
): Promise<ReviewRunOutput> {
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
      REVIEW_MODEL,
      '--permission-mode',
      'bypassPermissions',
      '--session-id',
      sessionId,
      '--allowed-tools',
      allowedTools,
      '--mcp-config',
      mcpConfigPath,
      '--max-budget-usd',
      REVIEW_BUDGET_USD,
    ],
    {
      cwd: projectDir,
      env: { ...process.env, BRAIN_AGENT_ID: agentId },
      stdio: ['pipe', 'pipe', 'pipe'],
    }
  );

  proc.stdin.write(prompt);
  proc.stdin.end();

  const { stdout, code } = await collectProcessOutput(proc);
  try {
    unlinkSync(mcpConfigPath);
  } catch {
    /* already cleaned */
  }

  return {
    agentId,
    output: extractClaudeResult(stdout),
    success: code === 0,
  };
}

function extractClaudeResult(stdout: string): string {
  try {
    const parsed = JSON.parse(stdout) as { result?: string };
    return parsed.result ?? stdout;
  } catch {
    return stdout;
  }
}
