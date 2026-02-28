import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { detectComponents } from '../../../src/modules/pm/engine/detect.js';

let rootDir: string;

beforeEach(() => {
  rootDir = join(tmpdir(), `detect-test-${randomUUID()}`);
  mkdirSync(rootDir, { recursive: true });
});

afterEach(() => {
  rmSync(rootDir, { recursive: true, force: true });
});

describe('detectComponents', () => {
  it('returns single component for simple node project', () => {
    writeFileSync(join(rootDir, 'package.json'), JSON.stringify({ name: 'myapp' }));
    mkdirSync(join(rootDir, 'src'));
    writeFileSync(join(rootDir, 'src', 'index.ts'), 'export {}');

    const result = detectComponents(rootDir);

    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('node');
    expect(result[0].path).toBe('.');
    expect(result[0].entryPoints).toContain('src/index.ts');
  });

  it('detects react-native from package.json dependencies', () => {
    writeFileSync(
      join(rootDir, 'package.json'),
      JSON.stringify({ name: 'mobileapp', dependencies: { 'react-native': '0.73.0' } })
    );

    const result = detectComponents(rootDir);

    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('react-native');
  });

  it('detects monorepo packages from workspaces field', () => {
    writeFileSync(
      join(rootDir, 'package.json'),
      JSON.stringify({ name: 'monorepo', workspaces: ['packages/*'] })
    );
    for (const pkg of ['api', 'web']) {
      const pkgDir = join(rootDir, 'packages', pkg);
      mkdirSync(pkgDir, { recursive: true });
      writeFileSync(join(pkgDir, 'package.json'), JSON.stringify({ name: `@mono/${pkg}` }));
    }

    const result = detectComponents(rootDir);

    expect(result).toHaveLength(2);
    expect(result.map(c => c.name).sort()).toEqual(['api', 'web']);
    expect(result[0].path).toMatch(/^packages\//);
  });

  it('detects go project from go.mod', () => {
    writeFileSync(join(rootDir, 'go.mod'), 'module example.com/myapp\n\ngo 1.21\n');
    mkdirSync(join(rootDir, 'cmd'));
    writeFileSync(join(rootDir, 'cmd', 'main.go'), 'package main');

    const result = detectComponents(rootDir);

    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('go');
  });

  it('detects python project from pyproject.toml', () => {
    writeFileSync(join(rootDir, 'pyproject.toml'), '[project]\nname = "myapp"\n');

    const result = detectComponents(rootDir);

    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('python');
  });

  it('returns unknown type when no manifest files found', () => {
    mkdirSync(join(rootDir, 'src'));
    writeFileSync(join(rootDir, 'src', 'main.c'), 'int main() {}');

    const result = detectComponents(rootDir);

    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('unknown');
  });

  it('finds .md files in component docPaths', () => {
    writeFileSync(join(rootDir, 'package.json'), JSON.stringify({ name: 'myapp' }));
    writeFileSync(join(rootDir, 'README.md'), '# My App');
    mkdirSync(join(rootDir, 'docs'));
    writeFileSync(join(rootDir, 'docs', 'guide.md'), '# Guide');

    const result = detectComponents(rootDir);

    expect(result[0].docPaths).toContain('README.md');
    expect(result[0].docPaths).toContain(join('docs', 'guide.md'));
    expect(result[0].docCount).toBe(2);
  });

  it('ignores node_modules and other excluded dirs', () => {
    writeFileSync(join(rootDir, 'package.json'), JSON.stringify({ name: 'myapp' }));
    mkdirSync(join(rootDir, 'node_modules', 'dep'), { recursive: true });
    writeFileSync(join(rootDir, 'node_modules', 'dep', 'README.md'), '# dep');
    writeFileSync(join(rootDir, 'README.md'), '# App');

    const result = detectComponents(rootDir);

    expect(result[0].docPaths).toEqual(['README.md']);
  });

  it('detects multi-language siblings at root', () => {
    // api/ has package.json, worker/ has go.mod
    mkdirSync(join(rootDir, 'api'));
    writeFileSync(join(rootDir, 'api', 'package.json'), JSON.stringify({ name: 'api' }));
    mkdirSync(join(rootDir, 'worker'));
    writeFileSync(join(rootDir, 'worker', 'go.mod'), 'module example.com/worker\n');

    const result = detectComponents(rootDir);

    expect(result.length).toBeGreaterThanOrEqual(2);
    const types = result.map(c => c.type).sort();
    expect(types).toContain('go');
    expect(types).toContain('node');
  });
});
