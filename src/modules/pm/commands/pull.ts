import { Command } from '@commander-js/extra-typings';
import { withBrain } from '../../../services/brain-service.js';
import { pullNextTask } from '../../agents/task-pull.js';

export function createPullCommand(): Command {
  return new Command('pull')
    .description('Pull the next eligible task for agent dispatch')
    .option('--project <prefix>', 'Project prefix (uses active if omitted)')
    .option('--json', 'Output JSON')
    .action(async (opts) => {
      await withBrain(async (svc) => {
        const result = await pullNextTask(svc.db, svc.config, svc.embedder);

        if (!result) {
          if (opts.json) {
            process.stdout.write(JSON.stringify(null) + '\n');
          } else {
            process.stdout.write('No eligible tasks found.\n');
          }
          return;
        }

        if (opts.json) {
          process.stdout.write(
            JSON.stringify(
              {
                taskId: result.taskId,
                claimToken: result.claimToken,
                routing: result.dispatchContext.routing,
                agentDispatchable: result.dispatchContext.agentDispatchable,
              },
              null,
              2
            ) + '\n'
          );
        } else {
          process.stdout.write(result.brief + '\n');
          process.stdout.write(`\nClaim token: ${result.claimToken}\n`);
        }
      });
    });
}
