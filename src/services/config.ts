import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import envPaths from 'env-paths';
import type { BrainConfig, EmbedderBackend } from '../types.js';

const paths = envPaths('brain', { suffix: '' });

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

export function getConfigDir(override?: string): string {
  const dir = override ?? paths.config;
  ensureDir(dir);
  return dir;
}

export function getDataDir(override?: string): string {
  const dir = override ?? paths.data;
  ensureDir(dir);
  return dir;
}

export function getConfigPath(configDir?: string): string {
  return join(getConfigDir(configDir), 'config.json');
}

export function getDefaultConfig(dataDir?: string): BrainConfig {
  return {
    notesDir: join(homedir(), 'brain'),
    dbPath: join(getDataDir(dataDir), 'brain.db'),
    embedder: 'local',
    fusionWeights: { bm25: 0.3, vector: 0.7 },
  };
}

export function loadConfig(configDir?: string, dataDir?: string): BrainConfig {
  const defaults = getDefaultConfig(dataDir);
  const filePath = getConfigPath(configDir);

  if (!existsSync(filePath)) {
    return defaults;
  }

  const raw = JSON.parse(readFileSync(filePath, 'utf-8')) as Partial<BrainConfig>;

  return {
    ...defaults,
    ...raw,
    fusionWeights: {
      ...defaults.fusionWeights,
      ...raw.fusionWeights,
    },
  };
}

export function saveConfig(
  config: Partial<BrainConfig>,
  configDir?: string,
  dataDir?: string
): void {
  validateConfig(config);

  const existing = loadConfig(configDir, dataDir);
  const merged: BrainConfig = {
    ...existing,
    ...config,
    fusionWeights: {
      ...existing.fusionWeights,
      ...config.fusionWeights,
    },
  };

  const filePath = getConfigPath(configDir);
  writeFileSync(filePath, JSON.stringify(merged, null, 2) + '\n', 'utf-8');
}
