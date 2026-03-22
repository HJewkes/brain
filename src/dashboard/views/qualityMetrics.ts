export { fmtMinutes } from '../utils/formatting.js';
import type { DashboardData, DashboardStageTransition } from '../types.js';

export interface DodResult {
  passRate: number | null;
  passed: number;
  total: number;
}

export interface FunnelStage {
  label: string;
  count: number;
}

export interface AgentErrorRate {
  id: string;
  name: string;
  errors: number;
  toolCalls: number;
  errorRate: number;
}

export interface StageDuration {
  stage: string;
  avgMinutes: number;
  isBottleneck: boolean;
}

export interface VelocityPoint {
  label: string;
  count: number;
}

// DoD pass rate: tasks that transitioned straight to done without a reset/block
export function computeDodPassRate(data: DashboardData): DodResult {
  const completedTasks = data.tasks.filter((t) => t.col === 'done');
  if (completedTasks.length === 0) return { passRate: null, passed: 0, total: 0 };

  const byTask: Record<string, DashboardStageTransition[]> = {};
  for (const t of data.stageHistory) {
    (byTask[t.taskId] ??= []).push(t);
  }

  let passed = 0;
  for (const task of completedTasks) {
    const events = (byTask[task.id] ?? [])
      .slice()
      .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    const _hadReset = events.some((e) => e.toState === 'blocked' || e.toState === 'blocked');
    // Check if any done->pending regression occurred
    const _hasRegression = events.some((e) => e.fromState === 'done' || e.toState === 'blocked');
    // Count transitions back to pending after progress (in-progress/review/done -> pending)
    const regressionStates = new Set(['in-progress', 'review', 'done']);
    let regressed = false;
    for (const e of events) {
      if (e.toState === 'pending' && regressionStates.has(e.fromState)) {
        regressed = true;
        break;
      }
    }
    if (!regressed) passed++;
  }

  const total = completedTasks.length;
  return { passRate: Math.round((passed / total) * 100), passed, total };
}

// Count tasks at each funnel stage
export function computeFunnel(data: DashboardData): FunnelStage[] {
  const total = data.tasks.length;
  const claimed = data.tasks.filter((t) => t.col !== 'pending').length;
  const inProgress = data.tasks.filter(
    (t) => t.col === 'in-progress' || t.col === 'in_progress' || t.col === 'review'
  ).length;
  const done = data.tasks.filter((t) => t.col === 'done').length;

  return [
    { label: 'Total', count: total },
    { label: 'Claimed', count: claimed },
    { label: 'In Progress', count: inProgress },
    { label: 'Done', count: done },
  ];
}

// Per-agent error rate sorted descending
export function computeAgentErrorRates(data: DashboardData): AgentErrorRate[] {
  return data.agents
    .map((a) => ({
      id: a.id,
      name: a.name,
      errors: a.errors,
      toolCalls: a.toolCalls,
      errorRate: a.toolCalls > 0 ? Math.round((a.errors / a.toolCalls) * 100) : 0,
    }))
    .sort((a, b) => b.errorRate - a.errorRate);
}

// Average minutes spent in each stage across all completed tasks
export function computeStageDurations(transitions: DashboardStageTransition[]): StageDuration[] {
  const STAGES = ['pending', 'claimed', 'in-progress', 'review', 'done'];

  // Build per-task sorted event list
  const byTask: Record<string, DashboardStageTransition[]> = {};
  for (const t of transitions) {
    (byTask[t.taskId] ??= []).push(t);
  }

  const stageTotals: Record<string, number[]> = {};
  for (const stage of STAGES) stageTotals[stage] = [];

  for (const events of Object.values(byTask)) {
    const sorted = events
      .slice()
      .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    for (let i = 0; i < sorted.length - 1; i++) {
      const stage = sorted[i].toState;
      if (!STAGES.includes(stage)) continue;
      const dur =
        (new Date(sorted[i + 1].timestamp).getTime() - new Date(sorted[i].timestamp).getTime()) /
        60000;
      if (dur > 0 && dur < 10080) {
        // ignore durations > 1 week (stale data)
        stageTotals[stage].push(dur);
      }
    }
  }

  const avgs = STAGES.map((stage) => {
    const arr = stageTotals[stage];
    return arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
  });

  const maxAvg = Math.max(...avgs, 1);

  return STAGES.map((stage, i) => ({
    stage,
    avgMinutes: Math.round(avgs[i]),
    isBottleneck: avgs[i] === maxAvg && avgs[i] > 0,
  }));
}

// Tasks completed per day over last 14 days
export function computeVelocity(transitions: DashboardStageTransition[]): VelocityPoint[] {
  const DAY_MS = 86400000;
  const NUM_DAYS = 14;
  const now = Date.now();

  const doneCounts: Record<number, Set<string>> = {};
  for (const t of transitions) {
    if (t.toState !== 'done') continue;
    const ts = new Date(t.timestamp).getTime();
    const dayOffset = Math.floor((now - ts) / DAY_MS);
    if (dayOffset < 0 || dayOffset >= NUM_DAYS) continue;
    const dayKey = NUM_DAYS - 1 - dayOffset;
    (doneCounts[dayKey] ??= new Set()).add(t.taskId);
  }

  const points: VelocityPoint[] = [];
  for (let i = 0; i < NUM_DAYS; i++) {
    const ts = now - (NUM_DAYS - 1 - i) * DAY_MS;
    const d = new Date(ts);
    const label = `${d.getMonth() + 1}/${d.getDate()}`;
    points.push({ label, count: doneCounts[i]?.size ?? 0 });
  }
  return points;
}
