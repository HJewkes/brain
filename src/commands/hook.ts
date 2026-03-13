import { Command } from '@commander-js/extra-typings';
import { HookRegistry, resolveHookConfig } from '../hooks/index.js';
import { ownershipCheck } from '../hooks/checks/ownership.js';
import { gitSafetyCheck } from '../hooks/checks/git-safety.js';
import { workspaceCheck } from '../hooks/checks/workspace.js';
import { dodCheck } from '../hooks/checks/dod.js';
import { wipCheck } from '../hooks/checks/wip.js';
import { loadModules } from '../modules/loader.js';
import { pmModule } from '../modules/pm/index.js';
import { workflowModule } from '../modules/workflow/index.js';
import { sessionsModule } from '../modules/sessions/index.js';
import type { HookEvent, HookInput, HookResult } from '../hooks/types.js';

const VALID_EVENTS = new Set<HookEvent>([
  'pre-tool-use',
  'prompt-submit',
  'task-completed',
  'agent-done',
]);

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

function createRegistry(): HookRegistry {
  const registry = new HookRegistry();
  registry.register(gitSafetyCheck);
  registry.register(ownershipCheck);
  registry.register(workspaceCheck);
  registry.register(dodCheck);
  registry.register(wipCheck);
  return registry;
}

async function registerModuleHandlers(registry: HookRegistry): Promise<void> {
  const { registry: moduleRegistry } = await loadModules({
    modules: [pmModule, workflowModule, sessionsModule],
  });
  for (const { handler } of moduleRegistry.getHookHandlers()) {
    registry.register(handler);
  }
}

const dispatchSubcommand = new Command('dispatch')
  .description('Run all enabled checks for a hook event')
  .argument('<event>', 'Hook event (pre-tool-use, prompt-submit, task-completed, agent-done)')
  .action(async (event: string) => {
    if (!VALID_EVENTS.has(event as HookEvent)) {
      process.stderr.write(
        `Unknown hook event: ${event}. Valid: ${[...VALID_EVENTS].join(', ')}\n`
      );
      process.exitCode = 1;
      return;
    }

    const raw = await readStdin();
    let parsed: Record<string, unknown> = {};
    try {
      parsed = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    } catch {
      // non-JSON stdin is fine
    }

    const config = resolveHookConfig(process.cwd());
    const registry = createRegistry();
    await registerModuleHandlers(registry);

    const input: HookInput = {
      event: event as HookEvent,
      raw,
      parsed,
      cwd: process.cwd(),
    };

    outputResult(registry.dispatch(event as HookEvent, input, config));
  });

const statusSubcommand = new Command('status')
  .description('Show registered hook handlers and their status')
  .option('--json', 'Output as JSON')
  .action(async (opts) => {
    const config = resolveHookConfig(process.cwd());
    const registry = createRegistry();
    await registerModuleHandlers(registry);

    const handlers = registry.getHandlers();
    const info = handlers.map((h) => ({
      name: h.name,
      event: h.event,
      priority: h.priority,
      enabled: h.enabled(config),
    }));

    if (opts.json) {
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
  .addCommand(statusSubcommand);
