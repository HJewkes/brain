import { describe, it, expect } from 'vitest';
import {
  extractExports,
  extractDependencies,
  extractModulePurpose,
  computeExportsHash,
  extractFileInfo,
} from '../../../src/modules/codebase/extractors/typescript-extractor.js';

// ---------------------------------------------------------------------------
// extractExports
// ---------------------------------------------------------------------------

describe('extractExports', () => {
  it('extracts simple function export', () => {
    const content = `export function hashContent(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}`;
    const exports = extractExports(content);
    expect(exports).toHaveLength(1);
    expect(exports[0]).toEqual({
      name: 'hashContent',
      kind: 'function',
      signature: 'export function hashContent(content: string): string',
    });
  });

  it('extracts async function export', () => {
    const content = `export async function scanForChanges(
  rootDir: string,
  knownFiles: Map<string, FileRecord>
): Promise<ScanResult> {
  // ...
}`;
    const exports = extractExports(content);
    expect(exports).toHaveLength(1);
    expect(exports[0].name).toBe('scanForChanges');
    expect(exports[0].kind).toBe('function');
    expect(exports[0].signature).toContain('scanForChanges(');
    expect(exports[0].signature).toContain('rootDir: string');
    expect(exports[0].signature).toContain('Promise<ScanResult>');
  });

  it('extracts class export', () => {
    const content = `export class SearchThrottle {
  private buckets = new Map();
}`;
    const exports = extractExports(content);
    expect(exports).toHaveLength(1);
    expect(exports[0]).toEqual({
      name: 'SearchThrottle',
      kind: 'class',
      signature: 'export class SearchThrottle',
    });
  });

  it('extracts interface export', () => {
    const content = `export interface ScanResult {
  new: Array<{ path: string; hash: string; mtime: number }>;
  modified: Array<{ path: string; hash: string; mtime: number }>;
}`;
    const exports = extractExports(content);
    expect(exports).toHaveLength(1);
    expect(exports[0]).toEqual({
      name: 'ScanResult',
      kind: 'interface',
      signature: 'export interface ScanResult',
    });
  });

  it('extracts type export', () => {
    const content = `export type ExportKind = 'function' | 'class' | 'interface' | 'type' | 'const' | 'enum';`;
    const exports = extractExports(content);
    expect(exports).toHaveLength(1);
    expect(exports[0]).toEqual({
      name: 'ExportKind',
      kind: 'type',
      signature:
        "export type ExportKind = 'function' | 'class' | 'interface' | 'type' | 'const' | 'enum'",
    });
  });

  it('extracts const export', () => {
    const content = `export const INDEXABLE_EXTENSIONS = new Set(['.md', '.csv', '.txt']);`;
    const exports = extractExports(content);
    expect(exports).toHaveLength(1);
    expect(exports[0]).toEqual({
      name: 'INDEXABLE_EXTENSIONS',
      kind: 'const',
      signature: "export const INDEXABLE_EXTENSIONS = new Set(['.md', '.csv', '.txt'])",
    });
  });

  it('extracts let export as const kind', () => {
    const content = `export let counter = 0;`;
    const exports = extractExports(content);
    expect(exports).toHaveLength(1);
    expect(exports[0].kind).toBe('const');
  });

  it('extracts enum export', () => {
    const content = `export enum Status {
  Active = 'active',
  Inactive = 'inactive',
}`;
    const exports = extractExports(content);
    expect(exports).toHaveLength(1);
    expect(exports[0]).toEqual({
      name: 'Status',
      kind: 'enum',
      signature: 'export enum Status',
    });
  });

  it('extracts default function export', () => {
    const content = `export default function createModule() {
  return {};
}`;
    const exports = extractExports(content);
    expect(exports).toHaveLength(1);
    expect(exports[0]).toEqual({
      name: 'createModule',
      kind: 'function',
      signature: 'export default function createModule()',
    });
  });

  it('extracts default class export', () => {
    const content = `export default class Router {
  routes = [];
}`;
    const exports = extractExports(content);
    expect(exports).toHaveLength(1);
    expect(exports[0]).toEqual({
      name: 'Router',
      kind: 'class',
      signature: 'export default class Router',
    });
  });

  it('extracts unnamed default export', () => {
    const content = `export default knowledgeModule;`;
    const exports = extractExports(content);
    expect(exports).toHaveLength(1);
    expect(exports[0]).toEqual({
      name: 'default',
      kind: 'const',
      signature: 'export default knowledgeModule',
    });
  });

  it('extracts re-exports', () => {
    const content = `export { LocalEmbedder } from './local-embedder.js';
export { OllamaEmbedder } from './ollama-embedder.js';`;
    const exports = extractExports(content);
    expect(exports).toHaveLength(2);
    expect(exports[0].name).toBe('LocalEmbedder');
    expect(exports[1].name).toBe('OllamaEmbedder');
  });

  it('extracts re-exports with aliases', () => {
    const content = `export { sanitizeFtsQuery as sanitize } from './repos/note-repo.js';`;
    const exports = extractExports(content);
    expect(exports).toHaveLength(1);
    expect(exports[0].name).toBe('sanitize');
  });

  it('extracts multiple re-exports from single line', () => {
    const content = `export { hookAllow, hookBlock, hookAllowJson } from './types.js';`;
    const exports = extractExports(content);
    expect(exports).toHaveLength(3);
    expect(exports.map((e) => e.name)).toEqual(['hookAllow', 'hookBlock', 'hookAllowJson']);
  });

  it('extracts bare re-export (no from)', () => {
    const content = `export { slugify };`;
    const exports = extractExports(content);
    expect(exports).toHaveLength(1);
    expect(exports[0].name).toBe('slugify');
  });

  it('handles class with generics', () => {
    const content = `export class Repository<T extends Entity> {
  constructor(private db: Database) {}
}`;
    const exports = extractExports(content);
    expect(exports).toHaveLength(1);
    expect(exports[0]).toEqual({
      name: 'Repository',
      kind: 'class',
      signature: 'export class Repository<T extends Entity>',
    });
  });

  it('handles interface with generics', () => {
    const content = `export interface Result<T, E = Error> {
  data?: T;
  error?: E;
}`;
    const exports = extractExports(content);
    expect(exports).toHaveLength(1);
    expect(exports[0].name).toBe('Result');
    expect(exports[0].signature).toBe('export interface Result<T, E = Error>');
  });

  it('handles multiline function signature', () => {
    const content = `export function search(
  db: BrainDB,
  query: string,
  opts: SearchOptions
): Promise<SearchResult[]> {
  // body
}`;
    const exports = extractExports(content);
    expect(exports).toHaveLength(1);
    expect(exports[0].name).toBe('search');
    expect(exports[0].signature).toContain('db: BrainDB');
    expect(exports[0].signature).toContain('Promise<SearchResult[]>');
  });

  it('extracts multiple exports from a file', () => {
    const content = `export interface Config {
  key: string;
}

export function loadConfig(): Config {
  return { key: '' };
}

export const DEFAULT_CONFIG: Config = { key: 'default' };`;

    const exports = extractExports(content);
    expect(exports).toHaveLength(3);
    expect(exports.map((e) => e.name)).toEqual(['Config', 'loadConfig', 'DEFAULT_CONFIG']);
    expect(exports.map((e) => e.kind)).toEqual(['interface', 'function', 'const']);
  });

  it('handles declare keyword', () => {
    const content = `export declare function createApp(opts: AppOptions): App;`;
    const exports = extractExports(content);
    expect(exports).toHaveLength(1);
    expect(exports[0].name).toBe('createApp');
    expect(exports[0].kind).toBe('function');
  });

  it('ignores non-export lines', () => {
    const content = `import { foo } from './foo.js';

const internal = 42;

function helper() {}

export function publicApi(): void {}`;
    const exports = extractExports(content);
    expect(exports).toHaveLength(1);
    expect(exports[0].name).toBe('publicApi');
  });
});

