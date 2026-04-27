import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { BrainServiceClass } from './brain-service.js';
import type { TriageResult, TriageTaskView, TriageWorkstreamView } from '../server/triage.js';
import { triageDispatch } from '../server/triage.js';
import { listSessions } from '../modules/sessions/data/session-ops.js';
import type { SessionMetadata } from '../modules/sessions/types.js';

export interface NextSessionPromptOptions {
  prefix?: string;
  workstream?: string;
  wipLimit?: number | null;
  /** Number of recent completed sessions to summarize. Default: 1. */
  sessionLimit?: number;
  /** Override "now" for deterministic rendering. */
  asOf?: string;
  /** Maximum stuck/in-flight/ready/blocked items rendered per section. */
  maxItemsPerSection?: number;
}

export interface NextSessionPromptResult {
  markdown: string;
  generatedAt: string;
  triage: TriageResult;
  recentSessions: SessionMetadata[];
}

const DEFAULT_MAX_ITEMS = 10;
const DEFAULT_REL_PATH = join('.plans', 'next-session-prompt.md');

export function generateNextSessionPrompt(
  svc: BrainServiceClass,
  opts: NextSessionPromptOptions = {}
): NextSessionPromptResult {
  const triage = triageDispatch(svc, {
    prefix: opts.prefix,
    workstream: opts.workstream,
    wipLimit: opts.wipLimit ?? null,
  });

  const recent = listSessions(svc.db, { project: triage.scope.prefix })
    .filter((s) => s.status === 'completed' || s.status === 'abandoned')
    .slice(0, opts.sessionLimit ?? 1);

  const generatedAt = opts.asOf ?? triage.generatedAt;
  const markdown = renderNextSessionPrompt(triage, recent, generatedAt, opts);

  return { markdown, generatedAt, triage, recentSessions: recent };
}

export function writeNextSessionPrompt(
  svc: BrainServiceClass,
  opts: NextSessionPromptOptions & { outputPath?: string; projectDir?: string } = {}
): NextSessionPromptResult & { path: string } {
  const result = generateNextSessionPrompt(svc, opts);
  const path = opts.outputPath ?? join(opts.projectDir ?? process.cwd(), DEFAULT_REL_PATH);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, result.markdown, 'utf-8');
  return { ...result, path };
}

export function renderNextSessionPrompt(
  triage: TriageResult,
  recentSessions: SessionMetadata[],
  generatedAt: string,
  opts: Pick<NextSessionPromptOptions, 'maxItemsPerSection'> = {}
): string {
  const max = opts.maxItemsPerSection ?? DEFAULT_MAX_ITEMS;
  const allTasks = triage.workstreams.flatMap((w) => w.tasks);
  const lines: string[] = [];

  lines.push(...renderHeader(triage, generatedAt));
  lines.push(...renderLastSessionSection(recentSessions));
  lines.push(...renderTriageSummary(triage));
  lines.push(...renderStuckSection(allTasks, max));
  lines.push(...renderInFlightSection(allTasks, max));
  lines.push(...renderReadySection(allTasks, triage.workstreams, max));
  lines.push(...renderBlockedSection(allTasks, max));
  lines.push(...renderQuickStart(triage));
  lines.push(...renderProvenance(generatedAt));

  return lines.join('\n');
}

function renderHeader(triage: TriageResult, generatedAt: string): string[] {
  const ws = triage.scope.workstream ? ` / ${triage.scope.workstream}` : '';
  return [
    `# Next Session — ${triage.scope.prefix}${ws}`,
    '',
    `_Auto-generated ${generatedAt} from \`brain_dispatch_triage\` + recent session metadata. Re-run to refresh._`,
    '',
  ];
}

function renderLastSessionSection(sessions: SessionMetadata[]): string[] {
  if (sessions.length === 0) {
    return [
      '## What Happened Last Session',
      '',
      '_No completed session on record for this project._',
      '',
    ];
  }
  const out: string[] = ['## What Happened Last Session'];
  for (const s of sessions) {
    out.push('', `### ${s.display_id} — ${s.started_at.slice(0, 10)} (${s.outcome ?? s.status})`);
    if (s.summary) out.push('', s.summary);
    const facts = collectSessionFacts(s);
    if (facts.length > 0) {
      out.push('');
      for (const f of facts) out.push(`- ${f}`);
    }
  }
  out.push('');
  return out;
}

function collectSessionFacts(s: SessionMetadata): string[] {
  const facts: string[] = [];
  if (s.tasks_completed?.length) facts.push(`Completed: ${s.tasks_completed.join(', ')}`);
  if (s.tasks_worked?.length) {
    const remaining = s.tasks_worked.filter((t) => !s.tasks_completed?.includes(t));
    if (remaining.length > 0) facts.push(`Worked (not completed): ${remaining.join(', ')}`);
  }
  if (s.pr_links?.length) facts.push(`PRs: ${s.pr_links.join(', ')}`);
  if (s.commits?.length) facts.push(`Commits: ${s.commits.length}`);
  if (s.duration_minutes != null) facts.push(`Duration: ${s.duration_minutes.toFixed(0)}m`);
  if (s.cost_usd != null) facts.push(`Cost: $${s.cost_usd.toFixed(2)}`);
  if (s.tool_calls != null) {
    const errs = s.error_count != null ? ` (${s.error_count} errors)` : '';
    facts.push(`Tool calls: ${s.tool_calls}${errs}`);
  }
  return facts;
}

