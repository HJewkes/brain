import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
    writeFileSync: vi.fn(),
  };
});

vi.mock('node:crypto', () => ({
  createHash: () => ({ update: () => ({ digest: () => 'fakehash' }) }),
}));

vi.mock('../../../src/modules/pm/data/queries.js', () => ({
  getPmNotes: vi.fn(),
}));

vi.mock('../../../src/services/indexing.js', () => ({
  indexSingleFile: vi.fn(),
}));

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { getPmNotes } from '../../../src/modules/pm/data/queries.js';
import { indexSingleFile } from '../../../src/services/indexing.js';
import { writeEnrichmentToTask } from '../../../src/modules/autoloop/engine/enrichment-writer.js';
import type { EnrichmentSuggestion } from '../../../src/modules/autoloop/engine/task-enricher.js';

const mockExistsSync = existsSync as ReturnType<typeof vi.fn>;
const mockReadFileSync = readFileSync as ReturnType<typeof vi.fn>;
const mockWriteFileSync = writeFileSync as ReturnType<typeof vi.fn>;
const mockGetPmNotes = getPmNotes as ReturnType<typeof vi.fn>;
const mockIndexSingleFile = indexSingleFile as ReturnType<typeof vi.fn>;

function makeSuggestion(overrides: Partial<EnrichmentSuggestion> = {}): EnrichmentSuggestion {
  return {
    taskId: 'VNM-45.01',
    suggestedAdditions: [],
    relatedResearch: [],
    relatedMemories: [],
    ...overrides,
  };
}

describe('writeEnrichmentToTask', () => {
  const fakeDb = {} as never;
  const fakeEmbedder = {} as never;

  beforeEach(() => {
    vi.clearAllMocks();
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue('---\ntitle: Task\n---\n\nSome content');
    mockGetPmNotes.mockReturnValue([{ filePath: '/notes/task.md' }]);
    mockIndexSingleFile.mockResolvedValue(undefined);
  });

  it('skips when no matching note found', async () => {
    mockGetPmNotes.mockReturnValue([]);
    await writeEnrichmentToTask(fakeDb, fakeEmbedder, makeSuggestion());
    expect(mockWriteFileSync).not.toHaveBeenCalled();
  });

  it('skips when note file does not exist on disk', async () => {
    mockExistsSync.mockReturnValue(false);
    await writeEnrichmentToTask(fakeDb, fakeEmbedder, makeSuggestion());
    expect(mockWriteFileSync).not.toHaveBeenCalled();
  });

  it('skips when already enriched', async () => {
    mockReadFileSync.mockReturnValue(
      '---\ntitle: Task\n---\n\n## Enrichment Context\n\nAlready here'
    );
    await writeEnrichmentToTask(
      fakeDb,
      fakeEmbedder,
      makeSuggestion({
        relatedResearch: [{ title: 'Test', relevance: 0.9, excerpt: 'excerpt' }],
      })
    );
    expect(mockWriteFileSync).not.toHaveBeenCalled();
  });

  it('skips when suggestion has no research or memories', async () => {
    await writeEnrichmentToTask(fakeDb, fakeEmbedder, makeSuggestion());
    expect(mockWriteFileSync).not.toHaveBeenCalled();
  });

  it('appends research section and re-indexes', async () => {
    const suggestion = makeSuggestion({
      relatedResearch: [{ title: 'Paper A', relevance: 0.85, excerpt: 'Key finding' }],
    });
    await writeEnrichmentToTask(fakeDb, fakeEmbedder, suggestion);

    expect(mockWriteFileSync).toHaveBeenCalledOnce();
    const written = mockWriteFileSync.mock.calls[0][1] as string;
    expect(written).toContain('## Enrichment Context');
    expect(written).toContain('### Related Research');
    expect(written).toContain('Paper A');
    expect(written).toContain('Key finding');

    expect(mockIndexSingleFile).toHaveBeenCalledOnce();
  });

  it('appends memories section', async () => {
    const suggestion = makeSuggestion({
      relatedMemories: ['User prefers TDD', 'Project uses Vitest'],
    });
    await writeEnrichmentToTask(fakeDb, fakeEmbedder, suggestion);

    const written = mockWriteFileSync.mock.calls[0][1] as string;
    expect(written).toContain('### Related Memories');
    expect(written).toContain('User prefers TDD');
    expect(written).toContain('Project uses Vitest');
  });

  it('truncates long excerpts to 200 chars', async () => {
    const longExcerpt = 'x'.repeat(300);
    const suggestion = makeSuggestion({
      relatedResearch: [{ title: 'Long', relevance: 0.9, excerpt: longExcerpt }],
    });
    await writeEnrichmentToTask(fakeDb, fakeEmbedder, suggestion);

    const written = mockWriteFileSync.mock.calls[0][1] as string;
    const excerptLine = written.split('\n').find((l: string) => l.includes('> '));
    expect(excerptLine!.length).toBeLessThan(250);
  });
});
