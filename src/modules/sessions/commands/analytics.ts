import { Command } from '@commander-js/extra-typings';
import { withDb } from '../../../services/brain-service.js';
import { byTaskType } from '../analytics/cross-session.js';
import type { TrajectoryPoint } from '../analytics/cross-session.js';

const TREND_SYMBOL: Record<string, string> = {
  improving: '↑',
  stable: '→',
  degrading: '↓',
};

function printTable(points: TrajectoryPoint[]): void {
  if (points.length === 0) {
    process.stdout.write('No session data found for the given period.\n');
    return;
  }

  const header =
    `${'CATEGORY'.padEnd(20)} ` +
    `${'SESSIONS'.padStart(8)} ` +
    `${'MEAN SCORE'.padStart(10)} ` +
    `${'STD DEV'.padStart(8)} ` +
    `${'TOOLS/TASK'.padStart(10)} ` +
    `${'ERR RATE'.padStart(9)} ` +
    `${'TREND'.padStart(10)}\n`;

  process.stdout.write('Session Analytics by Task Category\n');
  process.stdout.write('='.repeat(79) + '\n');
  process.stdout.write(header);
  process.stdout.write('-'.repeat(79) + '\n');

  for (const p of points) {
    const trendLabel = `${TREND_SYMBOL[p.trend]} ${p.trend}`;
    process.stdout.write(
      `${p.category.padEnd(20)} ` +
        `${String(p.sessions).padStart(8)} ` +
        `${p.meanScore.toFixed(1).padStart(10)} ` +
        `${p.stdDev.toFixed(1).padStart(8)} ` +
        `${p.meanToolCallsPerTask.toFixed(1).padStart(10)} ` +
        `${(p.meanErrorRate * 100).toFixed(1).padStart(8)}% ` +
        `${trendLabel.padStart(10)}\n`
    );
  }
}

export function createSessionAnalyticsCommand(): Command {
  return new Command('analytics')
    .description('Session analytics by task category')
    .option('--category <cat>', 'Filter to a specific task category')
    .option('--days <n>', 'Number of days to look back', '90')
    .option('--json', 'Output JSON array')
    .action(async (opts: { category?: string; days?: string; json?: boolean }) => {
      await withDb(async (svc) => {
        const days = parseInt(opts.days ?? '90', 10);
        let points = byTaskType(svc.db, svc.config, { days });

        if (opts.category) {
          points = points.filter((p) => p.category === opts.category);
        }

        if (opts.json) {
          process.stdout.write(JSON.stringify(points, null, 2) + '\n');
        } else {
          printTable(points);
        }
      });
    });
}
