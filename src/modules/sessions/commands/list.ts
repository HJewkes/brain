import { Command } from '@commander-js/extra-typings';
import { withDb } from '../../../services/brain-service.js';
import { listSessions } from '../data/session-ops.js';
import { parseSinceDate, formatDuration } from '../utils.js';
import type { SessionListFilters } from '../types.js';

export function createSessionListCommand(): Command {
  return new Command('list')
    .description('List ingested sessions')
    .option('--project <prefix>', 'Filter by PM project prefix')
    .option('--project-dir <dir>', 'Filter by project directory')
    .option('--since <date>', 'Sessions started after date')
    .option('--status <status>', 'Filter by status')
    .option('--limit <n>', 'Max results', '20')
    .option('--json', 'Output JSON')
    .action(
      async (opts: {
        project?: string;
        projectDir?: string;
        since?: string;
        status?: string;
        limit?: string;
        json?: boolean;
      }) => {
        await withDb(async (svc) => {
          const filters: SessionListFilters = {};
          if (opts.project) filters.project = opts.project;
          if (opts.projectDir) filters.projectDir = opts.projectDir;
          if (opts.since) filters.since = parseSinceDate(opts.since).toISOString();
          if (opts.status) filters.status = opts.status as SessionListFilters['status'];

          const sessions = listSessions(svc.db, filters);
          const limit = parseInt(opts.limit ?? '20', 10);
          const limited = sessions.slice(0, limit);

          if (opts.json) {
            process.stdout.write(JSON.stringify(limited, null, 2) + '\n');
            return;
          }

          if (limited.length === 0) {
            process.stdout.write('No sessions found\n');
            return;
          }

          // Table header
          process.stdout.write(
            `${'ID'.padEnd(10)} ${'DATE'.padEnd(12)} ${'DUR'.padEnd(8)} ${'STATUS'.padEnd(12)} ${'BRANCH'.padEnd(25)} SUMMARY\n`
          );
          process.stdout.write('-'.repeat(100) + '\n');

          for (const s of limited) {
            const date = s.started_at.slice(0, 10);
            const dur =
              s.duration_minutes != null ? formatDuration(s.duration_minutes * 60000) : '-';
            const branch = (s.branch ?? '-').slice(0, 24);
            const summary = (s.summary ?? '').slice(0, 50);
            process.stdout.write(
              `${s.display_id.padEnd(10)} ${date.padEnd(12)} ${dur.padEnd(8)} ${s.status.padEnd(12)} ${branch.padEnd(25)} ${summary}\n`
            );
          }
        });
      }
    );
}
