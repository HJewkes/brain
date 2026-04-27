import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { Command } from '@commander-js/extra-typings';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { z } from 'zod';
import { BrainServiceClass } from '../services/brain-service.js';
import type { ResolveOptions } from '../services/config.js';
import type { AgentStatus } from '../modules/agents/types.js';
import type { InboxItem } from '../types.js';
import { createHttpHandler, broadcast } from './serve-http.js';
import type { SseClients } from './serve-http.js';
import { startMcpServer } from '../server/index.js';
import { installLaunchd, uninstallLaunchd } from './serve-launchd.js';
import { WORKFLOW_CHANNEL_INSTRUCTIONS } from '../modules/workflow/runtime/channel.js';

export function createServeServer(service: BrainServiceClass): McpServer {
  const server = new McpServer(
    { name: 'brain', version: '0.7.0' },
    {
      capabilities: {
        tools: {},
        experimental: { 'claude/channel': {} },
      },
      instructions: WORKFLOW_CHANNEL_INSTRUCTIONS,
    }
  );

  server.tool(
    'brain_search',
    'Search brain notes using hybrid BM25 + vector search',
    { query: z.string(), limit: z.number().optional() },
    async ({ query, limit }) => {
      const results = await service.search(query, { limit: limit ?? 10 });
      return { content: [{ type: 'text' as const, text: JSON.stringify(results, null, 2) }] };
    }
  );

  server.tool(
    'brain_dashboard',
    'Get dashboard data including audit report, sessions, and agents',
    {},
    async () => {
      const data = service.dashboard();
      return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    'brain_pm_status',
    'Get PM project status by prefix (e.g. VNM)',
    { prefix: z.string() },
    async ({ prefix }) => {
      const status = service.pmStatus(prefix);
      if (!status) {
        return {
          content: [{ type: 'text' as const, text: `Project "${prefix}" not found` }],
          isError: true,
        };
      }
      return { content: [{ type: 'text' as const, text: JSON.stringify(status, null, 2) }] };
    }
  );

  server.tool(
    'brain_pm_next',
    'Get eligible tasks ready to be worked on',
    { prefix: z.string().optional() },
    async ({ prefix }) => {
      const tasks = service.pmNext(prefix);
      return { content: [{ type: 'text' as const, text: JSON.stringify(tasks, null, 2) }] };
    }
  );

  server.tool(
    'brain_pm_tasks',
    'List PM tasks, optionally filtered by workstream or status',
    { workstream: z.string().optional(), status: z.string().optional() },
    async ({ workstream, status }) => {
      const tasks = service.pmTaskList({ workstream, status });
      return { content: [{ type: 'text' as const, text: JSON.stringify(tasks, null, 2) }] };
    }
  );

  server.tool(
    'brain_sessions',
    'List recent sessions',
    { limit: z.number().optional(), status: z.string().optional() },
    async ({ limit, status }) => {
      const sessions = service.sessionList({ limit, status });
      return { content: [{ type: 'text' as const, text: JSON.stringify(sessions, null, 2) }] };
    }
  );

  server.tool(
    'brain_agents',
    'List agents, optionally filtered by status (pending|active|completed|failed|abandoned)',
    { status: z.string().optional() },
    async ({ status }) => {
      const agents = service.agentList(status ? { status: status as AgentStatus } : undefined);
      return { content: [{ type: 'text' as const, text: JSON.stringify(agents, null, 2) }] };
    }
  );

  server.tool(
    'brain_agent_find',
    'Find an agent by ID, name, or task reference',
    { identifier: z.string() },
    async ({ identifier }) => {
      const agent = service.agentFind(identifier);
      if (!agent) {
        return {
          content: [{ type: 'text' as const, text: `Agent "${identifier}" not found` }],
          isError: true,
        };
      }
      return { content: [{ type: 'text' as const, text: JSON.stringify(agent, null, 2) }] };
    }
  );

  server.tool(
    'brain_quick',
    'Capture text to the brain inbox for later processing',
    { text: z.string() },
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
      service.db.addInboxItem(item);
      return { content: [{ type: 'text' as const, text: `Captured to inbox: ${item.id}` }] };
    }
  );

  server.tool(
    'brain_status',
    'Get brain instance status (config, db path, embedder)',
    {},
    async () => {
      const status = {
        isOpen: service.isOpen,
        dbPath: service.config.dbPath,
        notesDir: service.config.notesDir,
        embedder: service.config.embedder ?? 'local',
      };
      return { content: [{ type: 'text' as const, text: JSON.stringify(status, null, 2) }] };
    }
  );

  server.tool(
    'brain_federated_search',
    'Search across all federated brain instances using BM25',
    { query: z.string(), limit: z.number().optional() },
    async ({ query, limit }) => {
      const results = service.federatedSearch(query, { limit: limit ?? 10 });
      return { content: [{ type: 'text' as const, text: JSON.stringify(results, null, 2) }] };
    }
  );

  return server;
}

/**
 * If a previous brain daemon is still bound to the port — likely because the
 * user rebuilt and did NOT kill the old process — politely ask it to exit
 * and then claim the port. Only takes over when the listener self-identifies
 * as brain AND its dbPath matches ours, so unrelated services on the same
 * port (or daemons for a different project) are left alone.
 */
