import { execFileSync } from 'node:child_process';
import type { HookHandler, HookInput, HookConfig, HookResult } from '../../../hooks/types.js';
import { hookAllow } from '../../../hooks/types.js';
import { loadConfig } from '../../../services/config.js';
import { BrainDB } from '../../../services/brain-db.js';
import { captureSessionEvent } from './capture-event.js';
import { writeStatusCache } from './status-cache.js';

const PR_URL_RE = /https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/\d+/;
const PR_NUMBER_RE = /\/pull\/(\d+)/;

export const sessionPostToolHandler: HookHandler = {
  name: 'sessions:post-tool',
  event: 'post-tool-use',
  priority: 90,

  enabled(_config: HookConfig): boolean {
    return !!process.env.BRAIN_PM_SESSION;
  },

  run(input: HookInput, _config: HookConfig): HookResult {
    const sessionId = process.env.BRAIN_PM_SESSION;
    if (!sessionId) return hookAllow();

    let db: BrainDB | null = null;
    try {
      const config = loadConfig();
      db = new BrainDB(config.dbPath);

      detectPrCreation(db, input, sessionId);
      writeStatusCache(db, sessionId);
    } catch {
      // Observational — never block
    } finally {
      db?.close();
    }

    return hookAllow();
  },
};

function detectPrCreation(db: BrainDB, input: HookInput, sessionId: string): void {
  const toolName = (input.parsed.tool_name ?? input.parsed.tool ?? '') as string;
  const toolOutput = (input.parsed.tool_output ?? input.parsed.output ?? '') as string;

  if (toolName !== 'Bash' && toolName !== 'bash') return;

  const match = PR_URL_RE.exec(toolOutput);
  if (!match) return;

  const prUrl = match[0];

  captureSessionEvent(db, {
    session_id: sessionId,
    event_type: 'pr:created',
    category: 'vcs',
    data: { pr_url: prUrl, tool: toolName },
    timestamp: new Date().toISOString(),
  });

  // Auto-create a review task for this PR
  tryCreateReviewTask(prUrl, sessionId);
}

/**
 * Shell out to brain pm task add to create a review task.
 * Fire-and-forget — never blocks the hook pipeline.
 */
function tryCreateReviewTask(prUrl: string, sessionId: string): void {
  try {
    const prNumber = PR_NUMBER_RE.exec(prUrl)?.[1] ?? '?';
    const agentId = process.env.BRAIN_AGENT_ID;
    const taskId = process.env.BRAIN_PM_TASK;
    const project = process.env.BRAIN_PM_PROJECT;

    if (!project) return;

    // Find the workstream from the current task
    const workstream = taskId?.split('.')[0]?.replace(project + '-', '') ?? '01';

    const name = `Review PR #${prNumber}`;
    const description =
      `Review ${prUrl}. Auto-created from session ${sessionId}.` +
      (agentId ? ` Author agent: ${agentId}.` : '') +
      (taskId ? ` Source task: ${taskId}.` : '');

    const args = [
      'pm',
      'task',
      'add',
      name,
      '--project',
      project,
      '--workstream',
      `${project}-${workstream}`,
      '--category',
      'review',
      '--priority',
      'high',
      '--description',
      description,
    ];

    if (taskId) {
      args.push('--depends-on', taskId);
    }

    execFileSync('brain', args, {
      timeout: 10_000,
      stdio: 'ignore',
    });
  } catch {
    // Non-fatal: review task creation is best-effort
  }
}
