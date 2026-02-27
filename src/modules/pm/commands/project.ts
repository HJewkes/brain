import { Command } from '@commander-js/extra-typings';
import { withBrain } from '../../../services/brain-service.js';
import { formatError } from '../errors.js';
import {
  createProject,
  listProjects,
  getProject,
  updateProject,
  deleteProject,
} from '../data/project-ops.js';
import { getActiveProject, setActiveProject } from '../data/queries.js';

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
    .description('Delete a project')
    .argument('<prefix>', 'Project prefix')
    .option('--force', 'Force delete even with dependent notes')
    .option('--json', 'Output JSON')
    .action(async (prefix, opts) => {
      await withBrain(async (svc) => {
        const result = await deleteProject(svc.db, svc.config, prefix.toUpperCase(), opts.force);
        if (!result.ok) {
          process.stderr.write(formatError(result.error, !!opts.json) + '\n');
          process.exitCode = 1;
          return;
        }
        if (opts.json) {
          process.stdout.write(
            JSON.stringify({ deleted: true, prefix: prefix.toUpperCase() }) + '\n'
          );
        } else {
          process.stdout.write(`Deleted project ${prefix.toUpperCase()}\n`);
        }
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
        const targetPrefix = prefix?.toUpperCase() ?? getActiveProject(svc.db);
        if (!targetPrefix) {
          const msg =
            'No project specified and no active project set. Use "brain pm use <prefix>" first.';
          process.stderr.write(
            formatError({ error: true, code: 'INVALID_INPUT', message: msg }, !!opts.json) + '\n'
          );
          process.exitCode = 1;
          return;
        }

        const result = getProject(svc.db, targetPrefix);
        if (!result.ok) {
          process.stderr.write(formatError(result.error, !!opts.json) + '\n');
          process.exitCode = 1;
          return;
        }
        outputResult(result.data, !!opts.json);
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
