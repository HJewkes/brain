import { Command } from '@commander-js/extra-typings';
import { withBrain, withDb } from '../../../services/brain-service.js';
import { BurndownOrchestrator } from '../../agents/burndown.js';
import { BackpressureController } from '../../agents/backpressure.js';
import { listTasks } from '../data/task-ops.js';
import { getActiveProject } from '../data/queries.js';
import { countActiveAgents } from '../../agents/data.js';
import { buildDashboard, formatDashboard } from '../../agents/burndown-dashboard.js';
import type { ActiveAgent, TickResult } from '../../agents/burndown.js';

function formatProgress(
  project: string,
  totalTasks: number,
  doneTasks: number,
  activeCount: number
): string {
  const pct = totalTasks > 0 ? Math.round((doneTasks / totalTasks) * 100) : 0;
  return `[${project}] ${doneTasks}/${totalTasks} done (${pct}%) | ${activeCount} agents active`;
}

function formatTickResult(result: TickResult): string {
  const lines: string[] = [];

  if (result.spawned.length > 0) {
    for (const agent of result.spawned) {
      lines.push(`  Spawned: ${agent.taskId} (${agent.routing.model}/${agent.routing.agentType})`);
    }
  }

  if (result.stalled.length > 0) {
    for (const s of result.stalled) {
      lines.push(`  Stalled: ${s.displayId} (${Math.round(s.lastCommitAge)}m since last commit)`);
    }
  }

  lines.push(
    `  Active: ${result.activeCount} | Slots: ${result.availableSlots} | WIP: ${result.effectiveWip}`
  );
  if (result.backpressureReason !== 'nominal') {
    lines.push(`  Backpressure: ${result.backpressureReason}`);
  }
  return lines.join('\n');
}

function formatDryRunAgent(agent: ActiveAgent): string {
  return (
    `  ${agent.taskId}: model=${agent.routing.model} ` +
    `agent=${agent.routing.agentType} isolation=${agent.routing.isolation}`
  );
}

export function createBurndownCommand(): Command {
  const cmd = new Command('burndown').description(
    'Burndown orchestrator — run and monitor task processing'
  );

  cmd
    .command('run')
    .description('Run burndown orchestrator to process task backlog')
    .option('--project <prefix>', 'Project prefix (defaults to active project)')
    .option('--wip-limit <n>', 'Max concurrent agents', '3')
    .option('--dry-run', 'Show what would be dispatched without spawning')
    .option('--once', 'Run a single tick then exit')
    .option('--interval <ms>', 'Tick interval in milliseconds', '60000')
    .option('--json', 'Output JSON')
    .action(async (opts) => {
      await withBrain(async (svc) => {
        const project = opts.project ?? getActiveProject(svc.db);
        if (!project) {
          process.stderr.write(
            'Error: No active project. Use --project or "brain pm use <prefix>"\n'
          );
          process.exitCode = 1;
          return;
        }

        const wipLimit = parseInt(opts.wipLimit, 10);
        const intervalMs = parseInt(opts.interval, 10);

        const tasksResult = listTasks(svc.db, project);
        const allTasks = tasksResult.ok ? tasksResult.data : [];
        const totalTasks = allTasks.length;
        const doneTasks = allTasks.filter((t) => t.status === 'done').length;

        if (opts.dryRun) {
          await runDryRun(svc, project, wipLimit, totalTasks, doneTasks, !!opts.json);
          return;
        }

        const backpressure = new BackpressureController(wipLimit);
        const orchestrator = new BurndownOrchestrator(
          svc.db,
          svc.config,
          svc.embedder,
          {
            maxWip: wipLimit,
            projectDir: process.cwd(),
          },
          backpressure
        );

        orchestrator.setSpawner(async (agent) => {
          if (!opts.json) {
            process.stdout.write(`Spawned: ${agent.taskId} (${agent.routing.model})\n`);
          }
        });

        orchestrator.setStallHandler(async (stalled) => {
          for (const s of stalled) {
            process.stderr.write(
              `Stalled: ${s.displayId} (${Math.round(s.lastCommitAge)}m idle)\n`
            );
          }
        });

        if (opts.once) {
          const result = await orchestrator.tick();
          outputTickResult(project, totalTasks, doneTasks, result, !!opts.json);
          return;
        }

        process.stdout.write(
          formatProgress(project, totalTasks, doneTasks, countActiveAgents(svc.db)) + '\n'
        );
        process.stdout.write(
          `Starting burndown loop (WIP=${wipLimit}, interval=${intervalMs}ms)\n`
        );

        orchestrator.start(intervalMs);

        await new Promise<void>((resolve) => {
          const shutdown = () => {
            orchestrator.stop();
            process.stdout.write('\nBurndown stopped.\n');
            resolve();
          };

          process.on('SIGINT', shutdown);
          process.on('SIGTERM', shutdown);
        });
      });
    });

  cmd
    .command('status')
    .description('Show burndown progress dashboard')
    .option('--project <prefix>', 'Project prefix (defaults to active project)')
    .option('--json', 'Output JSON')
    .action(async (opts) => {
      await withDb((svc) => {
        const data = buildDashboard(svc.db, process.cwd(), opts.project ?? undefined);
        if (!data) {
          process.stderr.write(
            'Error: No active project. Use --project or "brain pm use <prefix>"\n'
          );
          process.exitCode = 1;
          return;
        }

        if (opts.json) {
          process.stdout.write(JSON.stringify(data, null, 2) + '\n');
        } else {
          process.stdout.write(formatDashboard(data) + '\n');
        }
      });
    });

  cmd
    .command('launch')
    .description('Render coordinator prompt for Team/Agent pattern (replaces subprocess spawner)')
    .option('--project <prefix>', 'Project prefix (defaults to active project)')
    .option('--wip-limit <n>', 'Max concurrent agents', '4')
    .option('--team-name <name>', 'Team name for agent coordination', 'burndown')
    .option('--template <name>', 'Coordinator template name', 'coordinator')
    .option('--dry-run', 'Output coordinator prompt without launching')
    .option('--json', 'Output JSON')
    .action(async (opts) => {
      await withDb(async (svc) => {
        const project = opts.project ?? getActiveProject(svc.db);
        if (!project) {
          process.stderr.write(
            'Error: No active project. Use --project or "brain pm use <prefix>"\n'
          );
          process.exitCode = 1;
          return;
        }

        const { renderCoordinatorPrompt } = await import('../../agents/coordinator.js');

        const teamName = `${opts.teamName}-${project.toLowerCase()}`;
        const result = renderCoordinatorPrompt({
          projectDir: process.cwd(),
          teamName,
          wipLimit: parseInt(opts.wipLimit, 10),
          templateName: opts.template,
        });

        if (!result) {
          process.stderr.write(
            `Error: Template "${opts.template}" not found in templates/agents/\n`
          );
          process.exitCode = 1;
          return;
        }

        const tasksResult = listTasks(svc.db, project);
        const allTasks = tasksResult.ok ? tasksResult.data : [];
        const totalTasks = allTasks.length;
        const doneTasks = allTasks.filter((t) => t.status === 'done').length;

        if (opts.json) {
          process.stdout.write(
            JSON.stringify(
              {
                project,
                teamName,
                wipLimit: parseInt(opts.wipLimit, 10),
                totalTasks,
                doneTasks,
                dryRun: !!opts.dryRun,
                prompt: result.prompt,
              },
              null,
              2
            ) + '\n'
          );
          return;
        }

        if (opts.dryRun) {
          process.stdout.write(`Dry run — ${project}\n`);
          process.stdout.write(`Team: ${teamName}\n`);
          process.stdout.write(`WIP limit: ${opts.wipLimit}\n`);
          process.stdout.write(
            `Tasks: ${doneTasks}/${totalTasks} done\n\n`
          );
          process.stdout.write('--- Coordinator Prompt ---\n');
          process.stdout.write(result.prompt + '\n');
          return;
        }

        process.stdout.write(result.prompt);
      });
    });

  return cmd as unknown as Command;
}

