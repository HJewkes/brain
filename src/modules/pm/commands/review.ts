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
    .option('--json', 'Output JSON')
    .action(async (taskId, opts) => {
      await withBrain(async (svc) => {
        const result = await createReviewTask(svc.db, svc.config, svc.embedder, {
          sourceTaskId: taskId,
          prUrl: opts.pr,
          branch: opts.branch,
          agentId: opts.agent,
          rewireDeps: opts.rewire,
        });

        if (!result.ok) {
          process.stderr.write(formatError(result.error, !!opts.json) + '\n');
          process.exitCode = 1;
          return;
        }

        const { reviewTaskId, reviewTaskMeta, rewiredDeps } = result.data;

        if (opts.json) {
          process.stdout.write(
            JSON.stringify(
              {
                reviewTaskId,
                reviewTask: reviewTaskMeta,
                rewiredDeps,
                captureNoteId: result.data.captureNoteId,
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
          if (rewiredDeps.length > 0) {
            process.stdout.write(`  Rewired deps: ${rewiredDeps.join(', ')}\n`);
          }
        }
      });
    });

  return cmd;
}
