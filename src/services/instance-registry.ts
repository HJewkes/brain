import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import Database from 'better-sqlite3';

export interface InstanceEntry {
  path: string;
  name: string;
  projects?: string[];
  repo?: string;
  primary?: boolean;
  createdAt: string;
}

export interface InstanceRegistry {
  instances: InstanceEntry[];
}

export interface InstanceStatus {
  entry: InstanceEntry;
  noteCount: number;
  lastIndexed: string | null;
  projects: string[];
  error: string | null;
}

const REGISTRY_FILE = 'instances.json';

function registryPath(globalDir: string): string {
  return join(globalDir, REGISTRY_FILE);
}

export function loadRegistry(globalDir: string): InstanceRegistry {
  const filePath = registryPath(globalDir);
  if (!existsSync(filePath)) {
    return { instances: [] };
  }
  return JSON.parse(readFileSync(filePath, 'utf-8')) as InstanceRegistry;
}

function saveRegistry(globalDir: string, registry: InstanceRegistry): void {
  if (!existsSync(globalDir)) {
    mkdirSync(globalDir, { recursive: true });
  }
  writeFileSync(registryPath(globalDir), JSON.stringify(registry, null, 2) + '\n', 'utf-8');
}

export function registerInstance(
  globalDir: string,
  instancePath: string,
  name: string,
  opts: { projects?: string[]; repo?: string; primary?: boolean } = {}
): void {
  const registry = loadRegistry(globalDir);
  const existing = registry.instances.findIndex((i) => i.path === instancePath);

  const entry: InstanceEntry = {
    path: instancePath,
    name,
    createdAt: new Date().toISOString(),
    ...opts,
  };

  if (existing >= 0) {
    entry.createdAt = registry.instances[existing].createdAt;
    registry.instances[existing] = entry;
  } else {
    registry.instances.push(entry);
  }

  saveRegistry(globalDir, registry);
}

export function unregisterInstance(globalDir: string, nameOrPath: string): boolean {
  const registry = loadRegistry(globalDir);
  const before = registry.instances.length;
  registry.instances = registry.instances.filter(
    (i) => i.name !== nameOrPath && i.path !== nameOrPath
  );
  const removed = before - registry.instances.length;
  if (removed > 0) {
    saveRegistry(globalDir, registry);
  }
  return removed > 0;
}

export function listInstances(globalDir: string): InstanceEntry[] {
  return loadRegistry(globalDir).instances;
}

export function pruneStaleInstances(globalDir: string): number {
  const registry = loadRegistry(globalDir);
  const before = registry.instances.length;
  registry.instances = registry.instances.filter((i) => existsSync(i.path));
  const pruned = before - registry.instances.length;

  if (pruned > 0) {
    saveRegistry(globalDir, registry);
  }

  return pruned;
}

/** Query an instance's brain.db for note counts, last-indexed, and PM projects */
export function queryInstanceStatus(entry: InstanceEntry): InstanceStatus {
  const dbPath = join(entry.path, 'brain.db');
  if (!existsSync(dbPath)) {
    return { entry, noteCount: 0, lastIndexed: null, projects: [], error: 'brain.db not found' };
  }

  let db: Database.Database | null = null;
  try {
    db = new Database(dbPath, { readonly: true, fileMustExist: true });

    const noteCount = (db.prepare('SELECT COUNT(*) as n FROM notes').get() as { n: number }).n;

    // Last indexed: max indexed_at from files table
    let lastIndexed: string | null = null;
    try {
      const row = db.prepare('SELECT MAX(indexed_at) as t FROM files').get() as
        | { t: number | null }
        | undefined;
      if (row?.t) {
        lastIndexed = new Date(row.t).toISOString();
      }
    } catch {
      // table may not exist in older schema versions
    }

    // PM projects from module metadata notes
    const projects: string[] = [];
    try {
      const projectRows = db
        .prepare(
          "SELECT DISTINCT json_extract(metadata, '$.prefix') as prefix " +
            "FROM notes WHERE module = 'pm' AND type = 'project' " +
            "AND json_extract(metadata, '$.prefix') IS NOT NULL"
        )
        .all() as { prefix: string }[];
      for (const row of projectRows) {
        if (row.prefix) projects.push(row.prefix);
      }
    } catch {
      // pm tables may not exist
    }

    return { entry, noteCount, lastIndexed, projects, error: null };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { entry, noteCount: 0, lastIndexed: null, projects: [], error: msg };
  } finally {
    db?.close();
  }
}

/** Candidate locations to scan for undiscovered brain instances */
function candidateDirs(): string[] {
  const home = homedir();
  const candidates: string[] = [
    join(home, '.brain'),
    join(home, 'Library', 'Application Support', 'brain'),
  ];

  // Scan ~/Documents/projects/ for .brain subdirectories
  const projectsDir = join(home, 'Documents', 'projects');
  if (existsSync(projectsDir)) {
    try {
      for (const entry of readdirSync(projectsDir)) {
        const dir = join(projectsDir, entry);
        try {
          if (statSync(dir).isDirectory()) {
            candidates.push(join(dir, '.brain'));
          }
        } catch {
          // skip unreadable entries
        }
      }
    } catch {
      // skip unreadable projects dir
    }
  }

  return candidates;
}

/** Find .brain directories that exist but are not registered */
export function discoverInstances(globalDir: string): string[] {
  const registry = loadRegistry(globalDir);
  const registered = new Set(registry.instances.map((i) => resolve(i.path)));
  // Also exclude the global dir itself
  registered.add(resolve(globalDir));

  const discovered: string[] = [];
  for (const candidate of candidateDirs()) {
    const abs = resolve(candidate);
    if (registered.has(abs)) continue;
    if (existsSync(abs) && existsSync(join(abs, 'brain.db'))) {
      discovered.push(abs);
    }
  }
  return discovered;
}
