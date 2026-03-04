import { loadConfig, resolveInstance } from './config.js';
import type { ResolveOptions, InstancePaths } from './config.js';
import { BrainDB } from './brain-db.js';
import { createEmbedder } from '../adapters/index.js';
import { loadModules } from '../modules/loader.js';
import type { ModuleRegistry } from '../modules/registry.js';
import type { Embedder, BrainConfig } from '../types.js';

export interface BrainService {
  db: BrainDB;
  embedder: Embedder;
  config: BrainConfig;
  modules: ModuleRegistry;
  instance: InstancePaths;
  close(): void;
}

export interface DbService {
  db: BrainDB;
  config: BrainConfig;
  instance: InstancePaths;
  close(): void;
}

export async function withBrain<T>(
  fn: (svc: BrainService) => T | Promise<T>,
  resolveOpts?: ResolveOptions
): Promise<T> {
  const instance = resolveInstance(resolveOpts);
  const config = loadConfig(instance);
  const db = new BrainDB(config.dbPath);
  const embedder = createEmbedder(config);
  const { registry } = await loadModules();
  const svc: BrainService = {
    db,
    embedder,
    config,
    modules: registry,
    instance,
    close() {
      db.close();
    },
  };
  try {
    return await fn(svc);
  } finally {
    svc.close();
  }
}

export async function withDb<T>(
  fn: (svc: DbService) => T | Promise<T>,
  resolveOpts?: ResolveOptions
): Promise<T> {
  const instance = resolveInstance(resolveOpts);
  const config = loadConfig(instance);
  const db = new BrainDB(config.dbPath);
  const svc: DbService = {
    db,
    config,
    instance,
    close() {
      db.close();
    },
  };
  try {
    return await fn(svc);
  } finally {
    svc.close();
  }
}
