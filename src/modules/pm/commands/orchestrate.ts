import { randomUUID } from 'node:crypto';
import { execSync } from 'node:child_process';
import { Command } from '@commander-js/extra-typings';
import { withBrain } from '../../../services/brain-service.js';
import { formatError } from '../errors.js';
import { getActiveProject } from '../data/queries.js';
import { getTask, listTasks } from '../data/task-ops.js';
import { computeRouting } from '../engine/routing.js';
import { renderAgentPrompt, renderVerificationPrompt } from '../engine/template.js';
import { assembleContext } from '../engine/dispatch.js';
import { isValidTaskCategory, isValidTaskMode } from '../types.js';

function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    process.stdin.on('data', (chunk: Buffer) => chunks.push(chunk));
    process.stdin.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    if (process.stdin.isTTY) resolve('');
  });
}

const CHEAT_SHEET = `
## brain pm — Quick Reference

brain pm list                              # List projects
brain pm status [--json]                   # Project status summary
brain pm briefing [--full] [--json]        # Current state briefing

brain pm task list [--status <s>] [--workstream <n|PROJ-NN>] [--category <c>] [--priority <p>] [--json]
brain pm task add "<title>" --workstream <n|PROJ-NN> --project <PREFIX> --category <cat> --priority <pri> [--description "<desc>"] [--depends-on <id>]
brain pm task show <PROJ-WS.TT> [--json]
brain pm task claim <PROJ-WS.TT>
brain pm task start <PROJ-WS.TT> --token <token>
brain pm task done <PROJ-WS.TT>

brain pm workstream list [--project <PREFIX>] [--json]
brain pm workstream add --project <PREFIX> "<name>" [--description "<desc>"]
brain pm workstream show <PROJ-NN> [--json]

brain pm waves [--json]                    # Dependency-ordered task waves
brain pm next [--json]                     # Next eligible tasks
brain pm context <PROJ-WS.TT> [--json]    # Task context bundle
brain pm dispatch <PROJ-WS.TT> [--json]   # Agent dispatch brief
brain pm audit [--json]                    # Data quality audit
brain pm check [--deep] [--json]           # Consistency checks

brain pm onboard <name> [--prefix <PFX>] [--cwd <path>] [--skip-ingest] [--reset] [--json]
brain pm onboard status [<prefix>] [--json]

Statuses: pending, claimed, in-progress, done
Virtual states (computed): blocked, ready, eligible
Categories: bug, feature, improvement, research, documentation, testing, design, infrastructure, refactor
Priorities: critical, high, medium, low
`;

export function createOrchestrateCommands(): Command {
  const cmd = new Command('orchestrate').description(
    'Orchestration layer commands (used by hooks and skill)'
  );

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
                {
                  error: true,
                  code: 'INVALID_INPUT',
                  message: 'No active project set. Use "brain pm use <prefix>" first.',
                },
                true
              ) + '\n'
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

          // Append command cheat sheet for agent context
          process.stdout.write(CHEAT_SHEET);
        });
      })
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
          if (!isValidTaskCategory(task.category)) {
            const err = {
              error: true as const,
              code: 'INVALID_INPUT' as const,
              message: `Invalid task category "${task.category}"`,
            };
            process.stderr.write(formatError(err, !!opts.json) + '\n');
            process.exitCode = 1;
            return;
          }
          if (!isValidTaskMode(task.mode)) {
            const err = {
              error: true as const,
              code: 'INVALID_INPUT' as const,
              message: `Invalid task mode "${task.mode}"`,
            };
            process.stderr.write(formatError(err, !!opts.json) + '\n');
            process.exitCode = 1;
            return;
          }
          const routing = computeRouting(task.category, task.mode);

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
      })
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
      })
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
      })
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

          let worktreeInfo = {
            used: 0,
            max: 0,
            allocations: [] as Array<{ taskId: string; path: string }>,
          };
          try {
            const raw = execSync('ao worktree status --json', {
              encoding: 'utf-8',
              timeout: 5000,
            });
            const parsed = JSON.parse(raw) as Record<string, unknown>;
            const allocs = Array.isArray(parsed.allocations)
              ? (parsed.allocations as Array<{ taskId: string; path: string }>)
              : [];
            worktreeInfo = {
              used: typeof parsed.used === 'number' ? parsed.used : allocs.length,
              max:
                typeof parsed.max === 'number'
                  ? parsed.max
                  : typeof parsed.budget === 'number'
                    ? (parsed.budget as number)
                    : 0,
              allocations: allocs,
            };
          } catch {
            // ao-cli not available or no worktrees — graceful degradation
          }

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
              used: worktreeInfo.used,
              max: worktreeInfo.max,
              allocations: worktreeInfo.allocations.map((a) => ({
                taskId: a.taskId,
                path: a.path,
              })),
            },
          };

          if (opts.json) {
            process.stdout.write(JSON.stringify(summary, null, 2) + '\n');
          } else {
            process.stdout.write(`=== Session End: ${activeProject} ===\n`);
            process.stdout.write(
              `Tasks: ${done.length} done, ${inProgress.length} in-progress, ${pending.length} pending, ${blocked.length} blocked (${allTasks.length} total)\n`
            );
            process.stdout.write(
              `Worktrees: ${worktreeInfo.used}/${worktreeInfo.max} in use\n`
            );
            if (worktreeInfo.allocations.length > 0) {
              for (const a of worktreeInfo.allocations) {
                process.stdout.write(`  ${a.taskId}: ${a.path}\n`);
              }
            }
          }
        });
      })
  );

  return cmd as unknown as Command;
}
