import { Command } from '@commander-js/extra-typings';
import type { BrainDB } from '../../../services/brain-db.js';
import { withDb } from '../../../services/brain-service.js';
import { analyzeFriction } from '../engine/friction.js';
import type { FrictionAnalysis, FrictionPatternType } from '../engine/friction-types.js';
import { parseDuration, sessionAnalyticsToFrictionInput } from './observe.js';
import { listSessions } from '../../sessions/data/session-ops.js';
import { aggregateSessionEvents } from '../../sessions/engine/aggregate.js';

export type Trend = 'improving' | 'worsening' | 'stable' | 'insufficient_data';

export interface PatternSummary {
  type: FrictionPatternType;
  count: number;
  avgSeverityWeight: number;
}

export interface ReportData {
  periodLabel: string;
  sessionsAnalyzed: number;
  avgFrictionScore: number;
  topPatterns: PatternSummary[];
  trend: Trend;
  recommendations: string[];
}

export function createReportCommand(): Command {
  return new Command('report')
    .description('Generate summary report of workflow observations')
    .option('--since <duration>', 'Time window (e.g., 7d, 30d, 1h)', '7d')
    .option('--format <fmt>', 'Output format: text or json', 'text')
    .option('--json', 'Output as JSON (shorthand for --format json)')
    .action(async (opts) => {
      await withDb(async (svc) => {
        const useJson = opts.json || opts.format === 'json';
        const since = opts.since ?? '7d';
        const analyses = collectAnalyses(svc.db, since);
        const report = buildReport(analyses, since);

        if (useJson) {
          process.stdout.write(JSON.stringify(report, null, 2) + '\n');
        } else {
          process.stdout.write(formatReport(report) + '\n');
        }
      });
    });
}

function collectAnalyses(db: BrainDB, since: string): FrictionAnalysis[] {
  const durationMs = parseDuration(since);
  const cutoff = new Date(Date.now() - durationMs).toISOString();
  const sessions = listSessions(db, { since: cutoff });

  const results: FrictionAnalysis[] = [];
  for (const session of sessions) {
    const analytics = aggregateSessionEvents(db, session.session_id);
    if (!analytics) continue;
    const input = sessionAnalyticsToFrictionInput(analytics);
    results.push(analyzeFriction(input));
  }
  return results;
}

const SEVERITY_WEIGHTS: Record<string, number> = {
  low: 5,
  medium: 15,
  high: 30,
  critical: 50,
};

export function buildReport(analyses: FrictionAnalysis[], periodLabel: string): ReportData {
  if (analyses.length === 0) {
    return emptyReport(periodLabel);
  }

  const avgScore = computeAvgScore(analyses);
  const topPatterns = computeTopPatterns(analyses);
  const trend = computeTrend(analyses);
  const recommendations = generateRecommendations(avgScore, topPatterns, trend);

  return {
    periodLabel,
    sessionsAnalyzed: analyses.length,
    avgFrictionScore: avgScore,
    topPatterns,
    trend,
    recommendations,
  };
}

function emptyReport(periodLabel: string): ReportData {
  return {
    periodLabel,
    sessionsAnalyzed: 0,
    avgFrictionScore: 0,
    topPatterns: [],
    trend: 'insufficient_data',
    recommendations: ['No session data available. Run some sessions to generate observations.'],
  };
}

function computeAvgScore(analyses: FrictionAnalysis[]): number {
  const total = analyses.reduce((sum, a) => sum + a.score, 0);
  return Math.round(total / analyses.length);
}

export function computeTopPatterns(analyses: FrictionAnalysis[]): PatternSummary[] {
  const byType = new Map<FrictionPatternType, { count: number; totalWeight: number }>();

  for (const a of analyses) {
    for (const e of a.events) {
      const entry = byType.get(e.type) ?? { count: 0, totalWeight: 0 };
      entry.count++;
      entry.totalWeight += SEVERITY_WEIGHTS[e.severity] ?? 0;
      byType.set(e.type, entry);
    }
  }

  const patterns: PatternSummary[] = [];
  for (const [type, data] of byType) {
    patterns.push({
      type,
      count: data.count,
      avgSeverityWeight: Math.round(data.totalWeight / data.count),
    });
  }

  patterns.sort((a, b) => b.count - a.count);
  return patterns.slice(0, 5);
}

export function computeTrend(analyses: FrictionAnalysis[]): Trend {
  if (analyses.length < 4) return 'insufficient_data';

  const mid = Math.floor(analyses.length / 2);
  const firstHalf = analyses.slice(0, mid);
  const secondHalf = analyses.slice(mid);

  const avgFirst = computeAvgScore(firstHalf);
  const avgSecond = computeAvgScore(secondHalf);
  const diff = avgSecond - avgFirst;

  if (diff <= -5) return 'improving';
  if (diff >= 5) return 'worsening';
  return 'stable';
}

function generateRecommendations(
  avgScore: number,
  patterns: PatternSummary[],
  trend: Trend
): string[] {
  const recs: string[] = [];

  if (avgScore >= 50) {
    recs.push('High friction detected. Consider reviewing workflow patterns.');
  }

  const topPattern = patterns[0];
  if (topPattern) {
    recs.push(...patternRecommendation(topPattern));
  }

  if (trend === 'worsening') {
    recs.push('Friction is increasing over time. Investigate recent changes.');
  } else if (trend === 'improving') {
    recs.push('Friction is decreasing. Current improvements are working.');
  }

  if (recs.length === 0) {
    recs.push('Workflow health looks good. No action needed.');
  }

  return recs;
}

function patternRecommendation(pattern: PatternSummary): string[] {
  const recs: Record<FrictionPatternType, string> = {
    repeated_tool_failure: 'Frequent tool failures detected. Check tool configurations.',
    permission_denial: 'Permission denials occurring. Review access controls.',
    excessive_retry: 'Excessive retries observed. Consider adjusting retry strategies.',
    context_pressure: 'Context pressure is common. Break tasks into smaller sessions.',
    progress_stall: 'Progress stalls detected. Consider clearer task decomposition.',
    agent_spawn_failure: 'Agent spawn failures occurring. Check agent configurations.',
    hook_prevention: 'Hook preventions blocking operations. Review hook rules.',
    error_loop: 'Error loops detected. Investigate root causes of repeated errors.',
  };

  const rec = recs[pattern.type];
  return rec ? [rec] : [];
}

export function formatReport(report: ReportData): string {
  const lines: string[] = [];

  lines.push(`Workflow Report (${report.periodLabel})`);
  lines.push('='.repeat(40));
  lines.push('');
  lines.push(`Sessions analyzed: ${report.sessionsAnalyzed}`);
  lines.push(`Average friction score: ${report.avgFrictionScore}/100`);
  lines.push(`Trend: ${report.trend}`);
  lines.push('');

  if (report.topPatterns.length > 0) {
    lines.push('Top Friction Patterns:');
    for (const p of report.topPatterns) {
      lines.push(`  ${p.type}: ${p.count} occurrence(s)`);
    }
    lines.push('');
  }

  lines.push('Recommendations:');
  for (const rec of report.recommendations) {
    lines.push(`  - ${rec}`);
  }

  return lines.join('\n');
}
