import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createBrainMcpServer } from '../../src/server/mcp.js';
import type { BrainServiceClass } from '../../src/services/brain-service.js';
import type { InboxItem } from '../../src/types.js';

vi.mock('../../src/services/search.js', () => ({
  searchMemories: vi
    .fn()
    .mockResolvedValue([
      { id: 'm1', memory: 'TypeScript is typed', sourceNoteId: 'n1', score: 0.9 },
    ]),
}));

vi.mock('../../src/modules/pm/data/task-ops.js', () => ({
  getTask: vi.fn().mockReturnValue({
    ok: true,
    data: { id: 't1', display_id: 'VNM-01.01', title: 'Test task', status: 'pending' },
  }),
  updateTaskStatus: vi.fn().mockResolvedValue({
    ok: true,
    data: { id: 't1', display_id: 'VNM-01.01', title: 'Test task', status: 'done' },
  }),
}));

function makeService(overrides: Partial<Record<string, unknown>> = {}): BrainServiceClass {
  return {
    isOpen: true,
    config: { dbPath: '/tmp/test.db', notesDir: '/tmp/notes', embedder: 'local' },
    db: {
      addInboxItem: vi.fn(),
      getNoteById: vi.fn().mockReturnValue(null),
      forgetExpiredMemories: vi.fn(),
      getLatestMemories: vi.fn().mockReturnValue([
        {
          id: 'm1',
          memory: 'Test memory',
          sourceNoteId: 'n1',
          containerTag: null,
          createdAt: '2026-01-01',
        },
      ]),
    },
    embedder: { embed: vi.fn(), model: 'mock', dimensions: 3 },
    search: vi.fn().mockResolvedValue([
      {
        noteId: 'note-1',
        heading: 'Test Note',
        filePath: '/notes/test.md',
        score: 0.95,
        excerpt: 'Test excerpt',
        tier: 'slow',
        matchSource: 'both',
      },
    ]),
    pmTaskList: vi
      .fn()
      .mockReturnValue([
        { id: 't1', display_id: 'VNM-01.01', title: 'Test task', status: 'pending' },
      ]),
    pmNext: vi
      .fn()
      .mockReturnValue([{ id: 't1', display_id: 'VNM-01.01', title: 'Eligible task' }]),
    sessionList: vi.fn().mockReturnValue([{ id: 's1', display_id: 'SNS-001', status: 'active' }]),
    agentList: vi.fn().mockReturnValue([{ id: 'a1', name: 'test-agent', status: 'active' }]),
    ...overrides,
  } as unknown as BrainServiceClass;
}

function parseResult(result: { content: Array<{ type: string; text: string }> }): unknown {
  return JSON.parse(result.content[0].text);
}

