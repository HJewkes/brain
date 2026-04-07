import { Command } from '@commander-js/extra-typings';
import { withDb } from '../../../services/brain-service.js';
import { markSessionReference, listSessions } from '../data/session-ops.js';

export function createSessionReferenceCommand(): Command {
  const cmd = new Command('reference').description(
    'Manage reference sessions for golden dataset regression detection'
  );

  cmd
    .command('mark <display_id>')
    .description('Mark a session as a reference (golden) session')
    .action(async (displayId: string) => {
      await withDb(async (svc) => {
        const result = markSessionReference(svc.db, displayId.toUpperCase(), true);
        if (!result.ok) {
          process.stderr.write(`Error: ${result.error.message}\n`);
          process.exitCode = 1;
          return;
        }
        process.stdout.write(`Marked ${displayId.toUpperCase()} as reference session\n`);
      });
    });

  cmd
    .command('unmark <display_id>')
    .description('Remove reference status from a session')
    .action(async (displayId: string) => {
      await withDb(async (svc) => {
        const result = markSessionReference(svc.db, displayId.toUpperCase(), false);
        if (!result.ok) {
          process.stderr.write(`Error: ${result.error.message}\n`);
          process.exitCode = 1;
          return;
        }
        process.stdout.write(`Removed reference status from ${displayId.toUpperCase()}\n`);
      });
    });

  cmd
    .command('list')
    .description('List all reference sessions')
    .option('--json', 'Output JSON')
    .action(async (opts: { json?: boolean }) => {
      await withDb(async (svc) => {
        const sessions = listSessions(svc.db, { reference: true });

        if (opts.json) {
          process.stdout.write(JSON.stringify(sessions, null, 2) + '\n');
          return;
        }

        if (sessions.length === 0) {
          process.stdout.write('No reference sessions found\n');
          return;
        }

        process.stdout.write(
          `${'ID'.padEnd(10)} ${'DATE'.padEnd(12)} ${'STATUS'.padEnd(12)} SUMMARY\n`
        );
        process.stdout.write('-'.repeat(70) + '\n');

        for (const s of sessions) {
          const date = s.started_at.slice(0, 10);
          const summary = (s.summary ?? '').slice(0, 40);
          process.stdout.write(
            `${s.display_id.padEnd(10)} ${date.padEnd(12)} ${s.status.padEnd(12)} ${summary}\n`
          );
        }

        process.stdout.write(`\nTotal: ${sessions.length} reference session(s)\n`);
      });
    });

  return cmd;
}
