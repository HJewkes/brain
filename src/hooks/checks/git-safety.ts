import { existsSync, mkdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import type { HookHandler, HookInput, HookConfig, HookResult } from '../types.js';
import { hookAllow, hookBlock } from '../types.js';

const DESTRUCTIVE_PATTERNS: Array<(cmd: string) => boolean> = [
  (cmd) => /^git\s+push\s+.*(-f|--force|--force-with-lease)/.test(cmd),
  (cmd) => /^git\s+reset\s+--hard/.test(cmd),
  (cmd) => /^git\s+clean\s+.*-[a-zA-Z]*f/.test(cmd),
  (cmd) => /^git\s+checkout\s+(--\s+\.|\.)\s*$/.test(cmd),
  (cmd) => /^git\s+restore\s+(--[a-z-]+\s+)*\.(\s|$)/.test(cmd),
  (cmd) => /^git\s+branch\s+.*-D/.test(cmd),
  (cmd) => /^git\s+stash\s+drop/.test(cmd),
  (cmd) => /^git\s+rebase\s+-i/.test(cmd),
];

const SEPARATOR_RE = /\s*(?:&&|\|\||\||;)\s*/;
const MARKER_DIR = '.ao';

export function extractGitCommands(commandLine: string): string[] {
  return commandLine
    .split(SEPARATOR_RE)
    .map((s) => s.trim())
    .filter((s) => /^git\s/.test(s));
}

export function isDestructiveGitCommand(cmd: string): boolean {
  return DESTRUCTIVE_PATTERNS.some((pattern) => pattern(cmd.trim()));
}

export function markerPath(cwd: string, command: string): string {
  const hash = createHash('sha256').update(command).digest('hex').slice(0, 12);
  return join(cwd, MARKER_DIR, `git-safety-${hash}.marker`);
}

export const gitSafetyCheck: HookHandler = {
  name: 'git-safety',
  event: 'pre-tool-use',
  priority: 5,

  enabled(config: HookConfig): boolean {
    return config.enforcement.gitSafety;
  },

  run(input: HookInput, config: HookConfig): HookResult {
    const toolName = (input.parsed as { tool_name?: string }).tool_name ?? '';
    if (toolName !== 'Bash') return hookAllow();

    const toolInput = (input.parsed as { tool_input?: { command?: string } }).tool_input;
    const command = toolInput?.command;
    if (!command) return hookAllow();

    const gitCmds = extractGitCommands(command);
    const destructive = gitCmds.filter(isDestructiveGitCommand);
    if (destructive.length === 0) return hookAllow();

    const blockOnce = config.enforcement.gitSafetyBlockOnce;
    const firstDestructive = destructive[0];

    if (blockOnce) {
      const marker = markerPath(input.cwd, firstDestructive);

      if (existsSync(marker)) {
        unlinkSync(marker);
        return hookAllow();
      }

      const dir = join(input.cwd, MARKER_DIR);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      writeFileSync(marker, firstDestructive, 'utf-8');
    }

    return hookBlock(
      `Blocked destructive git operation: ${firstDestructive}. ` +
        (blockOnce
          ? 'Re-run the same command to confirm.'
          : 'This operation is not allowed by git-safety policy.')
    );
  },
};
