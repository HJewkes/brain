import type { DashboardData, DashboardAgent, DashboardStageTransition } from '../types.js';

export interface LeadTimeResult {
  p85: number | null;
}

export interface FlowEfficiencyResult {
  ratio: number | null;
}

export interface AgentPerf {
  agent: DashboardAgent;
  tasksDone: number;
  errorRate: number;
}

export interface BurndownPoint {
  label: string;
  ideal: number;
  actual: number;
}

// Compute count of tasks with col='done'
export function computeThroughput(data: DashboardData): number {
  return data.tasks.filter((t) => t.col === 'done').length;
}

// P85 lead time in minutes: from first 'pending' transition to 'done' for completed tasks
export function computeLeadTimeP85(transitions: DashboardStageTransition[]): LeadTimeResult {
  const byTask: Record<string, { firstPending: number; donedAt: number | null }> = {};

  for (const t of transitions) {
    const ts = new Date(t.timestamp).getTime();
    if (!byTask[t.taskId]) byTask[t.taskId] = { firstPending: Infinity, donedAt: null };

    if (t.toState === 'pending' && ts < byTask[t.taskId].firstPending) {
      byTask[t.taskId].firstPending = ts;
    }
    if (t.toState === 'done') {
      byTask[t.taskId].donedAt = ts;
    }
  }

  const leadTimes = Object.values(byTask)
    .filter((e) => e.donedAt !== null && e.firstPending !== Infinity)
    .map((e) => (e.donedAt! - e.firstPending) / 60000);

  if (leadTimes.length === 0) return { p85: null };

  leadTimes.sort((a, b) => a - b);
  const idx = Math.floor(leadTimes.length * 0.85);
  return { p85: Math.round(leadTimes[Math.min(idx, leadTimes.length - 1)]) };
}

// Flow efficiency: ratio of time in active states vs total lead time
// Active states: in-progress, review; Waiting states: pending, blocked
export function computeFlowEfficiency(
  transitions: DashboardStageTransition[]
): FlowEfficiencyResult {
  const ACTIVE_STATES = new Set(['in-progress', 'review', 'verify']);
  const byTask: Record<string, DashboardStageTransition[]> = {};

  for (const t of transitions) {
    (byTask[t.taskId] ??= []).push(t);
  }

  let totalActive = 0;
  let totalLead = 0;

  for (const events of Object.values(byTask)) {
    const sorted = events
      .slice()
      .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    const hasDone = sorted.some((e) => e.toState === 'done');
    if (!hasDone || sorted.length < 2) continue;

    const start = new Date(sorted[0].timestamp).getTime();
    const end = new Date(sorted[sorted.length - 1].timestamp).getTime();
    const lead = end - start;
    if (lead <= 0) continue;

    let active = 0;
    for (let i = 0; i < sorted.length - 1; i++) {
      if (ACTIVE_STATES.has(sorted[i].toState)) {
        active +=
          new Date(sorted[i + 1].timestamp).getTime() - new Date(sorted[i].timestamp).getTime();
      }
    }

    totalActive += active;
    totalLead += lead;
  }

  if (totalLead === 0) return { ratio: null };
  return { ratio: Math.round((totalActive / totalLead) * 100) };
}

// Average age in minutes of tasks currently in-progress
export function computeWIPAge(
  data: DashboardData,
  transitions: DashboardStageTransition[]
): number | null {
  const inProgress = data.tasks.filter((t) => t.col === 'in-progress' || t.col === 'in_progress');
  if (inProgress.length === 0) return null;

  const startByTask: Record<string, number> = {};
  for (const t of transitions) {
    if (t.toState === 'in-progress' || t.toState === 'in_progress') {
      const ts = new Date(t.timestamp).getTime();
      if (!startByTask[t.taskId] || ts > startByTask[t.taskId]) {
        startByTask[t.taskId] = ts;
      }
    }
  }

  const now = Date.now();
  const ages = inProgress.map((t) => {
    const start = startByTask[t.id];
    return start ? (now - start) / 60000 : (t.queueAge ?? 0);
  });

  return Math.round(ages.reduce((a, b) => a + b, 0) / ages.length);
}

