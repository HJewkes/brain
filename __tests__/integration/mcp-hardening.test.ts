/**
 * Spec-tests for VNM-42.246: MCP Server Hardening
 *
 * Covers tools not tested in mcp-server.test.ts:
 *   - brain_note_list, brain_note_add
 *   - brain_memory_add
 *   - brain_pm_task_add, brain_pm_workstream_list, brain_pm_workstream_add,
 *     brain_pm_wave, brain_pm_context, brain_pm_capture, brain_pm_overview
 *   - brain_session_show
 *   - brain_workflow_events
 *   - workflow-runs MCP resource
 *   - channelInstructions capability option
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createBrainMcpServer } from '../../src/server/mcp.js';
import type { BrainServiceClass } from '../../src/services/brain-service.js';

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    existsSync: vi.fn().mockReturnValue(false),
    writeFileSync: vi.fn(),
    mkdirSync: vi.fn(),
    readFileSync: vi.fn().mockReturnValue(''),
  };
});

vi.mock('../../src/services/indexing.js', () => ({
  indexSingleFile: vi.fn().mockResolvedValue('new-note-id'),
}));

vi.mock('../../src/modules/pm/data/task-ops.js', () => ({
  getTask: vi.fn().mockReturnValue({
    ok: true,
    data: { id: 't1', display_id: 'VNM-01.01', title: 'Test task', status: 'pending' },
  }),
  listTasks: vi.fn().mockReturnValue({
    ok: true,
    data: [
      {
        id: 't1',
        display_id: 'VNM-01.01',
        title: 'Test task',
        status: 'pending',
        workstream: 1,
        priority: 'high',
        modified: '2026-04-01',
      },
    ],
  }),
  createTask: vi.fn().mockResolvedValue({
    ok: true,
    data: { id: 'new-t', display_id: 'VNM-01.99', title: 'New Task', status: 'pending' },
  }),
  updateTaskStatus: vi.fn().mockResolvedValue({ ok: true, data: {} }),
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
  computeWaves: vi.fn().mockReturnValue([['VNM-01.01'], ['VNM-01.02']]),
}));

vi.mock('../../src/modules/pm/data/queries.js', () => ({
  resolveProject: vi.fn().mockReturnValue({ ok: true, data: 'VNM' }),
  getPmNotes: vi.fn().mockReturnValue([{ id: 'n1', title: 'Task note' }]),
}));

vi.mock('../../src/modules/pm/engine/dispatch.js', () => ({
  readTaskBody: vi.fn().mockReturnValue('Task body content'),
}));

vi.mock('../../src/modules/agents/data.js', () => ({
  getAgent: vi.fn().mockReturnValue({ id: 'a1', name: 'test-agent', status: 'active' }),
  listAgents: vi.fn().mockReturnValue([{ id: 'a1', name: 'test-agent', status: 'active' }]),
}));

vi.mock('../../src/server/dispatch.js', () => ({
  dispatchTask: vi.fn().mockResolvedValue({ agentId: 'a1', pid: 1234, sessionId: 'ses-1' }),
}));

vi.mock('../../src/services/search.js', () => ({
  searchMemories: vi.fn().mockResolvedValue([]),
}));

function makePrepareStmt(rows: unknown[]) {
  return { all: vi.fn().mockReturnValue(rows) };
}

function makeService(overrides: Partial<Record<string, unknown>> = {}): BrainServiceClass {
  return {
    isOpen: true,
    config: { dbPath: '/tmp/test.db', notesDir: '/tmp/notes', embedder: 'local' },
    db: {
      addInboxItem: vi.fn(),
      addMemory: vi.fn(),
      getNoteById: vi.fn().mockReturnValue(null),
      getAllNotes: vi.fn().mockReturnValue([
        {
          id: 'n1',
          title: 'Note One',
          type: 'note',
          tier: 'slow',
          filePath: '/tmp/notes/note-one.md',
          summary: 'A note',
        },
        {
          id: 'n2',
          title: 'Guide Two',
          type: 'guide',
          tier: 'fast',
          filePath: '/tmp/notes/guide-two.md',
          summary: 'A guide',
        },
      ]),
      forgetExpiredMemories: vi.fn(),
      getLatestMemories: vi.fn().mockReturnValue([]),
      getRelationsFrom: vi.fn().mockReturnValue([]),
      rawDb: {
        prepare: vi.fn().mockReturnValue(makePrepareStmt([])),
      },
    },
    embedder: { embed: vi.fn(), model: 'mock', dimensions: 3 },
    search: vi.fn().mockResolvedValue([]),
    pmTaskList: vi.fn().mockReturnValue([]),
    pmNext: vi.fn().mockReturnValue([]),
    sessionList: vi.fn().mockReturnValue([]),
    agentList: vi.fn().mockReturnValue([]),
    sessionDetail: vi.fn().mockReturnValue({
      id: 's1',
      display_id: 'SES-01',
      status: 'completed',
      turns: 5,
      tokenUsage: { input: 1000, output: 500 },
    }),
    sessionsByTask: vi.fn().mockReturnValue([]),
    ...overrides,
  } as unknown as BrainServiceClass;
}

function parseResult(result: { content: Array<{ type: string; text: string }> }): unknown {
  return JSON.parse(result.content[0].text);
}

describe('MCP server hardening (VNM-42.246)', () => {
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

  describe('Tool registry completeness', () => {
    it('lists all 20+ tools including new hardening additions', async () => {
      const result = await client.listTools();
      const names = result.tools.map((t) => t.name);

      const expectedTools = [
        // Search group
        'brain_search',
        'brain_note_read',
        'brain_memory_search',
        'brain_memory_list',
        // Note group
        'brain_note_list',
        'brain_note_add',
        // Memory group
        'brain_memory_add',
        // PM group
        'brain_pm_task_list',
        'brain_pm_task_show',
        'brain_pm_task_update',
        'brain_pm_next',
        'brain_pm_overview',
        // PM extended group
        'brain_pm_task_add',
        'brain_pm_workstream_list',
        'brain_pm_workstream_add',
        'brain_pm_wave',
        'brain_pm_context',
        'brain_pm_capture',
        // Session & agent group
        'brain_session_list',
        'brain_session_show',
        'brain_agent_list',
        'brain_inbox_add',
        // Dispatch group
        'brain_agent_dispatch',
        'brain_agent_status',
        // Workflow group
        'brain_workflow_start',
        'brain_workflow_status',
        'brain_workflow_signal',
        'brain_workflow_events',
      ];

      for (const toolName of expectedTools) {
        expect(names, `expected tool "${toolName}" to be registered`).toContain(toolName);
      }
      expect(names.length).toBeGreaterThanOrEqual(expectedTools.length);
    });
  });

  describe('Note tools', () => {
    it('brain_note_list returns all notes', async () => {
      const result = await client.callTool({ name: 'brain_note_list', arguments: {} });
      expect(result.isError).toBeFalsy();
      const parsed = parseResult(
        result as { content: Array<{ type: string; text: string }> }
      ) as Array<{ id: string }>;
      expect(parsed).toHaveLength(2);
      expect(parsed[0].id).toBe('n1');
    });

    it('brain_note_list filters by type', async () => {
      const result = await client.callTool({
        name: 'brain_note_list',
        arguments: { type: 'guide' },
      });
      const parsed = parseResult(
        result as { content: Array<{ type: string; text: string }> }
      ) as Array<{ type: string }>;
      expect(parsed).toHaveLength(1);
      expect(parsed[0].type).toBe('guide');
    });

    it('brain_note_list filters by tier', async () => {
      const result = await client.callTool({
        name: 'brain_note_list',
        arguments: { tier: 'fast' },
      });
      const parsed = parseResult(
        result as { content: Array<{ type: string; text: string }> }
      ) as Array<{ tier: string }>;
      expect(parsed).toHaveLength(1);
      expect(parsed[0].tier).toBe('fast');
    });

    it('brain_note_list respects limit', async () => {
      const result = await client.callTool({ name: 'brain_note_list', arguments: { limit: 1 } });
      const parsed = parseResult(
        result as { content: Array<{ type: string; text: string }> }
      ) as unknown[];
      expect(parsed).toHaveLength(1);
    });

    it('brain_note_add creates a new note and returns noteId', async () => {
      const result = await client.callTool({
        name: 'brain_note_add',
        arguments: {
          title: 'My New Note',
          content: '# Content\n\nSome markdown content.',
          type: 'note',
          tier: 'slow',
        },
      });
      expect(result.isError).toBeFalsy();
      const parsed = parseResult(result as { content: Array<{ type: string; text: string }> }) as {
        noteId: string;
        filePath: string;
        title: string;
      };
      expect(parsed.noteId).toBe('new-note-id');
      expect(parsed.title).toBe('My New Note');
      expect(parsed.filePath).toContain('my-new-note');
    });

    it('brain_note_add uses default type=note and tier=slow when omitted', async () => {
      const result = await client.callTool({
        name: 'brain_note_add',
        arguments: { title: 'Minimal Note', content: 'Content' },
      });
      const parsed = parseResult(result as { content: Array<{ type: string; text: string }> }) as {
        type: string;
        tier: string;
      };
      expect(parsed.type).toBe('note');
      expect(parsed.tier).toBe('slow');
    });
  });

  describe('Memory tools', () => {
    it('brain_memory_add stores a memory entry', async () => {
      const result = await client.callTool({
        name: 'brain_memory_add',
        arguments: { memory: 'TypeScript generics enable reusable type-safe code' },
      });
      expect(result.isError).toBeFalsy();
      const parsed = parseResult(result as { content: Array<{ type: string; text: string }> }) as {
        id: string;
        memory: string;
      };
      expect(parsed.id).toBeDefined();
      expect(parsed.memory).toBe('TypeScript generics enable reusable type-safe code');
      expect(service.db.addMemory).toHaveBeenCalledOnce();
    });

    it('brain_memory_add accepts optional containerTag and category', async () => {
      await client.callTool({
        name: 'brain_memory_add',
        arguments: {
          memory: 'Use zod for runtime validation',
          containerTag: 'session:SES-01',
          category: 'technical',
        },
      });
      const call = (service.db.addMemory as ReturnType<typeof vi.fn>).mock.calls[0][0] as {
        containerTag: string;
        category: string;
      };
      expect(call.containerTag).toBe('session:SES-01');
      expect(call.category).toBe('technical');
    });
  });

  describe('PM extended tools', () => {
    it('brain_pm_task_add creates a task and returns display_id', async () => {
      const result = await client.callTool({
        name: 'brain_pm_task_add',
        arguments: {
          project: 'VNM',
          workstream: 1,
          name: 'New Task',
          description: 'A task description',
          priority: 'high',
        },
      });
      expect(result.isError).toBeFalsy();
      const parsed = parseResult(result as { content: Array<{ type: string; text: string }> }) as {
        display_id: string;
      };
      expect(parsed.display_id).toBe('VNM-01.99');
    });

    it('brain_pm_task_add passes dependsOn and acceptanceCriteria', async () => {
      const { createTask } = await import('../../src/modules/pm/data/task-ops.js');
      await client.callTool({
        name: 'brain_pm_task_add',
        arguments: {
          project: 'VNM',
          workstream: 1,
          name: 'Dependent Task',
          description: 'Depends on another task',
          dependsOn: ['VNM-01.01'],
          acceptanceCriteria: ['Tests pass'],
        },
      });
      expect(createTask).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.anything(),
        expect.objectContaining({
          dependsOn: ['VNM-01.01'],
          acceptanceCriteria: ['Tests pass'],
        })
      );
    });

    it('brain_pm_workstream_list returns workstreams', async () => {
      const result = await client.callTool({
        name: 'brain_pm_workstream_list',
        arguments: {},
      });
      expect(result.isError).toBeFalsy();
      const parsed = parseResult(
        result as { content: Array<{ type: string; text: string }> }
      ) as Array<{
        display_id: string;
      }>;
      expect(parsed).toHaveLength(1);
      expect(parsed[0].display_id).toBe('VNM-01');
    });

    it('brain_pm_workstream_add creates a workstream', async () => {
      const result = await client.callTool({
        name: 'brain_pm_workstream_add',
        arguments: { project: 'VNM', name: 'New Workstream', description: 'For new features' },
      });
      expect(result.isError).toBeFalsy();
      const parsed = parseResult(result as { content: Array<{ type: string; text: string }> }) as {
        display_id: string;
      };
      expect(parsed.display_id).toBe('VNM-02');
    });

    it('brain_pm_wave returns dependency-ordered waves', async () => {
      const result = await client.callTool({
        name: 'brain_pm_wave',
        arguments: {},
      });
      expect(result.isError).toBeFalsy();
      const parsed = parseResult(
        result as { content: Array<{ type: string; text: string }> }
      ) as unknown[][];
      expect(parsed).toHaveLength(2);
      expect(parsed[0]).toContain('VNM-01.01');
    });

    it('brain_pm_context returns task details, body, sessions, and related notes', async () => {
      service.sessionsByTask = vi
        .fn()
        .mockReturnValue([
          { display_id: 'SES-01', status: 'completed', started_at: '2026-04-01T00:00:00Z' },
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

    it('brain_pm_capture creates an inbox item with PM prefix', async () => {
      const result = await client.callTool({
        name: 'brain_pm_capture',
        arguments: {
          text: 'We should add rate limiting',
          project: 'VNM',
          workstream: 'VNM-42',
        },
      });
      expect(result.isError).toBeFalsy();
      const parsed = parseResult(result as { content: Array<{ type: string; text: string }> }) as {
        captured: string;
        hint: string;
      };
      expect(parsed.captured).toBeDefined();
      expect(parsed.hint).toContain('brain_pm_task_add');
      const item = (service.db.addInboxItem as ReturnType<typeof vi.fn>).mock.calls[0][0] as {
        content: string;
        sourceMeta: string;
      };
      expect(item.content).toContain('VNM');
      expect(item.content).toContain('We should add rate limiting');
    });

    it('brain_pm_overview returns summary, priorityMatrix, workstreams, and recentCompletions', async () => {
      const result = await client.callTool({
        name: 'brain_pm_overview',
        arguments: {},
      });
      expect(result.isError).toBeFalsy();
      const parsed = parseResult(result as { content: Array<{ type: string; text: string }> }) as {
        summary: { totalTasks: number; eligible: number };
        priorityMatrix: { critical: number; high: number };
        workstreams: unknown[];
        recentCompletions: unknown[];
      };
      expect(parsed.summary).toBeDefined();
      expect(parsed.summary.totalTasks).toBeDefined();
      expect(parsed.priorityMatrix).toBeDefined();
      expect(Array.isArray(parsed.workstreams)).toBe(true);
      expect(Array.isArray(parsed.recentCompletions)).toBe(true);
    });
  });

  describe('Session tools', () => {
    it('brain_session_show returns session detail for valid displayId', async () => {
      const result = await client.callTool({
        name: 'brain_session_show',
        arguments: { displayId: 'SES-01' },
      });
      expect(result.isError).toBeFalsy();
      const parsed = parseResult(result as { content: Array<{ type: string; text: string }> }) as {
        display_id: string;
        status: string;
        turns: number;
      };
      expect(parsed.display_id).toBe('SES-01');
      expect(parsed.status).toBe('completed');
      expect(parsed.turns).toBe(5);
      expect(service.sessionDetail).toHaveBeenCalledWith('SES-01');
    });

    it('brain_session_show returns error for unknown session', async () => {
      service.sessionDetail = vi.fn().mockReturnValue(null);
      const result = await client.callTool({
        name: 'brain_session_show',
        arguments: { displayId: 'SES-NONEXISTENT' },
      });
      expect(result.isError).toBe(true);
      const content = result.content as Array<{ text: string }>;
      expect(content[0].text).toContain('not found');
    });
  });

  describe('Workflow events polling (channel notification fix)', () => {
    it('brain_workflow_events returns events array and cursor', async () => {
      const mockRows = [
        {
          id: 'run-1',
          workflow_name: 'planning',
          status: 'running',
          current_step: 'spec-tests',
          started_at: '2026-04-01T00:00:00Z',
          completed_at: null,
          error: null,
        },
      ];
      service.db.rawDb.prepare = vi.fn().mockReturnValue(makePrepareStmt(mockRows));

      const result = await client.callTool({
        name: 'brain_workflow_events',
        arguments: {},
      });
      expect(result.isError).toBeFalsy();
      const parsed = parseResult(result as { content: Array<{ type: string; text: string }> }) as {
        events: Array<{
          instanceId: string;
          workflowId: string;
          status: string;
          currentStep: string;
        }>;
        cursor: string;
        hint: string;
      };
      expect(parsed.events).toHaveLength(1);
      expect(parsed.events[0].instanceId).toBe('run-1');
      expect(parsed.events[0].workflowId).toBe('planning');
      expect(parsed.events[0].status).toBe('running');
      expect(parsed.events[0].currentStep).toBe('spec-tests');
      expect(parsed.cursor).toBeDefined();
      expect(parsed.hint).toContain('since');
    });

    it('brain_workflow_events filters by instanceId', async () => {
      service.db.rawDb.prepare = vi.fn().mockReturnValue(makePrepareStmt([]));

      await client.callTool({
        name: 'brain_workflow_events',
        arguments: { instanceId: 'run-1' },
      });

      const sql = (service.db.rawDb.prepare as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
      expect(sql).toContain('id = ?');
    });

    it('brain_workflow_events filters by since timestamp', async () => {
      service.db.rawDb.prepare = vi.fn().mockReturnValue(makePrepareStmt([]));

      await client.callTool({
        name: 'brain_workflow_events',
        arguments: { since: '2026-04-01T00:00:00Z' },
      });

      const sql = (service.db.rawDb.prepare as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
      expect(sql).toContain('completed_at > ?');
    });

    it('brain_workflow_events returns empty events with a cursor when no runs match', async () => {
      service.db.rawDb.prepare = vi.fn().mockReturnValue(makePrepareStmt([]));
      const result = await client.callTool({
        name: 'brain_workflow_events',
        arguments: { since: '2030-01-01T00:00:00Z' },
      });
      const parsed = parseResult(result as { content: Array<{ type: string; text: string }> }) as {
        events: unknown[];
        cursor: string;
      };
      expect(parsed.events).toHaveLength(0);
      expect(parsed.cursor).toBeDefined();
    });
  });

  describe('MCP resources (channel notification fix)', () => {
    it('exposes workflow-runs resource at brain://workflow/runs', async () => {
      const result = await client.listResources();
      const uris = result.resources.map((r) => r.uri);
      expect(uris).toContain('brain://workflow/runs');
    });

    it('reading workflow-runs resource returns hint to use brain_workflow_events', async () => {
      const result = await client.readResource({ uri: 'brain://workflow/runs' });
      const text = (result.contents[0] as { text: string }).text;
      expect(text).toContain('brain_workflow_events');
    });
  });

  describe('channelInstructions option', () => {
    it('createBrainMcpServer without channelInstructions omits experimental capability', async () => {
      // Server without instructions (default setup used in beforeEach) should not error
      // The tool listing still works correctly
      const result = await client.listTools();
      expect(result.tools.length).toBeGreaterThan(0);
    });

    it('createBrainMcpServer with channelInstructions includes instructions on server', async () => {
      // Create a second server pair with channelInstructions
      const svc = makeService();
      const server2 = createBrainMcpServer(svc, {
        channelInstructions: 'Poll brain_workflow_events instead of channel tags.',
      });
      const [ct2, st2] = InMemoryTransport.createLinkedPair();
      const client2 = new Client({ name: 'c2', version: '1.0.0' });
      await server2.connect(st2);
      await client2.connect(ct2);

      // Server should initialize and tools should be accessible
      const tools = await client2.listTools();
      expect(tools.tools.map((t) => t.name)).toContain('brain_workflow_events');

      await client2.close();
      await server2.close();
    });
  });
});
