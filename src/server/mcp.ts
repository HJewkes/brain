import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { BrainServiceClass } from '../services/brain-service.js';
import type { InboxItem } from '../types.js';
import { searchMemories } from '../services/search.js';
import { getTask } from '../modules/pm/data/task-ops.js';
import { updateTaskStatus } from '../modules/pm/data/task-ops.js';
import type { TaskStatus } from '../modules/pm/types.js';
import type { AgentStatus } from '../modules/agents/types.js';

function textResult(data: unknown): { content: Array<{ type: 'text'; text: string }> } {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
}

function errorResult(msg: string): {
  content: Array<{ type: 'text'; text: string }>;
  isError: true;
} {
  return { content: [{ type: 'text' as const, text: msg }], isError: true };
}

function registerSearchTools(server: McpServer, svc: BrainServiceClass): void {
  server.tool(
    'brain_search',
    'Search brain knowledge base using hybrid BM25 + vector search',
    {
      query: z.string().describe('Search query'),
      limit: z.number().optional().describe('Max results (default 10)'),
    },
    async ({ query, limit }) => {
      const results = await svc.search(query, { limit: limit ?? 10 });
      return textResult(
        results.map((r) => ({
          noteId: r.noteId,
          title: r.heading,
          filePath: r.filePath,
          score: r.score,
          excerpt: r.excerpt,
          tier: r.tier,
          matchSource: r.matchSource,
        }))
      );
    }
  );

  server.tool(
    'brain_note_read',
    'Read a note by ID, returning metadata and file content',
    { id: z.string().describe('Note ID') },
    async ({ id }) => {
      const note = svc.db.getNoteById(id);
      if (!note) return errorResult(`Note "${id}" not found`);
      const body = existsSync(note.filePath) ? readFileSync(note.filePath, 'utf-8') : '';
      return textResult({
        id: note.id,
        title: note.title,
        type: note.type,
        tier: note.tier,
        filePath: note.filePath,
        tags: note.tags ? JSON.parse(note.tags) : [],
        summary: note.summary,
        body,
      });
    }
  );

  server.tool(
    'brain_memory_search',
    'Search memories using vector similarity',
    {
      query: z.string().describe('Search query'),
      limit: z.number().optional().describe('Max results (default 10)'),
      container: z.string().optional().describe('Container tag filter'),
    },
    async ({ query, limit, container }) => {
      const results = await searchMemories(svc.db, svc.embedder, query, limit ?? 10, container);
      return textResult(results);
    }
  );

  server.tool(
    'brain_memory_list',
    'List recent memories from the knowledge base',
    {
      limit: z.number().optional().describe('Max results (default 20)'),
      container: z.string().optional(),
    },
    async ({ limit, container }) => {
      svc.db.forgetExpiredMemories();
      const memories = svc.db.getLatestMemories(container);
      return textResult(
        memories.slice(0, limit ?? 20).map((m) => ({
          id: m.id,
          memory: m.memory,
          sourceNoteId: m.sourceNoteId,
          containerTag: m.containerTag,
          createdAt: m.createdAt,
        }))
      );
    }
  );
}

function registerPmTools(server: McpServer, svc: BrainServiceClass): void {
  server.tool(
    'brain_pm_task_list',
    'List PM tasks, optionally filtered by workstream or status',
    { workstream: z.string().optional(), status: z.string().optional() },
    async ({ workstream, status }) => {
      const tasks = svc.pmTaskList({ workstream, status });
      return textResult(tasks);
    }
  );

  server.tool(
    'brain_pm_task_show',
    'Show details for a specific task by display ID (e.g. VNM-01.03)',
    { displayId: z.string().describe('Task display ID') },
    async ({ displayId }) => {
      const result = getTask(svc.db, displayId);
      if (!result.ok) return errorResult(result.error.message);
      return textResult(result.data);
    }
  );

  server.tool(
    'brain_pm_task_update',
    'Update a task status (e.g. backlog, ready, in-progress, review, done)',
    {
      displayId: z.string().describe('Task display ID'),
      status: z.string().describe('New status'),
    },
    async ({ displayId, status }) => {
      const result = await updateTaskStatus(
        svc.db,
        svc.config,
        svc.embedder,
        displayId,
        status as TaskStatus
      );
      if (!result.ok) return errorResult(result.error.message);
      return textResult(result.data);
    }
  );

  server.tool(
    'brain_pm_next',
    'Get eligible tasks ready to be worked on',
    { prefix: z.string().optional().describe('Project prefix (e.g. VNM)') },
    async ({ prefix }) => {
      const tasks = svc.pmNext(prefix);
      return textResult(tasks);
    }
  );
}

function registerSessionAgentTools(server: McpServer, svc: BrainServiceClass): void {
  server.tool(
    'brain_session_list',
    'List recent sessions',
    { limit: z.number().optional(), status: z.string().optional() },
    async ({ limit, status }) => {
      const sessions = svc.sessionList({ limit, status });
      return textResult(sessions);
    }
  );

  server.tool(
    'brain_agent_list',
    'List agents, optionally filtered by status',
    { status: z.string().optional().describe('Filter: pending|active|completed|failed|abandoned') },
    async ({ status }) => {
      const agents = svc.agentList(status ? { status: status as AgentStatus } : undefined);
      return textResult(agents);
    }
  );

  server.tool(
    'brain_inbox_add',
    'Capture text to the brain inbox for later processing',
    { text: z.string().describe('Content to capture') },
    async ({ text }) => {
      const item: InboxItem = {
        id: randomUUID(),
        content: text,
        title: null,
        source: 'api',
        sourceUrl: null,
        sourceMeta: null,
        status: 'pending',
        createdAt: new Date().toISOString(),
        processedAt: null,
      };
      svc.db.addInboxItem(item);
      return textResult({ captured: item.id });
    }
  );
}

export function createBrainMcpServer(svc: BrainServiceClass): McpServer {
  const server = new McpServer(
    { name: 'brain', version: '0.7.0' },
    { capabilities: { tools: {} } }
  );

  registerSearchTools(server, svc);
  registerPmTools(server, svc);
  registerSessionAgentTools(server, svc);

  return server;
}
