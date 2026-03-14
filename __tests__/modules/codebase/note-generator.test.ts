import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import {
  generateArchitectureNote,
  generateNotes,
  updateArchitectureNote,
  writeNote,
  buildNotePath,
} from '../../../src/modules/codebase/note-generator.js';
import type { ModuleSummary } from '../../../src/modules/codebase/types.js';
import type { ScanResult } from '../../../src/modules/codebase/scanner.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTmpDir(): string {
  const dir = join(tmpdir(), `note-gen-test-${randomUUID()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function makeSummary(overrides?: Partial<ModuleSummary>): ModuleSummary {
  return {
    modulePath: 'src/services/search',
    language: 'typescript',
    exports: [
      {
        name: 'hybridSearch',
        kind: 'function',
        signature: 'hybridSearch(db: BrainDB, query: string): Promise<Result[]>',
      },
      { name: 'SearchOptions', kind: 'interface', signature: 'interface SearchOptions' },
    ],
    dependencies: {
      internal: [
        { path: './brain-db.js', imports: ['BrainDB'] },
        { path: './reranker.js', imports: ['rerank', 'RerankerOptions'] },
      ],
      external: [{ package: 'better-sqlite3', imports: ['Database'] }],
    },
    exportHash: 'abc123def456',
    ...overrides,
  };
}

function makeScanResult(modules: ModuleSummary[], changed: string[]): ScanResult {
  const unchanged = modules.map((m) => m.modulePath).filter((p) => !changed.includes(p));
  return {
    modules,
    changed,
    unchanged,
    stats: {
      filesScanned: modules.length,
      modulesFound: modules.length,
      modulesChanged: changed.length,
    },
  };
}

// ---------------------------------------------------------------------------
// buildNotePath
// ---------------------------------------------------------------------------

describe('buildNotePath', () => {
  it('converts slashes to dashes', () => {
    const result = buildNotePath('/out', 'services/search');
    expect(result).toBe(join('/out', 'services-search.md'));
  });

  it('handles root module', () => {
    const result = buildNotePath('/out', 'root');
    expect(result).toBe(join('/out', 'root.md'));
  });

  it('handles deeply nested paths', () => {
    const result = buildNotePath('/out', 'src/modules/pm/engine');
    expect(result).toBe(join('/out', 'src-modules-pm-engine.md'));
  });
});

// ---------------------------------------------------------------------------
// generateArchitectureNote — single note
// ---------------------------------------------------------------------------

describe('generateArchitectureNote', () => {
  it('produces valid frontmatter', () => {
    const summary = makeSummary();
    const note = generateArchitectureNote(summary, 'brain');

    expect(note).toMatch(/^---\n/);
    expect(note).toContain('title: "Architecture: src/services/search"');
    expect(note).toContain('type: architecture');
    expect(note).toContain('tier: slow');
    expect(note).toContain('module: codebase');
    expect(note).toContain('module-path: src/services/search');
    expect(note).toContain('language: typescript');
    expect(note).toContain('exports-hash: "abc123def456"');
    expect(note).toContain('tags: [architecture, typescript, brain]');
    expect(note).toMatch(/created: \d{4}-\d{2}-\d{2}T/);
    expect(note).toMatch(/modified: \d{4}-\d{2}-\d{2}T/);
  });

  it('includes Purpose section with default text', () => {
    const note = generateArchitectureNote(makeSummary(), 'brain');
    expect(note).toContain('## Purpose\n\nNo module-level documentation found.');
  });

  it('includes Public API table with sorted exports', () => {
    const note = generateArchitectureNote(makeSummary(), 'brain');
    expect(note).toContain('## Public API');
    expect(note).toContain('| Export | Kind | Signature |');
    // Case-insensitive sort: hybridSearch before SearchOptions
    const apiSection = note.slice(note.indexOf('## Public API'));
    const hybridIdx = apiSection.indexOf('hybridSearch');
    const searchIdx = apiSection.indexOf('SearchOptions');
    expect(hybridIdx).toBeLessThan(searchIdx);
  });

  it('includes Dependencies section with sorted deps', () => {
    const note = generateArchitectureNote(makeSummary(), 'brain');
    expect(note).toContain('### Internal');
    expect(note).toContain('`./brain-db.js`');
    expect(note).toContain('`./reranker.js` — RerankerOptions, rerank');
    expect(note).toContain('### External');
    expect(note).toContain('`better-sqlite3` — Database');
  });

  it('includes empty Invariants section', () => {
    const note = generateArchitectureNote(makeSummary(), 'brain');
    expect(note).toContain('## Invariants\n\n*(none yet)*');
  });

  it('handles module with no exports', () => {
    const summary = makeSummary({ exports: [] });
    const note = generateArchitectureNote(summary, 'brain');
    expect(note).toContain('*(none)*');
  });

  it('handles module with no dependencies', () => {
    const summary = makeSummary({
      dependencies: { internal: [], external: [] },
    });
    const note = generateArchitectureNote(summary, 'brain');
    expect(note).toContain('### Internal\n\n*(none)*');
    expect(note).toContain('### External\n\n*(none)*');
  });

  it('escapes pipe characters in signatures', () => {
    const summary = makeSummary({
      exports: [{ name: 'merge', kind: 'function', signature: 'merge(a: A | B): C' }],
    });
    const note = generateArchitectureNote(summary, 'brain');
    expect(note).toContain('merge(a: A \\| B): C');
  });
});

// ---------------------------------------------------------------------------
// updateArchitectureNote — preserving hand-edits
// ---------------------------------------------------------------------------

describe('updateArchitectureNote', () => {
  it('preserves hand-edited Invariants section', () => {
    const original = generateArchitectureNote(makeSummary(), 'brain');
    const withInvariants = original.replace(
      '*(none yet)*',
      '- Results are always capped at limit.\n- BM25 runs before vector.'
    );

    const newSummary = makeSummary({ exportHash: 'newhash999' });
    const updated = updateArchitectureNote(withInvariants, newSummary, 'brain');

    expect(updated).toContain('- Results are always capped at limit.');
    expect(updated).toContain('- BM25 runs before vector.');
    expect(updated).toContain('exports-hash: "newhash999"');
  });

  it('updates exports-hash and modified date', () => {
    const original = generateArchitectureNote(makeSummary(), 'brain');
    const newSummary = makeSummary({ exportHash: 'updatedHash' });
    const updated = updateArchitectureNote(original, newSummary, 'brain');

    expect(updated).toContain('exports-hash: "updatedHash"');
    expect(updated).toMatch(/modified: \d{4}-\d{2}-\d{2}T/);
  });

  it('updates Public API when exports change', () => {
    const original = generateArchitectureNote(makeSummary(), 'brain');
    const newSummary = makeSummary({
      exports: [{ name: 'newFunction', kind: 'function', signature: 'newFunction(): void' }],
      exportHash: 'changed',
    });
    const updated = updateArchitectureNote(original, newSummary, 'brain');

    expect(updated).toContain('newFunction');
    expect(updated).not.toContain('hybridSearch');
  });

  it('preserves manually edited Purpose', () => {
    const original = generateArchitectureNote(makeSummary(), 'brain');
    const withPurpose = original.replace(
      'No module-level documentation found.',
      'Orchestrates hybrid search combining BM25 and vector approaches.'
    );

    const updated = updateArchitectureNote(withPurpose, makeSummary(), 'brain');
    expect(updated).toContain('Orchestrates hybrid search combining BM25 and vector approaches.');
  });

  it('keeps default Purpose when not manually edited', () => {
    const original = generateArchitectureNote(makeSummary(), 'brain');
    const updated = updateArchitectureNote(original, makeSummary(), 'brain');
    expect(updated).toContain('No module-level documentation found.');
  });
});

// ---------------------------------------------------------------------------
// writeNote
// ---------------------------------------------------------------------------

describe('writeNote', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });
  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates file and intermediate directories', () => {
    const filePath = join(tmpDir, 'nested', 'deep', 'note.md');
    writeNote(filePath, '# Test');
    expect(readFileSync(filePath, 'utf-8')).toBe('# Test');
  });

  it('overwrites existing file', () => {
    const filePath = join(tmpDir, 'note.md');
    writeNote(filePath, 'first');
    writeNote(filePath, 'second');
    expect(readFileSync(filePath, 'utf-8')).toBe('second');
  });
});

// ---------------------------------------------------------------------------
// generateNotes — batch
// ---------------------------------------------------------------------------

describe('generateNotes', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });
  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('generates notes only for changed modules', () => {
    const mod1 = makeSummary({ modulePath: 'src/a', exportHash: 'h1' });
    const mod2 = makeSummary({ modulePath: 'src/b', exportHash: 'h2' });
    const scan = makeScanResult([mod1, mod2], ['src/a']);

    const result = generateNotes(scan, { projectName: 'test', outputDir: tmpDir });

    expect(result.created).toHaveLength(1);
    expect(result.unchanged).toEqual(['src/b']);
    expect(existsSync(buildNotePath(tmpDir, 'src/a'))).toBe(true);
    expect(existsSync(buildNotePath(tmpDir, 'src/b'))).toBe(false);
  });

  it('generates all notes when forceAll is true', () => {
    const mod1 = makeSummary({ modulePath: 'src/a', exportHash: 'h1' });
    const mod2 = makeSummary({ modulePath: 'src/b', exportHash: 'h2' });
    const scan = makeScanResult([mod1, mod2], ['src/a']);

    const result = generateNotes(scan, {
      projectName: 'test',
      outputDir: tmpDir,
      forceAll: true,
    });

    expect(result.created).toHaveLength(2);
    expect(result.unchanged).toHaveLength(0);
  });

  it('does not write files in dry-run mode', () => {
    const mod = makeSummary({ modulePath: 'src/x' });
    const scan = makeScanResult([mod], ['src/x']);

    const result = generateNotes(scan, {
      projectName: 'test',
      outputDir: tmpDir,
      dryRun: true,
    });

    expect(result.created).toHaveLength(1);
    expect(result.notes.has('src/x')).toBe(true);
    expect(existsSync(buildNotePath(tmpDir, 'src/x'))).toBe(false);
  });

  it('detects updates when note already exists', () => {
    const mod = makeSummary({ modulePath: 'src/c' });
    const scan = makeScanResult([mod], ['src/c']);

    // First generation
    generateNotes(scan, { projectName: 'test', outputDir: tmpDir });

    // Second generation with changed hash
    const mod2 = makeSummary({ modulePath: 'src/c', exportHash: 'newHash' });
    const scan2 = makeScanResult([mod2], ['src/c']);
    const result = generateNotes(scan2, { projectName: 'test', outputDir: tmpDir });

    expect(result.updated).toHaveLength(1);
    expect(result.created).toHaveLength(0);

    const content = readFileSync(buildNotePath(tmpDir, 'src/c'), 'utf-8');
    expect(content).toContain('exports-hash: "newHash"');
  });

  it('returns generated content in notes map', () => {
    const mod = makeSummary({ modulePath: 'src/d' });
    const scan = makeScanResult([mod], ['src/d']);

    const result = generateNotes(scan, {
      projectName: 'test',
      outputDir: tmpDir,
      dryRun: true,
    });

    const content = result.notes.get('src/d');
    expect(content).toBeDefined();
    expect(content).toContain('Architecture: src/d');
  });
});
