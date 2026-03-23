import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import type { AgentRecord } from './types.js';
import type { SessionMetadata } from '../sessions/types.js';
import { getAgentContext, setAgentContext } from './data.js';

export type ResumeReason = 'pr-feedback' | 'build-failure' | 'test-failure' | 'manual';

export interface SessionSummary {
  sessionId: string;
  startedAt: string;
  duration: string;
  toolCalls: number;
  errors: number;
  filesModified: string[];
  prsCreated: string[];
  tasksReferenced: string[];
  keyTools: string[];
  logPath: string | null;
}

export interface ResumptionEntry {
  reason: string;
  timestamp: string;
  feedback?: string;
}

export interface ResumeContext {
  agent: AgentRecord;
  taskTitle?: string;
  sessions: SessionMetadata[];
  sessionSummaries?: SessionSummary[];
  reason: ResumeReason;
  feedback?: string;
}

export interface ResumptionPrompt {
  markdown: string;
  json: {
    agent: { id: string; name: string; branch: string | null; status: string; task: string | null };
    reason: ResumeReason;
    feedback?: string;
    sessions: Array<{
      display_id: string;
      started_at: string;
      duration_minutes?: number;
      tool_calls?: number;
      error_count?: number;
      summary?: string;
    }>;
    task_title?: string;
  };
}

interface RawDb {
  prepare(sql: string): { get(...args: unknown[]): unknown };
}

function toRawDb(db: unknown): RawDb {
  const inner = (db as { db?: RawDb }).db;
  return inner ?? (db as RawDb);
}

/**
 * Extract a session summary from the brain session note stored in the DB.
 * Returns null if the session note has not been ingested yet.
 */
export function extractSessionSummary(db: unknown, sessionId: string): SessionSummary | null {
  try {
    const raw = toRawDb(db);
    const row = raw
      .prepare(
        `SELECT metadata FROM notes
         WHERE module = 'sessions'
           AND json_extract(metadata, '$.session_id') = ?`
      )
      .get(sessionId) as { metadata: string } | undefined;

    if (!row?.metadata) return null;

    const meta = JSON.parse(row.metadata) as Record<string, unknown>;
    const durationMin = meta.duration_minutes as number | undefined;
    const keyTools = extractKeyTools(meta);

    return {
      sessionId,
      startedAt: (meta.started_at as string | undefined) ?? '',
      duration: formatDuration(durationMin),
      toolCalls: (meta.tool_calls as number | undefined) ?? 0,
      errors: (meta.error_count as number | undefined) ?? 0,
      filesModified: (meta.notes_created as string[] | undefined) ?? [],
      prsCreated: [],
      tasksReferenced: [
        ...((meta.tasks_worked as string[] | undefined) ?? []),
        ...((meta.tasks_completed as string[] | undefined) ?? []),
      ].filter((v, i, a) => a.indexOf(v) === i),
      keyTools,
      logPath: findSessionLogPath(sessionId),
    };
  } catch {
    return null;
  }
}

function extractKeyTools(meta: Record<string, unknown>): string[] {
  const ext = meta.analyticsExt as
    | { top_tools?: Array<{ name: string; count: number }> }
    | undefined;
  if (!ext?.top_tools) return [];
  return ext.top_tools.slice(0, 5).map((t) => t.name);
}

/**
 * Locate the JSONL log file for a session by scanning ~/.claude/projects/.
 * Returns the absolute path or null if not found.
 */
export function findSessionLogPath(sessionId: string, claudeProjectsDir?: string): string | null {
  const baseDir = claudeProjectsDir ?? join(homedir(), '.claude', 'projects');
  if (!existsSync(baseDir)) return null;

  let projectDirs: string[];
  try {
    projectDirs = readdirSync(baseDir).map((d) => join(baseDir, d));
  } catch {
    return null;
  }

  for (const projDir of projectDirs) {
    const candidate = join(projDir, `${sessionId}.jsonl`);
    if (existsSync(candidate)) return candidate;

    // Also check sessions/ subdirectory pattern
    const inSubdir = join(projDir, 'sessions', `${sessionId}.jsonl`);
    if (existsSync(inSubdir)) return inSubdir;
  }

  return null;
}

