import { Command } from '@commander-js/extra-typings';
import { withBrain } from '../../../services/brain-service.js';
import { formatError } from '../errors.js';
import {
  createWorkstream,
  listWorkstreams,
  getWorkstream,
  updateWorkstream,
  deleteWorkstream,
} from '../data/workstream-ops.js';

function outputResult(data: unknown, json: boolean): void {
  if (json) {
    process.stdout.write(JSON.stringify(data, null, 2) + '\n');
  } else if (Array.isArray(data)) {
    for (const item of data) {
      process.stdout.write(formatWorkstreamLine(item) + '\n');
    }
    if (data.length === 0) {
      process.stdout.write('No workstreams found.\n');
    }
  } else {
    process.stdout.write(formatWorkstreamLine(data) + '\n');
  }
}

function formatWorkstreamLine(ws: unknown): string {
  const w = ws as Record<string, unknown>;
  return `${w.display_id} - ${w.project} #${w.number} (${w.status})`;
}

export function createWorkstreamCommands(): Command {
  const cmd = new Command('workstream').description('Manage workstreams');

  cmd
    .command('add')
    .description('Create a new workstream')
    .argument('<name>', 'Workstream name')
    .requiredOption('--project <prefix>', 'Parent project prefix')
    .option('--description <desc>', 'Workstream description')
    .option('--json', 'Output JSON')
    .action(async (name, opts) => {
      await withBrain(async (svc) => {
        const result = await createWorkstream(svc.db, svc.config, svc.embedder, {
          project: opts.project.toUpperCase(),
          name,
          description: opts.description,
        });
        if (!result.ok) {
          process.stderr.write(formatError(result.error, !!opts.json) + '\n');
          process.exitCode = 1;
          return;
        }
        outputResult(result.data, !!opts.json);
      });
    });

  cmd
    .command('list')
    .description('List workstreams')
    .option('--project <prefix>', 'Filter by project prefix')
    .option('--json', 'Output JSON')
    .action(async (opts) => {
      await withBrain(async (svc) => {
        if (!opts.project) {
          process.stderr.write(
            formatError(
              {
                error: true,
                code: 'INVALID_INPUT',
                message: '--project is required for listing workstreams',
              },
              !!opts.json
            ) + '\n'
          );
          process.exitCode = 1;
          return;
        }
        const result = listWorkstreams(svc.db, opts.project.toUpperCase());
        if (!result.ok) {
          process.stderr.write(formatError(result.error, !!opts.json) + '\n');
          process.exitCode = 1;
          return;
        }
        outputResult(result.data, !!opts.json);
      });
    });

  cmd
    .command('show')
    .description('Show workstream detail')
    .argument('<id>', 'Workstream display ID (e.g. WEB-01)')
    .option('--json', 'Output JSON')
    .action(async (id, opts) => {
      await withBrain(async (svc) => {
        const result = getWorkstream(svc.db, id.toUpperCase());
        if (!result.ok) {
          process.stderr.write(formatError(result.error, !!opts.json) + '\n');
          process.exitCode = 1;
          return;
        }
        outputResult(result.data, !!opts.json);
      });
    });

  cmd
    .command('update')
    .description('Update a workstream')
    .argument('<id>', 'Workstream display ID')
    .option('--status <status>', 'New status')
    .option('--json', 'Output JSON')
    .action(async (id, opts) => {
      await withBrain(async (svc) => {
        const updates: Record<string, unknown> = {};
        if (opts.status) updates.status = opts.status;

        const result = await updateWorkstream(
          svc.db,
          svc.config,
          svc.embedder,
          id.toUpperCase(),
          updates
        );
        if (!result.ok) {
          process.stderr.write(formatError(result.error, !!opts.json) + '\n');
          process.exitCode = 1;
          return;
        }
        outputResult(result.data, !!opts.json);
      });
    });

  cmd
    .command('delete')
    .description('Delete a workstream')
    .argument('<id>', 'Workstream display ID')
    .option('--force', 'Force delete even with tasks')
    .option('--json', 'Output JSON')
    .action(async (id, opts) => {
      await withBrain(async (svc) => {
        const result = await deleteWorkstream(svc.db, svc.config, id.toUpperCase(), opts.force);
        if (!result.ok) {
          process.stderr.write(formatError(result.error, !!opts.json) + '\n');
          process.exitCode = 1;
          return;
        }
        if (opts.json) {
          process.stdout.write(JSON.stringify({ deleted: true, id: id.toUpperCase() }) + '\n');
        } else {
          process.stdout.write(`Deleted workstream ${id.toUpperCase()}\n`);
        }
      });
    });

  return cmd;
}
