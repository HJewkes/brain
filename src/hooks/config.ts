import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { HookConfig } from './types.js';
import type { BrainConfig } from '../types.js';

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

function brainConfigToHookConfig(brain: BrainConfig): Partial<HookConfig> | null {
  if (!brain.hooks) return null;
  const result: Partial<HookConfig> = {};
  if (brain.hooks.enforcement) {
    result.enforcement = brain.hooks.enforcement as HookConfig['enforcement'];
  }
  if (brain.hooks.ownershipManifest) {
    result.ownershipManifest = brain.hooks.ownershipManifest;
  }
  return result;
}

function tryLoadJson(path: string): Partial<HookConfig> | null {
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, 'utf-8')) as Partial<HookConfig>;
}

export function resolveHookConfig(
  projectDir: string,
  overrides?: Partial<HookConfig>,
  brainConfig?: BrainConfig
): HookConfig {
  const sources: Partial<HookConfig>[] = [];

  // Priority 1: ao.config.json (legacy, lowest priority)
  const globalAoPath = join(homedir(), '.claude', 'ao.config.json');
  const globalAo = tryLoadJson(globalAoPath);
  if (globalAo) sources.push(globalAo);

  const projectAoPath = join(projectDir, 'ao.config.json');
  const projectAo = tryLoadJson(projectAoPath);
  if (projectAo) sources.push(projectAo);

  // Priority 2: brain config hooks section (higher priority than ao.config.json)
  if (brainConfig) {
    const hookConfig = brainConfigToHookConfig(brainConfig);
    if (hookConfig) sources.push(hookConfig);
  }

  // Priority 3: explicit overrides (highest priority)
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