// ---------------------------------------------------------------------------
// extractDependencies
// ---------------------------------------------------------------------------

describe('extractDependencies', () => {
  it('classifies internal dependencies (relative paths)', () => {
    const content = `import { hashContent } from './file-scanner.js';
import type { FileRecord } from '../types.js';`;
    const deps = extractDependencies(content, 'src/services/indexing.ts');
    expect(deps.internal).toHaveLength(2);
    expect(deps.internal[0]).toEqual({
      path: './file-scanner.js',
      imports: ['hashContent'],
    });
    expect(deps.internal[1]).toEqual({
      path: '../types.js',
      imports: ['FileRecord'],
    });
    expect(deps.external).toHaveLength(0);
  });

  it('classifies external dependencies (package names)', () => {
    const content = `import { createHash } from 'node:crypto';
import Database from 'better-sqlite3';`;
    const deps = extractDependencies(content, 'src/services/brain-db.ts');
    expect(deps.external).toHaveLength(2);
    expect(deps.external[0]).toEqual({
      path: undefined,
      package: 'node:crypto',
      imports: ['createHash'],
    });
    expect(deps.external[1]).toEqual({
      package: 'better-sqlite3',
      imports: ['Database'],
    });
  });

  it('handles mixed internal and external imports', () => {
    const content = `import { existsSync } from 'node:fs';
import type { BrainDB } from './brain-db.js';
import { computeHotnessScore, ageDays } from './hotness.js';
import { rerank } from './reranker.js';`;
    const deps = extractDependencies(content, 'src/services/search.ts');
    expect(deps.external).toHaveLength(1);
    expect(deps.external[0].package).toBe('node:fs');
    expect(deps.internal).toHaveLength(3);
    expect(deps.internal[1].imports).toEqual(['computeHotnessScore', 'ageDays']);
  });

  it('handles default + named imports', () => {
    const content = `import Database, { Statement } from 'better-sqlite3';`;
    const deps = extractDependencies(content, 'src/db.ts');
    expect(deps.external).toHaveLength(1);
    expect(deps.external[0].imports).toEqual(['Database', 'Statement']);
  });

  it('handles side-effect imports', () => {
    const content = `import './polyfills.js';
import 'reflect-metadata';`;
    const deps = extractDependencies(content, 'src/main.ts');
    expect(deps.internal).toHaveLength(1);
    expect(deps.internal[0].path).toBe('./polyfills.js');
    expect(deps.internal[0].imports).toEqual([]);
    expect(deps.external).toHaveLength(1);
    expect(deps.external[0].package).toBe('reflect-metadata');
  });

  it('handles type imports', () => {
    const content = `import type { ModuleRegistry } from '../modules/registry.js';`;
    const deps = extractDependencies(content, 'src/services/search.ts');
    expect(deps.internal).toHaveLength(1);
    expect(deps.internal[0].imports).toEqual(['ModuleRegistry']);
  });

  it('handles aliased imports', () => {
    const content = `import { readFile as read, writeFile as write } from 'node:fs/promises';`;
    const deps = extractDependencies(content, 'src/util.ts');
    expect(deps.external).toHaveLength(1);
    expect(deps.external[0].imports).toEqual(['read', 'write']);
  });

  it('returns empty when no imports', () => {
    const content = `export const PI = 3.14159;`;
    const deps = extractDependencies(content, 'src/constants.ts');
    expect(deps.internal).toEqual([]);
    expect(deps.external).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// extractModulePurpose
// ---------------------------------------------------------------------------

describe('extractModulePurpose', () => {
  it('extracts single-line JSDoc', () => {
    const content = `/** Shared utilities for string manipulation */
import { foo } from './foo.js';`;
    expect(extractModulePurpose(content)).toBe('Shared utilities for string manipulation');
  });

  it('extracts multiline JSDoc', () => {
    const content = `/**
 * Architecture note frontmatter.
 *
 * Extends the base NoteFrontmatter pattern used by all brain notes.
 */
export interface ArchitectureNoteFrontmatter {}`;
    expect(extractModulePurpose(content)).toBe(
      'Architecture note frontmatter. Extends the base NoteFrontmatter pattern used by all brain notes.'
    );
  });

  it('extracts single-line comment purpose', () => {
    const content = `// Configuration loading via env-paths
import { join } from 'node:path';`;
    expect(extractModulePurpose(content)).toBe('Configuration loading via env-paths');
  });

  it('extracts multi-line comment purpose', () => {
    const content = `// Search orchestration module
// Combines BM25 and vector search with RRF fusion

import { foo } from './foo.js';`;
    expect(extractModulePurpose(content)).toBe(
      'Search orchestration module Combines BM25 and vector search with RRF fusion'
    );
  });

  it('returns undefined when no leading comment', () => {
    const content = `import { foo } from './foo.js';

export function bar() {}`;
    expect(extractModulePurpose(content)).toBeUndefined();
  });

  it('handles leading whitespace before JSDoc', () => {
    const content = `
/** Module purpose here */
export function foo() {}`;
    expect(extractModulePurpose(content)).toBe('Module purpose here');
  });
});

// ---------------------------------------------------------------------------
// computeExportsHash
// ---------------------------------------------------------------------------

describe('computeExportsHash', () => {
  it('produces a hex SHA-256 hash', () => {
    const hash = computeExportsHash([
      { name: 'foo', kind: 'function', signature: 'export function foo(): void' },
    ]);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('is stable for same exports', () => {
    const exports = [
      { name: 'a', kind: 'function' as const, signature: 'export function a(): void' },
      { name: 'b', kind: 'const' as const, signature: 'export const b = 1' },
    ];
    const hash1 = computeExportsHash(exports);
    const hash2 = computeExportsHash(exports);
    expect(hash1).toBe(hash2);
  });

  it('is order-independent (sorts by name)', () => {
    const v1 = [
      { name: 'b', kind: 'const' as const, signature: 'export const b = 1' },
      { name: 'a', kind: 'function' as const, signature: 'export function a(): void' },
    ];
    const v2 = [
      { name: 'a', kind: 'function' as const, signature: 'export function a(): void' },
      { name: 'b', kind: 'const' as const, signature: 'export const b = 1' },
    ];
    expect(computeExportsHash(v1)).toBe(computeExportsHash(v2));
  });

  it('changes when signatures differ', () => {
    const v1 = [
      { name: 'foo', kind: 'function' as const, signature: 'export function foo(): void' },
    ];
    const v2 = [
      { name: 'foo', kind: 'function' as const, signature: 'export function foo(): string' },
    ];
    expect(computeExportsHash(v1)).not.toBe(computeExportsHash(v2));
  });

  it('changes when exports are added', () => {
    const v1 = [
      { name: 'foo', kind: 'function' as const, signature: 'export function foo(): void' },
    ];
    const v2 = [...v1, { name: 'bar', kind: 'const' as const, signature: 'export const bar = 42' }];
    expect(computeExportsHash(v1)).not.toBe(computeExportsHash(v2));
  });
});

// ---------------------------------------------------------------------------
// extractFileInfo
// ---------------------------------------------------------------------------

describe('extractFileInfo', () => {
  it('combines all extractors into a ModuleSummary', () => {
    const content = `/** Database facade */
import { createHash } from 'node:crypto';
import type { FileRecord } from '../types.js';

export interface ScanResult {
  new: string[];
}

export function hashContent(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

export const VERSION = '1.0.0';`;

    const result = extractFileInfo('/project/src/services/file-scanner.ts', content, '/project');

    expect(result.modulePath).toBe('src/services/file-scanner.ts');
    expect(result.language).toBe('typescript');
    expect(result.exports).toHaveLength(3);
    expect(result.exports.map((e) => e.name)).toEqual(['ScanResult', 'hashContent', 'VERSION']);
    expect(result.dependencies.external).toHaveLength(1);
    expect(result.dependencies.internal).toHaveLength(1);
    expect(result.exportHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('uses filePath as modulePath when no projectRoot', () => {
    const result = extractFileInfo('/abs/path/foo.ts', 'export const x = 1;');
    expect(result.modulePath).toBe('/abs/path/foo.ts');
  });
});
