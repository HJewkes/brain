import Database from 'better-sqlite3';
import { resolveInstance, loadConfig } from '../../services/config.js';
import { countActiveAgents } from '../../modules/agents/data.js';
import { existsSync } from 'node:fs';

/**
 * Count active agents using the DB. Returns null if the DB is unavailable
 * so callers can fall back to process-based counting.
 *
 * Delegates to the canonical countActiveAgents() in agents/data.ts,
 * wrapping it with DB lifecycle management for hook contexts that
 * don't already have a DB handle.
 */
export function countActiveAgentsFromDb(cwd: string): number | null {
  let db: Database.Database | undefined;
  try {
    const instance = resolveInstance({ cwd });
    const config = loadConfig(instance);
    const dbPath = config.dbPath;
    if (!existsSync(dbPath)) return null;

    db = new Database(dbPath, { readonly: true });
    return countActiveAgents(db);
  } catch {
    return null;
  } finally {
    db?.close();
  }
}
