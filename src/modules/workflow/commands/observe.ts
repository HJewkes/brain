import { Command } from '@commander-js/extra-typings';
import type { BrainDB } from '../../../services/brain-db.js';
import { withDb } from '../../../services/brain-service.js';
import { analyzeFriction } from '../engine/friction.js';
import type {
  FrictionAnalysis,
  FrictionSeverity,
  FrictionEvent,
} from '../engine/friction-types.js';
import type { ParsedSessionData } from '../engine/friction-types.js';
import { listSessions } from '../../sessions/data/session-ops.js';
import { aggregateSessionEvents } from '../../sessions/engine/aggregate.js';
import type { SessionAnalytics } from '../../sessions/types.js';

const SEVERITY_ORDER: Record<FrictionSeverity, number> = {
  low: 0,
  medium: 1,
  high: 2,
  critical: 3,
};

export function parseDuration(input: string): number {
  const match = input.match(/^(\d+)(m|h|d)$/);
  if (!match) return 10 * 60_000;

  const amount = parseInt(match[1], 10);
  switch (match[2]) {
    case 'm':
      return amount * 60_000;
    case 'h':
      return amount * 3_600_000;
    case 'd':
      return amount * 86_400_000;
    default:
      return 10 * 60_000;
  }
}

export function sessionAnalyticsToFrictionInput(analytics: SessionAnalytics): ParsedSessionData {
  return {
    sessionId: analytics.sessionId,
    toolCalls: analytics.toolCalls.map((tc) => ({
      toolName: tc.toolName,
      timestamp: tc.timestamp,
      outcome: tc.outcome,
      errorMessage: tc.errorMessage,
    })),
    errorCount: analytics.errorCount,
    totalTurns: analytics.userTurns + analytics.assistantTurns,
    durationMs: analytics.durationMs,
    compactionCount: analytics.compactionCount,
    hookPreventionCount: analytics.hookPreventionCount,
    tokens: {
      input: analytics.tokens.inputTokens,
      output: analytics.tokens.outputTokens,
    },
  };
}

export function filterByThreshold(
  events: FrictionEvent[],
  threshold: FrictionSeverity
): FrictionEvent[] {
  const minLevel = SEVERITY_ORDER[threshold];
  return events.filter((e) => SEVERITY_ORDER[e.severity] >= minLevel);
}

export function formatAnalysis(
  analysis: FrictionAnalysis,
  label: string,
  threshold: FrictionSeverity
): string {
  const filtered = filterByThreshold(analysis.events, threshold);
  const lines: string[] = [];

  lines.push(`Friction Analysis (${label})`);
  lines.push(`Score: ${analysis.score}/100`);
  lines.push('');

  if (filtered.length === 0) {
    lines.push('No friction events above threshold.');
    return lines.join('\n');
  }

  for (const event of filtered) {
    const tag = event.severity.toUpperCase();
    lines.push(`[${tag}] ${event.description}`);
    lines.push(`  at ${formatTimestamp(event.timestamp)}`);
    lines.push('');
  }

  return lines.join('\n');
}

function formatTimestamp(ts: string): string {
  const d = new Date(ts);
  if (isNaN(d.getTime())) return ts;
  return d.toISOString().slice(11, 16);
}

export function buildJsonOutput(
  analysis: FrictionAnalysis,
  threshold: FrictionSeverity
): Record<string, unknown> {
  const filtered = filterByThreshold(analysis.events, threshold);
  return {
    sessionId: analysis.sessionId,
    score: analysis.score,
    summary: analysis.summary,
    eventCount: filtered.length,
    events: filtered,
  };
}

export function createObserveCommand(): Command {
  return new Command('observe')
    .description('Analyze session friction patterns')
    .option('--since <duration>', 'Time window (e.g., 10m, 1h, 24h)', '10m')
    .option('--session <id>', 'Analyze a specific session')
    .option('--threshold <level>', 'Minimum severity: low, medium, high, critical', 'medium')
    .option('--json', 'Output as JSON')
    .option('--save', 'Save observations as workflow notes')
    .action(async (opts) => {
      await withDb(async (svc) => {
        const threshold = validateThreshold(opts.threshold ?? 'medium');
        const analyses = collectAnalyses(svc.db, opts.since ?? '10m', opts.session);

        if (analyses.length === 0) {
          if (opts.json) {
            process.stdout.write(JSON.stringify({ sessions: 0, events: [], score: 0 }) + '\n');
          } else {
            process.stdout.write('No session data found.\n');
          }
          return;
        }

        const merged = mergeAnalyses(analyses);
        const label = opts.session ? `session ${opts.session}` : `last ${opts.since ?? '10m'}`;

        if (opts.json) {
          process.stdout.write(JSON.stringify(buildJsonOutput(merged, threshold), null, 2) + '\n');
        } else {
          process.stdout.write(formatAnalysis(merged, label, threshold) + '\n');
        }

        if (opts.save) {
          const saved = saveObservations(merged, threshold);
          if (!opts.json) {
            process.stdout.write(`${saved} observation(s) recorded.\n`);
          }
        }
      });
    });
}

function validateThreshold(input: string): FrictionSeverity {
  const valid: FrictionSeverity[] = ['low', 'medium', 'high', 'critical'];
  if (valid.includes(input as FrictionSeverity)) return input as FrictionSeverity;
  return 'medium';
}

function collectAnalyses(db: BrainDB, since: string, sessionId?: string): FrictionAnalysis[] {
  if (sessionId) {
    return analyzeSpecificSession(db, sessionId);
  }
  return analyzeRecentSessions(db, since);
}

function analyzeSpecificSession(db: BrainDB, sessionId: string): FrictionAnalysis[] {
  const analytics = aggregateSessionEvents(db, sessionId);
  if (!analytics) return [];
  const input = sessionAnalyticsToFrictionInput(analytics);
  return [analyzeFriction(input)];
}

function analyzeRecentSessions(db: BrainDB, since: string): FrictionAnalysis[] {
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

export function mergeAnalyses(analyses: FrictionAnalysis[]): FrictionAnalysis {
  if (analyses.length === 1) return analyses[0];

  const allEvents: FrictionEvent[] = [];
  for (const a of analyses) {
    allEvents.push(...a.events);
  }
  allEvents.sort((a, b) => a.timestamp.localeCompare(b.timestamp));

  const totalScore = Math.min(
    100,
    analyses.reduce((sum, a) => sum + a.score, 0)
  );

  const ids = analyses.map((a) => a.sessionId).join(', ');

  return {
    sessionId: ids,
    events: allEvents,
    score: totalScore,
    summary: `${analyses.length} sessions: ${allEvents.length} friction event(s), score: ${totalScore}/100`,
  };
}

function saveObservations(analysis: FrictionAnalysis, threshold: FrictionSeverity): number {
  const filtered = filterByThreshold(analysis.events, threshold);
  // Placeholder: observation note creation will be added when the full
  // note-creation pipeline is wired. For now, return the count.
  return filtered.length;
}
