import { randomUUID } from 'node:crypto';
import { Command } from '@commander-js/extra-typings';
import { withBrain } from '../../../services/brain-service.js';
import { formatError } from '../errors.js';
import { getActiveProject } from '../data/queries.js';
import { getTask, listTasks } from '../data/task-ops.js';
import { computeRouting } from '../engine/routing.js';
import { renderAgentPrompt, renderVerificationPrompt } from '../engine/template.js';
import { allocateWorktree, checkWorktreePath, releaseWorktree, getBudget } from '../engine/worktree.js';
import { assembleContext } from '../engine/dispatch.js';
import type { TaskCategory, TaskMode } from '../types.js';

function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    process.stdin.on('data', (chunk: Buffer) => chunks.push(chunk));
    process.stdin.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    if (process.stdin.isTTY) resolve('');
  });
}

export function createOrchestrateCommands(): Command {
  const cmd = new Command('orchestrate')
    .description('Orchestration layer commands (used by hooks and skill)');

  cmd.addCommand(
    new Command('session-start')
      .description('Initialize orchestration session (called by SessionStart hook)')
      .action(async () => {
        await withBrain(async (svc) => {
          const input = await readStdin();
          const data = input.trim() ? (JSON.parse(input) as Record<string, unknown>) : {};

          const activeProject = getActiveProject(svc.db);
          if (!activeProject) {
            process.stderr.write(
              formatError(
                { error: true, code: 'INVALID_INPUT', message: 'No active project set. Use "brain pm use <prefix>" first.' },
                true,
              ) + '\n',
            );
            process.exitCode = 1;
            return;
          }

          const sessionId = (data.sessionId as string) ?? randomUUID();
          const output = {
            sessionId,
            project: activeProject,
            env: {
              BRAIN_PM_PROJECT: activeProject,
              BRAIN_PM_SESSION: sessionId,
            },
          };
          process.stdout.write(JSON.stringify(output, null, 2) + '\n');
        });
      }),
  );

  cmd.addCommand(
    new Command('route')
      .description('Compute routing for a task')
      .argument('<id>', 'Task display ID')
      .option('--json', 'Output JSON')
      .action(async (id, opts) => {
        await withBrain(async (svc) => {
          const displayId = id.toUpperCase();
          const taskResult = getTask(svc.db, displayId);
          if (!taskResult.ok) {
            process.stderr.write(formatError(taskResult.error, !!opts.json) + '\n');
            process.exitCode = 1;
            return;
          }

          const task = taskResult.data;
          const routing = computeRouting(task.category as TaskCategory, task.mode as TaskMode);

          const output = { taskId: displayId, ...routing };
          if (opts.json) {
            process.stdout.write(JSON.stringify(output, null, 2) + '\n');
          } else {
            process.stdout.write(`Task: ${displayId}\n`);
            process.stdout.write(`Agent: ${routing.agentType}\n`);
            process.stdout.write(`Model: ${routing.model}\n`);
            process.stdout.write(`Isolation: ${routing.isolation}\n`);
            process.stdout.write(`Verify: ${routing.verify}\n`);
            process.stdout.write(`Concurrency: ${routing.concurrency}\n`);
          }
        });
      }),
  );

  cmd.addCommand(
    new Command('render')
      .description('Render agent prompt for a task')
      .argument('<id>', 'Task display ID')
      .option('--json', 'Output JSON with metadata')
      .option('--worktree <path>', 'Worktree path to include in prompt')
      .option('--verification', 'Render verification prompt instead')
      .action(async (id, opts) => {
        await withBrain(async (svc) => {
          const displayId = id.toUpperCase();
          const contextResult = assembleContext(svc.db, displayId);
          if (!contextResult.ok) {
            process.stderr.write(formatError(contextResult.error, !!opts.json) + '\n');
            process.exitCode = 1;
            return;
          }

          const bundle = contextResult.data;
          const renderOpts = { worktreePath: opts.worktree };

          const rendered = opts.verification
            ? renderVerificationPrompt(bundle, renderOpts)
            : renderAgentPrompt(bundle, renderOpts);

          if (opts.json) {
            const output = {
              taskId: displayId,
              contextHash: bundle.contextHash,
              prompt: rendered,
            };
            process.stdout.write(JSON.stringify(output, null, 2) + '\n');
          } else {
            process.stdout.write(rendered + '\n');
          }
        });
      }),
  );

  cmd.addCommand(
    new Command('worktree-alloc')
      .description('Allocate a worktree for a task')
      .argument('<id>', 'Task display ID')
      .option('--json', 'Output JSON')
      .action(async (id, opts) => {
        await withBrain(async (svc) => {
          const displayId = id.toUpperCase();
          const taskResult = getTask(svc.db, displayId);
          if (!taskResult.ok) {
            process.stderr.write(formatError(taskResult.error, !!opts.json) + '\n');
            process.exitCode = 1;
            return;
          }

          const task = taskResult.data;
          const workstream = `s${task.workstream}`;
          const claimToken = task.claim_token ?? randomUUID();

          const allocResult = allocateWorktree(svc.db, displayId, workstream, claimToken);
          if (!allocResult.ok) {
            process.stderr.write(formatError(allocResult.error, !!opts.json) + '\n');
            process.exitCode = 1;
            return;
          }

          if (opts.json) {
            process.stdout.write(JSON.stringify(allocResult.data, null, 2) + '\n');
          } else {
            process.stdout.write(`Allocated: ${allocResult.data.path}\n`);
            process.stdout.write(`Branch: ${allocResult.data.branch}\n`);
          }
        });
      }),
  );

  cmd.addCommand(
    new Command('worktree-check')
      .description('Validate CWD is inside expected worktree')
      .option('--path <path>', 'Path to validate (default: CWD)')
      .action(async (opts) => {
        const expectedWorktree = process.env.BRAIN_PM_WORKTREE;
        if (!expectedWorktree) {
          process.stderr.write('BRAIN_PM_WORKTREE not set\n');
          process.exitCode = 1;
          return;
        }

        const targetPath = opts.path ?? process.cwd();
        const result = checkWorktreePath(expectedWorktree, targetPath);

        if (result.ok) {
          process.exitCode = 0;
        } else {
          process.stderr.write(formatError(result.error, false) + '\n');
          process.exitCode = 1;
        }
      }),
  );

  cmd.addCommand(
    new Command('worktree-release')
      .description('Release worktree allocation for a task')
      .argument('<id>', 'Task display ID')
      .option('--json', 'Output JSON')
      .action(async (id, opts) => {
        await withBrain(async (svc) => {
          const displayId = id.toUpperCase();
          const result = releaseWorktree(svc.db, displayId);
          if (!result.ok) {
            process.stderr.write(formatError(result.error, !!opts.json) + '\n');
            process.exitCode = 1;
            return;
          }

          if (opts.json) {
            process.stdout.write(JSON.stringify({ taskId: displayId, ...result.data }, null, 2) + '\n');
          } else {
            if (result.data.released) {
              process.stdout.write(`Released worktree for ${displayId}\n`);
            } else {
              process.stdout.write(`No allocation found for ${displayId}\n`);
            }
          }
        });
      }),
  );

  cmd.addCommand(
    new Command('worktree-status')
      .description('Show worktree allocations and budget')
      .option('--json', 'Output JSON')
      .action(async (opts) => {
        await withBrain(async (svc) => {
          const budget = getBudget(svc.db);

          if (opts.json) {
            process.stdout.write(JSON.stringify(budget, null, 2) + '\n');
          } else {
            process.stdout.write(`Budget: ${budget.used}/${budget.max} (${budget.available} available)\n`);
            if (budget.allocations.length > 0) {
              for (const alloc of budget.allocations) {
                process.stdout.write(`  ${alloc.taskId}: ${alloc.path} (${alloc.branch})\n`);
              }
            }
          }
        });
      }),
  );

  cmd.addCommand(
    new Command('agent-done')
      .description('Record sub-agent completion (called by SubagentStop hook)')
      .action(async () => {
        await withBrain(async (svc) => {
          const input = await readStdin();
          const data = input.trim() ? (JSON.parse(input) as Record<string, unknown>) : {};

          const taskId = data.taskId as string | undefined;
          const sessionId = data.sessionId as string | undefined;
          const outcome = (data.outcome as string) ?? 'completed';

          const now = new Date().toISOString();
          svc.db.addActivity({
            id: randomUUID(),
            noteIds: taskId ? JSON.stringify([taskId]) : JSON.stringify([]),
            module: 'pm',
            moduleInstance: (data.project as string) ?? null,
            activityType: 'agent_done',
            actorType: 'agent',
            actorId: (data.agentId as string) ?? null,
            sessionId: sessionId ?? null,
            metadata: JSON.stringify(data),
            outcome,
            startedAt: (data.startedAt as string) ?? now,
            completedAt: now,
          });

          process.stdout.write(JSON.stringify({ recorded: true, taskId, outcome }) + '\n');
        });
      }),
  );

  cmd.addCommand(
    new Command('session-end')
      .description('End orchestration session and output summary')
      .option('--json', 'Output JSON')
      .action(async (opts) => {
        await withBrain(async (svc) => {
          const activeProject = getActiveProject(svc.db);
          if (!activeProject) {
            const output = { session: 'ended', project: null, summary: 'No active project' };
            process.stdout.write(JSON.stringify(output, null, 2) + '\n');
            return;
          }

          const budget = getBudget(svc.db);
          const tasksResult = listTasks(svc.db, activeProject);
          const allTasks = tasksResult.ok ? tasksResult.data : [];

          const done = allTasks.filter((t) => t.status === 'done');
          const inProgress = allTasks.filter((t) => t.status === 'in-progress');
          const pending = allTasks.filter((t) => t.status === 'pending');
          const blocked = allTasks.filter((t) => t.status === 'blocked');

          const summary = {
            session: 'ended',
            project: activeProject,
            tasks: {
              total: allTasks.length,
              done: done.length,
              inProgress: inProgress.length,
              pending: pending.length,
              blocked: blocked.length,
            },
            worktrees: {
              used: budget.used,
              max: budget.max,
              allocations: budget.allocations.map((a) => ({
                taskId: a.taskId,
                path: a.path,
              })),
            },
          };

          if (opts.json) {
            process.stdout.write(JSON.stringify(summary, null, 2) + '\n');
          } else {
            process.stdout.write(`=== Session End: ${activeProject} ===\n`);
            process.stdout.write(`Tasks: ${done.length} done, ${inProgress.length} in-progress, ${pending.length} pending, ${blocked.length} blocked (${allTasks.length} total)\n`);
            process.stdout.write(`Worktrees: ${budget.used}/${budget.max} in use\n`);
            if (budget.allocations.length > 0) {
              for (const a of budget.allocations) {
                process.stdout.write(`  ${a.taskId}: ${a.path}\n`);
              }
            }
          }
        });
      }),
  );

  return cmd as unknown as Command;
}
