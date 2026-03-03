import { existsSync, statSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { Command } from '@commander-js/extra-typings';
import { installHooks } from './install-hooks.js';
import { withBrain } from '../../../services/brain-service.js';
import { createProject } from '../data/project-ops.js';
import { createWorkstream } from '../data/workstream-ops.js';
import { createTask } from '../data/task-ops.js';
import { setActiveProject } from '../data/queries.js';

interface CheckResult {
  label: string;
  passed: boolean;
  error?: string;
}

function resolveClaudeDir(): string {
  return process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude');
}

function checkFile(
  path: string,
  label: string,
  contentCheck?: (c: string) => boolean
): CheckResult {
  if (!existsSync(path)) return { label, passed: false, error: `File missing: ${path}` };
  if (contentCheck) {
    const ok = contentCheck(readFileSync(path, 'utf-8'));
    return { label, passed: ok, error: ok ? undefined : `Content check failed: ${path}` };
  }
  const stat = statSync(path);
  return stat.mode & 0o100
    ? { label, passed: true }
    : { label, passed: false, error: `Not executable: ${path}` };
}

function validateInstallation(claudeDir: string): CheckResult[] {
  const hooks = join(claudeDir, 'hooks');
  return [
    checkFile(join(hooks, 'brain-pm-session.sh'), 'SessionStart hook'),
    checkFile(join(hooks, 'brain-pm-worktree.sh'), 'PreToolUse hook'),
    checkFile(join(hooks, 'brain-pm-agent-done.sh'), 'SubagentStop hook'),
    checkFile(join(claudeDir, 'settings.json'), 'Settings.json updated', (c) => {
      try {
        const s = JSON.parse(c);
        return !!(s.hooks?.SessionStart && s.hooks?.PreToolUse && s.hooks?.SubagentStop);
      } catch {
        return false;
      }
    }),
    checkFile(
      join(claudeDir, 'skills', 'orchestrator', 'SKILL.md'),
      'Orchestrator skill installed',
      (c) => c.includes('Project Orchestrator')
    ),
  ];
}

async function validateDatabase(): Promise<CheckResult> {
  try {
    await withBrain(() => {});
    return { label: 'Database accessible', passed: true };
  } catch (err) {
    return { label: 'Database accessible', passed: false, error: (err as Error).message };
  }
}

const DEMO_TASKS = [
  {
    name: 'Set up project structure',
    ws: 1,
    category: 'implementation' as const,
    priority: 'high' as const,
    description: 'Create the initial project directory structure with src/, tests/, and config files. Establishes the foundation for all subsequent implementation work.',
  },
  {
    name: 'Implement core logic',
    ws: 1,
    category: 'implementation' as const,
    priority: 'medium' as const,
    deps: [0],
    description: 'Build the primary business logic module that handles data processing and validation. Depends on project structure being in place.',
  },
  {
    name: 'Write unit tests',
    ws: 2,
    category: 'testing' as const,
    priority: 'medium' as const,
    deps: [1],
    description: 'Create comprehensive unit test coverage for the core logic module. Tests should cover happy paths, edge cases, and error handling.',
  },
  {
    name: 'Write documentation',
    ws: 2,
    category: 'documentation' as const,
    priority: 'low' as const,
    description: 'Write developer documentation covering API usage, configuration options, and architecture decisions. Include code examples for common use cases.',
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

function formatText(checks: CheckResult[], demo?: { success: boolean; error?: string }): string {
  const lines = ['PM Module Setup Complete', ''];
  for (const c of checks) {
    lines.push(
      `  ${c.passed ? '\u2713' : '\u2717'} ${c.label}${c.error ? ` \u2014 ${c.error}` : ''}`
    );
  }
  if (demo) {
    lines.push(
      '',
      demo.success
        ? '  \u2713 Demo project created (DEMO)'
        : `  \u2717 Demo project failed \u2014 ${demo.error}`
    );
  }
  if (checks.every((c) => c.passed) && (!demo || demo.success)) {
    lines.push('', 'Next steps:', '  brain pm init "My Project" --prefix MY', '  brain pm use MY');
  }
  lines.push('');
  return lines.join('\n');
}

export function createSetupCommand(): Command {
  return new Command('setup')
    .description('Install PM orchestration hooks, skill, and optionally create a demo project')
    .option('--demo', 'Create a demo project after setup')
    .option('--json', 'Output JSON status')
    .option('--dry-run', 'Show what would be installed')
    .action(async (opts) => {
      const claudeDir = resolveClaudeDir();

      if (opts.dryRun) {
        const items = [
          join(claudeDir, 'hooks', 'brain-pm-session.sh'),
          join(claudeDir, 'hooks', 'brain-pm-worktree.sh'),
          join(claudeDir, 'hooks', 'brain-pm-agent-done.sh'),
          join(claudeDir, 'skills', 'orchestrator', 'SKILL.md'),
          `Hook entries in ${join(claudeDir, 'settings.json')}`,
        ];
        if (opts.demo) items.push('Demo project with 2 workstreams and 4 tasks');
        process.stdout.write('Would install:\n' + items.map((i) => `  ${i}`).join('\n') + '\n');
        return;
      }

      const hookResult = installHooks(claudeDir);
      for (const err of hookResult.errors) process.stderr.write(`Error: ${err}\n`);

      const checks = validateInstallation(claudeDir);
      checks.push(await validateDatabase());

      const demo = opts.demo ? await createDemoProject() : undefined;
      const hasFailure = checks.some((c) => !c.passed) || (demo && !demo.success);
      if (hasFailure) process.exitCode = 1;

      if (opts.json) {
        process.stdout.write(
          JSON.stringify(
            {
              checks: checks.map((c) => ({ label: c.label, passed: c.passed, error: c.error })),
              demo: demo ? { success: demo.success, error: demo.error } : undefined,
              success: !hasFailure,
            },
            null,
            2
          ) + '\n'
        );
      } else {
        process.stdout.write(formatText(checks, demo));
      }
    }) as unknown as Command;
}
