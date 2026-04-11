import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import { spawn, execSync, type ChildProcess } from 'node:child_process';
import { tmpdir, homedir } from 'node:os';
import type { BrainServiceClass } from '../services/brain-service.js';
import type { BrainDB } from '../services/brain-db.js';
import type { Embedder } from '../types.js';
import type { RoutingResult } from '../modules/pm/engine/routing.js';
import type { PullResult } from '../modules/agents/task-pull.js';
import { pullNextTask } from '../modules/agents/task-pull.js';
import { getTask, updateTaskStatus } from '../modules/pm/data/task-ops.js';
import { buildWorkerDispatchFromPull } from '../modules/agents/coordinator.js';
import { generateClaim, isClaimStale } from '../modules/pm/engine/claims.js';
import { getPmNotes } from '../modules/pm/data/queries.js';
import {
  buildAgentDispatchContext,
  formatDispatchBrief,
} from '../modules/agents/dispatch-context.js';
import { replaceFrontmatterField } from '../utils.js';
import { indexSingleFile } from '../services/indexing.js';
import { allocateWorktree } from '../modules/agents/worktree.js';
import type { AllocateWorktreeResult } from '../modules/agents/worktree.js';
import {
  createAgent,
  getAgent,
  updateAgentStatus,
  setAgentContext,
  listAgents,
} from '../modules/agents/data.js';
import type { AgentStatus } from '../modules/agents/types.js';
import { parseCompletionMessage, handleCompletion } from '../modules/agents/completion-protocol.js';

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

// --- Types ---

export interface DispatchOptions {
  taskId?: string;
  model?: string;
  maxBudgetUsd?: number;
  dryRun?: boolean;
  promptOverride?: string;
  worktreeBudget?: number;
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
    ? await resolveExplicitTask(svc, opts.taskId, projectDir, opts.dryRun)
    : await resolveNextTask(svc, projectDir, opts.dryRun);

  const workerDispatch = buildWorkerDispatchFromPull(svc.db, pullResult, {
    projectDir,
    teamName: 'headless',
    templateName: 'worker',
  });

  const prompt = opts.promptOverride ?? workerDispatch?.prompt ?? pullResult.brief;
  const routing = workerDispatch?.routing ?? pullResult.dispatchContext.routing;
  const taskId = workerDispatch?.taskId ?? pullResult.taskId;
  const model = opts.model ?? routing.model;

  if (opts.dryRun) {
    return { taskId, prompt, routing, model, dryRun: true as const };
  }

  const worktreeResult = maybeAllocateWorktree(
    svc.db,
    projectDir,
    routing,
    taskId,
    pullResult,
    opts.worktreeBudget
  );

  const agentId = createAgent(svc.db, {
    name: workerDispatch?.description || `headless-${taskId}`,
    parent: 'headless-dispatch',
    brain_task: taskId,
    claim_token: pullResult.claimToken,
    branch: worktreeResult?.branch,
    worktree_path: worktreeResult?.worktreePath,
  });

  const sessionId = randomUUID();
  setAgentContext(svc.db, agentId, 'session_id', sessionId);
  setAgentContext(svc.db, agentId, 'sessions', [sessionId]);

  // Store workflow step context so resolveWorkflowInstance can trace back
  const stepMeta = resolveStepMetadata(svc, taskId);
  if (stepMeta) {
    setAgentContext(svc.db, agentId, 'workflow_step', stepMeta.stepId);
    setAgentContext(svc.db, agentId, 'workflow_instance', stepMeta.instanceDisplayId);
  }

  const mcpConfigPath = writeMcpConfig(agentId, projectDir);

  const proc = spawnClaude({
    prompt,
    model,
    taskId,
    sessionId,
    agentId,
    claimToken: pullResult.claimToken,
    mcpConfigPath,
    maxBudgetUsd: opts.maxBudgetUsd ?? 5.0,
    cwd: worktreeResult?.worktreePath || projectDir,
    worktreePath: worktreeResult?.worktreePath,
    addDir: worktreeResult ? projectDir : undefined,
  });

