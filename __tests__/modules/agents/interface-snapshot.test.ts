import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  extractSignaturesFromContent,
  captureInterfaceSnapshot,
  formatInterfaceSnapshotBrief,
} from '../../../src/modules/agents/interface-snapshot.js';
import type { InterfaceSnapshot } from '../../../src/modules/agents/interface-snapshot.js';

describe('extractSignaturesFromContent', () => {
  it('extracts exported function signatures', () => {
    const content = `
import { foo } from './bar.js';

export function searchNotes(query: string, opts?: SearchOpts): SearchResult[] {
  return [];
}

function privateHelper() {}
`;
    const sigs = extractSignaturesFromContent(content);

    expect(sigs).toHaveLength(1);
    expect(sigs[0].kind).toBe('function');
    expect(sigs[0].signature).toContain('export function searchNotes');
    expect(sigs[0].signature).toContain('SearchResult[]');
  });

  it('extracts exported async function signatures', () => {
    const content = `
export async function fetchData(url: string): Promise<Response> {
  return fetch(url);
}
`;
    const sigs = extractSignaturesFromContent(content);

    expect(sigs).toHaveLength(1);
    expect(sigs[0].kind).toBe('function');
    expect(sigs[0].signature).toContain('async function fetchData');
  });

  it('extracts exported interface definitions', () => {
    const content = `
export interface SearchResult {
  id: string;
  score: number;
}

export interface SearchOpts {
  limit?: number;
}
`;
    const sigs = extractSignaturesFromContent(content);

    expect(sigs).toHaveLength(2);
    expect(sigs[0]).toEqual({ kind: 'interface', signature: 'export interface SearchResult' });
    expect(sigs[1]).toEqual({ kind: 'interface', signature: 'export interface SearchOpts' });
  });

  it('extracts exported type aliases', () => {
    const content = `
export type NoteType = 'research' | 'guide';
export type SearchMode = 'hybrid' | 'bm25' | 'vector';
`;
    const sigs = extractSignaturesFromContent(content);

    expect(sigs).toHaveLength(2);
    expect(sigs[0].kind).toBe('type');
    expect(sigs[0].signature).toContain('NoteType');
    expect(sigs[1].kind).toBe('type');
    expect(sigs[1].signature).toContain('SearchMode');
  });

  it('captures multi-line function signatures', () => {
    const content = `
export function buildContext(
  db: BrainDB,
  taskId: string,
  options?: ContextOptions
): AgentContext | null {
  return null;
}
`;
    const sigs = extractSignaturesFromContent(content);

    expect(sigs).toHaveLength(1);
    expect(sigs[0].kind).toBe('function');
    expect(sigs[0].signature).toContain('buildContext');
    expect(sigs[0].signature).toContain('AgentContext | null');
  });

  it('ignores non-exported declarations', () => {
    const content = `
function internalFn() {}
interface InternalIface {}
type LocalType = string;
const localConst = 42;
`;
    const sigs = extractSignaturesFromContent(content);

    expect(sigs).toHaveLength(0);
  });

  it('returns empty array for empty content', () => {
    expect(extractSignaturesFromContent('')).toEqual([]);
  });
});

describe('captureInterfaceSnapshot', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'iface-snap-'));
    mkdirSync(join(tmpDir, 'src'), { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('captures signatures from matching files', () => {
    writeFileSync(
      join(tmpDir, 'src', 'service.ts'),
      `export function doWork(input: string): boolean {\n  return true;\n}\n`
    );

    const snapshot = captureInterfaceSnapshot(tmpDir, ['src/*.ts']);

    expect(snapshot).toHaveLength(1);
    expect(snapshot[0].file).toBe('src/service.ts');
    expect(snapshot[0].signatures).toHaveLength(1);
    expect(snapshot[0].signatures[0].signature).toContain('doWork');
  });

  it('returns empty array when no files match', () => {
    const snapshot = captureInterfaceSnapshot(tmpDir, ['nonexistent/*.ts']);

    expect(snapshot).toEqual([]);
  });

  it('skips files with no exported signatures', () => {
    writeFileSync(join(tmpDir, 'src', 'internal.ts'), `const x = 42;\nfunction helper() {}\n`);

    const snapshot = captureInterfaceSnapshot(tmpDir, ['src/*.ts']);

    expect(snapshot).toEqual([]);
  });

  it('handles multiple patterns', () => {
    mkdirSync(join(tmpDir, 'lib'), { recursive: true });
    writeFileSync(join(tmpDir, 'src', 'a.ts'), `export interface Foo {\n  x: number;\n}\n`);
    writeFileSync(join(tmpDir, 'lib', 'b.ts'), `export type Bar = string;\n`);

    const snapshot = captureInterfaceSnapshot(tmpDir, ['src/*.ts', 'lib/*.ts']);

    expect(snapshot).toHaveLength(2);
    const files = snapshot.map((s) => s.file);
    expect(files).toContain('src/a.ts');
    expect(files).toContain('lib/b.ts');
  });

  it('deduplicates files matched by multiple patterns', () => {
    writeFileSync(join(tmpDir, 'src', 'dup.ts'), `export function unique(): void {}\n`);

    const snapshot = captureInterfaceSnapshot(tmpDir, ['src/*.ts', 'src/dup.ts']);

    expect(snapshot).toHaveLength(1);
  });
});

describe('formatInterfaceSnapshotBrief', () => {
  it('formats snapshot into a readable section', () => {
    const snapshot: InterfaceSnapshot = [
      {
        file: 'src/service.ts',
        signatures: [
          { kind: 'function', signature: 'export function doWork(input: string): boolean' },
          { kind: 'interface', signature: 'export interface WorkResult' },
        ],
      },
    ];

    const brief = formatInterfaceSnapshotBrief(snapshot);

    expect(brief).toContain('--- Interface Snapshot ---');
    expect(brief).toContain('src/service.ts');
    expect(brief).toContain('[function] export function doWork');
    expect(brief).toContain('[interface] export interface WorkResult');
  });

  it('includes multiple files', () => {
    const snapshot: InterfaceSnapshot = [
      {
        file: 'src/a.ts',
        signatures: [{ kind: 'function', signature: 'export function foo(): void' }],
      },
      {
        file: 'src/b.ts',
        signatures: [{ kind: 'type', signature: 'export type Bar = string' }],
      },
    ];

    const brief = formatInterfaceSnapshotBrief(snapshot);

    expect(brief).toContain('src/a.ts');
    expect(brief).toContain('src/b.ts');
    expect(brief).toContain('[type]');
  });

  it('returns empty string for empty snapshot', () => {
    expect(formatInterfaceSnapshotBrief([])).toBe('');
  });
});