async function runDryRun(
  svc: {
    db: import('../../../services/brain-db.js').BrainDB;
    config: import('../../../types.js').BrainConfig;
    embedder: import('../../../types.js').Embedder;
  },
  project: string,
  wipLimit: number,
  totalTasks: number,
  doneTasks: number,
  json: boolean
): Promise<void> {
  const backpressure = new BackpressureController(wipLimit);
  const orchestrator = new BurndownOrchestrator(
    svc.db,
    svc.config,
    svc.embedder,
    {
      maxWip: wipLimit,
      projectDir: process.cwd(),
    },
    backpressure
  );

  orchestrator.setSpawner(async () => {});

  const result = await orchestrator.tick();

  if (json) {
    process.stdout.write(
      JSON.stringify(
        {
          project,
          dryRun: true,
          totalTasks,
          doneTasks,
          wipLimit,
          wouldSpawn: result.spawned.map((a) => ({
            taskId: a.taskId,
            model: a.routing.model,
            agentType: a.routing.agentType,
            isolation: a.routing.isolation,
          })),
          stalled: result.stalled,
        },
        null,
        2
      ) + '\n'
    );
  } else {
    process.stdout.write(`Dry run — ${project}\n`);
    process.stdout.write(formatProgress(project, totalTasks, doneTasks, 0) + '\n');
    if (result.spawned.length === 0) {
      process.stdout.write('  No tasks eligible for dispatch.\n');
    } else {
      process.stdout.write('  Would dispatch:\n');
      for (const agent of result.spawned) {
        process.stdout.write(formatDryRunAgent(agent) + '\n');
      }
    }
    if (result.stalled.length > 0) {
      process.stdout.write('  Stalled tasks:\n');
      for (const s of result.stalled) {
        process.stdout.write(`    ${s.displayId}: ${Math.round(s.lastCommitAge)}m idle\n`);
      }
    }
  }
}

function outputTickResult(
  project: string,
  totalTasks: number,
  doneTasks: number,
  result: TickResult,
  json: boolean
): void {
  if (json) {
    process.stdout.write(
      JSON.stringify(
        {
          project,
          totalTasks,
          doneTasks,
          tick: {
            spawned: result.spawned.map((a) => ({
              taskId: a.taskId,
              model: a.routing.model,
              agentType: a.routing.agentType,
            })),
            stalled: result.stalled,
            activeCount: result.activeCount,
            availableSlots: result.availableSlots,
            effectiveWip: result.effectiveWip,
            backpressureReason: result.backpressureReason,
          },
        },
        null,
        2
      ) + '\n'
    );
  } else {
    process.stdout.write(formatProgress(project, totalTasks, doneTasks, result.activeCount) + '\n');
    process.stdout.write(formatTickResult(result) + '\n');
  }
}