describe('MCP server integration (src/server/mcp.ts)', () => {
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

  it('lists all expected tools', async () => {
    const result = await client.listTools();
    const names = result.tools.map((t) => t.name).sort();
    expect(names).toContain('brain_search');
    expect(names).toContain('brain_note_read');
    expect(names).toContain('brain_memory_search');
    expect(names).toContain('brain_memory_list');
    expect(names).toContain('brain_pm_task_list');
    expect(names).toContain('brain_pm_task_show');
    expect(names).toContain('brain_pm_task_update');
    expect(names).toContain('brain_pm_next');
    expect(names).toContain('brain_session_list');
    expect(names).toContain('brain_agent_list');
    expect(names).toContain('brain_inbox_add');
    expect(names.length).toBeGreaterThanOrEqual(11);
  });

  describe('Search tools', () => {
    it('brain_search returns formatted results', async () => {
      const result = await client.callTool({
        name: 'brain_search',
        arguments: { query: 'test query' },
      });
      expect(result.isError).toBeFalsy();
      const parsed = parseResult(
        result as { content: Array<{ type: string; text: string }> }
      ) as Array<{ noteId: string }>;
      expect(parsed).toHaveLength(1);
      expect(parsed[0].noteId).toBe('note-1');
      expect(service.search).toHaveBeenCalledWith('test query', { limit: 10 });
    });

    it('brain_search respects limit parameter', async () => {
      await client.callTool({
        name: 'brain_search',
        arguments: { query: 'test', limit: 5 },
      });
      expect(service.search).toHaveBeenCalledWith('test', { limit: 5 });
    });

    it('brain_note_read returns error for unknown note', async () => {
      const result = await client.callTool({
        name: 'brain_note_read',
        arguments: { id: 'nonexistent' },
      });
      expect(result.isError).toBe(true);
      const content = result.content as Array<{ text: string }>;
      expect(content[0].text).toContain('not found');
    });

    it('brain_memory_list returns memories', async () => {
      const result = await client.callTool({
        name: 'brain_memory_list',
        arguments: {},
      });
      expect(result.isError).toBeFalsy();
      const parsed = parseResult(
        result as { content: Array<{ type: string; text: string }> }
      ) as Array<{ id: string }>;
      expect(parsed).toHaveLength(1);
      expect(parsed[0].id).toBe('m1');
    });

    it('brain_memory_list respects limit', async () => {
      service.db.getLatestMemories = vi.fn().mockReturnValue(
        Array.from({ length: 30 }, (_, i) => ({
          id: `m${i}`,
          memory: `Memory ${i}`,
          sourceNoteId: `n${i}`,
          containerTag: null,
          createdAt: '2026-01-01',
        }))
      );
      const result = await client.callTool({
        name: 'brain_memory_list',
        arguments: { limit: 5 },
      });
      const parsed = parseResult(
        result as { content: Array<{ type: string; text: string }> }
      ) as unknown[];
      expect(parsed).toHaveLength(5);
    });

    it('brain_memory_search calls searchMemories', async () => {
      const result = await client.callTool({
        name: 'brain_memory_search',
        arguments: { query: 'typescript' },
      });
      expect(result.isError).toBeFalsy();
      const parsed = parseResult(
        result as { content: Array<{ type: string; text: string }> }
      ) as Array<{ id: string }>;
      expect(parsed).toHaveLength(1);
    });
  });

  describe('PM tools', () => {
    it('brain_pm_task_list returns tasks', async () => {
      const result = await client.callTool({
        name: 'brain_pm_task_list',
        arguments: {},
      });
      expect(result.isError).toBeFalsy();
      const parsed = parseResult(
        result as { content: Array<{ type: string; text: string }> }
      ) as Array<{ display_id: string }>;
      expect(parsed).toHaveLength(1);
      expect(parsed[0].display_id).toBe('VNM-01.01');
    });

    it('brain_pm_task_list passes filters', async () => {
      await client.callTool({
        name: 'brain_pm_task_list',
        arguments: { workstream: 'VNM-07', status: 'done' },
      });
      expect(service.pmTaskList).toHaveBeenCalledWith({ workstream: 'VNM-07', status: 'done' });
    });

    it('brain_pm_task_show returns task detail', async () => {
      const result = await client.callTool({
        name: 'brain_pm_task_show',
        arguments: { displayId: 'VNM-01.01' },
      });
      expect(result.isError).toBeFalsy();
      const parsed = parseResult(result as { content: Array<{ type: string; text: string }> }) as {
        display_id: string;
      };
      expect(parsed.display_id).toBe('VNM-01.01');
    });

    it('brain_pm_task_update updates task status', async () => {
      const result = await client.callTool({
        name: 'brain_pm_task_update',
        arguments: { displayId: 'VNM-01.01', status: 'done' },
      });
      expect(result.isError).toBeFalsy();
      const parsed = parseResult(result as { content: Array<{ type: string; text: string }> }) as {
        status: string;
      };
      expect(parsed.status).toBe('done');
    });

    it('brain_pm_next returns eligible tasks', async () => {
      const result = await client.callTool({
        name: 'brain_pm_next',
        arguments: {},
      });
      expect(result.isError).toBeFalsy();
      const parsed = parseResult(
        result as { content: Array<{ type: string; text: string }> }
      ) as Array<{ display_id: string }>;
      expect(parsed).toHaveLength(1);
    });

    it('brain_pm_next passes prefix', async () => {
      await client.callTool({
        name: 'brain_pm_next',
        arguments: { prefix: 'VNM' },
      });
      expect(service.pmNext).toHaveBeenCalledWith('VNM');
    });
  });

  describe('Session & Agent tools', () => {
    it('brain_session_list returns sessions', async () => {
      const result = await client.callTool({
        name: 'brain_session_list',
        arguments: {},
      });
      expect(result.isError).toBeFalsy();
      const parsed = parseResult(
        result as { content: Array<{ type: string; text: string }> }
      ) as Array<{ display_id: string }>;
      expect(parsed).toHaveLength(1);
      expect(parsed[0].display_id).toBe('SNS-001');
    });

    it('brain_session_list passes limit and status', async () => {
      await client.callTool({
        name: 'brain_session_list',
        arguments: { limit: 3, status: 'completed' },
      });
      expect(service.sessionList).toHaveBeenCalledWith({ limit: 3, status: 'completed' });
    });

    it('brain_agent_list returns agents', async () => {
      const result = await client.callTool({
        name: 'brain_agent_list',
        arguments: {},
      });
      expect(result.isError).toBeFalsy();
      const parsed = parseResult(
        result as { content: Array<{ type: string; text: string }> }
      ) as Array<{ name: string }>;
      expect(parsed).toHaveLength(1);
      expect(parsed[0].name).toBe('test-agent');
    });

    it('brain_agent_list passes status filter', async () => {
      await client.callTool({
        name: 'brain_agent_list',
        arguments: { status: 'completed' },
      });
      expect(service.agentList).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'completed', limit: 50 })
      );
    });

    it('brain_inbox_add captures to inbox', async () => {
      const result = await client.callTool({
        name: 'brain_inbox_add',
        arguments: { text: 'Remember this' },
      });
      expect(result.isError).toBeFalsy();
      const parsed = parseResult(result as { content: Array<{ type: string; text: string }> }) as {
        captured: string;
      };
      expect(parsed.captured).toBeDefined();
      expect(service.db.addInboxItem).toHaveBeenCalledOnce();
      const item = (service.db.addInboxItem as ReturnType<typeof vi.fn>).mock
        .calls[0][0] as InboxItem;
      expect(item.content).toBe('Remember this');
      expect(item.source).toBe('api');
    });
  });
});
