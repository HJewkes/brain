import { HookRegistry, resolveHookConfig } from './index.js';
import { ownershipCheck } from './checks/ownership.js';
import { gitSafetyCheck } from './checks/git-safety.js';
import { workspaceCheck } from './checks/workspace.js';
import { dodCheck } from './checks/dod.js';
import { wipCheck } from './checks/wip.js';
import { worktreeIsolationCheck } from './checks/worktree-isolation.js';
import { workflowResourceCheck } from './checks/workflow-resource.js';
import { loadModules } from '../modules/loader.js';
import { pmModule } from '../modules/pm/index.js';
import { workflowModule } from '../modules/workflow/index.js';
import { sessionsModule } from '../modules/sessions/index.js';
import { agentsModule } from '../modules/agents/index.js';
import { codebaseModule } from '../modules/codebase/index.js';
import type { HookEvent, HookInput, HookResult } from './types.js';

export const VALID_HOOK_EVENTS = new Set<HookEvent>([
  'pre-tool-use',
  'post-tool-use',
  'prompt-submit',
  'notification',
  'task-completed',
  'agent-done',
  'session-start',
  'pre-compact',
]);

export function buildRegistry(): HookRegistry {
  const registry = new HookRegistry();
  registry.register(gitSafetyCheck);
  registry.register(ownershipCheck);
  registry.register(workspaceCheck);
  registry.register(dodCheck);
  registry.register(wipCheck);
  registry.register(worktreeIsolationCheck);
  registry.register(workflowResourceCheck);
  return registry;
}

export async function registerModuleHandlers(registry: HookRegistry): Promise<void> {
  const { registry: moduleRegistry } = await loadModules({
    modules: [pmModule, workflowModule, sessionsModule, agentsModule, codebaseModule],
  });
  for (const { handler } of moduleRegistry.getHookHandlers()) {
    registry.register(handler);
  }
}

export async function dispatchHookEvent(
  event: HookEvent,
  raw: string,
  cwd: string
): Promise<HookResult> {
  let parsed: Record<string, unknown> = {};
  try {
    parsed = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
  } catch {
    // non-JSON stdin is fine
  }

  const config = resolveHookConfig(cwd);
  const registry = buildRegistry();
  await registerModuleHandlers(registry);

  const input: HookInput = { event, raw, parsed, cwd };
  return registry.dispatch(event, input, config);
}
