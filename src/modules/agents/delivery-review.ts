import type Database from 'better-sqlite3';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { existsSync, unlinkSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DeliveryRecord } from './delivery.js';
import { recordDelivery, readAndClearHumanSignal } from './delivery.js';
import { parseSignals } from '../workflow/runtime/signals.js';
import { renderTemplate } from '../workflow/engine/templates.js';
import { sleep } from '../../utils/db.js';

export type ReviewTier = 'ci-only' | 'ai-review' | 'human-review';

export interface DeliveryReviewResult {
  approved: boolean;
  riskScore: number;
  escalated: boolean;
  fixupIterations: number;
  reviewAgentId: string;
}

export interface ReviewRunOutput {
  agentId: string;
  output: string;
  success: boolean;
}

export interface ReviewDeps {
  runReview: (
    db: Database.Database,
    delivery: DeliveryRecord,
    projectDir: string
  ) => Promise<ReviewRunOutput>;
  runFixup: (delivery: DeliveryRecord, projectDir: string) => Promise<ReviewRunOutput>;
}

const MAX_FIXUP_ITERATIONS = 3;
const REVIEW_MODEL = 'claude-sonnet-4-6';
const RESEARCH_TOOLS = 'Bash,Read,Glob,Grep,WebSearch,WebFetch';
const FIXUP_TOOLS = 'Bash,Edit,Read,Write,Glob,Grep';
const REVIEW_BUDGET_USD = '5.0';
const HUMAN_SIGNAL_POLL_MS = 30_000;
const HUMAN_REVIEW_MAX_CYCLES = 2;
export const REVIEW_TIMEOUT_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Run the review phase of delivery.
 *
 * - ci-only: no-op, returns immediately approved.
 * - ai-review: dispatches review-agent, parses signals, runs fixup loop up to
 *   MAX_FIXUP_ITERATIONS. Escalates to the human review gate on high_risk or
 *   exhausted fixups.
 * - human-review: dispatches review-agent and routes directly to the human
 *   review gate, which pauses delivery until the user signals via
 *   brain_delivery_signal or `brain agent approve/reject`.
 */
export async function runDeliveryReview(
  db: Database.Database,
  delivery: DeliveryRecord,
  tier: ReviewTier,
  projectDir: string,
  deps: ReviewDeps = defaultDeps
): Promise<DeliveryReviewResult> {
  persistReviewTier(db, delivery.agent_id, tier);

  if (tier === 'ci-only') {
    return approved(0, '');
  }

  const first = await deps.runReview(db, delivery, projectDir);
  persistReviewAgentId(db, delivery.agent_id, first.agentId);
  const riskScore = parseRiskScore(first.output);
  persistReviewScore(db, delivery.agent_id, riskScore);

  // A failed subprocess (timeout, budget cap, non-zero exit) leaves empty
  // output that would otherwise parse to signal === null -> approved. Treat
  // it as an escalation instead so the human gate can verify.
  if (!first.success) {
    return runHumanReviewGate(db, delivery, first.agentId, riskScore, first.output, projectDir, 0);
  }

  // parseSignals returns the first-matching pattern, and `approved` is
  // checked before `high_risk` in CONDITION_PATTERNS. So a verdict of PASS
  // with a risk score of 5 would short-circuit to approved. Guard on the
  // risk score directly before dispatching on the signal.
  if (tier === 'human-review' || riskScore >= 4) {
    return runHumanReviewGate(db, delivery, first.agentId, riskScore, first.output, projectDir, 0);
  }

  const signal = parseSignals('review', 'delivery', first.output);

  if (signal === 'high_risk') {
    return runHumanReviewGate(db, delivery, first.agentId, riskScore, first.output, projectDir, 0);
  }

  if (signal !== 'needs_fixes') {
    return approved(riskScore, first.agentId);
  }

  return runFixupLoop(db, delivery, projectDir, first.agentId, riskScore, deps);
}

