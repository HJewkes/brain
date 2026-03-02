import { Command } from '@commander-js/extra-typings';
import { withBrain } from '../../../services/brain-service.js';
import { formatError } from '../errors.js';
import {
  createWorkstream,
  listWorkstreams,
  getWorkstream,
  updateWorkstream,
  deleteWorkstream,
} from '../data/workstream-ops.js';
import { resolveProject } from '../data/queries.js';
import { listTasks } from '../data/task-ops.js';
import { parseDisplayId } from '../ids.js';
import { checkNamespaceMismatch } from '../engine/routing.js';

function outputResult(data: unknown, json: boolean): void {
  if (json) {
    process.stdout.write(JSON.stringify(data, null, 2) + '\n');
  } else if (Array.isArray(data)) {
    for (const item of data) {
      process.stdout.write(formatWorkstreamLine(item) + '\n');
    }
    if (data.length === 0) {
      process.stdout.write('No workstreams found.\n');
    }
  } else {
    process.stdout.write(formatWorkstreamLine(data) + '\n');
  }
}

function formatWorkstreamLine(ws: unknown): string {
  const w = ws as Record<string, unknown>;
  const rawTitle = (w.title as string) ?? '';
  const name = rawTitle.replace(/^Workstream\s+/i, '') || `#${w.number}`;
  return `${w.display_id} - ${name} (${w.status})`;
}

