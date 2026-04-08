import type { SessionMetadata } from '../types.js';

export type TaskType = string;

export interface TaskTypeNorm {
  taskType: TaskType;
  sampleSize: number;
  avgToolCalls: number;
  avgErrorRate: number;
  /** Normalised efficiency 0–1 (reference: 20 tool calls per commit) */
  avgEfficiency: number;
  avgDurationMinutes: number;
}

export interface TaskTypeTrajectory {
  taskType: TaskType;
  norm: TaskTypeNorm;
  /** Trend derived from comparing older half vs recent half of sessions */
  errorRateTrend: 'improving' | 'stable' | 'degrading';
  efficiencyTrend: 'improving' | 'stable' | 'degrading';
}

export interface TaskTrajectoryReport {
  trajectories: TaskTypeTrajectory[];
  /** Task types with a degrading error rate or efficiency trend */
  degradedTypes: TaskType[];
}

/**
 * Reference tool calls per commit — matches scorer.ts baseline.
 */
const REFERENCE_TOOLS_PER_COMMIT = 20;

function computeEfficiency(toolCalls: number, commitCount: number): number {
  if (toolCalls === 0 || commitCount === 0) return 0;
  const toolsPerCommit = toolCalls / commitCount;
  return Math.max(0, Math.min(1, REFERENCE_TOOLS_PER_COMMIT / toolsPerCommit));
}

function computeTrend(
  olderAvg: number,
  recentAvg: number,
  lowerIsBetter: boolean
): 'improving' | 'stable' | 'degrading' {
  if (olderAvg === 0 && recentAvg === 0) return 'stable';
  const base = Math.max(olderAvg, 0.001);
  const change = (recentAvg - olderAvg) / base;
  const threshold = 0.1;
  if (change < -threshold) return lowerIsBetter ? 'improving' : 'degrading';
  if (change > threshold) return lowerIsBetter ? 'degrading' : 'improving';
  return 'stable';
}

function avg(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/**
 * Resolve the dominant task type for a session.
 *
 * @param session - session to classify
 * @param taskCategoryFn - maps a task display_id to its PM category, or null if unknown
 * @returns the most-common category among the session's task refs, or 'unknown'
 */
function dominantTaskType(
  session: SessionMetadata,
  taskCategoryFn: (taskId: string) => string | null
): TaskType {
  const taskIds = [...(session.tasks_worked ?? []), ...(session.tasks_completed ?? [])];
  if (taskIds.length === 0) return 'unknown';

  const counts = new Map<string, number>();
  for (const id of taskIds) {
    const cat = taskCategoryFn(id) ?? 'unknown';
    counts.set(cat, (counts.get(cat) ?? 0) + 1);
  }

  let best: TaskType = 'unknown';
  let bestCount = 0;
  for (const [cat, count] of counts) {
    if (count > bestCount) {
      best = cat;
      bestCount = count;
    }
  }
  return best;
}

/**
 * Compute per-task-type trajectory norms and degradation patterns.
 *
 * @param sessions - list of sessions (typically all sessions for a project)
 * @param taskCategoryFn - maps a PM task display_id to its category string
 */
export function computeTaskTypeTrajectory(
  sessions: SessionMetadata[],
  taskCategoryFn: (taskId: string) => string | null
): TaskTrajectoryReport {
  if (sessions.length === 0) {
    return { trajectories: [], degradedTypes: [] };
  }

  // Sort chronologically for trend analysis
  const sorted = [...sessions].sort(
    (a, b) => new Date(a.started_at).getTime() - new Date(b.started_at).getTime()
  );

  // Group by dominant task type
  const groups = new Map<TaskType, SessionMetadata[]>();
  for (const session of sorted) {
    const taskType = dominantTaskType(session, taskCategoryFn);
    const list = groups.get(taskType) ?? [];
    list.push(session);
    groups.set(taskType, list);
  }

  const trajectories: TaskTypeTrajectory[] = [];

  for (const [taskType, group] of groups) {
    const toolCallsArr = group.map((s) => s.tool_calls ?? 0);
    const errorRateArr = group.map((s) => s.error_rate ?? 0);
    const durationArr = group.map((s) => s.duration_minutes ?? 0);
    const efficiencyArr = group.map((s) =>
      computeEfficiency(s.tool_calls ?? 0, s.commits?.length ?? 0)
    );

    const norm: TaskTypeNorm = {
      taskType,
      sampleSize: group.length,
      avgToolCalls: avg(toolCallsArr),
      avgErrorRate: avg(errorRateArr),
      avgEfficiency: avg(efficiencyArr),
      avgDurationMinutes: avg(durationArr),
    };

    // Trend: split group in half; compare older half vs newer half
    const mid = Math.floor(group.length / 2);
    const older = group.slice(0, Math.max(mid, 1));
    const recent = group.slice(Math.max(mid, 1));

    const olderErrorRate = avg(older.map((s) => s.error_rate ?? 0));
    const recentErrorRate = avg(recent.map((s) => s.error_rate ?? 0));
    const olderEfficiency = avg(
      older.map((s) => computeEfficiency(s.tool_calls ?? 0, s.commits?.length ?? 0))
    );
    const recentEfficiency = avg(
      recent.map((s) => computeEfficiency(s.tool_calls ?? 0, s.commits?.length ?? 0))
    );

    const errorRateTrend = computeTrend(olderErrorRate, recentErrorRate, true);
    const efficiencyTrend = computeTrend(olderEfficiency, recentEfficiency, false);

    trajectories.push({ taskType, norm, errorRateTrend, efficiencyTrend });
  }

  // Sort by sample size descending so most-common types appear first
  trajectories.sort((a, b) => b.norm.sampleSize - a.norm.sampleSize);

  const degradedTypes = trajectories
    .filter((t) => t.errorRateTrend === 'degrading' || t.efficiencyTrend === 'degrading')
    .map((t) => t.taskType);

  return { trajectories, degradedTypes };
}