  // Catch spawn errors — logged in setupProcessTracking but we need a handler
  // attached before the event loop tick to prevent unhandled 'error' crash
  proc.on('error', () => {
    /* handled in setupProcessTracking */
  });

  if (!proc.pid) {
    const cwd = worktreeResult?.worktreePath || projectDir;
    updateAgentStatus(svc.db, agentId, 'failed', {
      exit_reason: 'spawn_error',
      summary: `Failed to spawn claude. Binary: ${getClaudePath()}, cwd: ${cwd}, cwd exists: ${existsSync(cwd)}`,
    });
    throw new Error(
      `Agent spawn failed: binary=${getClaudePath()} cwd=${cwd} cwdExists=${existsSync(cwd)}`
    );
  }

  updateAgentStatus(svc.db, agentId, 'active', { pid: proc.pid });

  // Transition task to in-progress so agent-done handler can mark it done
  // (claimed → in-progress is valid; in-progress → done is valid)
  updateTaskStatus(svc.db, svc.config, svc.embedder, taskId, 'in-progress').catch(() => {});

  setupProcessTracking(svc, proc, agentId, mcpConfigPath);
  proc.unref();

  return {
    agentId,
    taskId,
    pid: proc.pid,
    worktreePath: worktreeResult?.worktreePath,
    branch: worktreeResult?.branch,
    model,
    sessionId,
    prompt,
  };
}

// --- Helpers ---

export function resolveProjectDir(svc: BrainServiceClass): string {
  if (svc.instance.isLocal) {
    return dirname(svc.instance.root);
  }
  return process.cwd();
}

async function resolveExplicitTask(
  svc: BrainServiceClass,
  taskId: string,
  projectDir: string,
  dryRun?: boolean
): Promise<PullResult> {
  const result = getTask(svc.db, taskId);
  if (!result.ok) {
    throw new Error(`Task not found: ${taskId}`);
  }

  const task = result.data;

  // Dedup: if an active agent with a live process already exists for this task, reject
  const activeAgents = listAgents(svc.db, { status: 'active' as AgentStatus });
  const existing = activeAgents.find((a) => a.brain_task === taskId);
  if (existing) {
    const pid = (existing as unknown as Record<string, unknown>).pid as number | undefined;
    if (pid && isAlive(pid)) {
      throw new Error(`Task ${taskId} already has an active agent (id=${existing.id}, pid=${pid})`);
    }
  }

  if (task.status === 'done' || task.status === 'cancelled' || task.status === 'pruned') {
    throw new Error(`Task ${taskId} has terminal status "${task.status}" — skipping dispatch`);
  }
  if (task.status === 'claimed' && task.claimed_at && !isClaimStale(task.claimed_at)) {
    throw new Error(`Task ${taskId} has an active claim (claimed at ${task.claimed_at})`);
  }
  if (task.status !== 'pending' && task.status !== 'claimed' && task.status !== 'in-progress') {
    throw new Error(
      `Task ${taskId} has status "${task.status}" — expected pending, claimed, or in-progress`
    );
  }

  if (!dryRun) {
    await claimTask(svc.db, svc.embedder, taskId);
  }

  const dispatchContext = buildAgentDispatchContext(svc.db, taskId, { projectDir });
  if (!dispatchContext) {
    throw new Error(`Failed to build dispatch context for ${taskId}`);
  }

  const brief = formatDispatchBrief(dispatchContext);
  const claim = getTask(svc.db, taskId);
  const claimToken = dryRun ? '' : claim.ok ? (claim.data.claim_token ?? '') : '';

  return { taskId, claimToken, dispatchContext, brief };
}

