import { Command } from '@commander-js/extra-typings';
import { withDb } from '../../../services/brain-service.js';
import { markSessionReference } from '../data/session-ops.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createSessionMarkCommand(): Command<any> {
  return new Command('mark')
    .description('Mark a session as a reference (golden) session')
    .argument('<id>', 'Session display ID (e.g. SNS-001)')
    .action(async (id: string) => {
      await withDb(async (svc) => {
        const displayId = id.toUpperCase();
        const result = markSessionReference(svc.db, displayId, true);
        if (!result.ok) {
          process.stderr.write(`Error: ${result.error.message}\n`);
          process.exitCode = 1;
          return;
        }
        process.stdout.write(`Marked ${displayId} as reference session\n`);
      });
    });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createSessionUnmarkCommand(): Command<any> {
  return new Command('unmark')
    .description('Remove reference status from a session')
    .argument('<id>', 'Session display ID (e.g. SNS-001)')
    .action(async (id: string) => {
      await withDb(async (svc) => {
        const displayId = id.toUpperCase();
        const result = markSessionReference(svc.db, displayId, false);
        if (!result.ok) {
          process.stderr.write(`Error: ${result.error.message}\n`);
          process.exitCode = 1;
          return;
        }
        process.stdout.write(`Removed reference status from ${displayId}\n`);
      });
    });
}
