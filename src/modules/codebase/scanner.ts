import { readFile, readdir } from 'node:fs/promises';
import { join, relative, dirname, extname } from 'node:path';
import { extractFileInfo, computeExportsHash } from './extractors/typescript-extractor.js';
import type { ModuleSummary, ExportSignature, ModuleDependencies } from './types.js';

// ---------------------------------------------------------------------------
// Public interfaces
// ---------------------------------------------------------------------------

export interface ScanOptions {
  include?: string[];
  exclude?: string[];
  previousHashes?: Map<string, string>;
}

export interface ScanResult {
  modules: ModuleSummary[];
  changed: string[];
  unchanged: string[];
  stats: { filesScanned: number; modulesFound: number; modulesChanged: number };
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_INCLUDE = ['src/**/*.ts'];
const DEFAULT_EXCLUDE = ['**/*.test.ts', '**/*.spec.ts', '**/node_modules/**', '**/dist/**'];

// ---------------------------------------------------------------------------
// Pattern matching
// ---------------------------------------------------------------------------

/** Convert a glob pattern to a RegExp for matching relative paths. */
function globToRegex(pattern: string): RegExp {
  let p = pattern;
  // Replace **/ (match zero or more directory segments) and /** (trailing)
  p = p.replace(/\*\*\//g, '<STARSTAR_SLASH>');
  p = p.replace(/\/\*\*/g, '<SLASH_STARSTAR>');
  // Escape regex specials (except our placeholders and *)
  p = p.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  // Single * matches anything except /
  p = p.replace(/\*/g, '[^/]*');
  p = p.replace(/\?/g, '.');
  // Restore: <STARSTAR_SLASH> = zero or more leading directory segments
  p = p.replace(/<STARSTAR_SLASH>/g, '(?:.+/)?');
  // <SLASH_STARSTAR> = optional trailing path
  p = p.replace(/<SLASH_STARSTAR>/g, '(?:/.*)?');
  return new RegExp(`^${p}$`);
}

function matchesAny(path: string, patterns: RegExp[]): boolean {
  return patterns.some((re) => re.test(path));
}

// ---------------------------------------------------------------------------
// File discovery
// ---------------------------------------------------------------------------

export async function discoverFiles(
  projectDir: string,
  include: string[],
  exclude: string[]
): Promise<string[]> {
  const includeRe = include.map(globToRegex);
  const excludeRe = exclude.map(globToRegex);

  const entries = await readdir(projectDir, { recursive: true });
  return entries
    .filter((entry) => {
      if (extname(entry) !== '.ts') return false;
      return matchesAny(entry, includeRe) && !matchesAny(entry, excludeRe);
    })
    .map((entry) => join(projectDir, entry));
}

// ---------------------------------------------------------------------------
// Module grouping
// ---------------------------------------------------------------------------

/**
 * Groups files into modules based on directory structure.
 * Files directly in src/ form the "root" module.
 * Each subdirectory with .ts files is a distinct module.
 */
export function groupFilesByModule(files: string[], projectDir: string): Map<string, string[]> {
  const groups = new Map<string, string[]>();

  for (const file of files) {
    const rel = relative(projectDir, file);
    const dir = dirname(rel);
    const modulePath = dir === '.' ? 'root' : dir;

    const group = groups.get(modulePath);
    if (group) {
      group.push(file);
    } else {
      groups.set(modulePath, [file]);
    }
  }

  return groups;
}

// ---------------------------------------------------------------------------
// Module aggregation
// ---------------------------------------------------------------------------

function mergeExports(summaries: ModuleSummary[]): ExportSignature[] {
  const seen = new Set<string>();
  const merged: ExportSignature[] = [];
  for (const s of summaries) {
    for (const exp of s.exports) {
      const key = `${exp.kind}:${exp.name}`;
      if (!seen.has(key)) {
        seen.add(key);
        merged.push(exp);
      }
    }
  }
  return merged;
}

function mergeDependencies(summaries: ModuleSummary[]): ModuleDependencies {
  const internalMap = new Map<string, Set<string>>();
  const externalMap = new Map<string, Set<string>>();

  for (const s of summaries) {
    for (const dep of s.dependencies.internal) {
      const existing = internalMap.get(dep.path) ?? new Set<string>();
      dep.imports.forEach((i) => existing.add(i));
      internalMap.set(dep.path, existing);
    }
    for (const dep of s.dependencies.external) {
      const existing = externalMap.get(dep.package) ?? new Set<string>();
      dep.imports.forEach((i) => existing.add(i));
      externalMap.set(dep.package, existing);
    }
  }

  return {
    internal: [...internalMap.entries()].map(([path, imports]) => ({
      path,
      imports: [...imports],
    })),
    external: [...externalMap.entries()].map(([pkg, imports]) => ({
      package: pkg,
      imports: [...imports],
    })),
  };
}

/** Combine per-file summaries into a single module-level summary. */
export function aggregateModuleSummary(
  modulePath: string,
  fileSummaries: ModuleSummary[]
): ModuleSummary {
  const exports = mergeExports(fileSummaries);
  const dependencies = mergeDependencies(fileSummaries);
  const exportHash = computeExportsHash(exports);

  return {
    modulePath,
    language: 'typescript',
    exports,
    dependencies,
    exportHash,
  };
}

// ---------------------------------------------------------------------------
// Incremental comparison
// ---------------------------------------------------------------------------

function classifyModules(
  modules: ModuleSummary[],
  previousHashes?: Map<string, string>
): { changed: string[]; unchanged: string[] } {
  const changed: string[] = [];
  const unchanged: string[] = [];

  for (const mod of modules) {
    const prev = previousHashes?.get(mod.modulePath);
    if (prev && prev === mod.exportHash) {
      unchanged.push(mod.modulePath);
    } else {
      changed.push(mod.modulePath);
    }
  }

  return { changed, unchanged };
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export async function scanProject(projectDir: string, options?: ScanOptions): Promise<ScanResult> {
  const include = options?.include ?? DEFAULT_INCLUDE;
  const exclude = options?.exclude ?? DEFAULT_EXCLUDE;

  const files = await discoverFiles(projectDir, include, exclude);
  const groups = groupFilesByModule(files, projectDir);

  const modules: ModuleSummary[] = [];
  for (const [modulePath, moduleFiles] of groups) {
    const fileSummaries = await extractFileSummaries(moduleFiles, projectDir);
    modules.push(aggregateModuleSummary(modulePath, fileSummaries));
  }

  const { changed, unchanged } = classifyModules(modules, options?.previousHashes);

  return {
    modules,
    changed,
    unchanged,
    stats: {
      filesScanned: files.length,
      modulesFound: modules.length,
      modulesChanged: changed.length,
    },
  };
}

async function extractFileSummaries(files: string[], projectDir: string): Promise<ModuleSummary[]> {
  const summaries: ModuleSummary[] = [];
  for (const file of files) {
    const content = await readFile(file, 'utf-8');
    summaries.push(extractFileInfo(file, content, projectDir));
  }
  return summaries;
}
