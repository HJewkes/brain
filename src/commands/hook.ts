import { Command } from '@commander-js/extra-typings';
import { isJsonFormat } from './format.js';
import { resolveHookConfig } from '../hooks/index.js';
import {
  VALID_HOOK_EVENTS,
  buildRegistry,
  registerModuleHandlers,
  dispatchHookEvent,
} from '../hooks/dispatch.js';
import { hookInstallCommand } from './hook-install.js';
import type { HookEvent, HookResult } from '../hooks/types.js';

function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    if (process.stdin.isTTY) {
      resolve('');
      return;
    }
    const chunks: Buffer[] = [];
    process.stdin.on('data', (chunk: Buffer) => chunks.push(chunk));
    process.stdin.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8').trim()));
    process.stdin.on('error', () => resolve(''));
  });
}

function outputResult(result: HookResult): void {
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  process.exitCode = result.exitCode;
}

const dispatchSubcommand = new Command('dispatch')
  .description('Run all enabled checks for a hook event')
  .argument('<event>', 'Hook event (pre-tool-use, prompt-submit, task-completed, agent-done)')
  .action(async (event: string) => {
    if (!VALID_HOOK_EVENTS.has(event as HookEvent)) {
      process.stderr.write(
        `Unknown hook event: ${event}. Valid: ${[...VALID_HOOK_EVENTS].join(', ')}\n`
      );
      process.exitCode = 1;
      return;
    }

    const raw = await readStdin();
    outputResult(await dispatchHookEvent(event as HookEvent, raw, process.cwd()));
  });

const statusSubcommand = new Command('status')
  .description('Show registered hook handlers and their status')
  .option('--json', 'Output as JSON')
  .action(async (opts, cmd) => {
    const config = resolveHookConfig(process.cwd());
    const registry = buildRegistry();
    await registerModuleHandlers(registry);

    const handlers = registry.getHandlers();
    const info = handlers.map((h) => ({
      name: h.name,
      event: h.event,
      priority: h.priority,
      enabled: h.enabled(config),
    }));

    if (isJsonFormat(opts, cmd)) {
      process.stdout.write(JSON.stringify(info, null, 2) + '\n');
    } else {
      for (const h of info) {
        const flag = h.enabled ? 'on' : 'off';
        process.stderr.write(`  [${flag}] ${h.name} (${h.event}, priority ${h.priority})\n`);
      }
    }
  });

export const hookCommand = new Command('hook')
  .description('Hook dispatch and management')
  .addCommand(dispatchSubcommand)
  .addCommand(statusSubcommand)
  .addCommand(hookInstallCommand);
