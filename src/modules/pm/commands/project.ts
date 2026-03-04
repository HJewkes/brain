import { Command } from '@commander-js/extra-typings';
import { existsSync, readFileSync } from 'node:fs';
import type { BrainDB } from '../../../services/brain-db.js';
import { withBrain } from '../../../services/brain-service.js';
import { formatError } from '../errors.js';
import {
  createProject,
  listProjects,
  getProject,
  updateProject,
  deleteProject,
} from '../data/project-ops.js';
import { setActiveProject, resolveProject, getPmNotes } from '../data/queries.js';
import { listTasks } from '../data/task-ops.js';
import { listWorkstreams } from '../data/workstream-ops.js';
import { projectDeleteWithActivity } from './activity.js';

function outputResult(data: unknown, json: boolean): void {
  if (json) {
    process.stdout.write(JSON.stringify(data, null, 2) + '\n');
  } else if (Array.isArray(data)) {
    for (const item of data) {
      process.stdout.write(formatProjectLine(item) + '\n');
    }
    if (data.length === 0) {
      process.stdout.write('No projects found.\n');
    }
  } else {
    process.stdout.write(formatProjectLine(data) + '\n');
  }
}

function formatProjectLine(project: unknown): string {
  const p = project as Record<string, unknown>;
  const rawTitle = (p.title as string) ?? '';
  const name = rawTitle.replace(/^Project\s+/i, '') || p.prefix;
  const status = p.status ?? 'unknown';
  const phase = p.phase ? ` [${p.phase}]` : '';
  return `${p.prefix} - ${name}${phase} (${status})`;
}

function extractProjectDescription(db: BrainDB, prefix: string): string | undefined {
  const notes = getPmNotes(db, 'project', { prefix });
  if (notes.length === 0) return undefined;

  const filePath = notes[0].filePath;
  if (!existsSync(filePath)) return undefined;

  const content = readFileSync(filePath, 'utf-8');
  const fmEnd = content.indexOf('\n---', 4);
  if (fmEnd === -1) return undefined;

  const afterFm = content.slice(fmEnd + 4).trim();
  const lines = afterFm.split('\n');
  const headingIdx = lines.findIndex((l) => l.startsWith('# '));
  if (headingIdx === -1) return undefined;

  const descLines: string[] = [];
  for (let i = headingIdx + 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line === '' && descLines.length > 0) break;
    if (line === '') continue;
    descLines.push(line);
  }

  return descLines.length > 0 ? descLines.join(' ') : undefined;
}

