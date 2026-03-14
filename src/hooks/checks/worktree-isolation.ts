import { execSync } from 'node:child_process';
import type { HookHandler, HookInput, HookConfig, HookResult } from '../types.js';
import { hookAllow, hookBlock } from '../types.js';
import { countActiveAgentsFromDb } from './agent-count.js';

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

    const otherAgentCount = countOtherAgents(input.cwd);
    if (otherAgentCount === 0) return hookAllow();

    return hookBlock(
      `Blocked: agent "${agentName}" attempted a write without worktree isolation. ` +
        `${otherAgentCount} other agent(s) detected. ` +
        `Set AGENT_WORKTREE_PATH or allocate a worktree before making changes.`
    );
  },
};

function countOtherAgents(cwd: string): number {
  const dbCount = countActiveAgentsFromDb(cwd);
  if (dbCount !== null) {
    return Math.max(0, dbCount - 1);
  }
  return countOtherAgentsByProcess();
}

function countOtherAgentsByProcess(): number {
  try {
    const output = execSync('ps aux | grep -c "[c]laude.*agent"', {
      encoding: 'utf-8',
      timeout: 2000,
    }).trim();
    const total = parseInt(output, 10) || 0;
    return Math.max(0, total - 1);
  } catch {
    return 0;
  }
}
