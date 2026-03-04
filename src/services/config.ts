import { readFileSync, writeFileSync, mkdirSync, existsSync, copyFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { homedir } from 'node:os';
import type { Command } from '@commander-js/extra-typings';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyCommand = Command<any[], any, any>;
import type { BrainConfig, EmbedderBackend } from '../types.js';

export const GLOBAL_BRAIN_DIR = join(homedir(), '.brain');

/**
 * Extract ResolveOptions from the parent command's --global and --instance flags.
 * Pass the Command object (last arg in action handlers) to pick up program-level flags.
 */
export function parentResolveOpts(cmd: AnyCommand): ResolveOptions {
  const parent = cmd.parent?.opts() as { global?: boolean; instance?: string } | undefined;
  return {
    forceGlobal: parent?.global,
    instancePath: parent?.instance,
  };
}

export interface InstancePaths {
  root: string;
  isLocal: boolean;
  source: string;
}

export interface ResolveOptions {
  cwd?: string;
  forceGlobal?: boolean;
  instancePath?: string;
}

const VALID_EMBEDDERS: readonly EmbedderBackend[] = ['local', 'ollama', 'remote'];

function ensureDir(dir: string): void {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

function validateConfig(config: Partial<BrainConfig>): void {
  if (config.embedder !== undefined && !VALID_EMBEDDERS.includes(config.embedder)) {
    throw new Error(
      `Invalid embedder "${config.embedder}". Must be one of: ${VALID_EMBEDDERS.join(', ')}`
    );
  }

  if (config.fusionWeights !== undefined) {
    const sum = config.fusionWeights.bm25 + config.fusionWeights.vector;
    if (Math.abs(sum - 1.0) > 1e-6) {
      throw new Error(
        `Fusion weights must sum to 1.0, got ${sum} (bm25: ${config.fusionWeights.bm25}, vector: ${config.fusionWeights.vector})`
      );
    }
  }
}

export function resolveInstance(opts: ResolveOptions = {}): InstancePaths {
  if (opts.instancePath) {
    return { root: resolve(opts.instancePath), isLocal: true, source: 'flag:--instance' };
  }

  if (opts.forceGlobal) {
    return { root: GLOBAL_BRAIN_DIR, isLocal: false, source: 'flag:--global' };
  }

  let dir = resolve(opts.cwd ?? process.cwd());

  while (true) {
    const candidate = join(dir, '.brain');
    if (existsSync(candidate)) {
      return { root: candidate, isLocal: true, source: `local:${candidate}` };
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  return { root: GLOBAL_BRAIN_DIR, isLocal: false, source: 'global' };
}

export function getConfigDir(override?: string): string {
  const dir = override ?? GLOBAL_BRAIN_DIR;
  ensureDir(dir);
  return dir;
}

export function getDataDir(override?: string): string {
  const dir = override ?? GLOBAL_BRAIN_DIR;
  ensureDir(dir);
  return dir;
}

export function getConfigPath(instanceRoot?: string): string {
  const root = instanceRoot ?? GLOBAL_BRAIN_DIR;
  ensureDir(root);
  return join(root, 'config.json');
}

export function getDefaultConfig(instanceRoot?: string): BrainConfig {
  const root = instanceRoot ?? GLOBAL_BRAIN_DIR;
  return {
    notesDir: join(homedir(), 'brain'),
    dbPath: join(root, 'brain.db'),
    embedder: 'local',
    fusionWeights: { bm25: 0.3, vector: 0.7 },
  };
}

export function loadConfig(instance?: InstancePaths): BrainConfig {
  const globalDefaults = getDefaultConfig(GLOBAL_BRAIN_DIR);
  const globalPath = getConfigPath(GLOBAL_BRAIN_DIR);

  let config = { ...globalDefaults };

  if (existsSync(globalPath)) {
    const raw = JSON.parse(readFileSync(globalPath, 'utf-8')) as Partial<BrainConfig>;
    config = {
      ...config,
      ...raw,
      fusionWeights: { ...config.fusionWeights, ...raw.fusionWeights },
    };
  }

  if (instance && instance.isLocal) {
    const localDefaults = getDefaultConfig(instance.root);
    config.dbPath = localDefaults.dbPath;
    config.notesDir = join(instance.root, 'notes');

    const localPath = getConfigPath(instance.root);
    if (existsSync(localPath)) {
      const raw = JSON.parse(readFileSync(localPath, 'utf-8')) as Partial<BrainConfig>;
      config = {
        ...config,
        ...raw,
        fusionWeights: { ...config.fusionWeights, ...raw.fusionWeights },
      };
    }
  }

  return config;
}

export function saveConfig(config: Partial<BrainConfig>, instanceRoot?: string): void {
  validateConfig(config);

  const root = instanceRoot ?? GLOBAL_BRAIN_DIR;
  const filePath = getConfigPath(root);

  const defaults = getDefaultConfig(root);
  let existing: BrainConfig;
  if (existsSync(filePath)) {
    const raw = JSON.parse(readFileSync(filePath, 'utf-8')) as Partial<BrainConfig>;
    existing = {
      ...defaults,
      ...raw,
      fusionWeights: { ...defaults.fusionWeights, ...raw.fusionWeights },
    };
  } else {
    existing = defaults;
  }

  const merged: BrainConfig = {
    ...existing,
    ...config,
    fusionWeights: { ...existing.fusionWeights, ...config.fusionWeights },
  };

  writeFileSync(filePath, JSON.stringify(merged, null, 2) + '\n', 'utf-8');
}

export function migrateFromEnvPaths(
  oldConfigDir: string,
  oldDataDir: string,
  newGlobalDir: string
): boolean {
  const oldConfigPath = join(oldConfigDir, 'config.json');
  const oldDbPath = join(oldDataDir, 'brain.db');

  if (!existsSync(oldConfigPath) && !existsSync(oldDbPath)) {
    return false;
  }

  ensureDir(newGlobalDir);

  if (existsSync(oldDbPath)) {
    copyFileSync(oldDbPath, join(newGlobalDir, 'brain.db'));
  }

  if (existsSync(oldConfigPath)) {
    const raw = JSON.parse(readFileSync(oldConfigPath, 'utf-8')) as Record<string, unknown>;
    raw.dbPath = join(newGlobalDir, 'brain.db');
    writeFileSync(join(newGlobalDir, 'config.json'), JSON.stringify(raw, null, 2) + '\n', 'utf-8');
  }

  return true;
}
