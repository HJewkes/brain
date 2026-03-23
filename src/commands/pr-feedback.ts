import { execSync } from 'node:child_process';
import { Command } from '@commander-js/extra-typings';
import { withBrain } from '../services/brain-service.js';
import { findAgentByPR, findAgentByBranch } from '../modules/agents/data.js';
import { buildResumptionPrompt, extractSessionSummary } from '../modules/agents/resume.js';
import { getTask } from '../modules/pm/data/task-ops.js';
import { getSessionsForTask } from '../modules/sessions/data/session-ops.js';

export interface PRReview {
  id: number;
  user: { login: string };
  state: string;
  body: string;
}

export interface PRComment {
  id: number;
  user: { login: string };
  path: string;
  line: number | null;
  original_line: number | null;
  body: string;
}

export interface PRInfo {
  number: number;
  headRefName: string;
}

export function parsePRUrl(url: string): { owner: string; repo: string; number: string } | null {
  // Matches https://github.com/{owner}/{repo}/pull/{number}
  const match = /github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/.exec(url);
  if (!match) return null;
  return { owner: match[1], repo: match[2], number: match[3] };
}

/** Shell out to gh CLI. Returns parsed JSON or throws on error. */
function ghApi<T>(args: string): T {
  const output = execSync(`gh api ${args}`, { encoding: 'utf-8' });
  return JSON.parse(output) as T;
}

/** Fetch PR metadata (number and head branch). */
export function fetchPRInfo(url: string): PRInfo {
  const output = execSync(`gh pr view "${url}" --json number,headRefName`, { encoding: 'utf-8' });
  return JSON.parse(output) as PRInfo;
}

/** Fetch all submitted reviews for a PR. */
export function fetchPRReviews(owner: string, repo: string, number: string): PRReview[] {
  return ghApi<PRReview[]>(`repos/${owner}/${repo}/pulls/${number}/reviews`);
}

/** Fetch all inline review comments for a PR. */
export function fetchPRComments(owner: string, repo: string, number: string): PRComment[] {
  return ghApi<PRComment[]>(`repos/${owner}/${repo}/pulls/${number}/comments`);
}

/** Build a human-readable feedback summary from PR reviews and comments. */
export function formatFeedbackSummary(
  prNumber: number,
  reviews: PRReview[],
  comments: PRComment[]
): string {
  const lines: string[] = [`## PR Review Feedback for #${prNumber}`, ''];

  if (reviews.length === 0 && comments.length === 0) {
    lines.push('No review feedback found.');
    return lines.join('\n');
  }

  // Group inline comments by reviewer for display
  const commentsByReviewer = new Map<string, PRComment[]>();
  for (const c of comments) {
    const reviewer = c.user.login;
    const existing = commentsByReviewer.get(reviewer) ?? [];
    existing.push(c);
    commentsByReviewer.set(reviewer, existing);
  }

  // Top-level reviews (may have body + state)
  const reviewMap = new Map<string, PRReview>();
  for (const r of reviews) {
    reviewMap.set(r.user.login, r);
  }

  // Merge all reviewer names
  const allReviewers = new Set([...reviewMap.keys(), ...commentsByReviewer.keys()]);

  for (const reviewer of allReviewers) {
    const review = reviewMap.get(reviewer);
    const reviewerComments = commentsByReviewer.get(reviewer) ?? [];

    const state = review?.state ?? 'COMMENTED';
    lines.push(`### Review by ${reviewer} — ${state}`, '');

    if (review?.body?.trim()) {
      lines.push(review.body.trim(), '');
    }

    for (const c of reviewerComments) {
      const lineRef = c.line ?? c.original_line;
      const location = lineRef != null ? `${c.path}:${lineRef}` : c.path;
      lines.push(`**${location}** — ${c.body.trim()}`, '');
    }
  }

  return lines.join('\n').trimEnd();
}

const feedbackSubcommand = new Command('feedback')
  .description('Fetch PR review feedback and generate an agent resumption prompt')
  .argument('<url>', 'GitHub PR URL (e.g. https://github.com/owner/repo/pull/123)')
  .option('--auto-resume', 'Also output the full agent resumption prompt')
  .action(async (url: string, opts: { autoResume?: boolean }) => {
    // Verify gh is available
    try {
      execSync('gh --version', { stdio: 'ignore' });
    } catch {
      process.stderr.write('Error: gh CLI not found. Install from https://cli.github.com/\n');
      process.exitCode = 1;
      return;
    }

    const parsed = parsePRUrl(url);
    if (!parsed) {
      process.stderr.write(`Error: Could not parse PR URL: ${url}\n`);
      process.exitCode = 1;
      return;
    }

    let prInfo: PRInfo;
    let reviews: PRReview[];
    let comments: PRComment[];

    try {
      prInfo = fetchPRInfo(url);
      reviews = fetchPRReviews(parsed.owner, parsed.repo, parsed.number);
      comments = fetchPRComments(parsed.owner, parsed.repo, parsed.number);
    } catch (err) {
      process.stderr.write(
        `Error: Failed to fetch PR data: ${err instanceof Error ? err.message : String(err)}\n`
      );
      process.exitCode = 1;
      return;
    }

    const feedbackSummary = formatFeedbackSummary(prInfo.number, reviews, comments);
    process.stdout.write(feedbackSummary + '\n');

    if (!opts.autoResume) return;

    await withBrain(async (svc) => {
      // Try to find the agent: first by PR URL, then by branch
      let agent = findAgentByPR(svc.db, url);
      if (!agent) {
        agent = findAgentByBranch(svc.db, prInfo.headRefName);
      }

      if (!agent) {
        process.stderr.write(`No agent found for this PR (branch: ${prInfo.headRefName})\n`);
        return;
      }

      let taskTitle: string | undefined;
      if (agent.brain_task) {
        const taskResult = getTask(svc.db, agent.brain_task);
        if (taskResult.ok) taskTitle = taskResult.data.title;
      }

      const sessions = agent.brain_task ? getSessionsForTask(svc.db, agent.brain_task) : [];
      const sessionSummaries = sessions
        .map((s) => extractSessionSummary(svc.db, s.session_id))
        .filter((s): s is NonNullable<typeof s> => s !== null);

      const resumptionPrompt = buildResumptionPrompt({
        agent,
        taskTitle,
        sessions,
        sessionSummaries,
        reason: 'pr-feedback',
        feedback: feedbackSummary,
      });

      process.stdout.write('\n---\n\n');
      process.stdout.write(resumptionPrompt.markdown + '\n');
    });
  });

export const prFeedbackCommand = new Command('pr')
  .description('PR workflow commands')
  .addCommand(feedbackSubcommand);
