import type { BrainDB } from '../../../services/brain-db.js';
import type { BrainConfig } from '../../../types.js';
import type { SessionMetadata } from '../types.js';
import { listSessions } from '../data/session-ops.js';

export interface CrossSessionAnalytics {
  byCategory: Array<{
    category: string;
    sessionCount: number;
    avgDurationMinutes: number;
    avgErrorRate: number;
    avgToolCalls: number;
  }>;
  byBranch: Array<{
    branch: string;
    sessionCount: number;
    totalDurationMinutes: number;
  }>;
  trends: {
    errorRateTrend: 'improving' | 'stable' | 'degrading';
    durationTrend: 'improving' | 'stable' | 'degrading';
    sessionsPerDay: number;
  };
}

export interface TrajectoryPoint {
  category: string;
  sessions: number;
  meanScore: number;
  stdDev: number;
  meanToolCallsPerTask: number;
  meanErrorRate: number;
  trend: 'improving' | 'stable' | 'degrading';
}

function extractBranchCategory(branch: string): string {
  const prefixes = ['feat/', 'fix/', 'refactor/', 'docs/', 'chore/', 'test/', 'ci/'];
  for (const prefix of prefixes) {
    if (branch.startsWith(prefix)) return prefix.slice(0, -1);
  }
  return branch === 'main' || branch === 'master' ? branch : 'other';
}

function computeTrend(
  firstHalfAvg: number,
  secondHalfAvg: number
): 'improving' | 'stable' | 'degrading' {
  if (firstHalfAvg === 0 && secondHalfAvg === 0) return 'stable';
  const base = Math.max(firstHalfAvg, 0.001);
  const change = (secondHalfAvg - firstHalfAvg) / base;
  if (change < -0.1) return 'improving';
  if (change > 0.1) return 'degrading';
  return 'stable';
}

export function computeCrossSessionAnalytics(sessions: SessionMetadata[]): CrossSessionAnalytics {
  if (sessions.length === 0) {
    return {
      byCategory: [],
      byBranch: [],
      trends: { errorRateTrend: 'stable', durationTrend: 'stable', sessionsPerDay: 0 },
    };
  }

  // Sort by started_at ascending for trend computation
  const sorted = [...sessions].sort(
    (a, b) => new Date(a.started_at).getTime() - new Date(b.started_at).getTime()
  );

  // --- byCategory: group by branch prefix ---
  const categoryMap = new Map<string, SessionMetadata[]>();
  for (const s of sorted) {
    const cat = s.branch ? extractBranchCategory(s.branch) : 'unknown';
    const list = categoryMap.get(cat) ?? [];
    list.push(s);
    categoryMap.set(cat, list);
  }

  const byCategory = [...categoryMap.entries()].map(([category, items]) => {
    const totalDuration = items.reduce((sum, s) => sum + (s.duration_minutes ?? 0), 0);
    const totalErrorRate = items.reduce((sum, s) => sum + (s.error_rate ?? 0), 0);
    const totalToolCalls = items.reduce((sum, s) => sum + (s.tool_calls ?? 0), 0);
    return {
      category,
      sessionCount: items.length,
      avgDurationMinutes: totalDuration / items.length,
      avgErrorRate: totalErrorRate / items.length,
      avgToolCalls: totalToolCalls / items.length,
    };
  });

  // --- byBranch ---
  const branchMap = new Map<string, { count: number; totalDuration: number }>();
  for (const s of sorted) {
    const branch = s.branch ?? 'unknown';
    const entry = branchMap.get(branch) ?? { count: 0, totalDuration: 0 };
    entry.count++;
    entry.totalDuration += s.duration_minutes ?? 0;
    branchMap.set(branch, entry);
  }

  const byBranch = [...branchMap.entries()]
    .map(([branch, { count, totalDuration }]) => ({
      branch,
      sessionCount: count,
      totalDurationMinutes: totalDuration,
    }))
    .sort((a, b) => b.totalDurationMinutes - a.totalDurationMinutes);

  // --- Trends: compare first half vs second half ---
  const mid = Math.floor(sorted.length / 2);
  const firstHalf = sorted.slice(0, Math.max(mid, 1));
  const secondHalf = sorted.slice(Math.max(mid, 1));

  const avgVal = (arr: SessionMetadata[], fn: (s: SessionMetadata) => number): number =>
    arr.length > 0 ? arr.reduce((sum, s) => sum + fn(s), 0) / arr.length : 0;

  const firstErrorRate = avgVal(firstHalf, (s) => s.error_rate ?? 0);
  const secondErrorRate = avgVal(secondHalf, (s) => s.error_rate ?? 0);
  const firstDuration = avgVal(firstHalf, (s) => s.duration_minutes ?? 0);
  const secondDuration = avgVal(secondHalf, (s) => s.duration_minutes ?? 0);

  const errorRateTrend = computeTrend(firstErrorRate, secondErrorRate);
  const durationTrend = computeTrend(firstDuration, secondDuration);

  // --- Sessions per day ---
  const firstDate = new Date(sorted[0].started_at).getTime();
  const lastDate = new Date(sorted[sorted.length - 1].started_at).getTime();
  const dayRange = Math.max((lastDate - firstDate) / 86_400_000, 1);
  const sessionsPerDay = sorted.length / dayRange;

  return {
    byCategory,
    byBranch,
    trends: { errorRateTrend, durationTrend, sessionsPerDay },
  };
}

