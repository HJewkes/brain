import { vi, describe, it, expect, beforeEach } from 'vitest';
import {
  extractSignatures,
  detectBreakingChanges,
  formatBreakingChangesBrief,
} from '../../../src/modules/agents/breaking-changes.js';
import type { BreakingChange } from '../../../src/modules/agents/breaking-changes.js';

vi.mock('node:child_process');
vi.mock('node:fs');

const { execSync } = await import('node:child_process');
const { readFileSync } = await import('node:fs');

const mockExecSync = vi.mocked(execSync);
const mockReadFileSync = vi.mocked(readFileSync);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('extractSignatures', () => {
  it('extracts exported function signatures', () => {
    const content = `
import { foo } from './bar.js';

export function searchNotes(query: string, opts?: SearchOpts): SearchResult[] {
  return [];
}

function privateHelper() {}
`;
    const sigs = extractSignatures(content);

    expect(sigs).toHaveLength(1);
    expect(sigs[0]).toContain('export function searchNotes');
  });

  it('extracts exported interfaces', () => {
    const content = `
export interface SearchResult {
  id: string;
  score: number;
}

export interface SearchOpts {
  limit?: number;
}
`;
    const sigs = extractSignatures(content);

    expect(sigs).toHaveLength(2);
    expect(sigs[0]).toBe('export interface SearchResult');
    expect(sigs[1]).toBe('export interface SearchOpts');
  });

  it('extracts exported types and consts', () => {
    const content = `
export type NoteType = 'research' | 'guide';
export const DEFAULT_LIMIT = 50;
`;
    const sigs = extractSignatures(content);

    expect(sigs).toHaveLength(2);
    expect(sigs[0]).toBe('export type NoteType');
    expect(sigs[1]).toBe('export const DEFAULT_LIMIT');
  });

  it('ignores non-exported declarations', () => {
    const content = `
function internalFn() {}
interface InternalIface {}
const localConst = 42;
`;
    const sigs = extractSignatures(content);

    expect(sigs).toHaveLength(0);
  });

  it('returns empty array for empty content', () => {
    expect(extractSignatures('')).toEqual([]);
  });
});

describe('detectBreakingChanges', () => {
  it('returns changes for recently modified key files', () => {
    mockExecSync.mockImplementation((cmd: string) => {
      if (cmd.includes('--name-only')) {
        return 'src/types.ts\n\nsrc/types.ts\n';
      }
      if (cmd.includes('--format=%ci')) {
        return '2026-03-12 10:00:00 +0000\n';
      }
      return '';
    });
    mockReadFileSync.mockReturnValue('export interface Note {\n  id: string;\n}\n');

    const changes = detectBreakingChanges('/fake/project');

    expect(changes).toHaveLength(1);
    expect(changes[0].file).toBe('src/types.ts');
    expect(changes[0].changedAt).toBe('2026-03-12 10:00:00 +0000');
    expect(changes[0].currentSignatures).toContain('export interface Note');
  });

  it('returns empty array when git command fails', () => {
    mockExecSync.mockImplementation(() => {
      throw new Error('not a git repo');
    });

    const changes = detectBreakingChanges('/fake/project');

    expect(changes).toEqual([]);
  });

  it('returns empty array when no key files were modified', () => {
    mockExecSync.mockReturnValue('\n');

    const changes = detectBreakingChanges('/fake/project');

    expect(changes).toEqual([]);
  });

  it('skips files that cannot be read', () => {
    mockExecSync.mockImplementation((cmd: string) => {
      if (cmd.includes('--name-only')) {
        return 'src/types.ts\n';
      }
      if (cmd.includes('--format=%ci')) {
        return '2026-03-12\n';
      }
      return '';
    });
    mockReadFileSync.mockImplementation(() => {
      throw new Error('ENOENT');
    });

    const changes = detectBreakingChanges('/fake/project');

    expect(changes).toEqual([]);
  });

  it('deduplicates files appearing in multiple commits', () => {
    mockExecSync.mockImplementation((cmd: string) => {
      if (cmd.includes('--name-only')) {
        return 'src/types.ts\nsrc/types.ts\nsrc/services/search.ts\n';
      }
      if (cmd.includes('--format=%ci')) {
        return '2026-03-12\n';
      }
      return '';
    });
    mockReadFileSync.mockReturnValue('export function doSearch(): void {}\n');

    const changes = detectBreakingChanges('/fake/project');

    expect(changes).toHaveLength(2);
    const files = changes.map((c) => c.file);
    expect(files).toContain('src/types.ts');
    expect(files).toContain('src/services/search.ts');
  });

  it('respects custom sinceDays parameter', () => {
    mockExecSync.mockReturnValue('\n');

    detectBreakingChanges('/fake/project', 14);

    expect(mockExecSync).toHaveBeenCalledWith(
      expect.stringContaining('14 days ago'),
      expect.any(Object)
    );
  });
});

describe('formatBreakingChangesBrief', () => {
  it('formats breaking changes into a readable section', () => {
    const changes: BreakingChange[] = [
      {
        file: 'src/types.ts',
        changedAt: '2026-03-12',
        currentSignatures: ['export interface Note', 'export type NoteType'],
      },
    ];

    const brief = formatBreakingChangesBrief(changes);

    expect(brief).toContain('--- API Break Notice ---');
    expect(brief).toContain('src/types.ts (changed: 2026-03-12)');
    expect(brief).toContain('export interface Note');
    expect(brief).toContain('export type NoteType');
  });

  it('includes multiple files', () => {
    const changes: BreakingChange[] = [
      {
        file: 'src/types.ts',
        changedAt: '2026-03-12',
        currentSignatures: ['export interface Note'],
      },
      {
        file: 'src/services/search.ts',
        changedAt: '2026-03-11',
        currentSignatures: ['export function hybridSearch'],
      },
    ];

    const brief = formatBreakingChangesBrief(changes);

    expect(brief).toContain('src/types.ts');
    expect(brief).toContain('src/services/search.ts');
    expect(brief).toContain('export function hybridSearch');
  });
});
