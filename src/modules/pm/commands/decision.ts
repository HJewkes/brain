import { Command } from '@commander-js/extra-typings';
import { withBrain } from '../../../services/brain-service.js';
import { formatError } from '../errors.js';
import {
  createDecision,
  listDecisions,
  getDecision,
  supersedeDecision,
} from '../data/decision-ops.js';

function outputResult(data: unknown, json: boolean): void {
  if (json) {
    process.stdout.write(JSON.stringify(data, null, 2) + '\n');
  } else if (Array.isArray(data)) {
    for (const item of data) {
      process.stdout.write(formatDecisionLine(item) + '\n');
    }
    if (data.length === 0) {
      process.stdout.write('No decisions found.\n');
    }
  } else {
    process.stdout.write(formatDecisionLine(data) + '\n');
  }
}

function formatDecisionLine(d: unknown): string {
  const dec = d as Record<string, unknown>;
  const source = dec.source_task ? ` from ${dec.source_task}` : '';
  return `${dec.display_id} - ${dec.status}${source}`;
}

export function createDecisionCommands(): Command {
  const cmd = new Command('decision').description('Manage decisions');

  cmd
    .command('add')
    .description('Record a new decision')
    .argument('<name>', 'Decision name')
    .requiredOption('--project <prefix>', 'Parent project prefix')
    .requiredOption('--source-task <id>', 'Task that prompted this decision')
    .option('--impacts <ids...>', 'Display IDs of impacted tasks')
    .option('--json', 'Output JSON')
    .action(async (name, opts) => {
      await withBrain(async (svc) => {
        const content = '';
        const result = await createDecision(svc.db, svc.config, svc.embedder, {
          project: opts.project.toUpperCase(),
          name,
          sourceTask: opts.sourceTask.toUpperCase(),
          impacts: opts.impacts?.map((id: string) => id.toUpperCase()),
          content,
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
    .description('List decisions')
    .option('--project <prefix>', 'Filter by project prefix')
    .option('--status <status>', 'Filter by status')
    .option('--json', 'Output JSON')
    .action(async (opts) => {
      await withBrain(async (svc) => {
        if (!opts.project) {
          process.stderr.write('Error: --project is required for listing decisions\n');
          process.exitCode = 1;
          return;
        }
        const result = listDecisions(svc.db, opts.project.toUpperCase(), {
          status: opts.status,
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
    .command('show')
    .description('Show decision detail')
    .argument('<id>', 'Decision display ID (e.g. WEB-D01)')
    .option('--json', 'Output JSON')
    .action(async (id, opts) => {
      await withBrain(async (svc) => {
        const result = getDecision(svc.db, id.toUpperCase());
        if (!result.ok) {
          process.stderr.write(formatError(result.error, !!opts.json) + '\n');
          process.exitCode = 1;
          return;
        }
        if (opts.json) {
          process.stdout.write(JSON.stringify(result.data, null, 2) + '\n');
        } else {
          const d = result.data;
          process.stdout.write(formatDecisionLine(d) + '\n');
          if (d.content) {
            process.stdout.write('\n' + d.content + '\n');
          }
        }
      });
    });

  cmd
    .command('supersede')
    .description('Supersede an existing decision with a new one')
    .argument('<old-id>', 'Display ID of decision to supersede')
    .argument('<name>', 'Name for the new decision')
    .option('--impacts <ids...>', 'Display IDs of impacted tasks')
    .option('--json', 'Output JSON')
    .action(async (oldId, name, opts) => {
      await withBrain(async (svc) => {
        const oldDisplayId = oldId.toUpperCase();
        const oldResult = getDecision(svc.db, oldDisplayId);
        if (!oldResult.ok) {
          process.stderr.write(formatError(oldResult.error, !!opts.json) + '\n');
          process.exitCode = 1;
          return;
        }

        const result = await supersedeDecision(svc.db, svc.config, svc.embedder, oldDisplayId, {
          project: oldResult.data.project,
          name,
          sourceTask: oldResult.data.source_task,
          impacts: opts.impacts?.map((id: string) => id.toUpperCase()),
          content: '',
        });
        if (!result.ok) {
          process.stderr.write(formatError(result.error, !!opts.json) + '\n');
          process.exitCode = 1;
          return;
        }
        if (opts.json) {
          process.stdout.write(JSON.stringify(result.data, null, 2) + '\n');
        } else {
          process.stdout.write(`Superseded ${result.data.old.display_id} -> ${result.data.new.display_id}\n`);
        }
      });
    });

  return cmd;
}