async function resolveNextTask(
  svc: BrainServiceClass,
  projectDir: string,
  dryRun?: boolean
): Promise<PullResult> {
  const result = await pullNextTask(svc.db, svc.config, svc.embedder, { projectDir, dryRun });
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

  // Preserve workflow metadata (step_id, etc.) that expandWorkflow set in DB
  // but isn't in the frontmatter file — re-indexing from disk would lose it
  const priorMeta = notes[0].metadata
    ? (JSON.parse(notes[0].metadata) as Record<string, unknown>)
    : {};

  const filePath = notes[0].filePath;
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

  // Merge back workflow metadata fields that existed before re-indexing
  const WORKFLOW_FIELDS = ['step_id', 'workflow_id', 'instance_status', 'context'] as const;
  const reindexedNotes = getPmNotes(db, 'task', { display_id: taskId });
  if (reindexedNotes.length > 0) {
    const newMeta = reindexedNotes[0].metadata
      ? (JSON.parse(reindexedNotes[0].metadata) as Record<string, unknown>)
      : {};
    let needsUpdate = false;
    for (const field of WORKFLOW_FIELDS) {
      if (priorMeta[field] !== undefined && newMeta[field] === undefined) {
        newMeta[field] = priorMeta[field];
        needsUpdate = true;
      }
    }
    if (needsUpdate) {
      db.upsertNote({ ...reindexedNotes[0], metadata: JSON.stringify(newMeta) });
    }
  }
}

// --- Spawn helpers ---

interface SpawnOptions {
  prompt: string;
  model: string;
  taskId: string;
  sessionId: string;
  agentId: string;
  claimToken: string;
  mcpConfigPath: string;
  maxBudgetUsd: number;
  cwd: string;
  worktreePath?: string;
  addDir?: string;
}

