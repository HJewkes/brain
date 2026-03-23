import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join } from 'node:path';
import type { HookHandler, HookInput, HookConfig, HookResult } from '../types.js';
import { hookAllow, hookBlock } from '../types.js';

const WRITE_TOOLS = new Set(['Write', 'Edit', 'NotebookEdit']);

interface BranchResource {
  id: string;
  type: string;
  project: string;
  status: string;
  data: Record<string, unknown>;
  updatedAt: string;
}

function getCurrentBranch(cwd: string): string | null {
  try {
    return execSync('git rev-parse --abbrev-ref HEAD', {
      cwd,
      timeout: 2000,
      encoding: 'utf-8',
    }).trim();
  } catch {
    return null;
  }
}

function loadBranchResources(resourceDir: string): BranchResource[] {
  if (!existsSync(resourceDir)) return [];

  const files = readdirSync(resourceDir).filter((f) => f.endsWith('.json'));
  const resources: BranchResource[] = [];

  for (const file of files) {
    try {
      const content = readFileSync(join(resourceDir, file), 'utf-8');
      const resource = JSON.parse(content) as BranchResource;
      if (resource.type === 'branch' && resource.status === 'active') {
        resources.push(resource);
      }
    } catch {
      // Skip malformed files
    }
  }

  return resources;
}

export const workflowResourceCheck: HookHandler = {
  name: 'workflow-resource',
  event: 'pre-tool-use',
  priority: 5,

  enabled(config: HookConfig): boolean {
    return config.enforcement.brainResources;
  },

  run(input: HookInput, _config: HookConfig): HookResult {
    const toolName = (input.parsed as { tool_name?: string }).tool_name ?? '';
    if (!WRITE_TOOLS.has(toolName)) return hookAllow();

    const agentId = process.env.AO_AGENT_ID;
    if (!agentId) return hookAllow();

    const currentBranch = getCurrentBranch(input.cwd);
    if (!currentBranch) return hookAllow();

    const resourceDir = join(input.cwd, '.brain', 'modules', 'workflow', 'resources');
    const branchResources = loadBranchResources(resourceDir);

    for (const resource of branchResources) {
      const resourceBranch = resource.data.branch as string | undefined;
      const resourceAgent = resource.data.agentId as string | undefined;

      if (resourceBranch === currentBranch && resourceAgent && resourceAgent !== agentId) {
        return hookBlock(`Blocked: branch ${currentBranch} is owned by agent ${resourceAgent}`);
      }
    }

    return hookAllow();
  },
};
