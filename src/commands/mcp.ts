import { Command } from '@commander-js/extra-typings';
import { randomUUID } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { loadConfig, resolveInstance } from '../services/config.js';
import type { ResolveOptions } from '../services/config.js';
import { BrainDB } from '../services/brain-db.js';
import { createEmbedder } from '../adapters/index.js';
import { search } from '../services/search.js';
import { SearchThrottle } from '../services/search-throttle.js';
import type { InboxItem, NoteRecord } from '../types.js';

const MCP_SOURCE_NOTE_ID = '_mcp-direct';

function ensureMcpSourceNote(db: BrainDB): void {
  const existing = db.getNoteById(MCP_SOURCE_NOTE_ID);
  if (existing) return;

  const now = new Date().toISOString();
  const record: NoteRecord = {
    id: MCP_SOURCE_NOTE_ID,
    filePath: '_synthetic/mcp-direct.md',
    title: 'MCP Direct Memories',
    type: 'note',
    tier: 'fast',
    category: null,
    tags: 'mcp,synthetic',
    summary: 'Synthetic source note for memories created via MCP',
    confidence: null,
    status: 'current',
    sources: null,
    createdAt: now,
    modifiedAt: now,
    lastReviewed: null,
    reviewInterval: null,
    expires: null,
    metadata: null,
    module: null,
    moduleInstance: null,
    contentDir: null,
    l0Abstract: null,
    l1Overview: null,
  };
  db.upsertNote(record);
}

export function createMcpServer(resolveOpts?: ResolveOptions): McpServer {
  const instance = resolveInstance(resolveOpts);
  const config = loadConfig(instance);

  const throttle = new SearchThrottle('mcp-session');

  const server = new McpServer(
    { name: 'brain', version: '1.0.0' },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  server.tool(
    'search',
    'Search the knowledge base using hybrid BM25 + vector search',
    { query: z.string(), limit: z.number().optional() },
    async ({ query, limit }) => {
      const db = new BrainDB(config.dbPath);
      try {
        const embedder = await createEmbedder(config);
        const { results: hits, throttleMessage } = await search(db, embedder, query, {
          limit: limit ?? 10,
          throttle,
        });
        const payload = hits.map((r) => ({
          noteId: r.noteId,
          filePath: r.filePath,
          score: r.score,
          excerpt: r.excerpt,
          tier: r.tier,
          tags: r.tags,
          matchSource: r.matchSource,
        }));
        const text = throttleMessage
          ? `${throttleMessage}\n${JSON.stringify(payload, null, 2)}`
          : JSON.stringify(payload, null, 2);
        return {
          content: [{ type: 'text' as const, text }],
        };
      } finally {
        db.close();
      }
    }
  );

  server.tool(
    'add_memory',
    'Create a memory entry in the knowledge base',
    { content: z.string(), source: z.string().optional() },
    async ({ content, source }) => {
      const db = new BrainDB(config.dbPath);
      try {
        const id = randomUUID();
        const sourceNoteId = source ?? MCP_SOURCE_NOTE_ID;
        if (!source) {
          ensureMcpSourceNote(db);
        } else if (!db.getNoteById(source)) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `Source note "${source}" not found. Omit source to create without a linked note.`,
              },
            ],
            isError: true,
          };
        }
        db.addMemory({
          id,
          memory: content,
          sourceNoteId,
          sourceChunkId: null,
          containerTag: 'default',
          category: null,
          isLatest: true,
          parentMemoryId: null,
          rootMemoryId: null,
          relationType: null,
          validAt: null,
          invalidAt: null,
          forgetAfter: null,
          isForgotten: false,
          isInference: false,
          createdAt: new Date().toISOString(),
        });
        return {
          content: [{ type: 'text' as const, text: `Memory created: ${id}` }],
        };
      } finally {
        db.close();
      }
    }
  );

  server.tool(
    'quick',
    'Capture text to the inbox for later processing',
    { text: z.string() },
    async ({ text }) => {
      const db = new BrainDB(config.dbPath);
      try {
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
        db.addInboxItem(item);
        return {
          content: [{ type: 'text' as const, text: `Captured to inbox: ${item.id}` }],
        };
      } finally {
        db.close();
      }
    }
  );

  server.tool(
    'context',
    'Show context for a note: related notes, memories, and graph connections',
    { noteId: z.string() },
    async ({ noteId }) => {
      const db = new BrainDB(config.dbPath);
      try {
        const note = db.getNoteById(noteId);
        if (!note) {
          return {
            content: [{ type: 'text' as const, text: `Note "${noteId}" not found` }],
            isError: true,
          };
        }

        const memories = db.getMemoriesForNote(noteId);
        const relationsFrom = db.getRelationsFrom(noteId);
        const relationsTo = db.getRelationsTo(noteId);

        const relatedNoteIds = new Set([
          ...relationsFrom.map((r) => r.targetId),
          ...relationsTo.map((r) => r.sourceId),
        ]);
        relatedNoteIds.delete(noteId);

        const relatedNotesById = db.getNotesByIds([...relatedNoteIds]);
        const relatedNotes = [...relatedNotesById.values()];

        const result = {
          note: {
            id: note.id,
            title: note.title,
            type: note.type,
            tier: note.tier,
          },
          memories: memories.map((m) => ({
            id: m.id,
            memory: m.memory,
            containerTag: m.containerTag,
          })),
          relations: [...relationsFrom, ...relationsTo],
          relatedNotes: relatedNotes.map((n) => ({
            id: n.id,
            title: n.title,
            type: n.type,
          })),
        };

        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
        };
      } finally {
        db.close();
      }
    }
  );

  server.tool(
    'list_memories',
    'List recent memories from the knowledge base',
    { limit: z.number().optional() },
    async ({ limit }) => {
      const db = new BrainDB(config.dbPath);
      try {
        db.forgetExpiredMemories();
        const memories = db.getLatestMemories();
        const limited = memories.slice(0, limit ?? 20);

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                limited.map((m) => ({
                  id: m.id,
                  memory: m.memory,
                  sourceNoteId: m.sourceNoteId,
                  containerTag: m.containerTag,
                  createdAt: m.createdAt,
                })),
                null,
                2
              ),
            },
          ],
        };
      } finally {
        db.close();
      }
    }
  );

  return server;
}

export async function startMcpServer(resolveOpts?: ResolveOptions): Promise<void> {
  const server = createMcpServer(resolveOpts);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

const serveCommand = new Command('serve')
  .description('Start the MCP server using stdio transport')
  .action(async (_opts, cmd) => {
    const root = cmd.parent?.parent;
    const globalFlag = (root?.opts() as Record<string, unknown>)?.global;
    const instancePath = (root?.opts() as Record<string, unknown>)?.instance;
    const resolveOpts: ResolveOptions = {};
    if (globalFlag) resolveOpts.forceGlobal = true;
    if (typeof instancePath === 'string') resolveOpts.instancePath = instancePath;
    await startMcpServer(resolveOpts);
  });

export const mcpCommand = new Command('mcp')
  .description('Model Context Protocol server for brain')
  .addCommand(serveCommand);
