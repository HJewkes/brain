import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { BrainServiceClass } from '../services/brain-service.js';
import { resolveProject } from '../modules/pm/data/queries.js';
import { listTasks } from '../modules/pm/data/task-ops.js';
import { listWorkstreams } from '../modules/pm/data/workstream-ops.js';
import { computeWaves } from '../modules/pm/engine/dependency.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AdvisorRequest {
  question: string;
  context?: string;
  maxTokens?: number;
  systemPrompt?: string;
}

export interface ReviewRequest {
  svc: BrainServiceClass;
  focus?: string;
  workstream?: string;
  includeSession?: boolean;
}

export interface AdvisorResponse {
  advice: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
    durationMs: number;
  };
}

interface ClaudeJsonOutput {
  result: string;
  is_error: boolean;
  duration_ms: number;
  total_cost_usd: number;
  usage: {
    input_tokens?: number;
    output_tokens?: number;
  };
}

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

const ADVISOR_SYSTEM_PROMPT = `You are a strategic advisor for a software engineering coordinator agent. Your role is to provide concise, actionable guidance — not to implement anything yourself.

Rules:
1. Answer with enumerated steps or bullet points, not paragraphs
2. Be direct — state the recommended action first, then brief rationale
3. If the question involves trade-offs, list options with pros/cons in 1–2 lines each
4. Flag risks or blockers the coordinator should address
5. Stay within the coordinator's domain — do not suggest manual human actions unless asked`;

// ---------------------------------------------------------------------------
// Claude binary resolution (mirrors dispatch.ts pattern)
// ---------------------------------------------------------------------------

let _claudePath: string | null = null;