// ---------------------------------------------------------------------------
// byTaskType: per-PM-category trajectory points
// ---------------------------------------------------------------------------

const REFERENCE_TOOLS_PER_COMMIT = 20;
const FRICTION_DENSITY_SCALE = 5;

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function scoreFromMetadata(s: SessionMetadata): number {
  const commitCount = s.commits?.length ?? 0;
  const toolCalls = s.tool_calls ?? 0;
  const errorRate = s.error_rate ?? 0;
  const frictionCount =
    s.analyticsExt?.friction_categories?.reduce((sum, c) => sum + c.count, 0) ?? 0;

  const efficiency =
    toolCalls > 0 && commitCount > 0
      ? clamp(REFERENCE_TOOLS_PER_COMMIT / (toolCalls / commitCount))
      : 0;
  const reliability = clamp(1 - errorRate);
  const assurance =
    toolCalls > 0 ? clamp(1 - (frictionCount / toolCalls) * FRICTION_DENSITY_SCALE) : 1;

  // Steadiness defaults to 1.0 (no retry data in metadata); weights match scorer.ts
  return Math.round((efficiency * 0.35 + reliability * 0.3 + assurance * 0.2 + 0.15) * 100);
}

function avg(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function stddev(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = avg(values);
  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

function buildTaskCategoryMap(db: BrainDB): Map<string, string> {
  const map = new Map<string, string>();
  try {
    const noteIds = db.getModuleNoteIds({ module: 'pm', type: 'task' });
    if (noteIds.length === 0) return map;
    const notes = db.getNotesByIds(noteIds);
    for (const [, note] of notes) {
      if (!note.metadata) continue;
      const meta = JSON.parse(note.metadata) as Record<string, unknown>;
      if (meta.display_id && meta.category) {
        map.set(meta.display_id as string, meta.category as string);
      }
    }
  } catch {
    // Best-effort; return partial map
  }
  return map;
}

function dominantCategory(session: SessionMetadata, categoryMap: Map<string, string>): string {
  const taskIds = [...(session.tasks_worked ?? []), ...(session.tasks_completed ?? [])];
  if (taskIds.length === 0) return 'unknown';

  const counts = new Map<string, number>();
  for (const id of taskIds) {
    const cat = categoryMap.get(id) ?? 'unknown';
    counts.set(cat, (counts.get(cat) ?? 0) + 1);
  }

  let best = 'unknown';
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
 * Compute per-PM-category trajectory points for sessions in the last `days` days.
 */
export function byTaskType(
  db: BrainDB,
  _config: BrainConfig,
  opts: { days: number }
): TrajectoryPoint[] {
  const sinceDate = new Date();
  sinceDate.setDate(sinceDate.getDate() - opts.days);

  const sessions = listSessions(db, { since: sinceDate.toISOString() });

  const sorted = [...sessions].sort(
    (a, b) => new Date(a.started_at).getTime() - new Date(b.started_at).getTime()
  );

  const taskCategoryMap = buildTaskCategoryMap(db);

  const groups = new Map<string, SessionMetadata[]>();
  for (const s of sorted) {
    const cat = dominantCategory(s, taskCategoryMap);
    const list = groups.get(cat) ?? [];
    list.push(s);
    groups.set(cat, list);
  }

  const points: TrajectoryPoint[] = [];

  for (const [category, group] of groups) {
    const scores = group.map(scoreFromMetadata);
    const meanScore = avg(scores);
    const sd = stddev(scores);

    const meanToolCallsPerTask = avg(
      group.map((s) => {
        const taskCount = (s.tasks_worked?.length ?? 0) + (s.tasks_completed?.length ?? 0);
        return taskCount > 0 ? (s.tool_calls ?? 0) / taskCount : 0;
      })
    );
    const meanErrorRate = avg(group.map((s) => s.error_rate ?? 0));

    // Trend: compare older half vs recent half (higher score = better)
    const mid = Math.floor(group.length / 2);
    const older = group.slice(0, Math.max(mid, 1));
    const recent = group.slice(Math.max(mid, 1));

    const olderScore = avg(older.map(scoreFromMetadata));
    const recentScore = avg(recent.map(scoreFromMetadata));

    let trend: 'improving' | 'stable' | 'degrading';
    if (olderScore === 0 && recentScore === 0) {
      trend = 'stable';
    } else {
      const base = Math.max(olderScore, 0.001);
      const change = (recentScore - olderScore) / base;
      if (change > 0.1) trend = 'improving';
      else if (change < -0.1) trend = 'degrading';
      else trend = 'stable';
    }

    points.push({
      category,
      sessions: group.length,
      meanScore,
      stdDev: sd,
      meanToolCallsPerTask,
      meanErrorRate,
      trend,
    });
  }

  return points.sort((a, b) => b.sessions - a.sessions);
}