export function createWorkstreamCommands(): Command {
  const cmd = new Command('workstream').description('Manage workstreams');

  cmd
    .command('add')
    .description('Create a new workstream')
    .argument('<name>', 'Workstream name')
    .option('--project <prefix>', 'Project prefix (uses active if omitted)')
    .option('--description <desc>', 'Workstream description')
    .option('--json', 'Output JSON')
    .action(async (name, opts) => {
      await withBrain(async (svc) => {
        const projectResult = resolveProject(svc.db, opts.project);
        if (!projectResult.ok) {
          process.stderr.write(formatError(projectResult.error, !!opts.json) + '\n');
          process.exitCode = 1;
          return;
        }
        const project = projectResult.data;
        const result = await createWorkstream(svc.db, svc.config, svc.embedder, {
          project,
          name,
          description: opts.description,
        });
        if (!result.ok) {
          process.stderr.write(formatError(result.error, !!opts.json) + '\n');
          process.exitCode = 1;
          return;
        }
        if (opts.json) {
          process.stdout.write(JSON.stringify(result.data, null, 2) + '\n');
        } else {
          const ws = result.data;
          const displayName = ws.title?.replace(/^Workstream\s+/i, '') || name;
          process.stdout.write(`Created ${ws.display_id} - ${displayName} (${ws.status})\n`);
        }
      });
    });

  cmd
    .command('list')
    .description('List workstreams')
    .argument('[prefix]', 'Project prefix (uses active project if omitted)')
    .option('--project <prefix>', 'Filter by project prefix')
    .option('--json', 'Output JSON')
    .action(async (prefix, opts) => {
      await withBrain(async (svc) => {
        const projectResult = resolveProject(svc.db, prefix ?? opts.project);
        if (!projectResult.ok) {
          process.stderr.write(formatError(projectResult.error, !!opts.json) + '\n');
          process.exitCode = 1;
          return;
        }
        const result = listWorkstreams(svc.db, projectResult.data);
        if (!result.ok) {
          process.stderr.write(formatError(result.error, !!opts.json) + '\n');
          process.exitCode = 1;
          return;
        }
        outputResult(result.data, !!opts.json);
      });
    });

  cmd
    .command('show')
    .description('Show workstream detail')
    .argument('<id>', 'Workstream display ID (e.g. WEB-01)')
    .option('--json', 'Output JSON')
    .action(async (id, opts) => {
      await withBrain(async (svc) => {
        const redirectMsg = checkNamespaceMismatch(id.toUpperCase(), 'workstream');
        if (redirectMsg) {
          process.stderr.write(`Error: ${redirectMsg}\n`);
          process.exitCode = 1;
          return;
        }
        const result = getWorkstream(svc.db, id.toUpperCase());
        if (!result.ok) {
          process.stderr.write(formatError(result.error, !!opts.json) + '\n');
          process.exitCode = 1;
          return;
        }
        const wsMeta = result.data;
        const parsed = parseDisplayId(id.toUpperCase());
        const prefix = parsed?.prefix ?? wsMeta.project;
        const wsNumber = parsed?.workstream ?? wsMeta.number;

        const tasksResult = listTasks(svc.db, prefix, { workstream: wsNumber });
        const taskList = tasksResult.ok ? tasksResult.data : [];

        const byStatus: Record<string, number> = {};
        const byPriority: Record<string, number> = {};
        for (const t of taskList) {
          byStatus[t.status] = (byStatus[t.status] ?? 0) + 1;
          byPriority[t.priority] = (byPriority[t.priority] ?? 0) + 1;
        }

        const PRIORITY_ORDER: Record<string, number> = {
          critical: 0, high: 1, medium: 2, low: 3,
        };
        const eligible = taskList
          .filter(t => t.virtualStates.includes('+ELIGIBLE'))
          .sort((a, b) =>
            (PRIORITY_ORDER[a.priority] ?? 9) - (PRIORITY_ORDER[b.priority] ?? 9)
          )
          .slice(0, 3);

        if (opts.json) {
          const jsonData = {
            ...wsMeta,
            taskSummary: {
              total: taskList.length,
              byStatus,
              byPriority,
            },
            eligibleTasks: eligible.map(t => ({
              display_id: t.display_id,
              title: t.title,
              priority: t.priority,
              status: t.status,
            })),
          };
          process.stdout.write(JSON.stringify(jsonData, null, 2) + '\n');
        } else {
          const lines: string[] = [];
          const name = wsMeta.title?.replace(/^Workstream\s+/i, '') || `#${wsMeta.number}`;
          lines.push(`${wsMeta.display_id} - ${name} (${wsMeta.status})`);

          if (wsMeta.description) {
            lines.push(`  ${wsMeta.description}`);
          }

          if (taskList.length > 0) {
            lines.push('');
            lines.push('Tasks:');
            for (const [status, count] of Object.entries(byStatus)) {
              lines.push(`  ${status}: ${count}`);
            }
            lines.push('');
            lines.push('Priority:');
            for (const [priority, count] of Object.entries(byPriority)) {
              lines.push(`  ${priority}: ${count}`);
            }
          }

          if (eligible.length > 0) {
            lines.push('');
            lines.push('Eligible:');
            for (const t of eligible) {
              lines.push(`  ${t.display_id} - ${t.title ?? '(untitled)'} [${t.priority}]`);
            }
          }

          process.stdout.write(lines.join('\n') + '\n');
        }
      });
    });

  cmd
    .command('update')
    .description('Update a workstream')
    .argument('<id>', 'Workstream display ID')
    .option('--status <status>', 'New status')
    .option('--json', 'Output JSON')
    .action(async (id, opts) => {
      await withBrain(async (svc) => {
        const updates: Record<string, unknown> = {};
        if (opts.status) updates.status = opts.status;

        const result = await updateWorkstream(
          svc.db,
          svc.config,
          svc.embedder,
          id.toUpperCase(),
          updates
        );
        if (!result.ok) {
          process.stderr.write(formatError(result.error, !!opts.json) + '\n');
          process.exitCode = 1;
          return;
        }
        outputResult(result.data, !!opts.json);
      });
    });

  cmd
    .command('delete')
    .description('Delete a workstream')
    .argument('<id>', 'Workstream display ID')
    .option('--force', 'Force delete even with tasks')
    .option('--json', 'Output JSON')
    .action(async (id, opts) => {
      await withBrain(async (svc) => {
        const result = await deleteWorkstream(svc.db, svc.config, id.toUpperCase(), opts.force);
        if (!result.ok) {
          process.stderr.write(formatError(result.error, !!opts.json) + '\n');
          process.exitCode = 1;
          return;
        }
        if (opts.json) {
          process.stdout.write(JSON.stringify({ deleted: true, id: id.toUpperCase() }) + '\n');
        } else {
          process.stdout.write(`Deleted workstream ${id.toUpperCase()}\n`);
        }
      });
    });

  return cmd;
}
