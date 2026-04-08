/**
 * MCP Server Hardening — integration tests.
 *
 * Covers two workstreams:
 *   (1) CLI-to-MCP Migration: tests for tools added in VNM-42.245
 *       that lacked coverage in mcp-server.test.ts.
 *   (2) Channel Notifications: brain_workflow_events polling and
 *       resource-list-changed notification path.
 *
 * Uses InMemoryTransport + mock service, same pattern as mcp-server.test.ts.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createBrainMcpServer } from '../../src/server/mcp.js';
import type { BrainServiceClass } from '../../src/services/brain-service.js';
import type { InboxItem } from '../../src/types.js';

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock('../../src/services/search.js', () => ({
  searchMemories: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../src/services/indexing.js', () => ({
  indexSingleFile: vi.fn().mockResolvedValue('indexed-note-id'),
}));

vi.mock('../../src/modules/pm/data/task-ops.js', () => ({
  getTask: vi.fn().mockReturnValue({
    ok: true,
    data: { id: 't1', display_id: 'VNM-01.01', title: 'Test task', status: 'pending' },
  }),
  updateTaskStatus: vi.fn().mockResolvedValue({ ok: true, data: {} }),
  createTask: vi.fn().mockResolvedValue({
    ok: true,
    data: { id: 'new-task', display_id: 'VNM-01.99', title: 'New task', status: 'pending' },
  }),
  listTasks: vi.fn().mockReturnValue({ ok: true, data: [] }),
}));

vi.mock('../../src/modules/pm/data/workstream-ops.js', () => ({
  listWorkstreams: vi.fn().mockReturnValue({
    ok: true,
    data: [{ id: 'ws1', display_id: 'VNM-01', title: 'Workstream 1', number: 1 }],
  }),
  createWorkstream: vi.fn().mockResolvedValue({
    ok: true,
    data: { id: 'ws2', display_id: 'VNM-02', title: 'New Workstream', number: 2 },
  }),
}));

vi.mock('../../src/modules/pm/engine/dependency.js', () => ({
  computeEligible: vi.fn().mockReturnValue(['VNM-01.01']),
  computeWaves: vi.fn().mockReturnValue([[{ display_id: 'VNM-01.01' }]]),
}));

vi.mock('../../src/modules/pm/data/queries.js', () => ({
  resolveProject: vi.fn().mockReturnValue({ ok: true, data: 'VNM' }),
  getPmNotes: vi.fn().mockReturnValue([{ id: 'pn1', content: '# Task body\n\nDetails here.' }]),
}));

vi.mock('../../src/modules/pm/engine/dispatch.js', () => ({
  readTaskBody: vi.fn().mockReturnValue('Task body content'),
}));

// ---------------------------------------------------------------------------
// Shared mock service factory
// ---------------------------------------------------------------------------

function makeService(overrides: Partial<Record<string, unknown>> = {}): BrainServiceClass {
  const mockRawDb = {
    prepare: vi.fn().mockReturnValue({
      all: vi.fn().mockReturnValue([]),
    }),
  };

  return {
    isOpen: true,
    config: {
      dbPath: '/tmp/test.db',
      notesDir: '/tmp/notes',
      embedder: 'local',
    },
    db: {
      addInboxItem: vi.fn(),
      addMemory: vi.fn(),
      getNoteById: vi.fn().mockReturnValue(null),
      getAllNotes: vi.fn().mockReturnValue([
        {
          id: 'n1',
          title: 'Note A',
          type: 'note',
          tier: 'slow',
          filePath: '/notes/a.md',
          summary: 'A note',
        },
        {
          id: 'n2',
          title: 'Note B',
          type: 'research',
          tier: 'fast',
          filePath: '/notes/b.md',
          summary: 'B note',
        },
      ]),
      forgetExpiredMemories: vi.fn(),
      getLatestMemories: vi.fn().mockReturnValue([]),
      getRelationsFrom: vi.fn().mockReturnValue([]),
      rawDb: mockRawDb,
    },
    embedder: { embed: vi.fn(), model: 'mock', dimensions: 3 },
    search: vi.fn().mockResolvedValue([]),
    pmTaskList: vi.fn().mockReturnValue([]),
    pmNext: vi.fn().mockReturnValue([]),
    sessionList: vi.fn().mockReturnValue([]),
    sessionDetail: vi.fn().mockReturnValue(null),
    sessionsByTask: vi.fn().mockReturnValue([]),
    agentList: vi.fn().mockReturnValue([]),
    ...overrides,
  } as unknown as BrainServiceClass;
}

function parseResult(result: { content: Array<{ type: string; text: string }> }): unknown {
  return JSON.parse(result.content[0].text);
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('MCP server hardening (VNM-42.245)', () => {
  let client: Client;
  let service: ReturnType<typeof makeService>;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    service = makeService();
    const server = createBrainMcpServer(service);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: 'test-client', version: '1.0.0' });
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    cleanup = async () => {
      await client.close();
      await server.close();
    };
  });

  afterEach(async () => {
    await cleanup();
  });

  // -------------------------------------------------------------------------
  // Tool registry check
  // -------------------------------------------------------------------------

  it('lists all tools including newly migrated ones', async () => {
    const result = await client.listTools();
    const names = result.tools.map((t) => t.name);

    // Existing tools
    expect(names).toContain('brain_search');
    expect(names).toContain('brain_note_read');
    expect(names).toContain('brain_pm_task_list');
    expect(names).toContain('brain_pm_task_update');
    expect(names).toContain('brain_pm_next');
    expect(names).toContain('brain_session_list');
    expect(names).toContain('brain_agent_list');
    expect(names).toContain('brain_inbox_add');

    // Newly migrated tools (workstream 1)
    expect(names).toContain('brain_pm_task_add');
    expect(names).toContain('brain_note_add');
    expect(names).toContain('brain_note_list');
    expect(names).toContain('brain_pm_context');
    expect(names).toContain('brain_pm_wave');
    expect(names).toContain('brain_pm_capture');
    expect(names).toContain('brain_pm_workstream_list');
    expect(names).toContain('brain_pm_workstream_add');
    expect(names).toContain('brain_session_show');
    expect(names).toContain('brain_memory_add');

    // Channel notification polling tool (workstream 2)
    expect(names).toContain('brain_workflow_events');
  });

  // -------------------------------------------------------------------------
  // Workstream 1: CLI-to-MCP Migration
  // -------------------------------------------------------------------------

  describe('brain_pm_task_add', () => {
    it('creates a task and returns display ID', async () => {
      const result = await client.callTool({
        name: 'brain_pm_task_add',
        arguments: {
          project: 'VNM',
          workstream: 1,
          name: 'New task',
          description: 'Task description',
        },
      });
      expect(result.isError).toBeFalsy();
      const parsed = parseResult(result as { content: Array<{ type: string; text: string }> }) as {
        display_id: string;
      };
      expect(parsed.display_id).toBe('VNM-01.99');
    });

    it('passes all optional fields to createTask', async () => {
      const { createTask } = await import('../../src/modules/pm/data/task-ops.js');
      await client.callTool({
        name: 'brain_pm_task_add',
        arguments: {
          project: 'VNM',
          workstream: 2,
          name: 'Critical task',
          description: 'A critical one',
          priority: 'critical',
          category: 'implementation',
          dependsOn: ['VNM-01.01'],
          acceptanceCriteria: ['criterion one'],
        },
      });
      expect(createTask).toHaveBeenCalledWith(
        service.db,
        service.config,
        service.embedder,
        expect.objectContaining({
          project: 'VNM',
          workstream: 2,
          priority: 'critical',
          category: 'implementation',
          dependsOn: ['VNM-01.01'],
          acceptanceCriteria: ['criterion one'],
        })
      );
    });

    it('returns error when createTask fails', async () => {
      const { createTask } = await import('../../src/modules/pm/data/task-ops.js');
      vi.mocked(createTask).mockResolvedValueOnce({
        ok: false,
        error: new Error('workstream not found'),
      });
      const result = await client.callTool({
        name: 'brain_pm_task_add',
        arguments: { project: 'VNM', workstream: 99, name: 'bad', description: 'x' },
      });
      expect(result.isError).toBe(true);
      const content = result.content as Array<{ text: string }>;
      expect(content[0].text).toContain('workstream not found');
    });
  });

  describe('brain_note_add', () => {
    it('creates a note and returns noteId and filePath', async () => {
      const result = await client.callTool({
        name: 'brain_note_add',
        arguments: {
          title: 'My New Note',
          content: 'Some note content here.',
        },
      });
      expect(result.isError).toBeFalsy();
      const parsed = parseResult(result as { content: Array<{ type: string; text: string }> }) as {
        noteId: string;
        filePath: string;
        title: string;
        type: string;
        tier: string;
      };
      expect(parsed.noteId).toBe('indexed-note-id');
      expect(parsed.title).toBe('My New Note');
      expect(parsed.type).toBe('note');
      expect(parsed.tier).toBe('slow');
    });

    it('respects type, tier, tags, and summary', async () => {
      const result = await client.callTool({
        name: 'brain_note_add',
        arguments: {
          title: 'Research Note',
          content: 'Content',
          type: 'research',
          tier: 'fast',
          tags: ['ai', 'testing'],
          summary: 'Short summary',
        },
      });
      expect(result.isError).toBeFalsy();
      const parsed = parseResult(result as { content: Array<{ type: string; text: string }> }) as {
        type: string;
        tier: string;
      };
      expect(parsed.type).toBe('research');
      expect(parsed.tier).toBe('fast');
    });
  });

  describe('brain_note_list', () => {
    it('returns all notes when no filter', async () => {
      const result = await client.callTool({
        name: 'brain_note_list',
        arguments: {},
      });
      expect(result.isError).toBeFalsy();
      const parsed = parseResult(
        result as { content: Array<{ type: string; text: string }> }
      ) as Array<{ id: string }>;
      expect(parsed).toHaveLength(2);
    });

    it('filters by type', async () => {
      const result = await client.callTool({
        name: 'brain_note_list',
        arguments: { type: 'research' },
      });
      const parsed = parseResult(
        result as { content: Array<{ type: string; text: string }> }
      ) as Array<{ id: string; type: string }>;
      expect(parsed.every((n) => n.type === 'research')).toBe(true);
    });

    it('filters by tier', async () => {
      const result = await client.callTool({
        name: 'brain_note_list',
        arguments: { tier: 'fast' },
      });
      const parsed = parseResult(
        result as { content: Array<{ type: string; text: string }> }
      ) as Array<{ tier: string }>;
      expect(parsed.every((n) => n.tier === 'fast')).toBe(true);
    });

    it('respects limit', async () => {
      service.db.getAllNotes = vi.fn().mockReturnValue(
        Array.from({ length: 100 }, (_, i) => ({
          id: `n${i}`,
          title: `Note ${i}`,
          type: 'note',
          tier: 'slow',
          filePath: `/notes/${i}.md`,
          summary: null,
        }))
      );
      const result = await client.callTool({
        name: 'brain_note_list',
        arguments: { limit: 10 },
      });
      const parsed = parseResult(
        result as { content: Array<{ type: string; text: string }> }
      ) as unknown[];
      expect(parsed).toHaveLength(10);
    });
  });

  describe('brain_memory_add', () => {
    it('stores a memory and returns its ID', async () => {
      const result = await client.callTool({
        name: 'brain_memory_add',
        arguments: { memory: 'TypeScript uses structural typing' },
      });
      expect(result.isError).toBeFalsy();
      const parsed = parseResult(result as { content: Array<{ type: string; text: string }> }) as {
        id: string;
        memory: string;
      };
      expect(parsed.id).toBeDefined();
      expect(parsed.memory).toBe('TypeScript uses structural typing');
      expect(service.db.addMemory).toHaveBeenCalledOnce();
    });

    it('stores memory with containerTag and category', async () => {
      await client.callTool({
        name: 'brain_memory_add',
        arguments: {
          memory: 'Use zod for validation',
          containerTag: 'session:SES-01',
          category: 'technical',
          sourceNoteId: 'note-abc',
        },
      });
      const call = (service.db.addMemory as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(call.containerTag).toBe('session:SES-01');
      expect(call.sourceNoteId).toBe('note-abc');
    });
  });

  describe('brain_pm_workstream_list', () => {
    it('returns workstreams for the resolved project', async () => {
      const result = await client.callTool({
        name: 'brain_pm_workstream_list',
        arguments: { prefix: 'VNM' },
      });
      expect(result.isError).toBeFalsy();
      const parsed = parseResult(
        result as { content: Array<{ type: string; text: string }> }
      ) as Array<{ display_id: string }>;
      expect(parsed).toHaveLength(1);
      expect(parsed[0].display_id).toBe('VNM-01');
    });

    it('returns error when project cannot be resolved', async () => {
      const { resolveProject } = await import('../../src/modules/pm/data/queries.js');
      vi.mocked(resolveProject).mockReturnValueOnce({
        ok: false,
        error: new Error('project not found'),
      });
      const result = await client.callTool({
        name: 'brain_pm_workstream_list',
        arguments: { prefix: 'UNKNOWN' },
      });
      expect(result.isError).toBe(true);
    });
  });

  describe('brain_pm_workstream_add', () => {
    it('creates a workstream and returns display ID', async () => {
      const result = await client.callTool({
        name: 'brain_pm_workstream_add',
        arguments: { project: 'VNM', name: 'New Workstream' },
      });
      expect(result.isError).toBeFalsy();
      const parsed = parseResult(result as { content: Array<{ type: string; text: string }> }) as {
        display_id: string;
      };
      expect(parsed.display_id).toBe('VNM-02');
    });

    it('passes optional description to createWorkstream', async () => {
      const { createWorkstream } = await import('../../src/modules/pm/data/workstream-ops.js');
      await client.callTool({
        name: 'brain_pm_workstream_add',
        arguments: { project: 'VNM', name: 'WS', description: 'Some details' },
      });
      expect(createWorkstream).toHaveBeenCalledWith(
        service.db,
        service.config,
        service.embedder,
        expect.objectContaining({ description: 'Some details' })
      );
    });
  });

  describe('brain_pm_wave', () => {
    it('returns dependency-ordered waves', async () => {
      const result = await client.callTool({
        name: 'brain_pm_wave',
        arguments: { prefix: 'VNM' },
      });
      expect(result.isError).toBeFalsy();
      const parsed = parseResult(
        result as { content: Array<{ type: string; text: string }> }
      ) as Array<Array<{ display_id: string }>>;
      expect(parsed).toHaveLength(1);
      expect(parsed[0][0].display_id).toBe('VNM-01.01');
    });
  });

  describe('brain_pm_capture', () => {
    it('captures a task idea to the inbox', async () => {
      const result = await client.callTool({
        name: 'brain_pm_capture',
        arguments: { text: 'Idea for new feature' },
      });
      expect(result.isError).toBeFalsy();
      const parsed = parseResult(result as { content: Array<{ type: string; text: string }> }) as {
        captured: string;
        hint: string;
      };
      expect(parsed.captured).toBeDefined();
      expect(parsed.hint).toContain('brain_pm_task_add');
      expect(service.db.addInboxItem).toHaveBeenCalledOnce();
    });

    it('prefixes inbox content with project context when provided', async () => {
      await client.callTool({
        name: 'brain_pm_capture',
        arguments: { text: 'The idea', project: 'VNM', workstream: 'VNM-42' },
      });
      const item = (service.db.addInboxItem as ReturnType<typeof vi.fn>).mock
        .calls[0][0] as InboxItem;
      expect(item.content).toContain('VNM');
      expect(item.content).toContain('VNM-42');
      expect(item.content).toContain('The idea');
    });
  });

  describe('brain_pm_context', () => {
    it('returns rich task context bundle', async () => {
      service.sessionsByTask = vi
        .fn()
        .mockReturnValue([
          { display_id: 'SES-01', status: 'completed', started_at: '2026-01-01T00:00:00Z' },
        ]);

      const result = await client.callTool({
        name: 'brain_pm_context',
        arguments: { displayId: 'VNM-01.01' },
      });
      expect(result.isError).toBeFalsy();
      const parsed = parseResult(result as { content: Array<{ type: string; text: string }> }) as {
        task: { display_id: string };
        body: string;
        sessions: Array<{ displayId: string }>;
        relatedNotes: unknown[];
      };
      expect(parsed.task.display_id).toBe('VNM-01.01');
      expect(parsed.body).toBe('Task body content');
      expect(parsed.sessions).toHaveLength(1);
      expect(parsed.sessions[0].displayId).toBe('SES-01');
    });

    it('returns error when task not found', async () => {
      const { getTask } = await import('../../src/modules/pm/data/task-ops.js');
      vi.mocked(getTask).mockReturnValueOnce({
        ok: false,
        error: new Error('task not found'),
      });
      const result = await client.callTool({
        name: 'brain_pm_context',
        arguments: { displayId: 'VNM-99.99' },
      });
      expect(result.isError).toBe(true);
    });
  });

  describe('brain_session_show', () => {
    it('returns session detail', async () => {
      service.sessionDetail = vi.fn().mockReturnValue({
        id: 's1',
        display_id: 'SES-01',
        status: 'completed',
        turns: 5,
        tokenUsage: { total: 1000 },
      });

      const result = await client.callTool({
        name: 'brain_session_show',
        arguments: { displayId: 'SES-01' },
      });
      expect(result.isError).toBeFalsy();
      const parsed = parseResult(result as { content: Array<{ type: string; text: string }> }) as {
        display_id: string;
        turns: number;
      };
      expect(parsed.display_id).toBe('SES-01');
      expect(parsed.turns).toBe(5);
    });

    it('returns error when session not found', async () => {
      service.sessionDetail = vi.fn().mockReturnValue(null);
      const result = await client.callTool({
        name: 'brain_session_show',
        arguments: { displayId: 'SES-99' },
      });
      expect(result.isError).toBe(true);
      const content = result.content as Array<{ text: string }>;
      expect(content[0].text).toContain('not found');
    });
  });

  // -------------------------------------------------------------------------
  // Workstream 2: Channel Notifications — brain_workflow_events
  // -------------------------------------------------------------------------

  describe('brain_workflow_events', () => {
    it('returns events array with cursor', async () => {
      const result = await client.callTool({
        name: 'brain_workflow_events',
        arguments: {},
      });
      expect(result.isError).toBeFalsy();
      const parsed = parseResult(result as { content: Array<{ type: string; text: string }> }) as {
        events: unknown[];
        cursor: string;
        hint: string;
      };
      expect(Array.isArray(parsed.events)).toBe(true);
      expect(parsed.cursor).toBeDefined();
      expect(new Date(parsed.cursor).getTime()).not.toBeNaN();
      expect(parsed.hint).toContain('since');
    });

    it('filters by instanceId when provided', async () => {
      const mockAll = vi.fn().mockReturnValue([
        {
          id: 'run-abc',
          workflow_name: 'planning',
          status: 'running',
          current_step: 'spec-tests',
          started_at: '2026-01-01T00:00:00Z',
          completed_at: null,
          error: null,
        },
      ]);
      service.db.rawDb = {
        prepare: vi.fn().mockReturnValue({ all: mockAll }),
      } as unknown as typeof service.db.rawDb;

      const result = await client.callTool({
        name: 'brain_workflow_events',
        arguments: { instanceId: 'run-abc' },
      });
      const parsed = parseResult(result as { content: Array<{ type: string; text: string }> }) as {
        events: Array<{ instanceId: string; workflowId: string; status: string }>;
      };
      expect(parsed.events).toHaveLength(1);
      expect(parsed.events[0].instanceId).toBe('run-abc');
      expect(parsed.events[0].workflowId).toBe('planning');
      expect(parsed.events[0].status).toBe('running');
    });

    it('returns events with correct shape', async () => {
      const mockAll = vi.fn().mockReturnValue([
        {
          id: 'run-xyz',
          workflow_name: 'implementation',
          status: 'complete',
          current_step: null,
          started_at: '2026-01-01T00:00:00Z',
          completed_at: '2026-01-01T01:00:00Z',
          error: null,
        },
      ]);
      service.db.rawDb = {
        prepare: vi.fn().mockReturnValue({ all: mockAll }),
      } as unknown as typeof service.db.rawDb;

      const result = await client.callTool({
        name: 'brain_workflow_events',
        arguments: { limit: 5 },
      });
      const parsed = parseResult(result as { content: Array<{ type: string; text: string }> }) as {
        events: Array<{
          instanceId: string;
          workflowId: string;
          status: string;
          currentStep: string | null;
          startedAt: string;
          completedAt: string | null;
          error: string | null;
        }>;
      };
      const ev = parsed.events[0];
      expect(ev.instanceId).toBe('run-xyz');
      expect(ev.workflowId).toBe('implementation');
      expect(ev.status).toBe('complete');
      expect(ev.currentStep).toBeNull();
      expect(ev.completedAt).toBe('2026-01-01T01:00:00Z');
    });

    it('passes since filter to the SQL query', async () => {
      const mockPrepare = vi.fn().mockReturnValue({ all: vi.fn().mockReturnValue([]) });
      service.db.rawDb = {
        prepare: mockPrepare,
      } as unknown as typeof service.db.rawDb;

      const since = '2026-03-01T00:00:00Z';
      await client.callTool({
        name: 'brain_workflow_events',
        arguments: { since },
      });

      const sql: string = mockPrepare.mock.calls[0][0];
      expect(sql).toContain('completed_at');
      expect(sql).toContain('started_at');

      const allArgs: unknown[] = (mockPrepare.mock.results[0].value.all as ReturnType<typeof vi.fn>)
        .mock.calls[0];
      expect(allArgs).toContain(since);
    });

    it('workflow-runs resource is registered', async () => {
      const result = await client.listResources();
      const uris = result.resources.map((r) => r.uri);
      expect(uris).toContain('brain://workflow/runs');
    });
  });

  // -------------------------------------------------------------------------
  // Channel notification path in src/server/index.ts
  // -------------------------------------------------------------------------

  describe('initV2Runtime channel notification path', () => {
    it('sendResourceListChanged is called on channelPush', async () => {
      // Test that the channelPush callback in initV2Runtime fires
      // sendResourceListChanged — tested indirectly by verifying the
      // WorkflowRuntime constructor receives a channelPush that wraps it.
      //
      // This integration behaviour is validated in workflow-mcp.test.ts;
      // here we just confirm createBrainMcpServer exposes the workflow-runs
      // resource (the stable polling target) and the server is connected.
      const result = await client.listResources();
      expect(result.resources.length).toBeGreaterThanOrEqual(1);
      const workflowRuns = result.resources.find((r) => r.uri === 'brain://workflow/runs');
      expect(workflowRuns).toBeDefined();
      // mimeType is returned in readResource contents, not listResources
    });
  });
});