// Per-agent performance stats
export function computeAgentPerf(data: DashboardData): AgentPerf[] {
  return data.agents.map((agent) => {
    const agentTasks = data.tasks.filter((t) => t.agent === agent.id || t.agent === agent.name);
    const tasksDone = agentTasks.filter((t) => t.col === 'done').length;
    const errorRate = agent.toolCalls > 0 ? Math.round((agent.errors / agent.toolCalls) * 100) : 0;
    return { agent, tasksDone, errorRate };
  });
}

// Build last 14 days burndown data from stageHistory
export function computeBurndown(data: DashboardData): BurndownPoint[] {
  const totalTasks = data.tasks.length;
  if (totalTasks === 0) return [];

  const now = Date.now();
  const DAY_MS = 86400000;
  const NUM_DAYS = 14;
  const points: BurndownPoint[] = [];

  // Build a set of (taskId, doneAt) pairs
  const doneAt: Record<string, number> = {};
  for (const t of data.stageHistory) {
    if (t.toState === 'done') {
      const ts = new Date(t.timestamp).getTime();
      if (!doneAt[t.taskId] || ts < doneAt[t.taskId]) {
        doneAt[t.taskId] = ts;
      }
    }
  }

  for (let i = NUM_DAYS - 1; i >= 0; i--) {
    const dayEnd = now - i * DAY_MS;
    const remaining = totalTasks - Object.values(doneAt).filter((ts) => ts <= dayEnd).length;
    const idealRemaining = Math.round(totalTasks * (i / (NUM_DAYS - 1)));
    const date = new Date(dayEnd);
    const label = `${date.getMonth() + 1}/${date.getDate()}`;
    points.push({ label, ideal: idealRemaining, actual: remaining });
  }

  return points;
}

// Format minutes as human-readable duration
export function fmtMinutes(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

// Deterministic avatar color from agent name
const AVATAR_COLORS = [
  '#882E72',
  '#1965B0',
  '#4EB265',
  '#F4A736',
  '#7BAFDE',
  '#DC050C',
  '#406D87',
  '#F7F056',
];

export function avatarColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) & 0xffffff;
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

export function initials(name: string): string {
  return name
    .split(/[-_\s]+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
}

// ── Resumption analytics ────────────────────────────────────────────────────

export interface ResumptionTaskRow {
  taskId: string;
  title: string;
  workstream: string;
  count: number;
}

export interface ResumptionStats {
  totalResumptions: number;
  totalCompletions: number;
  resumptionRate: number | null;
  byWorkstream: Array<{ workstream: string; count: number }>;
  topTasks: ResumptionTaskRow[];
}

// A "resumption" is a transition where a task moves back to pending/in-progress
// from done or blocked — indicating a reset or re-open.
const RESET_TO_STATES = new Set(['pending', 'in-progress', 'in_progress']);
const RESET_FROM_STATES = new Set(['done', 'blocked', 'failed']);

export function computeResumptionStats(
  transitions: DashboardStageTransition[],
  tasks: DashboardData['tasks'],
  workstreams: DashboardData['workstreams']
): ResumptionStats {
  const taskById = new Map(tasks.map((t) => [t.id, t]));

  const resets = transitions.filter(
    (t) => RESET_FROM_STATES.has(t.fromState) && RESET_TO_STATES.has(t.toState)
  );

  const totalResumptions = resets.length;
  const totalCompletions = transitions.filter((t) => t.toState === 'done').length;
  const resumptionRate =
    totalCompletions > 0 ? Math.round((totalResumptions / totalCompletions) * 100) : null;

  // Group by workstream
  const wsCounts: Record<string, number> = {};
  for (const r of resets) {
    const task = taskById.get(r.taskId);
    const ws = task?.workstream ?? 'unknown';
    wsCounts[ws] = (wsCounts[ws] ?? 0) + 1;
  }
  const byWorkstream = Object.entries(wsCounts)
    .map(([workstream, count]) => ({ workstream, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 6);

  // Count resets per task
  const taskCounts: Record<string, number> = {};
  for (const r of resets) {
    taskCounts[r.taskId] = (taskCounts[r.taskId] ?? 0) + 1;
  }
  const topTasks = Object.entries(taskCounts)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5)
    .map(([taskId, count]) => {
      const task = taskById.get(taskId);
      const wsName = task?.workstream
        ? (workstreams[task.workstream]?.name ?? task.workstream)
        : '—';
      return { taskId, title: task?.title ?? taskId, workstream: wsName, count };
    });

  return { totalResumptions, totalCompletions, resumptionRate, byWorkstream, topTasks };
}
