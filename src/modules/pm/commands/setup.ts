import { Command } from '@commander-js/extra-typings';
import { withBrain } from '../../../services/brain-service.js';
import { createProject } from '../data/project-ops.js';
import { createWorkstream } from '../data/workstream-ops.js';
import { createTask } from '../data/task-ops.js';
import { setActiveProject } from '../data/queries.js';

async function validateDatabase(): Promise<{ passed: boolean; error?: string }> {
  try {
    await withBrain(() => {});
    return { passed: true };
  } catch (err) {
    return { passed: false, error: (err as Error).message };
  }
}

const DEMO_TASKS = [
  {
    name: 'Set up project structure',
    ws: 1,
    category: 'implementation' as const,
    priority: 'high' as const,
    description:
      'Create the initial project directory structure with src/, tests/, and config files. Establishes the foundation for all subsequent implementation work.',
  },
  {
    name: 'Implement core logic',
    ws: 1,
    category: 'implementation' as const,
    priority: 'medium' as const,
    deps: [0],
    description:
      'Build the primary business logic module that handles data processing and validation. Depends on project structure being in place.',
  },
  {
    name: 'Write unit tests',
    ws: 2,
    category: 'testing' as const,
    priority: 'medium' as const,
    deps: [1],
    description:
      'Create comprehensive unit test coverage for the core logic module. Tests should cover happy paths, edge cases, and error handling.',
  },
  {
    name: 'Write documentation',
    ws: 2,
    category: 'documentation' as const,
    priority: 'low' as const,
    description:
      'Write developer documentation covering API usage, configuration options, and architecture decisions. Include code examples for common use cases.',
    deps: [1],
  },
];

async function createDemoProject(): Promise<{ success: boolean; error?: string }> {
  try {
    return await withBrain(async (svc) => {
      const proj = await createProject(svc.db, svc.config, svc.embedder, {
        name: 'Demo Project',
        prefix: 'DEMO',
      });
      if (!proj.ok) return { success: false, error: proj.error.message };
      setActiveProject(svc.db, 'DEMO');

      for (const name of ['Implementation', 'Testing']) {
        const ws = await createWorkstream(svc.db, svc.config, svc.embedder, {
          project: 'DEMO',
          name,
        });
        if (!ws.ok) return { success: false, error: ws.error.message };
      }

      const ids: string[] = [];
      for (const t of DEMO_TASKS) {
        const dependsOn = t.deps?.map((i) => ids[i]);
        const r = await createTask(svc.db, svc.config, svc.embedder, {
          project: 'DEMO',
          workstream: t.ws,
          name: t.name,
          description: t.description,
          mode: 'auto',
          category: t.category,
          priority: t.priority,
          dependsOn: dependsOn?.length ? dependsOn : undefined,
        });
        if (!r.ok) return { success: false, error: r.error.message };
        ids.push(r.data.display_id);
      }
      return { success: true };
    });
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

function formatText(
  dbCheck: { passed: boolean; error?: string },
  demo: { success: boolean; error?: string }
): string {
  const lines = ['PM Setup \u2014 Demo Project', ''];
  lines.push(
    `  ${dbCheck.passed ? '\u2713' : '\u2717'} Database accessible${dbCheck.error ? ` \u2014 ${dbCheck.error}` : ''}`
  );
  lines.push(
    '',
    demo.success
      ? '  \u2713 Demo project created (DEMO)'
      : `  \u2717 Demo project failed \u2014 ${demo.error}`
  );
  if (dbCheck.passed && demo.success) {
    lines.push('', 'Next steps:', '  brain pm init "My Project" --prefix MY', '  brain pm use MY');
  }
  lines.push('');
  return lines.join('\n');
}

export function createSetupCommand(): Command {
  return new Command('setup')
    .description('[DEPRECATED] Use "ao hook install" for hooks. Use --demo for demo project only.')
    .option('--demo', 'Create a demo project')
    .option('--json', 'Output JSON status')
    .option('--dry-run', 'Show what would be done')
    .action(async (opts) => {
      if (opts.dryRun) {
        const items: string[] = [];
        if (opts.demo) items.push('Demo project with 2 workstreams and 4 tasks');
        else items.push('DEPRECATED: Hook installation moved to ao-cli. Use: ao hook install');
        process.stdout.write('Would install:\n' + items.map((i) => `  ${i}`).join('\n') + '\n');
        return;
      }

      if (!opts.demo) {
        process.stderr.write(
          'DEPRECATED: Hook installation has moved to ao-cli.\n' +
            'Run: ao hook install\n' +
            'To create a demo project, use: brain pm setup --demo\n'
        );
        process.exitCode = 1;
        return;
      }

      const dbCheck = await validateDatabase();
      const demo = await createDemoProject();
      const hasFailure = !dbCheck.passed || !demo.success;
      if (hasFailure) process.exitCode = 1;

      if (opts.json) {
        process.stdout.write(
          JSON.stringify(
            {
              checks: [{ label: 'Database accessible', passed: dbCheck.passed, error: dbCheck.error }],
              demo: { success: demo.success, error: demo.error },
              success: !hasFailure,
            },
            null,
            2
          ) + '\n'
        );
      } else {
        process.stdout.write(formatText(dbCheck, demo));
      }
    }) as unknown as Command;
}
