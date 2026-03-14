import Database from 'better-sqlite3';
import { resolveInstance, loadConfig } from '../../services/config.js';
import { existsSync } from 'node:fs';

/**
 * Count active agents using the DB. Returns null if the DB is unavailable
 * so callers can fall back to process-based counting.
 */
export function countActiveAgentsFromDb(cwd: string): number | null {
  let db: Database.Database | undefined;
  try {
    const instance = resolveInstance({ cwd });
    const config = loadConfig(instance);
    const dbPath = config.dbPath;
    if (!existsSync(dbPath)) return null;

    db = new Database(dbPath, { readonly: true });
    const row = db.prepare("SELECT COUNT(*) as n FROM agents WHERE status = 'active'").get() as {
      n: number;
    };
    return row.n;
  } catch {
    return null;
  } finally {
    db?.close();
  }
}