/** Detect identifier type and return the lookup strategy. */
export function classifyIdentifier(identifier: string): 'pr-url' | 'task' | 'branch' | 'agent-id' {
  if (identifier.startsWith('http')) return 'pr-url';
  if (/^[A-Z]+-\d+\.\d+$/.test(identifier)) return 'task';
  if (identifier.includes('/')) return 'branch';
  return 'agent-id';
}

function formatDuration(minutes?: number): string {
  if (minutes == null) return 'unknown';
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function buildSessionSummaryLines(
  sessions: SessionMetadata[],
  summaries?: SessionSummary[]
): string[] {
  if (sessions.length === 0) return ['  No session data available.'];
  const lines: string[] = [];
  const mostRecent = sessions[0];
  const richSummary = summaries?.[0];

  lines.push(`- Started: ${mostRecent.started_at}`);
  lines.push(`- Duration: ${formatDuration(mostRecent.duration_minutes)}`);

  const toolCalls = richSummary?.toolCalls ?? mostRecent.tool_calls;
  const keyTools = richSummary?.keyTools ?? [];
  if (toolCalls != null) {
    const toolsStr = keyTools.length > 0 ? ` (${keyTools.join(', ')})` : '';
    lines.push(`- Tool calls: ${toolCalls}${toolsStr}`);
  }

  const errors = richSummary?.errors ?? mostRecent.error_count;
  if (errors != null) lines.push(`- Errors: ${errors}`);

  if (richSummary?.filesModified.length) {
    lines.push(`- Files modified: ${richSummary.filesModified.join(', ')}`);
  }
  if (richSummary?.prsCreated.length) {
    lines.push(`- PRs created: ${richSummary.prsCreated.join(', ')}`);
  }

  const tasksReferenced = richSummary?.tasksReferenced;
  if (tasksReferenced?.length) {
    lines.push(`- Tasks referenced: ${tasksReferenced.join(', ')}`);
  } else if (mostRecent.tasks_completed?.length) {
    lines.push(`- Tasks completed: ${mostRecent.tasks_completed.join(', ')}`);
  }

  if (mostRecent.summary) lines.push(`- Summary: ${mostRecent.summary}`);

  if (richSummary?.logPath) {
    lines.push(`- Session log: ${richSummary.logPath}`);
  }

  if (sessions.length > 1) {
    lines.push(`- Prior sessions: ${sessions.length - 1} earlier session(s) on this task`);
  }
  return lines;
}

function buildReasonDirective(reason: ResumeReason, feedback?: string): string {
  const fb = feedback ? `: ${feedback}` : '';
  switch (reason) {
    case 'pr-feedback':
      return `Address the following PR review feedback${fb}.`;
    case 'build-failure':
      return `Fix the build failure${fb}.`;
    case 'test-failure':
      return `Fix the failing tests${fb}.`;
    case 'manual':
    default:
      return feedback ? `Continue with the following context: ${feedback}` : 'Continue the work.';
  }
}

export function buildResumptionPrompt(ctx: ResumeContext): ResumptionPrompt {
  const { agent, taskTitle, sessions, sessionSummaries, reason, feedback } = ctx;
  const taskRef = agent.brain_task ?? 'unknown';
  const taskDisplay = taskTitle ? `${taskRef} — ${taskTitle}` : taskRef;

  const lines: string[] = [
    `# Agent Resumption: ${agent.name}`,
    '',
    '## Reason',
    `${reason}${feedback ? `: ${feedback}` : ''}`,
    '',
    '## Prior Context',
    `- **Task**: ${taskDisplay}`,
    `- **Branch**: ${agent.branch ?? 'none'}`,
    `- **Status when stopped**: ${agent.status}`,
    `- **Worktree**: ${agent.worktree_path ?? 'none'}`,
    '',
    '## Session Summary',
    ...buildSessionSummaryLines(sessions, sessionSummaries),
    '',
    '## What to do',
    `Resume work on task ${taskRef}. ${buildReasonDirective(reason, feedback)}`,
  ];

  const markdown = lines.join('\n');

  const jsonPayload = {
    agent: {
      id: agent.id,
      name: agent.name,
      branch: agent.branch,
      status: agent.status,
      task: agent.brain_task,
    },
    reason,
    ...(feedback ? { feedback } : {}),
    sessions: sessions.map((s) => ({
      display_id: s.display_id,
      started_at: s.started_at,
      ...(s.duration_minutes != null ? { duration_minutes: s.duration_minutes } : {}),
      ...(s.tool_calls != null ? { tool_calls: s.tool_calls } : {}),
      ...(s.error_count != null ? { error_count: s.error_count } : {}),
      ...(s.summary ? { summary: s.summary } : {}),
    })),
    ...(taskTitle ? { task_title: taskTitle } : {}),
  };

  return { markdown, json: jsonPayload };
}

/** Record a resumption event into the agent's context JSON. */
export function recordResumption(
  db: unknown,
  agentId: string,
  reason: string,
  feedback?: string
): void {
  setAgentContext(db, agentId, 'resumption_reason', reason);

  const count = ((getAgentContext(db, agentId, 'resumption_count') as number | undefined) ?? 0) + 1;
  setAgentContext(db, agentId, 'resumption_count', count);

  const history =
    (getAgentContext(db, agentId, 'resumption_history') as ResumptionEntry[] | undefined) ?? [];
  const entry: ResumptionEntry = { reason, timestamp: new Date().toISOString() };
  if (feedback !== undefined) entry.feedback = feedback;
  history.push(entry);
  setAgentContext(db, agentId, 'resumption_history', history);
}

/** Write a lightweight resumption activity note to the notes directory. */
export function writeResumptionActivityNote(
  notesDir: string,
  agent: AgentRecord,
  reason: string,
  iteration: number,
  feedback?: string
): void {
  const timestamp = new Date().toISOString();
  const slug = `resumption-${agent.id.slice(0, 8)}-${iteration}-${timestamp.replace(/[:.]/g, '-').slice(0, 19)}`;
  const notePath = join(notesDir, 'modules', 'agents', `${slug}.md`);
  const dir = dirname(notePath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const taskDisplayId = agent.brain_task ?? 'unknown';
  const feedbackSnippet =
    feedback !== undefined ? feedback.slice(0, 120) + (feedback.length > 120 ? '…' : '') : '';

  const lines = [
    '---',
    `id: ${slug}`,
    `title: "Resumption: ${agent.name} — ${reason}"`,
    'type: activity',
    'tier: fast',
    'module: agents',
    'metadata:',
    '  activity_type: resumption',
    `  agent_id: ${agent.id}`,
    `  agent_name: ${agent.name}`,
    `  task_id: ${taskDisplayId}`,
    `  reason: ${reason}`,
    `  iteration: ${iteration}`,
    ...(feedbackSnippet ? [`  feedback: "${feedbackSnippet}"`] : []),
    `  created: ${timestamp}`,
    '---',
    '',
    `# Resumption: ${agent.name} — ${reason}`,
    '',
    `- **Agent**: ${agent.name} (${agent.id})`,
    `- **Task**: ${taskDisplayId}`,
    `- **Reason**: ${reason}`,
    `- **Iteration**: ${iteration}`,
    ...(feedbackSnippet ? [`- **Feedback**: ${feedbackSnippet}`] : []),
    `- **Timestamp**: ${timestamp}`,
  ];

  writeFileSync(notePath, lines.join('\n') + '\n', 'utf-8');
}
