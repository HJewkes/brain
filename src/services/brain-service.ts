import { loadConfig } from './config.js';
import { BrainDB } from './brain-db.js';
import { createEmbedder } from '../adapters/index.js';
import type { Embedder, BrainConfig } from '../types.js';

export interface BrainService {
  db: BrainDB;
  embedder: Embedder;
  config: BrainConfig;
  close(): void;
}

export interface DbService {
  db: BrainDB;
  config: BrainConfig;
  close(): void;
}

export async function withBrain<T>(fn: (svc: BrainService) => T | Promise<T>): Promise<T> {
  const config = loadConfig();
  const db = new BrainDB(config.dbPath);
  const embedder = createEmbedder(config);
  const svc: BrainService = {
    db,
    embedder,
    config,
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

export async function withDb<T>(fn: (svc: DbService) => T | Promise<T>): Promise<T> {
  const config = loadConfig();
  const db = new BrainDB(config.dbPath);
  const svc: DbService = {
    db,
    config,
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