async function takeoverStalePort(port: number, dbPath: string): Promise<boolean> {
  const base = `http://127.0.0.1:${port}`;
  try {
    const infoRes = await fetch(`${base}/api/info`, { signal: AbortSignal.timeout(1500) });
    if (!infoRes.ok) return false;
    const info = (await infoRes.json()) as { brain?: boolean; dbPath?: string };
    if (info.brain !== true || info.dbPath !== dbPath) return false;
  } catch {
    return false;
  }

  try {
    const shutdownRes = await fetch(`${base}/api/shutdown`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dbPath }),
      signal: AbortSignal.timeout(1500),
    });
    if (!shutdownRes.ok) return false;
  } catch {
    return false;
  }

  // Poll for the port to free. The old process exits ~50ms after responding.
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 100));
    if (await isPortFree(port)) return true;
  }
  return false;
}

function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = createServer();
    probe.once('error', () => resolve(false));
    probe.once('listening', () => probe.close(() => resolve(true)));
    probe.listen(port, '127.0.0.1');
  });
}

async function listenWithTakeover(
  service: BrainServiceClass,
  sseClients: SseClients,
  port: number,
  onShutdownRequest: () => void
): Promise<ReturnType<typeof createServer> | undefined> {
  const tryListen = (): Promise<{ server: ReturnType<typeof createServer>; bound: boolean }> =>
    new Promise((resolve) => {
      const server = createServer(createHttpHandler(service, sseClients, { onShutdownRequest }));
      const onError = (err: NodeJS.ErrnoException) => {
        if (err.code === 'EADDRINUSE') {
          server.close();
          resolve({ server, bound: false });
        } else {
          throw err;
        }
      };
      server.once('error', onError);
      server.listen(port, () => {
        server.removeListener('error', onError);
        resolve({ server, bound: true });
      });
    });

  let attempt = await tryListen();
  if (attempt.bound) return attempt.server;

  const tookOver = await takeoverStalePort(port, service.config.dbPath);
  if (!tookOver) {
    process.stderr.write(
      `Port ${port} held by another process — running MCP stdio only (dashboard unavailable)\n`
    );
    return undefined;
  }

  process.stderr.write(`Replaced stale brain daemon on port ${port}\n`);
  attempt = await tryListen();
  if (attempt.bound) return attempt.server;

  process.stderr.write(`Port ${port} reclaimed by something else — running MCP stdio only\n`);
  return undefined;
}

export async function startServeServer(resolveOpts?: ResolveOptions, port = 7800): Promise<void> {
  const service = await BrainServiceClass.create(resolveOpts);

  const attached = await service.attachFederatedInstances();
  if (attached.length > 0) {
    process.stderr.write(`Federated: ${attached.join(', ')}\n`);
  }

  const sseClients: SseClients = new Set();

  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let httpServer: ReturnType<typeof createServer> | undefined;

  const shutdown = () => {
    if (heartbeat) clearInterval(heartbeat);
    if (httpServer) httpServer.close();
    service.close();
    process.exit(0);
  };

  if (port > 0) {
    httpServer = await listenWithTakeover(service, sseClients, port, shutdown);
    if (httpServer) {
      process.stderr.write(`Dashboard: http://localhost:${port}\n`);
      process.stderr.write(`API: http://localhost:${port}/api/dashboard\n`);
      heartbeat = setInterval(() => {
        broadcast(sseClients, 'heartbeat', { ts: Date.now() });
      }, 30_000);
    }
  }

  process.on('SIGINT', () => shutdown());
  process.on('SIGTERM', () => shutdown());

  // Use the full MCP server (with workflow tools) instead of the subset
  const { startMcpServerWithService } = await import('../server/index.js');
  await startMcpServerWithService(service, shutdown, sseClients);
}

export const serveCommand = new Command('serve')
  .description('Start brain daemon (HTTP dashboard + MCP over stdio)')
  .option('--port <n>', 'HTTP port for dashboard and API (default: 7800)', '7800')
  .option('--mcp', 'Start standalone MCP server over stdio (no HTTP)')
  .option('--install', 'Install as launchd agent (macOS)')
  .option('--uninstall', 'Remove launchd agent')
  .action(async (opts, cmd) => {
    const root = cmd.parent?.parent;
    const globalFlag = (root?.opts() as Record<string, unknown>)?.global;
    const instancePath = (root?.opts() as Record<string, unknown>)?.instance;
    const resolveOpts: ResolveOptions = {};
    if (globalFlag) resolveOpts.forceGlobal = true;
    if (typeof instancePath === 'string') resolveOpts.instancePath = instancePath;

    const port = parseInt((opts as { port?: string }).port ?? '7800', 10);

    if ((opts as { uninstall?: boolean }).uninstall) {
      uninstallLaunchd();
      return;
    }

    if ((opts as { install?: boolean }).install) {
      installLaunchd(port);
      return;
    }

    if ((opts as { mcp?: boolean }).mcp) {
      await startMcpServer(resolveOpts);
      return;
    }

    await startServeServer(resolveOpts, port);
  });