function getClaudePath(): string {
  if (_claudePath) return _claudePath;
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

// ---------------------------------------------------------------------------
// Core advisor invocation
// ---------------------------------------------------------------------------

export function askAdvisor(req: AdvisorRequest): AdvisorResponse {
  const userPrompt = req.context
    ? `Context:\n${req.context}\n\nQuestion:\n${req.question}`
    : req.question;

  const maxTokens = req.maxTokens ?? 500;
  const claudeBin = getClaudePath();

  const args = [
    '-p',
    '--output-format',
    'json',
    '--model',
    'claude-opus-4-6',
    '--max-turns',
    '1',
    '--permission-mode',
    'plan',
    '--system-prompt',
    req.systemPrompt ?? ADVISOR_SYSTEM_PROMPT,
    '--max-tokens',
    String(maxTokens),
  ];

  const start = Date.now();
  let stdout: string;
  try {
    stdout = execSync(`${claudeBin} ${args.map(shellEscape).join(' ')}`, {
      input: userPrompt,
      encoding: 'utf-8',
      timeout: 120_000,
      maxBuffer: 10 * 1024 * 1024,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Advisor invocation failed: ${msg}`);
  }
  const elapsed = Date.now() - start;

  let parsed: ClaudeJsonOutput;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return {
      advice: stdout.trim(),
      usage: { inputTokens: 0, outputTokens: 0, costUsd: 0, durationMs: elapsed },
    };
  }

  if (parsed.is_error) {
    throw new Error(`Advisor returned error: ${parsed.result}`);
  }

  return {
    advice: parsed.result,
    usage: {
      inputTokens: parsed.usage?.input_tokens ?? 0,
      outputTokens: parsed.usage?.output_tokens ?? 0,
      costUsd: parsed.total_cost_usd ?? 0,
      durationMs: parsed.duration_ms ?? elapsed,
    },
  };
}

// ---------------------------------------------------------------------------
// Review mode system prompt
// ---------------------------------------------------------------------------

const REVIEW_SYSTEM_PROMPT = `You are a strategic advisor reviewing the current state of a software engineering project. You have been given a context package assembled from the project management system, recent agent outcomes, and optionally session transcripts.

Produce a structured review with these sections:

## Assessment
What's working well and what's not. Be specific — reference task IDs and agent outcomes.

## Action Items
Numbered list of concrete, actionable steps the coordinator should take next.

## Risk Flags
Things that could go wrong — blocked dependencies, failing agents, scope creep, resource waste.

## Recommended Next Steps
Prioritized sequence of what to do next, considering dependencies and risk.

Rules:
- Be direct and specific — vague advice is useless
- Reference task IDs when discussing specific work
- Flag patterns (e.g. repeated failures on similar tasks)
- Keep each section concise — bullets over paragraphs`;

// ---------------------------------------------------------------------------
// Context assembly
// ---------------------------------------------------------------------------

function assemblePmContext(svc: BrainServiceClass, workstream?: string): string {
  const resolvedResult = resolveProject(svc.db, undefined);
  if (!resolvedResult.ok) return 'PM context unavailable: no project found';
  const prefix = resolvedResult.data;

  const allTasksResult = listTasks(svc.db, prefix);
  const allTasks = allTasksResult.ok ? allTasksResult.data : [];

  const wsResult = listWorkstreams(svc.db, prefix);
  const workstreams = wsResult.ok ? wsResult.data : [];

  const filteredTasks = workstream
    ? allTasks.filter(
        (t) => t.workstream_display_id === workstream || `${prefix}-${t.workstream}` === workstream
      )
    : allTasks;

  const inProgress = filteredTasks.filter((t) => t.status === 'in-progress');
  const pending = filteredTasks.filter((t) => t.status === 'pending');
  const recentDone = filteredTasks
    .filter((t) => t.status === 'done' && t.modified)
    .sort((a, b) => (b.modified ?? '').localeCompare(a.modified ?? ''))
    .slice(0, 10);
  const blocked = filteredTasks.filter((t) => t.status === 'blocked');

  const waves = computeWaves(svc.db, prefix);
  const taskByDisplayId = new Map(filteredTasks.map((t) => [t.display_id, t]));
  const currentWave = waves.find((w) =>
    w.taskIds.some((id) => {
      const t = taskByDisplayId.get(id);
      return t && (t.status === 'in-progress' || t.status === 'pending');
    })
  );

  const lines: string[] = ['## PM State'];
  if (workstream) lines.push(`Scoped to workstream: ${workstream}`);
  lines.push(`Total tasks: ${filteredTasks.length}`);
  lines.push(`In progress: ${inProgress.length}`);
  lines.push(`Pending: ${pending.length}`);
  lines.push(`Blocked: ${blocked.length}`);
  lines.push(`Workstreams: ${workstreams.map((w) => w.display_id).join(', ')}`);

  if (currentWave) {
    lines.push(`\nCurrent wave: ${currentWave.wave}`);
    for (const id of currentWave.taskIds) {
      const t = taskByDisplayId.get(id);
      lines.push(`  ${id} [${t?.status ?? 'unknown'}] ${t?.title ?? ''}`);
    }
  }

  if (inProgress.length > 0) {
    lines.push('\nIn-progress tasks:');
    for (const t of inProgress) {
      lines.push(`  ${t.display_id} — ${t.title ?? 'untitled'} (priority: ${t.priority})`);
    }
  }

  if (recentDone.length > 0) {
    lines.push('\nRecent completions:');
    for (const t of recentDone) {
      lines.push(`  ${t.display_id} — ${t.title ?? 'untitled'} (${t.modified})`);
    }
  }

  if (blocked.length > 0) {
    lines.push('\nBlocked tasks:');
    for (const t of blocked) {
      lines.push(`  ${t.display_id} — ${t.title ?? 'untitled'}`);
    }
  }

  return lines.join('\n');
}

function assembleAgentContext(svc: BrainServiceClass): string {
  const recent = svc.agentList({ limit: 20, since: new Date(Date.now() - 86400000).toISOString() });
  if (recent.length === 0) return '## Recent Agents\nNo recent agent activity.';

  const lines: string[] = ['## Recent Agents (last 24h)'];
  for (const a of recent) {
    const duration =
      a.started_at && a.completed_at
        ? `${Math.round((new Date(a.completed_at).getTime() - new Date(a.started_at).getTime()) / 1000)}s`
        : 'n/a';
    const summary = a.summary ? ` — ${a.summary.slice(0, 100)}` : '';
    lines.push(`  ${a.brain_task ?? a.name} [${a.status}] duration=${duration}${summary}`);
  }

  const completed = recent.filter((a) => a.status === 'completed').length;
  const failed = recent.filter((a) => a.status === 'failed').length;
  const active = recent.filter((a) => a.status === 'active').length;
  lines.push(`\nSummary: ${completed} completed, ${failed} failed, ${active} active`);

  return lines.join('\n');
}

function assembleSessionContext(svc: BrainServiceClass): string {
  const sessions = svc.sessionList({ limit: 1 });
  if (sessions.length === 0) return '## Session\nNo active session.';

  const session = sessions[0];
  const detail = svc.sessionDetail(session.displayId);
  if (!detail) return `## Session\nSession ${session.displayId} found but no detail available.`;

  const lines: string[] = [`## Current Session: ${session.displayId}`];
  lines.push(`Status: ${session.status}`);
  lines.push(`Started: ${session.startedAt}`);
  lines.push(`Turns: ${detail.turns.length}`);
  lines.push(`Tool calls: ${detail.totalToolCalls}`);

  if (detail.frictionSignals.length > 0) {
    lines.push(`\nFriction signals: ${detail.frictionSignals.length}`);
    for (const f of detail.frictionSignals.slice(0, 5)) {
      lines.push(`  [${f.kind}] ${f.detail.slice(0, 100)}`);
    }
  }

  const recentTurns = detail.turns.slice(-10);
  if (recentTurns.length > 0) {
    lines.push('\nRecent turns:');
    for (const turn of recentTurns) {
      if (turn.userMessage) {
        lines.push(`  [user] ${turn.userMessage.slice(0, 120)}`);
      }
      if (turn.assistantResponse) {
        lines.push(`  [assistant] ${turn.assistantResponse.slice(0, 120)}`);
      }
    }
  }

  return lines.join('\n');
}

async function assembleSearchContext(svc: BrainServiceClass, workstream?: string): Promise<string> {
  const query = workstream ? `workstream ${workstream} status progress` : 'project status progress';
  const results = await svc.search(query, { limit: 5 });
  if (results.length === 0) return '';

  const lines: string[] = ['## Relevant Knowledge'];
  for (const r of results) {
    lines.push(`  [${r.heading ?? r.filePath}] score=${r.score.toFixed(2)}`);
    if (r.excerpt) lines.push(`    ${r.excerpt.slice(0, 150)}`);
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Full review advisor
// ---------------------------------------------------------------------------

export async function reviewAdvisor(req: ReviewRequest): Promise<AdvisorResponse> {
  const sections: string[] = [];

  sections.push(assemblePmContext(req.svc, req.workstream));
  sections.push(assembleAgentContext(req.svc));

  if (req.includeSession) {
    sections.push(assembleSessionContext(req.svc));
  }

  const searchCtx = await assembleSearchContext(req.svc, req.workstream);
  if (searchCtx) sections.push(searchCtx);

  const context = sections.join('\n\n');

  const focusLine = req.focus
    ? `\nFocus area: ${req.focus}`
    : '\nProvide a general strategic review.';

  return askAdvisor({
    question: `Review the current project state and provide strategic feedback.${focusLine}`,
    context,
    maxTokens: 1500,
    systemPrompt: REVIEW_SYSTEM_PROMPT,
  });
}

// ---------------------------------------------------------------------------
// Shell escape helper
// ---------------------------------------------------------------------------

function shellEscape(arg: string): string {
  if (/^[a-zA-Z0-9._\-/=]+$/.test(arg)) return arg;
  return `'${arg.replace(/'/g, "'\\''")}'`;
}