async function runFixupLoop(
  db: Database.Database,
  delivery: DeliveryRecord,
  projectDir: string,
  initialReviewAgentId: string,
  initialRisk: number,
  deps: ReviewDeps
): Promise<DeliveryReviewResult> {
  let fixupIterations = 0;
  let latestReviewAgentId = initialReviewAgentId;
  let latestRisk = initialRisk;

  while (fixupIterations < MAX_FIXUP_ITERATIONS) {
    fixupIterations++;
    await deps.runFixup(delivery, projectDir);

    const reReview = await deps.runReview(db, delivery, projectDir);
    latestReviewAgentId = reReview.agentId;
    persistReviewAgentId(db, delivery.agent_id, latestReviewAgentId);
    latestRisk = parseRiskScore(reReview.output);
    persistReviewScore(db, delivery.agent_id, latestRisk);

    if (!reReview.success) {
      return runHumanReviewGate(
        db,
        delivery,
        latestReviewAgentId,
        latestRisk,
        reReview.output,
        projectDir,
        fixupIterations
      );
    }

    if (latestRisk >= 4) {
      return runHumanReviewGate(
        db,
        delivery,
        latestReviewAgentId,
        latestRisk,
        reReview.output,
        projectDir,
        fixupIterations
      );
    }

    const signal = parseSignals('review', 'delivery', reReview.output);

    if (signal === 'high_risk') {
      return runHumanReviewGate(
        db,
        delivery,
        latestReviewAgentId,
        latestRisk,
        reReview.output,
        projectDir,
        fixupIterations
      );
    }
    if (signal !== 'needs_fixes') {
      return {
        approved: true,
        riskScore: latestRisk,
        escalated: false,
        fixupIterations,
        reviewAgentId: latestReviewAgentId,
      };
    }
  }

  return runHumanReviewGate(
    db,
    delivery,
    latestReviewAgentId,
    latestRisk,
    '',
    projectDir,
    fixupIterations
  );
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

interface ReviewSummary {
  findings: string;
  highlightedFiles: string;
  questions: string;
}

export async function runHumanReviewGate(
  db: Database.Database,
  delivery: DeliveryRecord,
  reviewAgentId: string,
  riskScore: number,
  reviewOutput: string,
  projectDir: string,
  priorFixupIterations: number
): Promise<DeliveryReviewResult> {
  let latestSummary = extractReviewSummary(reviewOutput);
  let latestReviewAgentId = reviewAgentId;
  let latestRisk = riskScore;
  let fixupIterations = priorFixupIterations;

  for (let cycle = 1; cycle <= HUMAN_REVIEW_MAX_CYCLES; cycle++) {
    notifyHumanReview(db, delivery, latestSummary, latestRisk, latestReviewAgentId, cycle);
    recordDelivery(db, delivery.agent_id, {
      status: 'review-paused',
      review_agent_id: latestReviewAgentId,
    });

    const deadline = Date.now() + REVIEW_TIMEOUT_MS;
    const signal = await waitForHumanSignal(db, delivery.agent_id, deadline);

    if (signal === 'approve') {
      recordDelivery(db, delivery.agent_id, { status: 'pr-open' });
      return {
        approved: true,
        riskScore: latestRisk,
        escalated: true,
        fixupIterations,
        reviewAgentId: latestReviewAgentId,
      };
    }

    if (signal === 'timeout') {
      recordDelivery(db, delivery.agent_id, {
        status: 'stalled',
        stall_reason: 'review-timeout',
      });
      return {
        approved: false,
        riskScore: latestRisk,
        escalated: true,
        fixupIterations,
        reviewAgentId: latestReviewAgentId,
      };
    }

    if (cycle === HUMAN_REVIEW_MAX_CYCLES) break;

    await defaultDeps.runFixup(delivery, projectDir);
    fixupIterations++;
    const reReview = await defaultDeps.runReview(db, delivery, projectDir);
    latestReviewAgentId = reReview.agentId;
    latestRisk = parseRiskScore(reReview.output);
    latestSummary = extractReviewSummary(reReview.output);
  }

  recordDelivery(db, delivery.agent_id, {
    status: 'stalled',
    stall_reason: 'review-rejected',
  });
  return {
    approved: false,
    riskScore: latestRisk,
    escalated: true,
    fixupIterations,
    reviewAgentId: latestReviewAgentId,
  };
}

async function waitForHumanSignal(
  db: Database.Database,
  agentId: string,
  deadline: number
): Promise<'approve' | 'needs_fixes' | 'timeout'> {
  while (Date.now() < deadline) {
    const signal = readAndClearHumanSignal(db, agentId);
    if (signal) return signal;
    await sleep(HUMAN_SIGNAL_POLL_MS);
  }
  // Final check so a signal arriving just past the deadline isn't dropped.
  const signal = readAndClearHumanSignal(db, agentId);
  return signal ?? 'timeout';
}

function notifyHumanReview(
  db: Database.Database,
  delivery: DeliveryRecord,
  summary: ReviewSummary,
  riskScore: number,
  reviewAgentId: string,
  cycle: number
): void {
  const action = cycle === 1 ? 'review-requested' : 'review-re-requested';
  const content = formatHumanReviewRequest(delivery, summary, riskScore, reviewAgentId, cycle);
  const meta = JSON.stringify({
    taskId: delivery.task_id,
    prUrl: delivery.pr_url,
    prNumber: delivery.pr_number,
    reviewAgentId,
    riskScore,
    action,
    cycle,
  });
  try {
    db.prepare(
      `INSERT INTO inbox (id, content, title, source, source_url, source_meta, status, created_at, processed_at)
       VALUES (?, ?, ?, 'api', NULL, ?, 'pending', ?, NULL)`
    ).run(
      randomUUID(),
      content,
      `Review Required: ${delivery.task_id ?? 'unknown'}`,
      meta,
      new Date().toISOString()
    );
  } catch (err) {
    process.stderr.write(
      `[delivery-review] failed to add inbox notification: ${err instanceof Error ? err.message : String(err)}\n`
    );
  }
}

function formatHumanReviewRequest(
  delivery: DeliveryRecord,
  summary: ReviewSummary,
  riskScore: number,
  reviewAgentId: string,
  cycle: number
): string {
  const header =
    cycle === 1
      ? `## Review Required: ${delivery.task_id ?? 'unknown'}`
      : `## Review Required (after fixup): ${delivery.task_id ?? 'unknown'}`;
  return [
    header,
    '',
    `**PR**: ${delivery.pr_url ?? 'unknown'}`,
    `**Risk Score**: ${riskScore}/5 (tier: human-review)`,
    `**Review Agent**: ${reviewAgentId}`,
    '',
    '### Key Findings',
    summary.findings || '(none extracted)',
    '',
    '### Files of Interest',
    summary.highlightedFiles || '(none extracted)',
    '',
    '### Open Questions',
    summary.questions || '(none extracted)',
    '',
    `**Actions**: Signal \`approve\` or \`needs_fixes\` via \`brain_delivery_signal\` MCP tool, or run:`,
    `  brain agent approve ${delivery.task_id ?? '<taskId>'}`,
    `  brain agent reject ${delivery.task_id ?? '<taskId>'}`,
  ].join('\n');
}

function extractReviewSummary(output: string): ReviewSummary {
  return {
    findings: extractSection(output, ['Key Findings', 'Findings', 'Summary']),
    highlightedFiles: extractSection(output, ['Files of Interest', 'Files', 'Highlighted Files']),
    questions: extractSection(output, ['Open Questions', 'Questions']),
  };
}

function extractSection(output: string, headings: string[]): string {
  for (const heading of headings) {
    const pattern = new RegExp(`##?\\s*${heading}\\s*\\n([\\s\\S]*?)(?=\\n##\\s|\\n\\*\\*|$)`, 'i');
    const match = output.match(pattern);
    if (match) {
      const text = match[1].trim();
      if (text) return text;
    }
  }
  return '';
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
  delivery: DeliveryRecord,
  projectDir: string
): Promise<ReviewRunOutput> {
  const prompt = buildFixupPrompt(delivery, projectDir);
  return spawnClaudeReview(prompt, projectDir, FIXUP_TOOLS);
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

export function parseRiskScore(output: string): number {
  const match = output.match(/Risk\s*(?:Score|Level)?\s*:\s*(\d+)/i);
  return match ? parseInt(match[1], 10) : 0;
}

const defaultDeps: ReviewDeps = {
  runReview: runReviewAgent,
  runFixup: runFixupAgent,
};

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

function persistReviewScore(db: Database.Database, agentId: string, score: number): void {
  try {
    db.prepare('UPDATE delivery_states SET review_score = ? WHERE agent_id = ?').run(
      score,
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
