import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import {
  scanProject,
  groupFilesByModule,
  aggregateModuleSummary,
  discoverFiles,
} from '../../../src/modules/codebase/scanner.js';
import type { ModuleSummary } from '../../../src/modules/codebase/types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTmpDir(): string {
  const dir = join(tmpdir(), `scanner-test-${randomUUID()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function writeFile(base: string, relPath: string, content: string): string {
  const full = join(base, relPath);
  mkdirSync(join(full, '..'), { recursive: true });
  writeFileSync(full, content, 'utf-8');
  return full;
}

const SIMPLE_TS = `
export function hello(): string {
  return 'hello';
}
`;

const ANOTHER_TS = `
import { hello } from './index.js';

export const GREETING = hello();

export interface Config {
  name: string;
}
`;

const CLASS_TS = `
import { Config } from '../types.js';
import fs from 'node:fs';

export class Engine {
  run(): void {}
}
`;

// ---------------------------------------------------------------------------
// groupFilesByModule
// ---------------------------------------------------------------------------

describe('groupFilesByModule', () => {
  it('groups files in root as "root" module', () => {
    const projectDir = '/project';
    const files = ['/project/index.ts', '/project/utils.ts'];

    const groups = groupFilesByModule(files, projectDir);

    expect(groups.size).toBe(1);
    expect(groups.get('root')).toEqual(files);
  });

  it('groups files by directory into separate modules', () => {
    const projectDir = '/project';
    const files = [
      '/project/src/cli.ts',
      '/project/src/types.ts',
      '/project/src/services/search.ts',
      '/project/src/services/index.ts',
      '/project/src/modules/pm/engine.ts',
    ];

    const groups = groupFilesByModule(files, projectDir);

    expect(groups.size).toBe(3);
    expect(groups.get('src')!.length).toBe(2);
    expect(groups.get('src/services')!.length).toBe(2);
    expect(groups.get('src/modules/pm')!.length).toBe(1);
  });

  it('returns empty map for no files', () => {
    expect(groupFilesByModule([], '/project').size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// aggregateModuleSummary
// ---------------------------------------------------------------------------

describe('aggregateModuleSummary', () => {
  it('merges exports from multiple file summaries', () => {
    const summaries: ModuleSummary[] = [
      {
        modulePath: 'src/a.ts',
        language: 'typescript',
        exports: [{ name: 'foo', kind: 'function', signature: 'export function foo()' }],
        dependencies: { internal: [], external: [] },
        exportHash: 'aaa',
      },
      {
        modulePath: 'src/b.ts',
        language: 'typescript',
        exports: [{ name: 'bar', kind: 'const', signature: 'export const bar' }],
        dependencies: { internal: [], external: [] },
        exportHash: 'bbb',
      },
    ];

    const result = aggregateModuleSummary('src', summaries);

    expect(result.modulePath).toBe('src');
    expect(result.exports).toHaveLength(2);
    expect(result.exports.map((e) => e.name)).toEqual(['foo', 'bar']);
  });

  it('deduplicates exports with same kind and name', () => {
    const dup = { name: 'x', kind: 'const' as const, signature: 'export const x' };
    const summaries: ModuleSummary[] = [
      {
        modulePath: 'a.ts',
        language: 'typescript',
        exports: [dup],
        dependencies: { internal: [], external: [] },
        exportHash: '',
      },
      {
        modulePath: 'b.ts',
        language: 'typescript',
        exports: [dup],
        dependencies: { internal: [], external: [] },
        exportHash: '',
      },
    ];

    const result = aggregateModuleSummary('root', summaries);
    expect(result.exports).toHaveLength(1);
  });

  it('merges and deduplicates dependencies', () => {
    const summaries: ModuleSummary[] = [
      {
        modulePath: 'a.ts',
        language: 'typescript',
        exports: [],
        dependencies: {
          internal: [{ path: './utils.js', imports: ['slugify'] }],
          external: [{ package: 'node:fs', imports: ['readFile'] }],
        },
        exportHash: '',
      },
      {
        modulePath: 'b.ts',
        language: 'typescript',
        exports: [],
        dependencies: {
          internal: [{ path: './utils.js', imports: ['slugify', 'hashIt'] }],
          external: [{ package: 'node:fs', imports: ['writeFile'] }],
        },
        exportHash: '',
      },
    ];

    const result = aggregateModuleSummary('root', summaries);

    expect(result.dependencies.internal).toHaveLength(1);
    expect(result.dependencies.internal[0].imports).toContain('slugify');
    expect(result.dependencies.internal[0].imports).toContain('hashIt');

    expect(result.dependencies.external).toHaveLength(1);
    expect(result.dependencies.external[0].imports).toContain('readFile');
    expect(result.dependencies.external[0].imports).toContain('writeFile');
  });

  it('computes a stable exportHash from merged exports', () => {
    const summaries: ModuleSummary[] = [
      {
        modulePath: 'a.ts',
        language: 'typescript',
        exports: [{ name: 'b', kind: 'function', signature: 'export function b()' }],
        dependencies: { internal: [], external: [] },
        exportHash: '',
      },
      {
        modulePath: 'b.ts',
        language: 'typescript',
        exports: [{ name: 'a', kind: 'function', signature: 'export function a()' }],
        dependencies: { internal: [], external: [] },
        exportHash: '',
      },
    ];

    const r1 = aggregateModuleSummary('mod', summaries);
    const r2 = aggregateModuleSummary('mod', [...summaries].reverse());

    expect(r1.exportHash).toBe(r2.exportHash);
    expect(r1.exportHash).toHaveLength(64);
  });
});

// ---------------------------------------------------------------------------
// discoverFiles
// ---------------------------------------------------------------------------

describe('discoverFiles', () => {
  let dir: string;

  beforeEach(() => {
    dir = makeTmpDir();
    writeFile(dir, 'src/index.ts', SIMPLE_TS);
    writeFile(dir, 'src/utils.ts', ANOTHER_TS);
    writeFile(dir, 'src/services/search.ts', CLASS_TS);
    writeFile(dir, 'src/services/search.test.ts', '// test');
    writeFile(dir, 'src/services/search.spec.ts', '// spec');
    writeFile(dir, 'node_modules/pkg/index.ts', '// dep');
    writeFile(dir, 'dist/cli.ts', '// built');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('finds .ts files matching include pattern', async () => {
    const files = await discoverFiles(dir, ['src/**/*.ts'], []);

    expect(files.length).toBeGreaterThanOrEqual(4);
    expect(files.every((f) => f.endsWith('.ts'))).toBe(true);
  });

  it('excludes test files', async () => {
    const files = await discoverFiles(dir, ['src/**/*.ts'], ['**/*.test.ts', '**/*.spec.ts']);

    expect(files.some((f) => f.includes('.test.'))).toBe(false);
    expect(files.some((f) => f.includes('.spec.'))).toBe(false);
  });

  it('excludes node_modules and dist', async () => {
    const files = await discoverFiles(dir, ['**/*.ts'], ['**/node_modules/**', '**/dist/**']);

    expect(files.some((f) => f.includes('node_modules'))).toBe(false);
    expect(files.some((f) => f.includes('dist'))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// scanProject (integration)
// ---------------------------------------------------------------------------

describe('scanProject', () => {
  let dir: string;

  beforeEach(() => {
    dir = makeTmpDir();
    writeFile(dir, 'src/index.ts', SIMPLE_TS);
    writeFile(dir, 'src/types.ts', ANOTHER_TS);
    writeFile(dir, 'src/services/engine.ts', CLASS_TS);
    writeFile(dir, 'src/services/engine.test.ts', '// test');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('scans and returns module summaries', async () => {
    const result = await scanProject(dir);

    expect(result.modules.length).toBeGreaterThanOrEqual(2);
    expect(result.stats.filesScanned).toBe(3);
    expect(result.stats.modulesFound).toBeGreaterThanOrEqual(2);
  });

  it('reports all modules as changed on first scan', async () => {
    const result = await scanProject(dir);

    expect(result.changed.length).toBe(result.modules.length);
    expect(result.unchanged).toHaveLength(0);
  });

  it('marks modules unchanged when hashes match', async () => {
    const first = await scanProject(dir);

    const hashes = new Map<string, string>();
    for (const mod of first.modules) {
      hashes.set(mod.modulePath, mod.exportHash);
    }

    const second = await scanProject(dir, { previousHashes: hashes });

    expect(second.unchanged.length).toBe(second.modules.length);
    expect(second.changed).toHaveLength(0);
    expect(second.stats.modulesChanged).toBe(0);
  });

  it('detects changed modules when exports differ', async () => {
    const first = await scanProject(dir);

    const hashes = new Map<string, string>();
    for (const mod of first.modules) {
      hashes.set(mod.modulePath, mod.exportHash);
    }

    // Modify a file to change its exports
    writeFile(
      dir,
      'src/index.ts',
      `
export function hello(): string { return 'hello'; }
export function goodbye(): void {}
`
    );

    const second = await scanProject(dir, { previousHashes: hashes });

    expect(second.changed.length).toBeGreaterThanOrEqual(1);
    expect(second.changed).toContain('src');
  });

  it('excludes test files by default', async () => {
    const result = await scanProject(dir);

    const allPaths = result.modules.flatMap((m) => m.exports.map(() => m.modulePath));
    expect(allPaths.some((p) => p.includes('.test.'))).toBe(false);
  });

  it('respects custom include/exclude patterns', async () => {
    writeFile(dir, 'lib/helper.ts', 'export const X = 1;');

    const result = await scanProject(dir, {
      include: ['lib/**/*.ts'],
      exclude: [],
    });

    expect(result.stats.filesScanned).toBe(1);
    expect(result.modules[0].modulePath).toBe('lib');
  });

  it('extracts exports and dependencies correctly', async () => {
    const result = await scanProject(dir);

    const srcModule = result.modules.find((m) => m.modulePath === 'src');
    expect(srcModule).toBeDefined();
    expect(srcModule!.exports.length).toBeGreaterThanOrEqual(1);

    const names = srcModule!.exports.map((e) => e.name);
    expect(names).toContain('hello');

    const svcModule = result.modules.find((m) => m.modulePath === 'src/services');
    expect(svcModule).toBeDefined();
    expect(svcModule!.dependencies.external.length).toBeGreaterThanOrEqual(1);
  });
});
