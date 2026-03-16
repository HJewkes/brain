import type { IncomingMessage, ServerResponse } from 'node:http';
import type { BrainServiceClass } from '../services/brain-service.js';
import { VALID_HOOK_EVENTS, dispatchHookEvent } from '../hooks/dispatch.js';
import type { HookEvent } from '../hooks/types.js';
import { seekJsonlFile } from '../utils/jsonl-seek.js';

export type SseClients = Set<ServerResponse>;

export function broadcast(clients: SseClients, event: string, data: unknown): void {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of clients) {
    client.write(msg);
  }
}

function setCors(res: ServerResponse): void {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function json(res: ServerResponse, data: unknown, status = 200): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function notFound(res: ServerResponse): void {
  json(res, { error: 'Not found' }, 404);
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    req.on('error', () => resolve(''));
  });
}

export function createHttpHandler(
  service: BrainServiceClass,
  sseClients: SseClients
): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  return async (req, res) => {
    setCors(res);

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url ?? '/', `http://localhost`);
    const path = url.pathname;

    if (path === '/api/dashboard' && req.method === 'GET') {
      json(res, service.dashboard());
      return;
    }

    if (path === '/api/search' && req.method === 'GET') {
      const q = url.searchParams.get('q') ?? '';
      const results = await service.search(q, { limit: 10 });
      json(res, results);
      return;
    }

    if (path === '/api/status' && req.method === 'GET') {
      json(res, {
        isOpen: service.isOpen,
        dbPath: service.config.dbPath,
        notesDir: service.config.notesDir,
        embedder: service.config.embedder ?? 'local',
      });
      return;
    }

    if (path === '/api/sessions' && req.method === 'GET') {
      json(res, service.sessionList());
      return;
    }

    if (path === '/api/agents' && req.method === 'GET') {
      json(res, service.agentList());
      return;
    }

    if (path === '/api/pm/next' && req.method === 'GET') {
      const prefix = url.searchParams.get('prefix') ?? undefined;
      json(res, service.pmNext(prefix));
      return;
    }

    if (path === '/api/pm/tasks' && req.method === 'GET') {
      const workstream = url.searchParams.get('workstream') ?? undefined;
      const status = url.searchParams.get('status') ?? undefined;
      json(res, service.pmTaskList({ workstream, status }));
      return;
    }

    const taskMatch = path.match(/^\/api\/pm\/tasks\/(.+)$/);
    if (taskMatch && req.method === 'GET') {
      const id = taskMatch[1];
      const tasks = service.pmTaskList();
      const task = tasks.find((t) => t.display_id === id || t.id === id);
      if (!task) {
        notFound(res);
        return;
      }
      json(res, task);
      return;
    }

    const statusMatch = path.match(/^\/api\/pm\/status\/(.+)$/);
    if (statusMatch && req.method === 'GET') {
      const prefix = statusMatch[1].toUpperCase();
      const status = service.pmStatus(prefix);
      if (!status) {
        notFound(res);
        return;
      }
      json(res, status);
      return;
    }

    if (path === '/api/events' && req.method === 'GET') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });
      res.write(': connected\n\n');
      sseClients.add(res);
      req.on('close', () => sseClients.delete(res));
      return;
    }

    const sessionDetailMatch = path.match(/^\/api\/sessions\/([^/]+)$/);
    if (sessionDetailMatch && req.method === 'GET') {
      const displayId = sessionDetailMatch[1];
      const session = service.sessionGet(displayId);
      if (!session) {
        notFound(res);
        return;
      }
      json(res, session);
      return;
    }

    const segmentsMatch = path.match(/^\/api\/sessions\/([^/]+)\/segments$/);
    if (segmentsMatch && req.method === 'GET') {
      const displayId = segmentsMatch[1];
      const session = service.sessionGet(displayId);
      if (!session) {
        notFound(res);
        return;
      }
      json(res, service.sessionSegments(displayId));
      return;
    }

    const segmentDetailMatch = path.match(/^\/api\/sessions\/([^/]+)\/segments\/(\d+)$/);
    if (segmentDetailMatch && req.method === 'GET') {
      const displayId = segmentDetailMatch[1];
      const index = parseInt(segmentDetailMatch[2], 10);
      const result = service.sessionSegmentGet(displayId, index);
      if (!result) {
        notFound(res);
        return;
      }
      json(res, result);
      return;
    }

    const sessionFilesMatch = path.match(/^\/api\/sessions\/([^/]+)\/files$/);
    if (sessionFilesMatch && req.method === 'GET') {
      const displayId = sessionFilesMatch[1];
      const session = service.sessionGet(displayId);
      if (!session) {
        notFound(res);
        return;
      }
      json(res, service.sessionFiles(displayId));
      return;
    }

    if (path === '/api/sessions/by-file' && req.method === 'GET') {
      const filePath = url.searchParams.get('path') ?? '';
      if (!filePath) {
        json(res, { error: 'path query param required' }, 400);
        return;
      }
      json(res, service.sessionsByFile(filePath));
      return;
    }

    if (path === '/api/sessions/by-task' && req.method === 'GET') {
      const taskId = url.searchParams.get('id') ?? '';
      if (!taskId) {
        json(res, { error: 'id query param required' }, 400);
        return;
      }
      json(res, service.sessionsByTask(taskId));
      return;
    }

    const jsonlMatch = path.match(/^\/api\/sessions\/([^/]+)\/jsonl$/);
    if (jsonlMatch && req.method === 'GET') {
      const displayId = jsonlMatch[1];
      const offset = parseInt(url.searchParams.get('offset') ?? '0', 10);
      const lineCount = parseInt(url.searchParams.get('lines') ?? '1', 10);
      const session = service.sessionGet(displayId);
      if (!session?.jsonl_path) {
        json(res, { error: 'Session not found or no JSONL path' }, 404);
        return;
      }
      const result = seekJsonlFile(session.jsonl_path, offset, lineCount);
      if (!result.ok) {
        const status = result.value.code === 'OFFSET_OUT_OF_RANGE' ? 400 : 404;
        json(res, result.value, status);
        return;
      }
      json(res, result.value);
      return;
    }

    const hookMatch = path.match(/^\/api\/hooks\/([^/]+)$/);
    if (hookMatch && req.method === 'POST') {
      const event = hookMatch[1] as HookEvent;
      if (!VALID_HOOK_EVENTS.has(event)) {
        json(res, { error: `Unknown hook event: ${event}` }, 400);
        return;
      }
      const body = await readBody(req);
      const result = await dispatchHookEvent(event, body, process.cwd());
      const statusCode = result.exitCode === 2 ? 202 : 200;
      res.writeHead(statusCode, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
      broadcast(sseClients, 'hook', { event, result });
      return;
    }

    notFound(res);
  };
}
