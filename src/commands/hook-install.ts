import { Command } from '@commander-js/extra-typings';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';

interface HookEntry {
  type: string;
  command: string;
}

interface HookMatcher {
  matcher: string;
  hooks: HookEntry[];
}

type HooksConfig = Record<string, HookMatcher[]>;

interface SettingsFile {
  hooks?: HooksConfig;
  [key: string]: unknown;
}

const BRAIN_COMMAND_PREFIX = 'brain hook dispatch';

const HOOK_EVENTS: Array<{ claudeEvent: string; brainEvent: string }> = [
  { claudeEvent: 'PreToolUse', brainEvent: 'pre-tool-use' },
  { claudeEvent: 'PostToolUse', brainEvent: 'post-tool-use' },
  { claudeEvent: 'Notification', brainEvent: 'notification' },
  { claudeEvent: 'SessionStart', brainEvent: 'session-start' },
  { claudeEvent: 'Stop', brainEvent: 'agent-done' },
  { claudeEvent: 'PreCompact', brainEvent: 'pre-compact' },
];

function buildBrainHooksConfig(): HooksConfig {
  const hooks: HooksConfig = {};
  for (const { claudeEvent, brainEvent } of HOOK_EVENTS) {
    hooks[claudeEvent] = [
      {
        matcher: '',
        hooks: [{ type: 'command', command: `${BRAIN_COMMAND_PREFIX} ${brainEvent}` }],
      },
    ];
  }
  return hooks;
}

function hasBrainHook(matchers: HookMatcher[], brainCommand: string): boolean {
  return matchers.some((m) =>
    m.hooks.some((h) => h.type === 'command' && h.command === brainCommand)
  );
}

export function mergeHooksIntoSettings(existing: SettingsFile): SettingsFile {
  const result = { ...existing };
  const existingHooks: HooksConfig = result.hooks ?? {};
  const brainHooks = buildBrainHooksConfig();

  for (const [event, brainMatchers] of Object.entries(brainHooks)) {
    const brainCommand = brainMatchers[0].hooks[0].command;
    const current = existingHooks[event] ?? [];

    if (hasBrainHook(current, brainCommand)) continue;

    existingHooks[event] = [...current, ...brainMatchers];
  }

  result.hooks = existingHooks;
  return result;
}

function resolveSettingsPath(project: boolean): string {
  if (project) {
    return join(process.cwd(), '.claude', 'settings.local.json');
  }
  return join(homedir(), '.claude', 'settings.json');
}

function readSettingsFile(path: string): SettingsFile {
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as SettingsFile;
  } catch {
    return {};
  }
}

function writeSettingsFile(path: string, settings: SettingsFile): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(settings, null, 2) + '\n', 'utf-8');
}

export const hookInstallCommand = new Command('install')
  .description('Install brain hooks into Claude Code settings')
  .option('--user', 'Install in user-level settings (default)')
  .option('--project', 'Install in project-level settings')
  .option('--dry-run', 'Show what would be written without making changes')
  .action((opts) => {
    const isProject = opts.project === true;
    const settingsPath = resolveSettingsPath(isProject);
    const existing = readSettingsFile(settingsPath);
    const merged = mergeHooksIntoSettings(existing);

    if (opts.dryRun) {
      const label = isProject ? 'project' : 'user';
      process.stderr.write(`[dry-run] Would write to ${settingsPath} (${label}):\n`);
      process.stdout.write(JSON.stringify(merged, null, 2) + '\n');
      return;
    }

    writeSettingsFile(settingsPath, merged);
    const label = isProject ? 'project' : 'user';
    process.stderr.write(`Installed brain hooks in ${label} settings: ${settingsPath}\n`);
  });
