import { execSync } from 'node:child_process';
import type { HookHandler, HookInput, HookConfig, HookResult } from '../types.js';
import { hookAllow, hookBlock } from '../types.js';

const WRITE_TOOLS = new Set(['Write', 'Edit', 'NotebookEdit', 'Bash']);

export const worktreeIsolationCheck: HookHandler = {
  name: 'worktree-isolation',
  event: 'pre-tool-use',
  priority: 5,

  enabled(config: HookConfig): boolean {
    return config.enforcement.worktreeIsolation;
  },

  run(input: HookInput, _config: HookConfig): HookResult {
    const toolName = (input.parsed as { tool_name?: string }).tool_name ?? '';
    if (!WRITE_TOOLS.has(toolName)) return hookAllow();

    const agentName = process.env.AGENT_NAME;
    if (!agentName) return hookAllow();

    const worktreePath = process.env.AGENT_WORKTREE_PATH;
    if (worktreePath) return hookAllow();

    const otherAgentCount = countOtherAgents();
    if (otherAgentCount === 0) return hookAllow();

    return hookBlock(
      `Blocked: agent "${agentName}" attempted a write without worktree isolation. ` +
        `${otherAgentCount} other agent(s) detected. ` +
        `Set AGENT_WORKTREE_PATH or allocate a worktree before making changes.`
    );
  },
};

function countOtherAgents(): number {
  try {
    const output = execSync('ps aux | grep -c "[c]laude.*agent"', {
      encoding: 'utf-8',
      timeout: 2000,
    }).trim();
    const total = parseInt(output, 10) || 0;
    // Subtract 1 for the current agent process
    return Math.max(0, total - 1);
  } catch {
    return 0;
  }
}