function renderTriageSummary(triage: TriageResult): string[] {
  const t = triage.totals;
  const wip = triage.wip;
  const wipLine =
    wip.limit === null
      ? `WIP: ${wip.activeAgents} active agents (no limit)`
      : `WIP: ${wip.activeAgents}/${wip.limit} active agents${wip.atCapacity ? ' (AT CAPACITY)' : ''}`;
  return [
    '## Current State',
    '',
    `- ready: ${t.ready} | in_flight: ${t.in_flight} | stuck: ${t.stuck} | blocked: ${t.blocked} | capacity_limited: ${t.capacity_limited}`,
    `- ${wipLine}`,
    '',
  ];
}

function renderStuckSection(tasks: TriageTaskView[], max: number): string[] {
  const stuck = tasks.filter((t) => t.classification === 'stuck');
  if (stuck.length === 0) return ['## Stuck — Needs Attention', '', '_None._', ''];
  const out: string[] = ['## Stuck — Needs Attention', ''];
  for (const t of stuck.slice(0, max)) {
    const kind = t.stuckKind ? ` [${t.stuckKind}]` : '';
    const reason = t.reason ? ` — ${t.reason}` : '';
    const pr = t.delivery?.prNumber ? ` (PR #${t.delivery.prNumber})` : '';
    out.push(`- **${t.displayId}**${kind} ${t.title}${pr}${reason}`);
  }
  if (stuck.length > max) out.push(`- _…and ${stuck.length - max} more stuck tasks_`);
  out.push('');
  return out;
}

function renderInFlightSection(tasks: TriageTaskView[], max: number): string[] {
  const inFlight = tasks.filter((t) => t.classification === 'in_flight');
  if (inFlight.length === 0) return [];
  const out: string[] = ['## In Flight', ''];
  for (const t of inFlight.slice(0, max)) {
    const agent = t.agent ? ` (agent ${t.agent.id}${t.agent.alive ? '' : ', not alive'})` : '';
    const pr = t.delivery?.prNumber ? ` PR #${t.delivery.prNumber}` : '';
    out.push(`- ${t.displayId} ${t.title}${pr}${agent}`);
  }
  if (inFlight.length > max) out.push(`- _…and ${inFlight.length - max} more in flight_`);
  out.push('');
  return out;
}

const PRIORITY_RANK: Record<string, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

function renderReadySection(
  tasks: TriageTaskView[],
  workstreams: TriageWorkstreamView[],
  max: number
): string[] {
  const ready = tasks
    .filter((t) => t.classification === 'ready')
    .sort(
      (a, b) =>
        (PRIORITY_RANK[a.priority] ?? 9) - (PRIORITY_RANK[b.priority] ?? 9) ||
        a.displayId.localeCompare(b.displayId)
    );
  const capacity = tasks.filter((t) => t.classification === 'capacity_limited');
  if (ready.length === 0 && capacity.length === 0) return [];

  const out: string[] = ['## Ready to Pick Up', ''];
  for (const t of ready.slice(0, max)) {
    out.push(`- **${t.displayId}** [${t.priority}] ${t.title} _(${t.workstream})_`);
  }
  if (ready.length > max) out.push(`- _…and ${ready.length - max} more ready_`);

  if (capacity.length > 0) {
    out.push('', '_At-capacity (would be ready if WIP allowed):_');
    for (const t of capacity.slice(0, max)) {
      out.push(`- ${t.displayId} ${t.title}`);
    }
  }

  const wsTouched = new Set(ready.map((t) => t.workstream));
  if (wsTouched.size > 1) {
    const titles = workstreams
      .filter((w) => wsTouched.has(w.workstream))
      .map((w) => `${w.workstream} (${w.title})`);
    out.push('', `_Spans: ${titles.join('; ')}_`);
  }
  out.push('');
  return out;
}

function renderBlockedSection(tasks: TriageTaskView[], max: number): string[] {
  const blocked = tasks.filter((t) => t.classification === 'blocked');
  if (blocked.length === 0) return [];
  const out: string[] = ['## Blocked', ''];
  for (const t of blocked.slice(0, max)) {
    const deps = t.incompleteDeps?.length
      ? ` ← waiting on ${t.incompleteDeps.join(', ')}`
      : t.reason
        ? ` — ${t.reason}`
        : '';
    out.push(`- ${t.displayId} ${t.title}${deps}`);
  }
  if (blocked.length > max) out.push(`- _…and ${blocked.length - max} more blocked_`);
  out.push('');
  return out;
}

function renderQuickStart(triage: TriageResult): string[] {
  const wsArg = triage.scope.workstream ? `workstream=${triage.scope.workstream}` : '';
  const lines = ['## Quick Start', '', '```bash'];
  lines.push(
    `brain_dispatch_triage prefix=${triage.scope.prefix}${wsArg ? ' ' + wsArg : ''}   # refresh this view`
  );
  if (triage.scope.workstream) {
    lines.push(`brain_agent_dispatch_workstream workstream=${triage.scope.workstream}`);
  } else {
    lines.push('brain_agent_dispatch_workstream workstream=<id>   # pick a workstream above');
  }
  lines.push('```', '');
  return lines;
}

function renderProvenance(generatedAt: string): string[] {
  return [
    '---',
    `<sub>Generated by \`brain\` next-session-prompt service at ${generatedAt}.</sub>`,
  ];
}
