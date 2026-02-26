import { readdirSync, existsSync } from 'node:fs';
import { join, basename, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ModuleRegistry } from './registry.js';
import { createModuleContext } from './context.js';
import type { BrainModule } from './types.js';

function getBuiltinModulesDir(): string {
  try {
    const thisDir = import.meta.dirname ?? dirname(fileURLToPath(import.meta.url));
    return join(thisDir, '..', '..', 'modules');
  } catch {
    return '';
  }
}

/**
 * Discover built-in module files from the modules directory.
 * Convention: each module is a single file exporting a BrainModule as default.
 */
export function discoverModules(modulesDir?: string): string[] {
  const dir = modulesDir ?? getBuiltinModulesDir();
  if (!dir || !existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.js') || f.endsWith('.ts'))
    .filter((f) => !f.startsWith('_') && !f.endsWith('.test.ts') && !f.endsWith('.test.js'))
    .map((f) => join(dir, f));
}

/**
 * Load modules: create a registry, discover and register all modules.
 * Errors during individual module registration are caught and reported
 * but don't prevent other modules from loading.
 */
export async function loadModules(opts?: {
  modulesDir?: string;
  modules?: BrainModule[];
}): Promise<{ registry: ModuleRegistry; errors: Array<{ module: string; error: Error }> }> {
  const registry = new ModuleRegistry();
  const errors: Array<{ module: string; error: Error }> = [];

  if (opts?.modules) {
    for (const mod of opts.modules) {
      try {
        registry.registerModule(mod);
        const ctx = createModuleContext(registry, mod.name);
        mod.register(ctx);
      } catch (err) {
        errors.push({
          module: mod.name,
          error: err instanceof Error ? err : new Error(String(err)),
        });
      }
    }
  }

  const modulePaths = discoverModules(opts?.modulesDir);
  for (const modulePath of modulePaths) {
    const name = basename(modulePath).replace(/\.[jt]s$/, '');
    try {
      const imported = await import(modulePath);
      const mod: BrainModule = imported.default ?? imported;
      if (!mod.name || !mod.register) {
        throw new Error(`Module at ${modulePath} does not export a valid BrainModule`);
      }
      registry.registerModule(mod);
      const ctx = createModuleContext(registry, mod.name);
      mod.register(ctx);
    } catch (err) {
      errors.push({
        module: name,
        error: err instanceof Error ? err : new Error(String(err)),
      });
    }
  }

  return { registry, errors };
}

/**
 * Run pending migrations for all loaded modules.
 * Migrations are sorted by version and executed in order.
 */
export function runModuleMigrations(
  registry: ModuleRegistry,
  db: unknown,
  currentVersions: Map<string, number>,
): Array<{ module: string; version: number }> {
  const applied: Array<{ module: string; version: number }> = [];
  const allMigrations = registry.getMigrations();

  const byModule = new Map<string, typeof allMigrations>();
  for (const entry of allMigrations) {
    const list = byModule.get(entry.module) ?? [];
    list.push(entry);
    byModule.set(entry.module, list);
  }

  for (const [moduleName, migrations] of byModule) {
    const currentVersion = currentVersions.get(moduleName) ?? 0;
    const pending = migrations
      .filter((m) => m.migration.version > currentVersion)
      .sort((a, b) => a.migration.version - b.migration.version);

    for (const entry of pending) {
      entry.migration.up(db);
      applied.push({ module: moduleName, version: entry.migration.version });
    }
  }

  return applied;
}
