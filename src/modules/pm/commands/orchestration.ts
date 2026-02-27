import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Command } from '@commander-js/extra-typings';
import { withBrain } from '../../../services/brain-service.js';
import { formatError } from '../errors.js';
import { getActiveProject, getPmNotes } from '../data/queries.js';
import { getTask, updateTaskStatus } from '../data/task-ops.js';
import { computeEligible, computeWaves, computeImpact } from '../engine/dependency.js';
import { assembleContext } from '../engine/dispatch.js';
import { validateClaimToken } from '../engine/claims.js';
import type { TaskStatus } from '../types.js';

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

  const dispatchCmd = new Command('dispatch')
    .description('Assemble and output context bundle for a task')
    .argument('<id>', 'Task display ID')
    .option('--json', 'Output JSON')
    .action(async (id, opts) => {
      await withBrain(async (svc) => {
        const displayId = id.toUpperCase();
        const result = assembleContext(svc.db, displayId);

        if (!result.ok) {
          process.stderr.write(
            formatError(result.error, !!opts.json) + '\n',
          );
          process.exitCode = 1;
          return;
        }

        const bundle = result.data;
        if (opts.json) {
          process.stdout.write(JSON.stringify(bundle, null, 2) + '\n');
          return;
        }

        process.stdout.write(`Task: ${bundle.task.display_id}\n`);
        process.stdout.write(`Status: ${bundle.task.status}\n`);
        if (bundle.prompt) {
          process.stdout.write(`Prompt: ${bundle.prompt}\n`);
        }
        if (bundle.dependencies.length > 0) {
          process.stdout.write(`Dependencies: ${bundle.dependencies.map((d) => d.displayId).join(', ')}\n`);
        }
        if (bundle.decisions.length > 0) {
          process.stdout.write(`Decisions: ${bundle.decisions.map((d) => d.displayId).join(', ')}\n`);
        }
        process.stdout.write(`Context hash: ${bundle.contextHash}\n`);
      });
    });

  const completeCmd = new Command('complete')
    .description('Mark task done, record activity, run impact analysis')
    .argument('<id>', 'Task display ID')
    .option('--token <token>', 'Claim token to validate')
    .option('--summary <text>', 'Completion summary')
    .option('--json', 'Output JSON')
    .action(async (id, opts) => {
      await withBrain(async (svc) => {
        const displayId = id.toUpperCase();

        const taskResult = getTask(svc.db, displayId);
        if (!taskResult.ok) {
          process.stderr.write(
            formatError(taskResult.error, !!opts.json) + '\n',
          );
          process.exitCode = 1;
          return;
        }

        if (opts.token) {
          const storedToken = taskResult.data.claim_token;
          if (!storedToken) {
            process.stderr.write(
              formatError(
                { error: true, code: 'INVALID_CLAIM_TOKEN', message: 'Task has no active claim' },
                !!opts.json,
              ) + '\n',
            );
            process.exitCode = 1;
            return;
          }
          const tokenCheck = validateClaimToken(storedToken, opts.token);
          if (!tokenCheck.ok) {
            process.stderr.write(formatError(tokenCheck.error, !!opts.json) + '\n');
            process.exitCode = 1;
            return;
          }
        }

        const statusResult = await updateTaskStatus(
          svc.db, svc.config, svc.embedder,
          displayId, 'done' as TaskStatus,
        );
        if (!statusResult.ok) {
          process.stderr.write(formatError(statusResult.error, !!opts.json) + '\n');
          process.exitCode = 1;
          return;
        }

        if (opts.summary) {
          const notes = getPmNotes(svc.db, 'task', { display_id: displayId });
          if (notes.length > 0 && notes[0].contentDir) {
            const contentDir = notes[0].contentDir;
            if (!existsSync(contentDir)) {
              mkdirSync(contentDir, { recursive: true });
            }
            writeFileSync(join(contentDir, 'summary.md'), opts.summary, 'utf-8');
          }
        }

        const now = new Date().toISOString();
        svc.db.addActivity({
          id: randomUUID(),
          noteIds: JSON.stringify([displayId]),
          module: 'pm',
          moduleInstance: taskResult.data.project,
          activityType: 'task_completed',
          actorType: 'cli',
          actorId: null,
          sessionId: null,
          metadata: JSON.stringify({ display_id: displayId }),
          outcome: 'done',
          startedAt: now,
          completedAt: now,
        });

        const impact = computeImpact(svc.db, taskResult.data.project, displayId);

        const output = {
          ...statusResult.data,
          newlyEligible: impact,
        };

        if (opts.json) {
          process.stdout.write(JSON.stringify(output, null, 2) + '\n');
        } else {
          process.stdout.write(`Completed ${displayId}\n`);
          if (impact.length > 0) {
            process.stdout.write(`Newly eligible: ${impact.join(', ')}\n`);
          }
        }
      });
    });

  return [nextCmd, wavesCmd, dispatchCmd, completeCmd] as Command[];
}
