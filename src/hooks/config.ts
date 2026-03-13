import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { HookConfig } from './types.js';

export const DEFAULT_HOOK_CONFIG: HookConfig = {
  enforcement: {
    ownership: false,
    dod: false,
    dodCriteria: [],
    wipLimit: 0,
    workspaceClean: false,
    gitSafety: false,
    gitSafetyBlockOnce: true,
    brainResources: false,
    worktreeBudget: 3,
    worktreeBasePath: '.worktrees',
  },
  ownershipManifest: '.claude/ownership.json',
};

export function resolveHookConfig(
  projectDir: string,
  overrides?: Partial<HookConfig>
): HookConfig {
  const sources: Partial<HookConfig>[] = [];

  const globalPath = join(homedir(), '.claude', 'ao.config.json');
  if (existsSync(globalPath)) {
    sources.push(JSON.parse(readFileSync(globalPath, 'utf-8')) as Partial<HookConfig>);
  }

  const projectPath = join(projectDir, 'ao.config.json');
  if (existsSync(projectPath)) {
    sources.push(JSON.parse(readFileSync(projectPath, 'utf-8')) as Partial<HookConfig>);
  }

  if (overrides) {
    sources.push(overrides);
  }

  return deepMerge(DEFAULT_HOOK_CONFIG, ...sources);
}

function deepMerge<T extends object>(base: T, ...sources: Partial<T>[]): T {
  const result = { ...base } as Record<string, unknown>;
  for (const source of sources) {
    for (const key of Object.keys(source as object)) {
      const val = (source as Record<string, unknown>)[key];
      const existing = result[key];
      if (val && typeof val === 'object' && !Array.isArray(val)) {
        result[key] = deepMerge(
          (existing as Record<string, unknown>) ?? {},
          val as Record<string, unknown>
        );
      } else if (val !== undefined) {
        result[key] = val;
      }
    }
  }
  return result as T;
}
