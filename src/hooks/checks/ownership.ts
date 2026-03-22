import { resolve, relative } from 'node:path';
import { readFileSync, existsSync } from 'node:fs';
import type { HookHandler, HookInput, HookConfig, HookResult } from '../types.js';
import { hookAllow, hookBlock } from '../types.js';

const WRITE_TOOLS = new Set(['Write', 'Edit', 'NotebookEdit']);

/**
 * Shape of the persisted ownership manifest (`.claude/ownership.json`).
 *
 * This is the **authoritative** source for file ownership enforcement.
 * The hook reads this manifest at tool-use time and blocks writes that fall
 * outside an agent's declared paths.
 *
 * Note: a separate system (`file-ownership-ext.ts`) dynamically *computes*
 * ownership from task descriptions for dispatch context. That extension
 * provides recommendations only — this hook is the enforcement point.
 */
interface OwnershipManifest {
  agents: Record<string, { paths: string[] }>;
}

function loadOwnershipManifest(manifestPath: string): OwnershipManifest | null {
  if (!existsSync(manifestPath)) return null;
  try {
    return JSON.parse(readFileSync(manifestPath, 'utf-8')) as OwnershipManifest;
  } catch {
    return null;
  }
}

function isFileOwned(
  agentName: string,
  relPath: string,
  manifest: OwnershipManifest | null
): boolean {
  if (!manifest) return true;
  const agent = manifest.agents[agentName];
  if (!agent) return true;
  return agent.paths.some((p) => relPath.startsWith(p));
}

export const ownershipCheck: HookHandler = {
  name: 'ownership',
  event: 'pre-tool-use',
  priority: 10,

  enabled(config: HookConfig): boolean {
    return config.enforcement.ownership;
  },

  run(input: HookInput, config: HookConfig): HookResult {
    const toolName = (input.parsed as { tool_name?: string }).tool_name ?? '';
    if (!WRITE_TOOLS.has(toolName)) return hookAllow();

    const toolInput = (input.parsed as { tool_input?: { file_path?: string } }).tool_input;
    const filePath = toolInput?.file_path;
    if (!filePath) return hookAllow();

    const manifest = loadOwnershipManifest(resolve(input.cwd, config.ownershipManifest));
    const relPath = relative(input.cwd, filePath);
    const agentName = process.env.AGENT_NAME ?? 'default';

    if (isFileOwned(agentName, relPath, manifest)) return hookAllow();

    return hookBlock(
      `Blocked: ${relPath} is outside ownership scope for agent "${agentName}". ` +
        `Allowed paths: ${manifest?.agents[agentName]?.paths.join(', ') ?? 'none'}`
    );
  },
};
