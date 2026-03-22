import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { loadPreviousHashes } from '../../../../src/modules/codebase/commands/index-cmd.js';
import { scanProject } from '../../../../src/modules/codebase/scanner.js';
import { generateNotes } from '../../../../src/modules/codebase/note-generator.js';

function makeTmpDir(): string {
  const dir = join(tmpdir(), `brain-codebase-test-${randomUUID()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function writeSourceFile(projectDir: string, relPath: string, content: string): void {
  const full = join(projectDir, relPath);
  mkdirSync(join(full, '..'), { recursive: true });
  writeFileSync(full, content, 'utf-8');
}

const SAMPLE_TS = `export function greet(name: string): string {
  return \`Hello, \${name}\`;
}

export interface Config {
  debug: boolean;
}
`;

const SAMPLE_TS_B = `import { Config } from './a.js';

export class Server {
  constructor(private config: Config) {}
}
`;

describe('codebase index command', () => {
  let projectDir: string;
  let outputDir: string;

  beforeEach(() => {
    projectDir = makeTmpDir();
    outputDir = join(projectDir, '.brain', 'notes', 'modules', 'codebase', 'test-project');
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it('scans and generates notes for a temp directory', async () => {
    writeSourceFile(projectDir, 'src/a.ts', SAMPLE_TS);
    writeSourceFile(projectDir, 'src/b.ts', SAMPLE_TS_B);

    const scanResult = await scanProject(projectDir, {
      include: ['src/**/*.ts'],
    });

    const noteResult = generateNotes(scanResult, {
      projectName: 'test-project',
      outputDir,
    });

    expect(scanResult.stats.filesScanned).toBe(2);
    expect(scanResult.stats.modulesFound).toBeGreaterThanOrEqual(1);
    expect(noteResult.created.length).toBeGreaterThanOrEqual(1);

    const files = readdirSync(outputDir).filter((f) => f.endsWith('.md'));
    expect(files.length).toBeGreaterThanOrEqual(1);

    const content = readFileSync(join(outputDir, files[0]), 'utf-8');
    expect(content).toContain('module: codebase');
    expect(content).toContain('exports-hash:');
  });

  it('dry-run produces no files', async () => {
    writeSourceFile(projectDir, 'src/a.ts', SAMPLE_TS);

    const scanResult = await scanProject(projectDir, {
      include: ['src/**/*.ts'],
    });

    const noteResult = generateNotes(scanResult, {
      projectName: 'test-project',
      outputDir,
      dryRun: true,
    });

    expect(noteResult.created.length).toBeGreaterThanOrEqual(1);
    expect(noteResult.notes.size).toBeGreaterThanOrEqual(1);
    expect(existsSync(outputDir)).toBe(false);
  });

  it('force regenerates all notes', async () => {
    writeSourceFile(projectDir, 'src/a.ts', SAMPLE_TS);

    // First pass: generate notes
    const scanResult1 = await scanProject(projectDir);
    generateNotes(scanResult1, { projectName: 'test-project', outputDir });

    // Second pass with force: should update even though nothing changed
    const scanResult2 = await scanProject(projectDir, {
      previousHashes: new Map<string, string>(),
    });

    const noteResult2 = generateNotes(scanResult2, {
      projectName: 'test-project',
      outputDir,
      forceAll: true,
    });

    expect(noteResult2.updated.length).toBeGreaterThanOrEqual(1);
    expect(noteResult2.unchanged.length).toBe(0);
  });

  it('incremental skips unchanged modules', async () => {
    writeSourceFile(projectDir, 'src/a.ts', SAMPLE_TS);

    // First pass
    const scanResult1 = await scanProject(projectDir);
    generateNotes(scanResult1, { projectName: 'test-project', outputDir });

    // Load hashes from generated notes
    const previousHashes = loadPreviousHashes(outputDir);
    expect(previousHashes.size).toBeGreaterThanOrEqual(1);

    // Second pass with previous hashes — nothing changed
    const scanResult2 = await scanProject(projectDir, { previousHashes });
    const noteResult2 = generateNotes(scanResult2, {
      projectName: 'test-project',
      outputDir,
    });

    expect(noteResult2.unchanged.length).toBeGreaterThanOrEqual(1);
    expect(noteResult2.created.length).toBe(0);
    expect(noteResult2.updated.length).toBe(0);
  });

  it('JSON output format contains expected fields', async () => {
    writeSourceFile(projectDir, 'src/a.ts', SAMPLE_TS);

    const scanResult = await scanProject(projectDir);
    const noteResult = generateNotes(scanResult, {
      projectName: 'test-project',
      outputDir,
    });

    const summary = {
      filesScanned: scanResult.stats.filesScanned,
      modulesFound: scanResult.stats.modulesFound,
      created: noteResult.created,
      updated: noteResult.updated,
      unchanged: noteResult.unchanged,
    };

    const json = JSON.parse(JSON.stringify(summary));
    expect(json).toHaveProperty('filesScanned');
    expect(json).toHaveProperty('modulesFound');
    expect(json).toHaveProperty('created');
    expect(json).toHaveProperty('updated');
    expect(json).toHaveProperty('unchanged');
    expect(typeof json.filesScanned).toBe('number');
    expect(Array.isArray(json.created)).toBe(true);
  });

  it('loads previous hashes from existing notes', () => {
    mkdirSync(outputDir, { recursive: true });

    const noteContent = `---
title: "Architecture: src/services"
type: architecture
tier: slow
module: codebase
module-path: src/services
language: typescript
exports-hash: "abc123"
tags: [architecture, typescript]
---

## Purpose

Test note.
`;
    writeFileSync(join(outputDir, 'src-services.md'), noteContent, 'utf-8');

    const hashes = loadPreviousHashes(outputDir);
    expect(hashes.get('src/services')).toBe('abc123');
  });

  it('returns empty map for non-existent directory', () => {
    const hashes = loadPreviousHashes(join(projectDir, 'does-not-exist'));
    expect(hashes.size).toBe(0);
  });
});
