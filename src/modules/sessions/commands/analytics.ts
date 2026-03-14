import { Command } from '@commander-js/extra-typings';
import { withDb } from '../../../services/brain-service.js';
import { listSessions } from '../data/session-ops.js';
import { parseSinceDate } from '../utils.js';
import type { SessionListFilters } from '../types.js';

interface AnalyticsSummary {
  sessionCount: number;
  totalTurns: number;
  totalToolCalls: number;
  totalErrors: number;
  avgErrorRate: number;
  avgDurationMinutes: number;
  totalTokensInput: number;
  totalTokensOutput: number;
  topTools: Array<{ name: string; count: number }>;
  frictionSignals: number;
}

export function createSessionAnalyticsCommand(): Command {
  return new Command('analytics')
    .description('Session analytics summary')
    .option('--project <prefix>', 'Filter by PM project')
    .option('--project-dir <dir>', 'Filter by directory')
    .option('--since <date>', 'Sessions after date')
    .option('--limit <n>', 'Max sessions to analyze', '100')
    .option('--json', 'Output JSON')
    .action(
      async (opts: {
        project?: string;
        projectDir?: string;
        since?: string;
        limit?: string;
        json?: boolean;
      }) => {
        await withDb(async (svc) => {
          const filters: SessionListFilters = {};
          if (opts.project) filters.project = opts.project;
          if (opts.projectDir) filters.projectDir = opts.projectDir;
          if (opts.since) filters.since = parseSinceDate(opts.since).toISOString();

          const sessions = listSessions(svc.db, filters);
          const limit = parseInt(opts.limit ?? '100', 10);
          const limited = sessions.slice(0, limit);

          const summary: AnalyticsSummary = {
            sessionCount: limited.length,
            totalTurns: 0,
            totalToolCalls: 0,
            totalErrors: 0,
            avgErrorRate: 0,
            avgDurationMinutes: 0,
            totalTokensInput: 0,
            totalTokensOutput: 0,
            topTools: [],
            frictionSignals: 0,
          };

          let totalDuration = 0;
          let totalErrorRate = 0;

          for (const s of limited) {
            summary.totalTurns += s.total_turns ?? 0;
            summary.totalToolCalls += s.tool_calls ?? 0;
            summary.totalErrors += s.error_count ?? 0;
            totalErrorRate += s.error_rate ?? 0;
            totalDuration += s.duration_minutes ?? 0;
            summary.totalTokensInput += s.tokens_input ?? 0;
            summary.totalTokensOutput += s.tokens_output ?? 0;

            if (s.analyticsExt?.friction_categories) {
              for (const f of s.analyticsExt.friction_categories) {
                summary.frictionSignals += f.count;
              }
            }
          }

          if (limited.length > 0) {
            summary.avgErrorRate = totalErrorRate / limited.length;
            summary.avgDurationMinutes = totalDuration / limited.length;
          }

          if (opts.json) {
            process.stdout.write(JSON.stringify(summary, null, 2) + '\n');
          } else {
            process.stdout.write(`Sessions: ${summary.sessionCount}\n`);
            process.stdout.write(`Total turns: ${summary.totalTurns}\n`);
            process.stdout.write(`Total tool calls: ${summary.totalToolCalls}\n`);
            process.stdout.write(`Total errors: ${summary.totalErrors}\n`);
            process.stdout.write(`Avg error rate: ${(summary.avgErrorRate * 100).toFixed(1)}%\n`);
            process.stdout.write(`Avg duration: ${summary.avgDurationMinutes.toFixed(0)}m\n`);
            process.stdout.write(
              `Tokens: ${summary.totalTokensInput} in / ${summary.totalTokensOutput} out\n`
            );
            process.stdout.write(`Friction signals: ${summary.frictionSignals}\n`);
          }
        });
      }
    );
}