export function createProjectCommands(): Command {
  const cmd = new Command('project').description('Manage projects');

  cmd
    .command('update')
    .description('Update a project')
    .argument('<prefix>', 'Project prefix')
    .option('--status <status>', 'New status')
    .option('--phase <phase>', 'New phase')
    .option('--wip-limit <n>', 'New WIP limit', parseInt)
    .option('--json', 'Output JSON')
    .action(async (prefix, opts) => {
      await withBrain(async (svc) => {
        const updates: Record<string, unknown> = {};
        if (opts.status) updates.status = opts.status;
        if (opts.phase) updates.phase = opts.phase;
        if (opts.wipLimit !== undefined) updates.wip_limit = opts.wipLimit;

        const result = await updateProject(
          svc.db,
          svc.config,
          svc.embedder,
          prefix.toUpperCase(),
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
    .description('Delete a project and all its notes')
    .argument('<prefix>', 'Project prefix to delete')
    .option('--confirm', 'Confirm deletion (required)')
    .option('--all', 'Delete all notes under prefix, not just activity-tracked ones')
    .option('--force', 'Force delete even with dependent notes (legacy)')
    .option('--json', 'Output JSON')
    .action(async (prefix, opts) => {
      await withBrain(async (svc) => {
        const upper = prefix.toUpperCase();

        // Legacy path: no --confirm flag uses old deleteProject behavior
        if (!opts.confirm) {
          const result = await deleteProject(svc.db, svc.config, upper, opts.force);
          if (!result.ok) {
            process.stderr.write(formatError(result.error, !!opts.json) + '\n');
            process.exitCode = 1;
            return;
          }
          if (opts.json) {
            process.stdout.write(JSON.stringify({ deleted: true, prefix: upper }) + '\n');
          } else {
            process.stdout.write(`Deleted project ${upper}\n`);
          }
          return;
        }

        // Activity-aware delete path with --confirm
        const result = projectDeleteWithActivity(svc.db, svc.config, upper, {
          confirm: true,
          all: opts.all,
        });

        if (!result.ok) {
          process.stderr.write(formatError(result.error, !!opts.json) + '\n');
          process.exitCode = 1;
          return;
        }

        if (opts.json) {
          process.stdout.write(
            JSON.stringify(
              {
                deleted: true,
                prefix: upper,
                deletedCount: result.data.deletedCount,
                untrackedCount: result.data.untrackedCount,
              },
              null,
              2
            ) + '\n'
          );
        } else {
          process.stdout.write(
            `Deleted project ${upper} (${result.data.deletedCount} notes removed)\n`
          );
          if (result.data.untrackedCount > 0) {
            process.stderr.write(
              `Warning: ${result.data.untrackedCount} note(s) were not in activity lineage\n`
            );
          }
        }
      });
    });

  cmd
    .command('show')
    .description('Show project details')
    .argument('<prefix>', 'Project prefix')
    .option('--json', 'Output JSON')
    .action(async (prefix, opts) => {
      await withBrain(async (svc) => {
        const resolved = resolveProject(svc.db, prefix);
        if (!resolved.ok) {
          process.stderr.write(formatError(resolved.error, !!opts.json) + '\n');
          process.exitCode = 1;
          return;
        }

        const targetPrefix = resolved.data;
        const result = getProject(svc.db, targetPrefix);
        if (!result.ok) {
          process.stderr.write(formatError(result.error, !!opts.json) + '\n');
          process.exitCode = 1;
          return;
        }

        const p = result.data;
        const tasksResult = listTasks(svc.db, targetPrefix);
        const tasks = tasksResult.ok ? tasksResult.data : [];
        const wsResult = listWorkstreams(svc.db, targetPrefix);
        const workstreams = wsResult.ok ? wsResult.data : [];

        const description = extractProjectDescription(svc.db, targetPrefix);

        const taskCounts = {
          total: tasks.length,
          pending: tasks.filter((t) => t.status === 'pending').length,
          claimed: tasks.filter((t) => t.status === 'claimed').length,
          inProgress: tasks.filter((t) => t.status === 'in-progress').length,
          done: tasks.filter((t) => t.status === 'done').length,
          blocked: tasks.filter((t) => t.status === 'blocked').length,
        };

        if (opts.json) {
          const rawTitle = p.title ?? '';
          const name = rawTitle.replace(/^Project\s+/i, '') || p.prefix;
          const jsonOut = {
            prefix: p.prefix,
            name,
            status: p.status,
            phase: p.phase ?? null,
            description: description ?? null,
            workstreams: workstreams.map((w) => ({
              displayId: w.display_id,
              name: (w.title ?? '').replace(/^Workstream\s+/i, '') || w.display_id,
              status: w.status,
            })),
            taskCounts,
          };
          process.stdout.write(JSON.stringify(jsonOut, null, 2) + '\n');
          return;
        }

        const lines: string[] = [];
        lines.push(formatProjectLine(p));

        if (description) {
          lines.push(`  ${description}`);
        }

        const activeWs = workstreams.filter((w) => w.status === 'active').length;
        const wsStatus = activeWs === workstreams.length ? 'all active' : `${activeWs} active`;
        lines.push(`  Workstreams: ${workstreams.length} (${wsStatus})`);

        const pending = taskCounts.pending;
        const inProgress = taskCounts.inProgress;
        const done = taskCounts.done;
        const blocked = taskCounts.blocked;
        lines.push(
          `  Tasks: ${tasks.length} (${pending} pending, ${inProgress} in-progress, ${done} done${blocked > 0 ? `, ${blocked} blocked` : ''})`
        );

        process.stdout.write(lines.join('\n') + '\n');
      });
    });

  cmd
    .command('list')
    .description('List all projects')
    .option('--json', 'Output JSON')
    .action(async (opts) => {
      await withBrain(async (svc) => {
        const result = listProjects(svc.db);
        if (!result.ok) {
          process.stderr.write(formatError(result.error, !!opts.json) + '\n');
          process.exitCode = 1;
          return;
        }

        if (opts.json) {
          const jsonOut = result.data.map((p) => {
            const rawTitle = p.title ?? '';
            const name = rawTitle.replace(/^Project\s+/i, '') || p.prefix;
            return { prefix: p.prefix, name, status: p.status, phase: p.phase ?? null };
          });
          process.stdout.write(JSON.stringify(jsonOut, null, 2) + '\n');
          return;
        }

        outputResult(result.data, false);
      });
    });

  return cmd;
}

export function createPmCommand(): Command {
  const pm = new Command('pm').description('Project management');

  pm.command('init')
    .description('Initialize a new project')
    .argument('<name>', 'Project name')
    .requiredOption('--prefix <prefix>', 'Project prefix (2-5 uppercase chars)')
    .option('--phase <phase>', 'Initial phase')
    .option('--wip-limit <n>', 'WIP limit', parseInt)
    .option('--json', 'Output JSON')
    .action(async (name, opts) => {
      await withBrain(async (svc) => {
        const result = await createProject(svc.db, svc.config, svc.embedder, {
          name,
          prefix: opts.prefix,
          phase: opts.phase,
          wipLimit: opts.wipLimit,
        });
        if (!result.ok) {
          process.stderr.write(formatError(result.error, !!opts.json) + '\n');
          process.exitCode = 1;
          return;
        }

        const prefix = result.data.prefix;
        setActiveProject(svc.db, prefix);

        if (opts.json) {
          process.stdout.write(JSON.stringify(result.data, null, 2) + '\n');
        } else {
          process.stdout.write(`Created project "${name}" (${prefix}) — active\n`);
        }
      });
    });

  pm.command('list')
    .description('List all projects')
    .option('--json', 'Output JSON')
    .action(async (opts) => {
      await withBrain(async (svc) => {
        const result = listProjects(svc.db);
        if (!result.ok) {
          process.stderr.write(formatError(result.error, !!opts.json) + '\n');
          process.exitCode = 1;
          return;
        }
        outputResult(result.data, !!opts.json);
      });
    });

  pm.command('status')
    .description('Show project status')
    .argument('[prefix]', 'Project prefix (uses active project if omitted)')
    .option('--json', 'Output JSON')
    .action(async (prefix, opts) => {
      await withBrain(async (svc) => {
        const projectResult = resolveProject(svc.db, prefix?.toUpperCase());
        if (!projectResult.ok) {
          process.stderr.write(formatError(projectResult.error, !!opts.json) + '\n');
          process.exitCode = 1;
          return;
        }
        const targetPrefix = projectResult.data;

        const result = getProject(svc.db, targetPrefix);
        if (!result.ok) {
          process.stderr.write(formatError(result.error, !!opts.json) + '\n');
          process.exitCode = 1;
          return;
        }

        const tasksResult = listTasks(svc.db, targetPrefix);
        const tasks = tasksResult.ok ? tasksResult.data : [];
        const wsResult = listWorkstreams(svc.db, targetPrefix);
        const workstreams = wsResult.ok ? wsResult.data : [];

        if (opts.json) {
          const enriched = {
            ...result.data,
            taskCounts: {
              total: tasks.length,
              pending: tasks.filter((t) => t.status === 'pending').length,
              claimed: tasks.filter((t) => t.status === 'claimed').length,
              inProgress: tasks.filter((t) => t.status === 'in-progress').length,
              done: tasks.filter((t) => t.status === 'done').length,
              blocked: tasks.filter((t) => t.status === 'blocked').length,
            },
            workstreamCount: workstreams.length,
          };
          process.stdout.write(JSON.stringify(enriched, null, 2) + '\n');
          return;
        }

        const p = result.data;
        const lines: string[] = [];
        lines.push(formatProjectLine(p));

        const activeWs = workstreams.filter((w) => w.status === 'active').length;
        const wsStatus = activeWs === workstreams.length ? 'all active' : `${activeWs} active`;
        lines.push(`  Workstreams: ${workstreams.length} (${wsStatus})`);

        const pending = tasks.filter((t) => t.status === 'pending').length;
        const inProgress = tasks.filter((t) => t.status === 'in-progress').length;
        const done = tasks.filter((t) => t.status === 'done').length;
        const blocked = tasks.filter((t) => t.status === 'blocked').length;
        lines.push(
          `  Tasks: ${tasks.length} (${pending} pending, ${inProgress} in-progress, ${done} done${blocked > 0 ? `, ${blocked} blocked` : ''})`
        );

        const critical = tasks.filter((t) => t.priority === 'critical').length;
        const high = tasks.filter((t) => t.priority === 'high').length;
        const medium = tasks.filter((t) => t.priority === 'medium').length;
        const low = tasks.filter((t) => t.priority === 'low').length;
        lines.push(`  Priority: ${critical} critical, ${high} high, ${medium} medium, ${low} low`);

        process.stdout.write(lines.join('\n') + '\n');
      });
    });

  pm.command('use')
    .description('Set active project context')
    .argument('<prefix>', 'Project prefix')
    .action(async (prefix) => {
      await withBrain(async (svc) => {
        const upper = prefix.toUpperCase();
        const result = getProject(svc.db, upper);
        if (!result.ok) {
          process.stderr.write(formatError(result.error, false) + '\n');
          process.exitCode = 1;
          return;
        }
        setActiveProject(svc.db, upper);
        process.stdout.write(`Active project set to ${upper}\n`);
      });
    });

  pm.addCommand(createProjectCommands());

  return pm;
}
