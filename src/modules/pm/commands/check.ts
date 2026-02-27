import { Command } from '@commander-js/extra-typings';
import { withBrain } from '../../../services/brain-service.js';
import { getActiveProject } from '../data/queries.js';
import { formatError } from '../errors.js';
import { runConsistencyCheck } from '../engine/consistency.js';

function resolvePrefix(explicit: string | undefined, active: string | null): string | undefined {
  if (explicit) return explicit.toUpperCase();
  return active ?? undefined;
}

export function createCheckCommand(): Command {
  return new Command('check')
    .description('Run consistency checks on a PM project')
    .option('--project <prefix>', 'Project prefix (uses active project if omitted)')
    .option('--deep', 'Include semantic analysis and source document clustering')
    .option('--json', 'Output JSON')
    .action(async (opts) => {
      await withBrain(async (svc) => {
        const prefix = resolvePrefix(opts.project, getActiveProject(svc.db));
        if (!prefix) {
          const msg =
            'No project specified and no active project set. Use "brain pm use <prefix>" first.';
          process.stderr.write(
            formatError({ error: true, code: 'INVALID_INPUT', message: msg }, true) + '\n'
          );
          process.exitCode = 1;
          return;
        }

        const report = runConsistencyCheck(svc.db, prefix, !!opts.deep);
        process.stdout.write(JSON.stringify(report, null, 2) + '\n');
      });
    }) as unknown as Command;
}
