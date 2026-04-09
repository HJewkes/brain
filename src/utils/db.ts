import type Database from 'better-sqlite3';
import type { BrainDB } from '../services/brain-db.js';

/** Extract the underlying better-sqlite3 Database from a BrainDB or pass-through a raw Database. */
export function getRawDb(db: BrainDB | Database.Database): Database.Database {
  if ('rawDb' in db) return (db as BrainDB).rawDb;
  return db as Database.Database;
}

/** Promise-based delay. */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
