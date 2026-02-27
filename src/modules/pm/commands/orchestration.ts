import { Command } from '@commander-js/extra-typings';
import { withBrain } from '../../../services/brain-service.js';
import { formatError } from '../errors.js';
import { getActiveProject } from '../data/queries.js';
import { getTask } from '../data/task-ops.js';
import { computeEligible, computeWaves } from '../engine/dependency.js';

function resolvePrefix(
  explicitProject: string | undefined,
  activeProject: string | null,
): string | null {
  if (explicitProject) return explicitProject.toUpperCase();
  return activeProject;
}

export function createOrchestrationCommands(): Command[] {
  const nextCmd = new Command('next')
    .description('Show eligible tasks (pending with all deps done)')
    .option('--project <prefix>', 'Project prefix (uses active project if omitted)')
    .option('--json', 'Output JSON')
    .action(async (opts) => {
      await withBrain(async (svc) => {
        const prefix = resolvePrefix(opts.project, getActiveProject(svc.db));
        if (!prefix) {
          const msg = 'No project specified and no active project set. Use "brain pm use <prefix>" first.';
          process.stderr.write(
            formatError({ error: true, code: 'INVALID_INPUT', message: msg }, !!opts.json) + '\n',
          );
          process.exitCode = 1;
          return;
        }

        const eligibleIds = computeEligible(svc.db, prefix);

        if (opts.json) {
          const tasks = eligibleIds.map((id) => {
            const result = getTask(svc.db, id);
            if (!result.ok) return { display_id: id };
            return {
              display_id: result.data.display_id,
              name: result.data.display_id,
              priority: result.data.priority,
              virtualStates: result.data.virtualStates,
            };
          });
          process.stdout.write(JSON.stringify(tasks, null, 2) + '\n');
          return;
        }

        if (eligibleIds.length === 0) {
          process.stdout.write('No eligible tasks.\n');
          return;
        }

        for (const id of eligibleIds) {
          const result = getTask(svc.db, id);
          if (!result.ok) {
            process.stdout.write(`${id}\n`);
            continue;
          }
          const t = result.data;
          const vs = t.virtualStates.length > 0 ? ` ${t.virtualStates.join(' ')}` : '';
          process.stdout.write(`${t.display_id}  ${t.priority}${vs}\n`);
        }
      });
    });

  const wavesCmd = new Command('waves')
    .description('Show topological wave grouping of remaining tasks')
    .option('--project <prefix>', 'Project prefix (uses active project if omitted)')
    .option('--json', 'Output JSON')
    .action(async (opts) => {
      await withBrain(async (svc) => {
        const prefix = resolvePrefix(opts.project, getActiveProject(svc.db));
        if (!prefix) {
          const msg = 'No project specified and no active project set. Use "brain pm use <prefix>" first.';
          process.stderr.write(
            formatError({ error: true, code: 'INVALID_INPUT', message: msg }, !!opts.json) + '\n',
          );
          process.exitCode = 1;
          return;
        }

        const waves = computeWaves(svc.db, prefix);

        if (opts.json) {
          const result = waves.map((w) => ({
            wave: w.wave,
            tasks: w.taskIds.map((id) => {
              const r = getTask(svc.db, id);
              if (!r.ok) return { display_id: id, name: id, status: 'unknown' };
              return {
                display_id: r.data.display_id,
                name: r.data.display_id,
                status: r.data.status,
              };
            }),
          }));
          process.stdout.write(JSON.stringify(result, null, 2) + '\n');
          return;
        }

        if (waves.length === 0) {
          process.stdout.write('No active tasks.\n');
          return;
        }

        for (const w of waves) {
          process.stdout.write(`Wave ${w.wave}: ${w.taskIds.join(', ')}\n`);
        }
      });
    });

  return [nextCmd, wavesCmd];
}
