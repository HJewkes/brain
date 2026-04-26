import { Command } from '@commander-js/extra-typings';
import { withBrain } from '../../services/brain-service.js';
import {
  allocateWorktree,
  releaseWorktree,
  checkWorktreePath,
  cleanupStaleAllocations,
  cleanupOrphanRemoteBranches,
  findGitRoot,
} from './worktree.js';
import { getWorktreeAllocations } from './data.js';
import { resolveHookConfig } from '../../hooks/config.js';

function getProjectRoot(): string {
  return findGitRoot();
}

export function createWorktreeCommand(): Command {
  const worktreeCmd = new Command('worktree').description('Manage git worktrees for agent tasks');

  // brain agent worktree alloc
  worktreeCmd
    .command('alloc')
    .description('Allocate a git worktree for a task')
    .requiredOption('--task-id <id>', 'Task display ID')
    .requiredOption('--workstream <ws>', 'Workstream identifier')
    .requiredOption('--claim-token <token>', 'Claim token')
    .action(async (opts: { taskId: string; workstream: string; claimToken: string }) => {
      const projectRoot = getProjectRoot();
      const config = resolveHookConfig(projectRoot);
      await withBrain(async (svc) => {
        const result = allocateWorktree(svc.db, projectRoot, {
          taskId: opts.taskId,
          workstream: opts.workstream,
          claimToken: opts.claimToken,
          basePath: config.enforcement.worktreeBasePath,
          budget: config.enforcement.worktreeBudget,
        });
        process.stdout.write(
          JSON.stringify(
            {
              worktreePath: result.worktreePath,
              branch: result.branch,
              reused: result.reused,
              taskId: opts.taskId,
            },
            null,
            2
          ) + '\n'
        );
      });
    });

  // brain agent worktree release <task-id>
  worktreeCmd
    .command('release')
    .description('Release a worktree by task ID')
    .argument('<task-id>', 'Task display ID')
    .action(async (taskId: string) => {
      const projectRoot = getProjectRoot();
      await withBrain(async (svc) => {
        const released = releaseWorktree(svc.db, projectRoot, taskId);
        if (released) {
          process.stdout.write(`Released worktree for task ${taskId}.\n`);
        } else {
          process.stderr.write(`No worktree found for task ${taskId}.\n`);
          process.exitCode = 1;
        }
      });
    });

  // brain agent worktree status
  worktreeCmd
    .command('status')
    .description('Show current worktree allocations and budget')
    .option('--json', 'Output JSON')
    .action(async (opts: { json?: boolean }) => {
      const projectRoot = getProjectRoot();
      const config = resolveHookConfig(projectRoot);
      await withBrain(async (svc) => {
        const allocations = getWorktreeAllocations(svc.db);
        const budget = config.enforcement.worktreeBudget;

        if (opts.json) {
          process.stdout.write(
            JSON.stringify({ budget, count: allocations.length, allocations }, null, 2) + '\n'
          );
          return;
        }

        process.stdout.write(`Worktree budget: ${allocations.length}/${budget}\n`);
        if (allocations.length === 0) {
          process.stdout.write('  No active allocations.\n');
        } else {
          for (const a of allocations) {
            process.stdout.write(
              `  ${a.task_id} [${a.workstream ?? '—'}] → ${a.worktree_path} (${a.branch})\n`
            );
          }
        }
      });
    });

  // brain agent worktree check
  worktreeCmd
    .command('check')
    .description('Check whether cwd is inside the expected worktree path')
    .option('--path <path>', 'Expected worktree path (default: $AGENT_WORKTREE_PATH)')
    .action((opts: { path?: string }) => {
      const expectedPath = opts.path ?? process.env.AGENT_WORKTREE_PATH;
      if (!expectedPath) {
        process.stdout.write(JSON.stringify({ ok: true, reason: 'no worktree constraint' }) + '\n');
        return;
      }
      const result = checkWorktreePath(expectedPath);
      process.stdout.write(
        JSON.stringify({
          ok: result.inWorktree,
          expected: result.expected,
          actual: result.actual,
        }) + '\n'
      );
    });

  // brain agent worktree cleanup
  worktreeCmd
    .command('cleanup')
    .description('Remove stale allocations whose worktree paths no longer exist')
    .action(async () => {
      const projectRoot = getProjectRoot();
      await withBrain(async (svc) => {
        const removed = cleanupStaleAllocations(svc.db, projectRoot);
        if (removed.length === 0) {
          process.stdout.write('No stale allocations found.\n');
        } else {
          process.stdout.write(
            `Removed ${removed.length} stale allocation(s): ${removed.join(', ')}\n`
          );
        }
      });
    });

  // brain agent worktree cleanup-branches
  worktreeCmd
    .command('cleanup-branches')
    .description('Delete orphan remote agent/* branches with no open PR and no active agent')
    .option('--workstream <ws>', 'Only scan branches under agent/{workstream}/')
    .option('--dry-run', 'Report orphan branches without deleting them')
    .option('--json', 'Output JSON')
    .action(async (opts: { workstream?: string; dryRun?: boolean; json?: boolean }) => {
      const projectRoot = getProjectRoot();
      await withBrain(async (svc) => {
        const reports = cleanupOrphanRemoteBranches(svc.db, projectRoot, {
          workstream: opts.workstream,
          dryRun: opts.dryRun,
        });

        if (opts.json) {
          process.stdout.write(JSON.stringify(reports, null, 2) + '\n');
          return;
        }

        if (reports.length === 0) {
          process.stdout.write('No remote agent branches found.\n');
          return;
        }

        const orphans = reports.filter((r) => !r.hasOpenPR && !r.hasActiveAgent);
        const deleted = reports.filter((r) => r.deleted);

        process.stdout.write(`Scanned ${reports.length} remote agent branch(es).\n`);
        if (orphans.length === 0) {
          process.stdout.write('No orphan branches found.\n');
          return;
        }

        if (opts.dryRun) {
          process.stdout.write(`\n${orphans.length} orphan branch(es) (dry-run):\n`);
          for (const r of orphans) {
            process.stdout.write(`  ${r.branch}\n`);
          }
        } else {
          process.stdout.write(
            `\nDeleted ${deleted.length}/${orphans.length} orphan branch(es):\n`
          );
          for (const r of deleted) {
            process.stdout.write(`  ${r.branch}\n`);
          }
          const failed = orphans.filter((r) => !r.deleted);
          if (failed.length > 0) {
            process.stderr.write(
              `Failed to delete ${failed.length} branch(es): ${failed.map((r) => r.branch).join(', ')}\n`
            );
          }
        }
      });
    });

  return worktreeCmd;
}