function maybeAllocateWorktree(
  db: BrainDB,
  projectDir: string,
  routing: RoutingResult,
  taskId: string,
  pullResult: PullResult,
  budget?: number
): AllocateWorktreeResult | undefined {
  if (routing.isolation === 'none') return undefined;

  const workstream =
    pullResult.dispatchContext.context?.workstream?.displayId ?? taskId.replace(/\.\d+$/, '');

  const result = allocateWorktree(db, projectDir, {
    taskId,
    workstream,
    claimToken: pullResult.claimToken,
    budget,
  });
  if (result?.worktreePath && !existsSync(result.worktreePath)) {
    throw new Error(
      `Worktree path ${result.worktreePath} does not exist after allocation for ${taskId}`
    );
  }
  return result;
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

function cleanupTempFile(path: string): void {
  try {
    unlinkSync(path);
  } catch {
    /* already cleaned or missing */
  }
}

let _claudePath: string | null = null;
function getClaudePath(): string {
  if (_claudePath) return _claudePath;
  // Check common install locations first, then fall back to which/bare name
  const candidates = [
    join(homedir(), '.local', 'bin', 'claude'),
    '/usr/local/bin/claude',
    '/opt/homebrew/bin/claude',
  ];
  for (const p of candidates) {
    if (existsSync(p)) {
      _claudePath = p;
      return p;
    }
  }
  try {
    _claudePath = execSync('which claude', { encoding: 'utf-8' }).trim();
  } catch {
    _claudePath = 'claude';
  }
  return _claudePath;
}

function spawnClaude(opts: SpawnOptions): ChildProcess {
  const args = [
    '-p',
    '--output-format',
    'json',
    '--model',
    opts.model,
    '--permission-mode',
    'bypassPermissions',
    '--session-id',
    opts.sessionId,
    '--append-system-prompt',
    `On task completion output exactly: DONE ${opts.taskId} <one-line summary>. On failure output exactly: FAILED ${opts.taskId} <reason>.`,
    '--allowed-tools',
    'Bash,Edit,Read,Write,Glob,Grep',
    '--mcp-config',
    opts.mcpConfigPath,
    '--max-budget-usd',
    String(opts.maxBudgetUsd),
  ];

  if (opts.addDir) {
    args.push('--add-dir', opts.addDir);
  }

  const claudeBin = getClaudePath();
  const proc = spawn(claudeBin, args, {
    cwd: opts.cwd,
    env: {
      ...process.env,
      BRAIN_AGENT_ID: opts.agentId,
      AGENT_WORKTREE_PATH: opts.worktreePath || '',
      BRAIN_PM_TASK: opts.taskId,
      BRAIN_PM_CLAIM_TOKEN: opts.claimToken,
      BRAIN_PM_SESSION: opts.sessionId,
    },
    stdio: ['pipe', 'pipe', 'pipe'],
    detached: true,
  });

  proc.stdin.write(opts.prompt);
  proc.stdin.end();

  return proc;
}

function setupProcessTracking(
  svc: BrainServiceClass,
  proc: ChildProcess,
  agentId: string,
  mcpConfigPath: string
): void {
  const stdoutChunks: Buffer[] = [];
  proc.stdout!.on('data', (chunk: Buffer) => stdoutChunks.push(chunk));

  const stderrChunks: Buffer[] = [];
  proc.stderr!.on('data', (chunk: Buffer) => stderrChunks.push(chunk));

  // Handle spawn errors (e.g. ENOENT if claude binary not found)
  proc.on('error', (err) => {
    cleanupTempFile(mcpConfigPath);
    updateAgentStatus(svc.db, agentId, 'failed', {
      exit_reason: 'spawn_error',
      summary: err.message.slice(0, 500),
    });
  });

  proc.on('exit', async (code) => {
    cleanupTempFile(mcpConfigPath);
    await handleProcessExit(svc, agentId, code, stdoutChunks, stderrChunks);
  });
}

async function handleProcessExit(
  svc: BrainServiceClass,
  agentId: string,
  code: number | null,
  stdoutChunks: Buffer[],
  stderrChunks: Buffer[]
): Promise<void> {
  const stdout = Buffer.concat(stdoutChunks).toString('utf-8');
  let result: ClaudeJsonResult | null = null;
  try {
    result = JSON.parse(stdout);
  } catch {
    /* non-JSON output */
  }

  // Store full agent output BEFORE marking status — the reconciler may poll between
  // these two writes; ensuring full_output is present avoids empty signal parsing.
  if (result?.result) {
    setAgentContext(svc.db, agentId, 'full_output', result.result);
  }

  if (code === 0 && result) {
    const completion = parseCompletionMessage(result.result ?? '');
    // Skip handleCompletion (which sets task to 'done') when the agent has a
    // branch — delivery hasn't happened yet. The dispatch loop will set the
    // final task status after push + PR via ensureDelivery.
    const agent = getAgent(svc.db, agentId);
    const hasBranch = !!agent?.branch?.startsWith('agent/');
    if (completion && !hasBranch) {
      await handleCompletion(svc.db, svc.config, svc.embedder, completion);
    }
    updateAgentStatus(svc.db, agentId, 'completed', {
      summary: completion?.summary ?? 'Completed without protocol message',
    });
  } else if (code === 143) {
    updateAgentStatus(svc.db, agentId, 'failed', { exit_reason: 'rate_limited' });
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
}

// --- Workflow Context ---

function resolveStepMetadata(
  svc: BrainServiceClass,
  taskId: string
): { stepId: string; instanceDisplayId: string } | undefined {
  const taskNotes = getPmNotes(svc.db, 'task', { display_id: taskId });
  if (taskNotes.length === 0) return undefined;

  const meta = JSON.parse(taskNotes[0].metadata ?? '{}') as Record<string, unknown>;
  const stepId = meta.step_id as string | undefined;
  if (!stepId) return undefined;

  const incomingRelations = svc.db.getRelationsTo(taskNotes[0].id);
  const expandsToRel = incomingRelations.find((r) => r.type === 'expands-to');
  if (!expandsToRel) return undefined;

  const instanceNote = svc.db.getNoteById(expandsToRel.sourceId);
  if (!instanceNote?.metadata) return undefined;

  const instanceMeta = JSON.parse(instanceNote.metadata) as Record<string, unknown>;
  const instanceDisplayId = instanceMeta.display_id as string;
  if (!instanceDisplayId) return undefined;

  return { stepId, instanceDisplayId };
}
