import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { discoverDocs } from '../../../../src/modules/pm/engine/doc-scanner.js';

let rootDir: string;

beforeEach(() => {
  rootDir = join(tmpdir(), `doc-scan-test-${randomUUID()}`);
  mkdirSync(rootDir, { recursive: true });
});

afterEach(() => {
  rmSync(rootDir, { recursive: true, force: true });
});

describe('discoverDocs', () => {
  it('finds .md files and returns them sorted by score descending', () => {
    writeFileSync(join(rootDir, 'README.md'), '# Hello\n\nSome content here that is long enough.');
    mkdirSync(join(rootDir, 'docs'));
    writeFileSync(join(rootDir, 'docs', 'guide.md'), '# Guide\n\nDetailed guide content here.');

    const result = discoverDocs([rootDir]);

    expect(result.length).toBe(2);
    expect(result[0].score).toBeGreaterThanOrEqual(result[1].score);
  });

  it('scores README higher than arbitrary docs', () => {
    writeFileSync(join(rootDir, 'README.md'), '# Project\n\n' + 'x'.repeat(600));
    writeFileSync(join(rootDir, 'notes.md'), '# Notes\n\n' + 'x'.repeat(600));

    const result = discoverDocs([rootDir]);

    const readme = result.find(d => d.path.endsWith('README.md'));
    const notes = result.find(d => d.path.endsWith('notes.md'));
    expect(readme!.score).toBeGreaterThan(notes!.score);
  });

  it('scores ARCHITECTURE.md highly', () => {
    writeFileSync(join(rootDir, 'ARCHITECTURE.md'), '# Arch\n\n' + 'x'.repeat(600));
    writeFileSync(join(rootDir, 'random.md'), '# Random\n\n' + 'x'.repeat(600));

    const result = discoverDocs([rootDir]);

    const arch = result.find(d => d.path.includes('ARCHITECTURE'));
    const random = result.find(d => d.path.includes('random'));
    expect(arch!.score).toBeGreaterThan(random!.score);
  });

  it('scores files in docs/ directory higher', () => {
    mkdirSync(join(rootDir, 'docs'));
    writeFileSync(join(rootDir, 'docs', 'api.md'), '# API\n\n' + 'x'.repeat(600));
    mkdirSync(join(rootDir, 'src'));
    writeFileSync(join(rootDir, 'src', 'notes.md'), '# Notes\n\n' + 'x'.repeat(600));

    const result = discoverDocs([rootDir]);

    const docsFile = result.find(d => d.path.includes('docs/'));
    const srcFile = result.find(d => d.path.includes('src/'));
    expect(docsFile!.score).toBeGreaterThan(srcFile!.score);
  });

  it('excludes files in node_modules, vendor, dist, build', () => {
    writeFileSync(join(rootDir, 'README.md'), '# App');
    mkdirSync(join(rootDir, 'node_modules', 'pkg'), { recursive: true });
    writeFileSync(join(rootDir, 'node_modules', 'pkg', 'README.md'), '# Pkg');
    mkdirSync(join(rootDir, 'dist'));
    writeFileSync(join(rootDir, 'dist', 'docs.md'), '# Built');

    const result = discoverDocs([rootDir]);

    expect(result).toHaveLength(1);
    expect(result[0].path).toContain('README.md');
  });

  it('respects maxDocs limit', () => {
    for (let i = 0; i < 10; i++) {
      writeFileSync(join(rootDir, `doc-${i}.md`), `# Doc ${i}\n\n` + 'x'.repeat(600));
    }

    const result = discoverDocs([rootDir], { maxDocs: 3 });

    expect(result).toHaveLength(3);
  });

  it('excludes very small files (< 500 bytes) from score bonus', () => {
    writeFileSync(join(rootDir, 'tiny.md'), '# T');
    writeFileSync(join(rootDir, 'substantial.md'), '# Big\n\n' + 'x'.repeat(600));

    const result = discoverDocs([rootDir]);
    const tiny = result.find(d => d.path.includes('tiny'));
    const big = result.find(d => d.path.includes('substantial'));

    expect(big!.score).toBeGreaterThan(tiny!.score);
  });

  it('excludes very large files (> 50KB)', () => {
    writeFileSync(join(rootDir, 'huge.md'), '# H\n\n' + 'x'.repeat(60000));
    writeFileSync(join(rootDir, 'normal.md'), '# N\n\n' + 'x'.repeat(600));

    const result = discoverDocs([rootDir]);

    expect(result.every(d => !d.path.includes('huge'))).toBe(true);
  });

  it('handles multiple component paths', () => {
    const comp1 = join(rootDir, 'api');
    const comp2 = join(rootDir, 'web');
    mkdirSync(comp1);
    mkdirSync(comp2);
    writeFileSync(join(comp1, 'README.md'), '# API\n\n' + 'x'.repeat(600));
    writeFileSync(join(comp2, 'README.md'), '# Web\n\n' + 'x'.repeat(600));

    const result = discoverDocs([comp1, comp2]);

    expect(result).toHaveLength(2);
  });

  it('deduplicates docs found in overlapping paths', () => {
    writeFileSync(join(rootDir, 'README.md'), '# Root\n\n' + 'x'.repeat(600));

    const result = discoverDocs([rootDir, rootDir]);

    expect(result).toHaveLength(1);
  });

  it('initializes ingested and noteSlug fields to defaults', () => {
    writeFileSync(join(rootDir, 'README.md'), '# App\n\n' + 'x'.repeat(600));

    const result = discoverDocs([rootDir]);

    expect(result[0].ingested).toBe(false);
    expect(result[0].noteSlug).toBeUndefined();
  });
});
