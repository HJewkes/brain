import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PmContentHandler, mapPriority } from '../../../src/modules/pm/content-handler.js';
import type { BrainDB } from '../../../src/services/brain-db.js';
import type { BrainConfig, Embedder, ExtractedItem } from '../../../src/types.js';

// Mock all PM data operations
vi.mock('../../../src/modules/pm/data/task-ops.js', () => ({
  createTask: vi.fn(),
}));
vi.mock('../../../src/modules/pm/data/project-ops.js', () => ({
  createProject: vi.fn(),
}));
vi.mock('../../../src/modules/pm/data/workstream-ops.js', () => ({
  createWorkstream: vi.fn(),
}));
vi.mock('../../../src/modules/pm/data/queries.js', () => ({
  getPmNotes: vi.fn(),
}));

import { createTask } from '../../../src/modules/pm/data/task-ops.js';
import { createProject } from '../../../src/modules/pm/data/project-ops.js';
import { createWorkstream } from '../../../src/modules/pm/data/workstream-ops.js';
import { getPmNotes } from '../../../src/modules/pm/data/queries.js';

const mockConfig: BrainConfig = {
  notesDir: '/tmp/test-brain',
  dbPath: '/tmp/test-brain/brain.db',
  embedder: { type: 'local' },
} as BrainConfig;

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

function makeItem(overrides: Partial<ExtractedItem> = {}): ExtractedItem {
  return {
    noteType: 'task',
    title: 'Test task',
    content: 'Task description',
    fields: {},
    ...overrides,
  };
}

let taskCounter = 0;

function setupMocksForNewProject(): void {
  taskCounter = 0;
  (createProject as ReturnType<typeof vi.fn>).mockResolvedValue({
    ok: true,
    data: { prefix: 'IMPT', status: 'active' },
  });
  (createWorkstream as ReturnType<typeof vi.fn>).mockResolvedValue({
    ok: true,
    data: { number: 1, display_id: 'IMPT-01', project: 'IMPT', status: 'active' },
  });
  (createTask as ReturnType<typeof vi.fn>).mockImplementation(async () => {
    taskCounter++;
    const displayId = `IMPT-01.0${taskCounter}`;
    return {
      ok: true,
      data: {
        display_id: displayId,
        project: 'IMPT',
        workstream: 1,
        number: taskCounter,
        status: 'pending',
        mode: 'auto',
        category: 'implementation',
        priority: 'medium',
      },
    };
  });
  (getPmNotes as ReturnType<typeof vi.fn>).mockImplementation(
    (_db: BrainDB, type: string, filters?: Record<string, unknown>) => {
      if (type === 'workstream') return [];
      if (type === 'task' && filters?.display_id) {
        return [{ id: `note-${filters.display_id}`, metadata: '{}' }];
      }
      return [];
    }
  );
}

function setupMocksForExistingProject(prefix: string): void {
  taskCounter = 0;
  (createTask as ReturnType<typeof vi.fn>).mockImplementation(async () => {
    taskCounter++;
    const displayId = `${prefix}-01.0${taskCounter}`;
    return {
      ok: true,
      data: {
        display_id: displayId,
        project: prefix,
        workstream: 1,
        number: taskCounter,
        status: 'pending',
        mode: 'auto',
        category: 'implementation',
        priority: 'medium',
      },
    };
  });
  (getPmNotes as ReturnType<typeof vi.fn>).mockImplementation(
    (_db: BrainDB, type: string, filters?: Record<string, unknown>) => {
      if (type === 'workstream' && filters?.project === prefix) {
        return [{ id: 'ws-1', metadata: JSON.stringify({ number: 1 }) }];
      }
      if (type === 'task' && filters?.display_id) {
        return [{ id: `note-${filters.display_id}`, metadata: '{}' }];
      }
      return [];
    }
  );
}

