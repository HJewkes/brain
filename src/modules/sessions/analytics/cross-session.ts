import type { SessionMetadata } from '../types.js';

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
