import { Command } from '@commander-js/extra-typings';
import { withBrain } from '../../../services/brain-service.js';
import { listSessions } from '../data/session-ops.js';
import { parseSinceDate } from '../utils.js';
import { computeCrossSessionAnalytics } from '../analytics/cross-session.js';
import { detectRecurringErrors } from '../analytics/recurring-errors.js';
import type { SessionListFilters } from '../types.js';

function formatMinutes(minutes: number): string {
  if (minutes < 60) return `${Math.round(minutes)}m`;
  const hours = Math.floor(minutes / 60);
  const rem = Math.round(minutes % 60);
  return rem > 0 ? `${hours}h ${rem}m` : `${hours}h`;
}

export function createSessionStatsCommand(): Command {
  return new Command('stats')
    .description('Cross-session intelligence stats')
    .option('--since <date>', 'Sessions after date (ISO or relative: 7d, 30d, 3mo)')
    .option('--project-dir <dir>', 'Filter by project directory')
    .option('--json', 'Output JSON')
    .action(async (opts: { since?: string; projectDir?: string; json?: boolean }) => {
      await withBrain(async (svc) => {
        const filters: SessionListFilters = {};
        if (opts.projectDir) filters.projectDir = opts.projectDir;
        if (opts.since) filters.since = parseSinceDate(opts.since).toISOString();

        const sessions = listSessions(svc.db, filters);
        if (sessions.length === 0) {
          process.stdout.write('No sessions found.\n');
          return;
        }

        const crossAnalytics = computeCrossSessionAnalytics(sessions);
        const recurringErrors = detectRecurringErrors(sessions, svc.db, svc.config);

        const avgDuration =
          sessions.reduce((sum, s) => sum + (s.duration_minutes ?? 0), 0) / sessions.length;
        const avgErrorRate =
          sessions.reduce((sum, s) => sum + (s.error_rate ?? 0), 0) / sessions.length;

        if (opts.json) {
          const output = {
            sessionCount: sessions.length,
            sessionsPerDay: crossAnalytics.trends.sessionsPerDay,
            avgDurationMinutes: avgDuration,
            avgErrorRate,
            errorRateTrend: crossAnalytics.trends.errorRateTrend,
            durationTrend: crossAnalytics.trends.durationTrend,
            byBranch: crossAnalytics.byBranch,
            recurringErrors,
          };
          process.stdout.write(JSON.stringify(output, null, 2) + '\n');
          return;
        }

        // Text output
        process.stdout.write('Session Intelligence Stats\n');
        process.stdout.write(
          `  Sessions: ${sessions.length} (${crossAnalytics.trends.sessionsPerDay.toFixed(1)}/day)\n`
        );
        process.stdout.write(`  Avg duration: ${formatMinutes(avgDuration)}\n`);
        process.stdout.write(`  Avg error rate: ${(avgErrorRate * 100).toFixed(1)}%\n`);
        process.stdout.write(`  Error trend: ${crossAnalytics.trends.errorRateTrend}\n`);
        process.stdout.write(`  Duration trend: ${crossAnalytics.trends.durationTrend}\n`);

        if (crossAnalytics.byBranch.length > 0) {
          process.stdout.write('\nTop Branches:\n');
          for (const b of crossAnalytics.byBranch.slice(0, 10)) {
            process.stdout.write(
              `  ${b.branch}: ${b.sessionCount} sessions, ${formatMinutes(b.totalDurationMinutes)} total\n`
            );
          }
        }

        if (recurringErrors.length > 0) {
          process.stdout.write('\nRecurring Errors (2+ sessions):\n');
          for (const err of recurringErrors.slice(0, 10)) {
            process.stdout.write(
              `  ${err.toolName}: "${err.pattern}" (${err.occurrences} occurrences across ${err.sessionIds.length} sessions)\n`
            );
            process.stdout.write(`    -> ${err.suggestion}\n`);
          }
        }
      });
    });
}
