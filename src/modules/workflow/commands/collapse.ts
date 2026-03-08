import { Command, type CommandUnknownOpts } from '@commander-js/extra-typings';
import { withBrain } from '../../../services/brain-service.js';
import { collapseWorkflow } from '../data/workflow-ops.js';

export function createCollapseCommand(): CommandUnknownOpts {
  const cmd = new Command('collapse')
    .description('Collapse a completed workflow instance')
    .argument('<instance-id>', 'Workflow instance display ID')
    .option('--json', 'Output JSON')
    .action(async (instanceId, opts) => {
      await withBrain(async (svc) => {
        const result = await collapseWorkflow(svc.db, svc.config, svc.embedder, instanceId);
        if (!result.ok) {
          const msg = opts.json
            ? JSON.stringify(result.error, null, 2)
            : `Error: ${result.error.message}`;
          process.stderr.write(msg + '\n');
          process.exitCode = 1;
          return;
        }
        if (opts.json) {
          process.stdout.write(JSON.stringify(result.data, null, 2) + '\n');
        } else {
          process.stdout.write(`Collapsed workflow instance\n`);
          process.stdout.write(`  Summary: ${result.data.summaryNoteId}\n`);
          process.stdout.write(`  Tasks archived: ${result.data.tasksArchived}\n`);
        }
      });
    });
  return cmd;
}