describe('PmContentHandler', () => {
  let handler: PmContentHandler;

  beforeEach(() => {
    handler = new PmContentHandler();
    handler.setConfig(mockConfig);
    vi.clearAllMocks();
    taskCounter = 0;
  });

  describe('interface declarations', () => {
    it('declares task note type', () => {
      expect(handler.noteTypes).toContain('task');
    });
  });

  describe('canHandle', () => {
    it('returns true for task note type', () => {
      expect(handler.canHandle('task', 'some content')).toBe(true);
    });

    it('returns false for non-task note type', () => {
      expect(handler.canHandle('project', 'some content')).toBe(false);
    });
  });

  describe('materialize with ExtractedItem[]', () => {
    it('creates real PM tasks from extracted items', async () => {
      const mockDb = createMockDb();
      setupMocksForNewProject();

      const items: ExtractedItem[] = [
        makeItem({ title: 'Fix login bug', fields: { name: 'Fix login bug', priority: 'high' } }),
        makeItem({ title: 'Add tests', fields: { name: 'Add tests', priority: 'medium' } }),
      ];

      const ids = await handler.materialize(mockDb, mockEmbedder, items, 'source-note-1');

      expect(ids).toHaveLength(2);
      expect(createTask).toHaveBeenCalledTimes(2);
    });

    it('auto-creates project when none exists', async () => {
      const mockDb = createMockDb();
      setupMocksForNewProject();

      const items = [makeItem({ title: 'Task 1', fields: { name: 'Task 1' } })];
      await handler.materialize(mockDb, mockEmbedder, items, 'source-1');

      expect(createProject).toHaveBeenCalledWith(mockDb, mockConfig, mockEmbedder, {
        name: 'Imported',
        prefix: 'IMPT',
      });
    });

    it('auto-creates workstream when none exists', async () => {
      const mockDb = createMockDb();
      setupMocksForNewProject();

      const items = [makeItem({ title: 'Task 1', fields: { name: 'Task 1' } })];
      await handler.materialize(mockDb, mockEmbedder, items, 'source-1');

      expect(createWorkstream).toHaveBeenCalledWith(mockDb, mockConfig, mockEmbedder, {
        project: 'IMPT',
        name: 'General',
      });
    });

    it('uses existing active project if one exists', async () => {
      const mockDb = createMockDb([
        {
          id: 'proj-1',
          metadata: JSON.stringify({ prefix: 'TEST', status: 'active' }),
          type: 'project',
        },
      ]);
      setupMocksForExistingProject('TEST');

      const items = [makeItem({ title: 'Task 1', fields: { name: 'Task 1' } })];
      await handler.materialize(mockDb, mockEmbedder, items, 'source-1');

      expect(createProject).not.toHaveBeenCalled();
      expect(createTask).toHaveBeenCalledWith(
        mockDb,
        mockConfig,
        mockEmbedder,
        expect.objectContaining({ project: 'TEST' })
      );
    });

    it('maps priority values correctly', async () => {
      const mockDb = createMockDb();
      setupMocksForNewProject();

      const items = [
        makeItem({ fields: { name: 'Critical task', priority: 'critical' } }),
        makeItem({ fields: { name: 'Urgent task', priority: 'urgent' } }),
        makeItem({ fields: { name: 'High task', priority: 'high' } }),
        makeItem({ fields: { name: 'P1 task', priority: 'P1' } }),
        makeItem({ fields: { name: 'Low task', priority: 'P3' } }),
        makeItem({ fields: { name: 'Normal task', priority: 'medium' } }),
      ];

      await handler.materialize(mockDb, mockEmbedder, items, 'source-1');

      const calls = (createTask as ReturnType<typeof vi.fn>).mock.calls;
      expect(calls[0][3].priority).toBe('critical');
      expect(calls[1][3].priority).toBe('critical');
      expect(calls[2][3].priority).toBe('high');
      expect(calls[3][3].priority).toBe('high');
      expect(calls[4][3].priority).toBe('low');
      expect(calls[5][3].priority).toBe('medium');
    });

    it('creates derived-from relations to source note', async () => {
      const mockDb = createMockDb();
      setupMocksForNewProject();

      const items = [makeItem({ title: 'Task A', fields: { name: 'Task A' } })];
      await handler.materialize(mockDb, mockEmbedder, items, 'source-42');

      expect(mockDb.upsertRelations).toHaveBeenCalledWith(expect.stringContaining('note-'), [
        expect.objectContaining({
          targetId: 'source-42',
          type: 'derived-from',
        }),
      ]);
    });

    it('returns empty array for empty items list', async () => {
      const mockDb = createMockDb();
      const ids = await handler.materialize(mockDb, mockEmbedder, [], 'source-1');
      expect(ids).toHaveLength(0);
    });

    it('maps category field', async () => {
      const mockDb = createMockDb();
      setupMocksForNewProject();

      const items = [makeItem({ fields: { name: 'Task', category: 'testing' } })];
      await handler.materialize(mockDb, mockEmbedder, items, 'source-1');

      expect(createTask).toHaveBeenCalledWith(
        mockDb,
        mockConfig,
        mockEmbedder,
        expect.objectContaining({ category: 'testing' })
      );
    });

    it('maps due_date field', async () => {
      const mockDb = createMockDb();
      setupMocksForNewProject();

      const items = [makeItem({ fields: { name: 'Task', due_date: '2026-04-01' } })];
      await handler.materialize(mockDb, mockEmbedder, items, 'source-1');

      expect(createTask).toHaveBeenCalledWith(
        mockDb,
        mockConfig,
        mockEmbedder,
        expect.objectContaining({ dueDate: '2026-04-01' })
      );
    });

    it('throws if config is not set', async () => {
      const noConfigHandler = new PmContentHandler();
      const mockDb = createMockDb();
      setupMocksForNewProject();

      const items = [makeItem({ title: 'Task 1' })];
      await expect(
        noConfigHandler.materialize(mockDb, mockEmbedder, items, 'source-1')
      ).rejects.toThrow('requires config');
    });

    it('uses item.title when fields.name is absent', async () => {
      const mockDb = createMockDb();
      setupMocksForNewProject();

      const items = [makeItem({ title: 'From title', fields: {} })];
      await handler.materialize(mockDb, mockEmbedder, items, 'source-1');

      expect(createTask).toHaveBeenCalledWith(
        mockDb,
        mockConfig,
        mockEmbedder,
        expect.objectContaining({ name: 'From title' })
      );
    });

    it('uses item.content when fields.description is absent', async () => {
      const mockDb = createMockDb();
      setupMocksForNewProject();

      const items = [
        makeItem({ title: 'Task', content: 'Content description', fields: { name: 'Task' } }),
      ];
      await handler.materialize(mockDb, mockEmbedder, items, 'source-1');

      expect(createTask).toHaveBeenCalledWith(
        mockDb,
        mockConfig,
        mockEmbedder,
        expect.objectContaining({ description: 'Content description' })
      );
    });
  });

  describe('mapPriority', () => {
    it('maps critical/urgent/p0 to critical', () => {
      expect(mapPriority('critical')).toBe('critical');
      expect(mapPriority('urgent')).toBe('critical');
      expect(mapPriority('p0')).toBe('critical');
    });

    it('maps high/p1 to high', () => {
      expect(mapPriority('high')).toBe('high');
      expect(mapPriority('p1')).toBe('high');
    });

    it('maps low/p3 to low', () => {
      expect(mapPriority('low')).toBe('low');
      expect(mapPriority('p3')).toBe('low');
    });

    it('defaults to medium', () => {
      expect(mapPriority(undefined)).toBe('medium');
      expect(mapPriority('whatever')).toBe('medium');
      expect(mapPriority('p2')).toBe('medium');
    });
  });
});
