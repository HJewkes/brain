import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export interface InstanceEntry {
  path: string;
  name: string;
  createdAt: string;
}

export interface InstanceRegistry {
  instances: InstanceEntry[];
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

export function registerInstance(globalDir: string, instancePath: string, name: string): void {
  const registry = loadRegistry(globalDir);
  const existing = registry.instances.findIndex((i) => i.path === instancePath);

  const entry: InstanceEntry = {
    path: instancePath,
    name,
    createdAt: new Date().toISOString(),
  };

  if (existing >= 0) {
    entry.createdAt = registry.instances[existing].createdAt;
    entry.name = name;
    registry.instances[existing] = entry;
  } else {
    registry.instances.push(entry);
  }

  saveRegistry(globalDir, registry);
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
