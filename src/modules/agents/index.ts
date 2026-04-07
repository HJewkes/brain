import type { BrainModule } from '../types.js';
import type { HookHandler, HookInput, HookConfig, HookResult } from '../../hooks/types.js';
import { hookAllow, hookBlock, hookAllowJson } from '../../hooks/types.js';
import { agentsMigrationV1, agentsMigrationV2 } from './schema.js';
import { createAgentCommands } from './commands.js';
import { runAgentDoneHook } from './agent-done-handler.js';

/**
 * Ensures agent writes stay within their allocated worktree path.
 * Only runs when agent HAS a worktree (complements worktreeIsolationCheck).
 *
 * This is one half of a complementary pair:
 * - worktreeIsolationCheck (hooks/checks, priority 5): requires isolation when multiple agents exist
 * - worktreeBoundaryCheck (here, priority 20): constrains writes to the allocated worktree
 */
const worktreeBoundaryCheck: HookHandler = {
  name: 'agents:worktree-boundary',
  event: 'pre-tool-use',
  priority: 20,

  enabled(config: HookConfig): boolean {
    return config.enforcement.worktreeBudget > 0;
  },

  run(input: HookInput, _config: HookConfig): HookResult {
    const WRITE_TOOLS = new Set(['Write', 'Edit', 'NotebookEdit', 'Bash']);
    const toolName = (input.parsed as { tool_name?: string }).tool_name ?? '';
    if (!WRITE_TOOLS.has(toolName)) return hookAllow();

    const worktreePath = process.env.AGENT_WORKTREE_PATH;
    if (!worktreePath) return hookAllow();

    const toolInput = (input.parsed as { tool_input?: { file_path?: string; command?: string } })
      .tool_input;

    // For file-based tools check the target path stays within the worktree
    const filePath = toolInput?.file_path;
    if (filePath && !filePath.startsWith(worktreePath)) {
      return hookBlock(
        `Blocked: write to "${filePath}" is outside worktree boundary "${worktreePath}"`
      );
    }

    return hookAllow();
  },
};

const agentDoneHandler: HookHandler = {
  name: 'agents:agent-done',
  event: 'agent-done',
  priority: 10,

  enabled(_config: HookConfig): boolean {
    return true;
  },

  run(input: HookInput, _config: HookConfig): HookResult {
    const parsed = input.parsed as { agent_id?: string; exit_code?: number; summary?: string };

    try {
      const result = runAgentDoneHook(parsed, input.cwd);
      return hookAllowJson(
        `<agent-done agent_id="${result.agentId ?? 'unknown'}" status="${result.status}">` +
          `${result.message}</agent-done>`
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`[agents:agent-done] hook error: ${msg}\n`);
      return hookAllow();
    }
  },
};

export const agentsModule: BrainModule = {
  name: 'agents',
  version: '0.1.0',
  description: 'Agent state tracking with SQLite storage (replaces YAML files)',
  register(ctx) {
    ctx.registerNoteType({
      name: 'agent',
      description: 'Tracks a spawned agent: identity, process, workspace, and result',
      tier: 'fast',
      schema: {
        type: 'object',
        properties: {
          agent_id: { type: 'string', description: 'UUID for the agent record' },
          name: { type: 'string', description: 'Human-readable agent name' },
          parent: { type: 'string', description: 'Parent agent ID or orchestrator name' },
          status: {
            type: 'string',
            enum: ['pending', 'active', 'completed', 'failed', 'abandoned'],
            description: 'Agent lifecycle status',
          },
          brain_task: { type: 'string', description: 'PM task display_id this agent works on' },
          branch: { type: 'string', description: 'Git branch for this agent' },
          worktree_path: { type: 'string', description: 'Absolute worktree path' },
        },
        required: ['agent_id', 'name', 'status'],
      },
    });

    ctx.registerNoteType({
      name: 'worktree-allocation',
      description: 'Records a git worktree allocated to a task',
      tier: 'fast',
      schema: {
        type: 'object',
        properties: {
          task_id: { type: 'string', description: 'PM task display_id' },
          workstream: { type: 'string', description: 'Workstream identifier' },
          worktree_path: { type: 'string', description: 'Absolute path to the worktree' },
          branch: { type: 'string', description: 'Branch checked out in the worktree' },
          claim_token: { type: 'string', description: 'Claim token from PM task' },
        },
        required: ['task_id', 'worktree_path', 'branch'],
      },
    });

    ctx.registerExtractionStrategy({ shouldExtract: () => false });

    ctx.registerFilter({ visibility: 'private' });

    ctx.registerMigration(agentsMigrationV1);
    ctx.registerMigration(agentsMigrationV2);

    ctx.registerHookHandler(worktreeBoundaryCheck);
    ctx.registerHookHandler(agentDoneHandler);

    ctx.registerCommand(createAgentCommands());
  },
};
