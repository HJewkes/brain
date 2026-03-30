import { dirname, join } from 'node:path';
import { spawn } from 'node:child_process';
import { writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import type { BrainServiceClass } from '../services/brain-service.js';
import type { BrainDB } from '../services/brain-db.js';
import type { Embedder } from '../types.js';
import type { RoutingResult } from '../modules/pm/engine/routing.js';
import type { PullResult } from '../modules/agents/task-pull.js';
import { pullNextTask } from '../modules/agents/task-pull.js';
import { getTask } from '../modules/pm/data/task-ops.js';
import { buildWorkerDispatchFromPull } from '../modules/agents/coordinator.js';
import { generateClaim } from '../modules/pm/engine/claims.js';
import { isClaimStale } from '../modules/pm/engine/claims.js';
import { getPmNotes } from '../modules/pm/data/queries.js';
import {
  buildAgentDispatchContext,
  formatDispatchBrief,
} from '../modules/agents/dispatch-context.js';
import { replaceFrontmatterField } from '../utils.js';
import { allocateWorktree } from '../modules/agents/worktree.js';
import type { AllocateWorktreeResult } from '../modules/agents/worktree.js';
import { createAgent, updateAgentStatus, setAgentContext } from '../modules/agents/data.js';
import { parseCompletionMessage, handleCompletion } from '../modules/agents/completion-protocol.js';

// --- Types ---

export interface DispatchOptions {
  taskId?: string;
  model?: string;
  maxBudgetUsd?: number;
  dryRun?: boolean;
}

export interface DispatchResult {
  agentId: string;
  taskId: string;
  pid: number;
  worktreePath?: string;
  branch?: string;
  model: string;
  sessionId: string;
  prompt: string;
}

export interface DryRunResult {
  taskId: string;
  prompt: string;
  routing: RoutingResult;
  model: string;
  dryRun: true;
}

export interface ClaudeJsonResult {
  type: string;
  subtype: string;
  is_error: boolean;
  duration_ms: number;
  result: string;
  session_id: string;
  total_cost_usd: number;
  usage: Record<string, unknown>;
}

// --- Core Function ---

export async function dispatchTask(
  svc: BrainServiceClass,
  opts: DispatchOptions
): Promise<DispatchResult | DryRunResult> {
  const projectDir = resolveProjectDir(svc);

  const pullResult = opts.taskId
    ? await resolveExplicitTask(svc, opts.taskId, projectDir)
    : await resolveNextTask(svc, projectDir);

  const workerDispatch = buildWorkerDispatchFromPull(svc.db, pullResult, {
    projectDir,
    teamName: 'headless',
    templateName: 'worker',
  });

  const prompt = workerDispatch?.prompt ?? pullResult.brief;
  const routing = workerDispatch?.routing ?? pullResult.dispatchContext.routing;
  const taskId = workerDispatch?.taskId ?? pullResult.taskId;
  const model = opts.model ?? routing.model;

  if (opts.dryRun) {
    return { taskId, prompt, routing, model, dryRun: true as const };
  }

  // Step 6: Worktree allocation (conditional)
  let worktreeResult: AllocateWorktreeResult | undefined;
  if (routing.isolation === 'worktree') {
    const workstream = pullResult.dispatchContext.context?.workstream?.displayId || '';
    worktreeResult = allocateWorktree(svc.db, projectDir, {
      taskId,
      workstream,
      claimToken: pullResult.claimToken,
    });
  }
  const cwd = worktreeResult?.worktreePath || projectDir;

  // Step 7: Create agent record (starts as 'pending')
  const agentId = createAgent(svc.db, {
    name: workerDispatch?.description || `headless-${taskId}`,
    parent: 'headless-dispatch',
    brain_task: taskId,
    claim_token: pullResult.claimToken,
    branch: worktreeResult?.branch,
    worktree_path: worktreeResult?.worktreePath,
  });

  // Step 8: Spawn claude -p
  const sessionId = randomUUID();

  const mcpConfigPath = join(tmpdir(), `brain-mcp-${agentId}.json`);
  writeFileSync(
    mcpConfigPath,
    JSON.stringify({
      mcpServers: {
        brain: {
          command: 'node',
          args: [join(projectDir, 'dist', 'cli.js'), 'serve', '--mcp'],
        },
      },
    })
  );

  const maxBudget = opts.maxBudgetUsd ?? 2.0;

  const args = [
    '-p',
    '--output-format',
    'json',
    '--model',
    model,
    '--permission-mode',
    'bypassPermissions',
    '--no-session-persistence',
    '--session-id',
    sessionId,
    '--append-system-prompt',
    `On task completion output exactly: DONE ${taskId} <one-line summary>. On failure output exactly: FAILED ${taskId} <reason>.`,
    '--allowed-tools',
    'Bash,Edit,Read,Write,Glob,Grep',
    '--mcp-config',
    mcpConfigPath,
    '--max-budget-usd',
    String(maxBudget),
  ];

  if (worktreeResult) {
    args.push('--add-dir', projectDir);
  }

  const proc = spawn('claude', args, {
    cwd,
    env: {
      ...process.env,
      BRAIN_AGENT_ID: agentId,
      AGENT_WORKTREE_PATH: worktreeResult?.worktreePath || '',
      BRAIN_PM_TASK: taskId,
      BRAIN_PM_CLAIM_TOKEN: pullResult.claimToken,
    },
    stdio: ['pipe', 'pipe', 'pipe'],
    detached: true,
  });

  // Pipe prompt via stdin
  proc.stdin.write(prompt);
  proc.stdin.end();

  // Step 9: Transition to active + set up tracking
  updateAgentStatus(svc.db, agentId, 'active', { pid: proc.pid });

  const stdoutChunks: Buffer[] = [];
  proc.stdout.on('data', (chunk: Buffer) => stdoutChunks.push(chunk));

  const stderrChunks: Buffer[] = [];
  proc.stderr.on('data', (chunk: Buffer) => stderrChunks.push(chunk));

  // Exit handler
  proc.on('exit', async (code) => {
    try {
      unlinkSync(mcpConfigPath);
    } catch {
      /* already cleaned */
    }

    const stdout = Buffer.concat(stdoutChunks).toString('utf-8');
    let result: ClaudeJsonResult | null = null;
    try {
      result = JSON.parse(stdout);
    } catch {
      /* non-JSON output */
    }

    if (code === 0 && result) {
      const completion = parseCompletionMessage(result.result ?? '');
      if (completion) {
        await handleCompletion(svc.db, svc.config, svc.embedder, completion);
        updateAgentStatus(svc.db, agentId, 'completed', {
          summary: completion.summary,
        });
      } else {
        updateAgentStatus(svc.db, agentId, 'completed', {
          summary: 'Completed without protocol message',
        });
      }
    } else if (code === 143) {
      updateAgentStatus(svc.db, agentId, 'failed', {
        exit_reason: 'rate_limited',
      });
    } else {
      updateAgentStatus(svc.db, agentId, 'failed', {
        exit_reason: `exit_code_${code}`,
        summary: Buffer.concat(stderrChunks).toString('utf-8').slice(0, 500),
      });
    }

    if (result) {
      setAgentContext(svc.db, agentId, 'claude_result', {
        duration_ms: result.duration_ms,
        total_cost_usd: result.total_cost_usd,
        usage: result.usage,
        subtype: result.subtype,
        session_id: result.session_id,
      });
    }
  });

  proc.unref();

  // Step 10: Return handle
  return {
    agentId,
    taskId,
    pid: proc.pid!,
    worktreePath: worktreeResult?.worktreePath,
    branch: worktreeResult?.branch,
    model,
    sessionId,
    prompt,
  };
}

// --- Helpers ---

function resolveProjectDir(svc: BrainServiceClass): string {
  if (svc.instance.isLocal) {
    return dirname(svc.instance.root);
  }
  return process.cwd();
}

async function resolveExplicitTask(
  svc: BrainServiceClass,
  taskId: string,
  projectDir: string
): Promise<PullResult> {
  const result = getTask(svc.db, taskId);
  if (!result.ok) {
    throw new Error(`Task not found: ${taskId}`);
  }

  const task = result.data;
  if (task.status === 'claimed' && task.claimed_at && !isClaimStale(task.claimed_at)) {
    throw new Error(`Task ${taskId} has an active claim (claimed at ${task.claimed_at})`);
  }
  if (task.status !== 'pending' && task.status !== 'claimed') {
    throw new Error(`Task ${taskId} has status "${task.status}" — expected pending or claimed`);
  }

  await claimTask(svc.db, svc.embedder, taskId);

  const dispatchContext = buildAgentDispatchContext(svc.db, taskId, { projectDir });
  if (!dispatchContext) {
    throw new Error(`Failed to build dispatch context for ${taskId}`);
  }

  const brief = formatDispatchBrief(dispatchContext);
  const claim = getTask(svc.db, taskId);
  const claimToken = claim.ok ? (claim.data.claim_token ?? '') : '';

  return { taskId, claimToken, dispatchContext, brief };
}

async function resolveNextTask(svc: BrainServiceClass, projectDir: string): Promise<PullResult> {
  const result = await pullNextTask(svc.db, svc.config, svc.embedder, { projectDir });
  if (!result) {
    throw new Error('No eligible tasks found for dispatch');
  }
  return result;
}

async function claimTask(db: BrainDB, embedder: Embedder, taskId: string): Promise<void> {
  const notes = getPmNotes(db, 'task', { display_id: taskId });
  if (notes.length === 0) {
    throw new Error(`No note found for task ${taskId}`);
  }

  const filePath = notes[0].filePath;
  const { existsSync, readFileSync, writeFileSync } = await import('node:fs');
  const { createHash } = await import('node:crypto');
  const { indexSingleFile } = await import('../services/indexing.js');

  if (!existsSync(filePath)) {
    throw new Error(`Task file not found: ${filePath}`);
  }

  const claim = generateClaim();
  let content = readFileSync(filePath, 'utf-8');
  content = replaceFrontmatterField(content, 'status', 'claimed');
  content = replaceFrontmatterField(content, 'claim_token', claim.token);
  content = replaceFrontmatterField(content, 'claimed_at', claim.claimedAt);
  content = replaceFrontmatterField(content, 'modified', new Date().toISOString().slice(0, 10));

  writeFileSync(filePath, content, 'utf-8');

  const hash = createHash('sha256').update(content).digest('hex');
  await indexSingleFile(db, embedder, filePath, content, hash, Date.now());
}
