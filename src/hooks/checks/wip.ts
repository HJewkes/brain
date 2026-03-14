import { execSync } from 'node:child_process';
import type { HookHandler, HookInput, HookConfig, HookResult } from '../types.js';
import { hookAllow, hookAllowJson } from '../types.js';

export const wipCheck: HookHandler = {
  name: 'wip',
  event: 'prompt-submit',
  priority: 50,

  enabled(config: HookConfig): boolean {
    return config.enforcement.wipLimit > 0;
  },

  run(input: HookInput, config: HookConfig): HookResult {
    const limit = config.enforcement.wipLimit;
    const current = countActiveAgents();
    if (current < limit) return hookAllow();

    return hookAllowJson(
      `[brain] WIP limit reached: ${current}/${limit} concurrent agents. ` +
        `Consider waiting for an agent to complete before spawning another.`
    );
  },
};

function countActiveAgents(): number {
  try {
    const output = execSync('ps aux | grep -c "[c]laude.*agent"', {
      encoding: 'utf-8',
      timeout: 2000,
    }).trim();
    return parseInt(output, 10) || 0;
  } catch {
    return 0;
  }
}
