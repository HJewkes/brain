import { Command } from '@commander-js/extra-typings';
import { withBrain } from '../../../services/brain-service.js';
import { formatError } from '../errors.js';
import { createReviewTask } from '../data/review-ops.js';

export function createReviewCommands(): Command {
  const cmd = new Command('review').description('PR review lifecycle commands');

  cmd
    .command('create')
    .description('Create a review task for a PR')
    .argument('<task-id>', 'Source task display ID (e.g. SDK-02.01)')
    .requiredOption('--pr <url>', 'Pull request URL')
    .requiredOption('--branch <branch>', 'Branch name')
    .option('--agent <id>', 'Agent ID that created the PR')
    .option('--no-rewire', 'Skip dependency rewiring')
    .option('--no-auto-complete', 'Skip auto-completing the source task')
    .option('--risk <number>', 'Risk score (1-5) for review routing advisory')
    .option('--json', 'Output JSON')
    .action(async (taskId, opts) => {
      await withBrain(async (svc) => {
        let risk: number | undefined;
        if (opts.risk !== undefined) {
          risk = Number(opts.risk);
          if (!Number.isInteger(risk) || risk < 1 || risk > 5) {
            process.stderr.write('Error: --risk must be an integer between 1 and 5\n');
            process.exitCode = 1;
            return;
          }
        }

        const result = await createReviewTask(svc.db, svc.config, svc.embedder, {
          sourceTaskId: taskId,
          prUrl: opts.pr,
          branch: opts.branch,
          agentId: opts.agent,
          rewireDeps: opts.rewire,
          autoComplete: opts.autoComplete,
          risk,
        });

        if (!result.ok) {
          process.stderr.write(formatError(result.error, !!opts.json) + '\n');
          process.exitCode = 1;
          return;
        }

        const { reviewTaskId, reviewTaskMeta, rewiredDeps, sourceAutoCompleted } = result.data;

        if (opts.json) {
          process.stdout.write(
            JSON.stringify(
              {
                reviewTaskId,
                reviewTask: reviewTaskMeta,
                rewiredDeps,
                captureNoteId: result.data.captureNoteId,
                riskAdvisory: result.data.riskAdvisory,
                sourceAutoCompleted,
              },
              null,
              2
            ) + '\n'
          );
        } else {
          process.stdout.write(`Created review task ${reviewTaskId}\n`);
          process.stdout.write(
            `  ${reviewTaskMeta.title} [${reviewTaskMeta.priority}] (${reviewTaskMeta.mode})\n`
          );
          if (sourceAutoCompleted) {
            process.stdout.write(`  Auto-completed source task ${taskId.toUpperCase()}\n`);
          } else if (!opts.autoComplete) {
            // --no-auto-complete was set, no message needed
          } else {
            process.stdout.write(`  Source task ${taskId.toUpperCase()} already done\n`);
          }
          if (rewiredDeps.length > 0) {
            process.stdout.write(`  Rewired deps: ${rewiredDeps.join(', ')}\n`);
          }
          if (result.data.riskAdvisory) {
            process.stdout.write(`  ${result.data.riskAdvisory}\n`);
          }
        }
      });
    });

  return cmd;
}
