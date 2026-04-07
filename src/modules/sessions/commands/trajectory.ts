import { Command } from '@commander-js/extra-typings';
import { withDb } from '../../../services/brain-service.js';
import { listSessions } from '../data/session-ops.js';
import { parseSinceDate } from '../utils.js';
import type { SessionListFilters } from '../types.js';
import { computeTaskTypeTrajectory } from '../analytics/task-trajectory.js';

function buildTaskCategoryMap(
  db: import('../../../services/brain-db.js').BrainDB
): Map<string, string> {
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

export function createSessionTrajectoryCommand(): Command {
  return new Command('trajectory')
    .description('Per-task-type trajectory: tool call norms, error rates, and efficiency trends')
    .option('--project <prefix>', 'Filter by PM project')
    .option('--project-dir <dir>', 'Filter by directory')
    .option('--since <date>', 'Sessions after date')
    .option('--limit <n>', 'Max sessions to analyze', '200')
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
          const limit = parseInt(opts.limit ?? '200', 10);
          const limited = sessions.slice(0, limit);

          const categoryMap = buildTaskCategoryMap(svc.db);
          const report = computeTaskTypeTrajectory(limited, (id) => categoryMap.get(id) ?? null);

          if (opts.json) {
            process.stdout.write(JSON.stringify(report, null, 2) + '\n');
            return;
          }

          if (report.trajectories.length === 0) {
            process.stdout.write('No sessions with task references found.\n');
            return;
          }

          const TREND_SYMBOL: Record<string, string> = {
            improving: '↑',
            stable: '→',
            degrading: '↓',
          };

          process.stdout.write('Task Type Trajectory (tool calls, error rate, efficiency)\n');
          process.stdout.write('='.repeat(72) + '\n');
          process.stdout.write(
            `${'TYPE'.padEnd(18)} ${'N'.padStart(4)} ${'AVG TOOLS'.padStart(10)} ${'ERR RATE'.padStart(10)} ${'EFF'.padStart(6)} ${'ERR TREND'.padStart(10)} ${'EFF TREND'.padStart(10)}\n`
          );
          process.stdout.write('-'.repeat(72) + '\n');

          for (const t of report.trajectories) {
            const { norm, errorRateTrend, efficiencyTrend } = t;
            const errSym = TREND_SYMBOL[errorRateTrend];
            const effSym = TREND_SYMBOL[efficiencyTrend];
            process.stdout.write(
              `${t.taskType.padEnd(18)} ` +
                `${String(norm.sampleSize).padStart(4)} ` +
                `${norm.avgToolCalls.toFixed(0).padStart(10)} ` +
                `${(norm.avgErrorRate * 100).toFixed(1).padStart(9)}% ` +
                `${(norm.avgEfficiency * 100).toFixed(0).padStart(5)}% ` +
                `${(errSym + ' ' + errorRateTrend).padStart(10)} ` +
                `${(effSym + ' ' + efficiencyTrend).padStart(10)}\n`
            );
          }

          if (report.degradedTypes.length > 0) {
            process.stdout.write(
              '\nDegrading task types: ' + report.degradedTypes.join(', ') + '\n'
            );
          } else {
            process.stdout.write('\nNo degradation patterns detected.\n');
          }
        });
      }
    );
}
