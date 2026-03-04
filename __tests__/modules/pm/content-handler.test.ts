import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PmContentHandler } from '../../../src/modules/pm/content-handler.js';
import type { BrainDB } from '../../../src/services/brain-db.js';
import type { Embedder } from '../../../src/types.js';
import type { ClassifiedSection } from '../../../src/services/content-classifier.js';

vi.mock('../../../src/services/indexing.js', () => ({
  indexSingleFile: vi.fn().mockResolvedValue('mock-note-id'),
}));

import { indexSingleFile } from '../../../src/services/indexing.js';

function createMockDb(projectNotes: Array<{ id: string; metadata: string; type: string }> = []) {
  const noteIds = projectNotes.map((n) => n.id);
  const noteMap = new Map(
    projectNotes.map((n) => [n.id, { id: n.id, metadata: n.metadata, type: n.type, module: 'pm' }])
  );
  return {
    getModuleNoteIds: vi.fn().mockReturnValue(noteIds),
    getNotesByIds: vi.fn().mockReturnValue(noteMap),
    upsertRelations: vi.fn(),
  } as unknown as BrainDB;
}

const mockEmbedder: Embedder = {
  embed: vi.fn().mockResolvedValue([[0, 0, 0]]),
  model: 'test',
  dimensions: 3,
};

describe('PmContentHandler', () => {
  let handler: PmContentHandler;

  beforeEach(() => {
    handler = new PmContentHandler();
    vi.clearAllMocks();
    (indexSingleFile as ReturnType<typeof vi.fn>).mockResolvedValue('mock-note-id');
  });

  it('claims task-list content class', () => {
    expect(handler.contentClasses).toContain('task-list');
  });

  it('canHandle returns true for task-list classification', () => {
    const section: ClassifiedSection = {
      content: '| Title | Status | Priority |\n| --- | --- | --- |\n| Fix bug | Open | High |',
      contentClass: 'task-list',
      confidence: 0.9,
      method: 'deterministic',
      heading: 'Tasks',
    };
    expect(handler.canHandle(section)).toBe(true);
  });

  it('canHandle returns false for non-task-list content', () => {
    const section: ClassifiedSection = {
      content: 'Some architecture text',
      contentClass: 'architecture',
      confidence: 0.8,
      method: 'deterministic',
      heading: 'Architecture',
    };
    expect(handler.canHandle(section)).toBe(false);
  });

  it('parses table rows and creates notes via indexSingleFile', async () => {
    const content = `| Title | Status | Priority | Assignee |
| --- | --- | --- | --- |
| Fix login bug | Open | High | Alice |
| Add tests | Done | Medium | Bob |`;

    const section: ClassifiedSection = {
      content,
      contentClass: 'task-list',
      confidence: 0.9,
      method: 'deterministic',
      heading: 'Tasks',
    };

    const mockDb = createMockDb();
    const ids = await handler.materialize(mockDb, mockEmbedder, content, section, 'source-note-1');

    expect(ids).toHaveLength(2);
    expect(indexSingleFile).toHaveBeenCalledTimes(2);
    expect(mockDb.upsertRelations).toHaveBeenCalledTimes(2);
  });

  it('creates derived-from relations to source note', async () => {
    const content = `| Title | Status |
| --- | --- |
| Task A | Open |`;

    const section: ClassifiedSection = {
      content,
      contentClass: 'task-list',
      confidence: 0.9,
      method: 'deterministic',
      heading: 'Tasks',
    };

    const mockDb = createMockDb();
    await handler.materialize(mockDb, mockEmbedder, content, section, 'source-42');

    expect(mockDb.upsertRelations).toHaveBeenCalledWith('mock-note-id', [
      { sourceId: 'mock-note-id', targetId: 'source-42', type: 'derived-from' },
    ]);
  });

  it('returns empty array for content without a valid table', async () => {
    const content = 'Just some plain text without any table';
    const section: ClassifiedSection = {
      content,
      contentClass: 'task-list',
      confidence: 0.6,
      method: 'deterministic',
      heading: null,
    };

    const mockDb = createMockDb();
    const ids = await handler.materialize(mockDb, mockEmbedder, content, section, 'source-1');

    expect(ids).toHaveLength(0);
    expect(indexSingleFile).not.toHaveBeenCalled();
  });

  it('maps priority values correctly', async () => {
    const content = `| Title | Priority |
| --- | --- |
| Urgent task | Critical |
| Normal task | Medium |
| Low task | P3 |`;

    const section: ClassifiedSection = {
      content,
      contentClass: 'task-list',
      confidence: 0.9,
      method: 'deterministic',
      heading: 'Tasks',
    };

    const mockDb = createMockDb();
    await handler.materialize(mockDb, mockEmbedder, content, section, 'src-1');

    expect(indexSingleFile).toHaveBeenCalledTimes(3);
    const calls = (indexSingleFile as ReturnType<typeof vi.fn>).mock.calls;

    expect(calls[0][3]).toContain('import_priority: "critical"');
    expect(calls[1][3]).toContain('import_priority: "medium"');
    expect(calls[2][3]).toContain('import_priority: "low"');
  });

  it('attaches PM module and project when active project exists', async () => {
    const content = `| Title | Status |
| --- | --- |
| My task | Open |`;

    const section: ClassifiedSection = {
      content,
      contentClass: 'task-list',
      confidence: 0.9,
      method: 'deterministic',
      heading: 'Tasks',
    };

    const mockDb = createMockDb([
      {
        id: 'proj-1',
        metadata: JSON.stringify({ prefix: 'TEST', status: 'active' }),
        type: 'project',
      },
    ]);

    await handler.materialize(mockDb, mockEmbedder, content, section, 'src-1');

    const call = (indexSingleFile as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[3]).toContain('module: pm');
    expect(call[3]).toContain('project: TEST');
  });

  it('uses name column as fallback when title column is absent', async () => {
    const content = `| Name | Status |
| --- | --- |
| Deploy fix | Pending |`;

    const section: ClassifiedSection = {
      content,
      contentClass: 'task-list',
      confidence: 0.9,
      method: 'deterministic',
      heading: 'Tasks',
    };

    const mockDb = createMockDb();
    await handler.materialize(mockDb, mockEmbedder, content, section, 'src-1');

    const call = (indexSingleFile as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[3]).toContain('title: "Deploy fix"');
    expect(call[3]).toContain('# Deploy fix');
  });

  it('includes extra columns as body content', async () => {
    const content = `| Title | Status | Assignee | Notes |
| --- | --- | --- | --- |
| Review PR | Open | Carol | Check edge cases |`;

    const section: ClassifiedSection = {
      content,
      contentClass: 'task-list',
      confidence: 0.9,
      method: 'deterministic',
      heading: 'Tasks',
    };

    const mockDb = createMockDb();
    await handler.materialize(mockDb, mockEmbedder, content, section, 'src-1');

    const call = (indexSingleFile as ReturnType<typeof vi.fn>).mock.calls[0];
    const markdown = call[3] as string;
    expect(markdown).toContain('**assignee:** Carol');
    expect(markdown).toContain('**notes:** Check edge cases');
  });
});
