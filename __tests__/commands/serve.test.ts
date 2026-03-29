import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createServeServer } from '../../src/commands/serve.js';
import { createHttpHandler, broadcast } from '../../src/commands/serve-http.js';
import type { SseClients } from '../../src/commands/serve-http.js';
import type { BrainServiceClass } from '../../src/services/brain-service.js';
import type { SearchResult } from '../../src/types.js';
import type { AgentRecord } from '../../src/modules/agents/types.js';
import type { DashboardSession } from '../../src/commands/audit.js';
import type { TaskMetadata } from '../../src/modules/pm/types.js';
import type { IncomingMessage, ServerResponse } from 'node:http';

// Minimal stub that satisfies BrainServiceClass's public API surface
function makeService(overrides: Partial<Record<string, unknown>> = {}): BrainServiceClass {
  return {
    isOpen: true,
    config: { dbPath: '/tmp/test.db', notesDir: '/tmp/notes', embedder: 'local' },
    db: { addInboxItem: vi.fn() },
    search: vi.fn().mockResolvedValue([]),
    dashboard: vi.fn().mockReturnValue({ audit: {}, status: {}, dashboard: {} }),
    pmStatus: vi.fn().mockReturnValue(null),
    pmNext: vi.fn().mockReturnValue([]),
    pmTaskList: vi.fn().mockReturnValue([]),
    sessionList: vi.fn().mockReturnValue([]),
    agentList: vi.fn().mockReturnValue([]),
    agentFind: vi.fn().mockReturnValue(null),
    sessionDetail: vi.fn().mockReturnValue(null),
    close: vi.fn(),
    ...overrides,
  } as unknown as BrainServiceClass;
}

describe('createServeServer — tool catalog', () => {
  it('returns the expected number of tools', async () => {
    const service = makeService();
    const server = createServeServer(service);
    // McpServer exposes registered tools through internal _registeredTools
    const tools = (server as unknown as { _registeredTools: Record<string, unknown> })
      ._registeredTools;
    expect(Object.keys(tools).length).toBeGreaterThanOrEqual(10);
  });

  it('includes all expected tool names', async () => {
    const service = makeService();
    const server = createServeServer(service);
    const tools = (server as unknown as { _registeredTools: Record<string, unknown> })
      ._registeredTools;
    const names = Object.keys(tools);
    const expected = [
      'brain_search',
      'brain_dashboard',
      'brain_pm_status',
      'brain_pm_next',
      'brain_pm_tasks',
      'brain_sessions',
      'brain_agents',
      'brain_agent_find',
      'brain_quick',
      'brain_status',
    ];
    for (const name of expected) {
      expect(names).toContain(name);
    }
  });
});

describe('createServeServer — tool dispatch', () => {
  let service: ReturnType<typeof makeService>;

  beforeEach(() => {
    service = makeService();
  });

  function callTool(
    server: ReturnType<typeof createServeServer>,
    name: string,
    args: Record<string, unknown>
  ) {
    const tools = (
      server as unknown as {
        _registeredTools: Record<string, { handler: (args: unknown) => unknown }>;
      }
    )._registeredTools;
    const tool = tools[name];
    if (!tool) throw new Error(`Tool ${name} not found`);
    return tool.handler(args);
  }

  it('brain_search calls service.search with query and limit', async () => {
    const mockResults: SearchResult[] = [];
    (service.search as ReturnType<typeof vi.fn>).mockResolvedValue(mockResults);
    const server = createServeServer(service);

    await callTool(server, 'brain_search', { query: 'hello', limit: 5 });

    expect(service.search).toHaveBeenCalledWith('hello', { limit: 5 });
  });

  it('brain_search uses default limit of 10', async () => {
    const server = createServeServer(service);
    await callTool(server, 'brain_search', { query: 'test' });
    expect(service.search).toHaveBeenCalledWith('test', { limit: 10 });
  });

  it('brain_dashboard calls service.dashboard', async () => {
    const server = createServeServer(service);
    await callTool(server, 'brain_dashboard', {});
    expect(service.dashboard).toHaveBeenCalled();
  });

  it('brain_pm_status returns not-found error when project missing', async () => {
    const server = createServeServer(service);
    const result = (await callTool(server, 'brain_pm_status', { prefix: 'XYZ' })) as {
      isError?: boolean;
      content: Array<{ text: string }>;
    };
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('XYZ');
  });

  it('brain_pm_status returns project JSON when found', async () => {
    const project = { prefix: 'VNM', name: 'Test Project' };
    (service.pmStatus as ReturnType<typeof vi.fn>).mockReturnValue(project);
    const server = createServeServer(service);

    const result = (await callTool(server, 'brain_pm_status', { prefix: 'VNM' })) as {
      content: Array<{ text: string }>;
    };
    expect(JSON.parse(result.content[0].text)).toEqual(project);
  });

  it('brain_pm_next calls service.pmNext with optional prefix', async () => {
    const tasks: TaskMetadata[] = [];
    (service.pmNext as ReturnType<typeof vi.fn>).mockReturnValue(tasks);
    const server = createServeServer(service);

    await callTool(server, 'brain_pm_next', { prefix: 'VNM' });
    expect(service.pmNext).toHaveBeenCalledWith('VNM');
  });

  it('brain_pm_tasks calls service.pmTaskList with filters', async () => {
    const server = createServeServer(service);
    await callTool(server, 'brain_pm_tasks', { workstream: 'VNM-07', status: 'in-progress' });
    expect(service.pmTaskList).toHaveBeenCalledWith({
      workstream: 'VNM-07',
      status: 'in-progress',
    });
  });

  it('brain_sessions calls service.sessionList with limit and status', async () => {
    const sessions: DashboardSession[] = [];
    (service.sessionList as ReturnType<typeof vi.fn>).mockReturnValue(sessions);
    const server = createServeServer(service);

    await callTool(server, 'brain_sessions', { limit: 5, status: 'active' });
    expect(service.sessionList).toHaveBeenCalledWith({ limit: 5, status: 'active' });
  });

  it('brain_agents calls service.agentList with status filter', async () => {
    const agents: AgentRecord[] = [];
    (service.agentList as ReturnType<typeof vi.fn>).mockReturnValue(agents);
    const server = createServeServer(service);

    await callTool(server, 'brain_agents', { status: 'active' });
    expect(service.agentList).toHaveBeenCalledWith({ status: 'active' });
  });

  it('brain_agents calls service.agentList without filter when no status', async () => {
    const server = createServeServer(service);
    await callTool(server, 'brain_agents', {});
    expect(service.agentList).toHaveBeenCalledWith(undefined);
  });

  it('brain_agent_find returns agent JSON when found', async () => {
    const agent = { id: 'abc', name: 'test-agent' } as AgentRecord;
    (service.agentFind as ReturnType<typeof vi.fn>).mockReturnValue(agent);
    const server = createServeServer(service);

    const result = (await callTool(server, 'brain_agent_find', { identifier: 'abc' })) as {
      content: Array<{ text: string }>;
    };
    expect(JSON.parse(result.content[0].text)).toMatchObject({ id: 'abc' });
  });

  it('brain_agent_find returns error when agent not found', async () => {
    const server = createServeServer(service);
    const result = (await callTool(server, 'brain_agent_find', { identifier: 'missing' })) as {
      isError?: boolean;
    };
    expect(result.isError).toBe(true);
  });

  it('brain_quick adds item to inbox', async () => {
    const server = createServeServer(service);
    const result = (await callTool(server, 'brain_quick', { text: 'remember this' })) as {
      content: Array<{ text: string }>;
    };

    expect(service.db.addInboxItem).toHaveBeenCalledOnce();
    const call = (service.db.addInboxItem as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.content).toBe('remember this');
    expect(call.status).toBe('pending');
    expect(result.content[0].text).toMatch(/Captured to inbox:/);
  });

  it('brain_status returns config info', async () => {
    const server = createServeServer(service);
    const result = (await callTool(server, 'brain_status', {})) as {
      content: Array<{ text: string }>;
    };
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.dbPath).toBe('/tmp/test.db');
    expect(parsed.isOpen).toBe(true);
    expect(parsed.embedder).toBe('local');
  });
});

// ---------------------------------------------------------------------------
// HTTP handler tests
// ---------------------------------------------------------------------------

function makeMockRes() {
  const chunks: string[] = [];
  let statusCode = 0;
  const headers: Record<string, string> = {};
  return {
    writeHead: vi.fn((code: number, hdrs?: Record<string, string>) => {
      statusCode = code;
      if (hdrs) Object.assign(headers, hdrs);
    }),
    setHeader: vi.fn((k: string, v: string) => {
      headers[k] = v;
    }),
    write: vi.fn((chunk: string) => {
      chunks.push(chunk);
    }),
    end: vi.fn((chunk?: string) => {
      if (chunk) chunks.push(chunk);
    }),
    on: vi.fn(),
    get statusCode() {
      return statusCode;
    },
    get headers() {
      return headers;
    },
    get body() {
      return chunks.join('');
    },
  };
}

function makeReq(method: string, url: string): IncomingMessage {
  return { method, url, on: vi.fn() } as unknown as IncomingMessage;
}

describe('createHttpHandler — route matching', () => {
  let service: ReturnType<typeof makeService>;
  let sseClients: SseClients;

  beforeEach(() => {
    service = makeService();
    sseClients = new Set();
  });

  it('OPTIONS returns 204', async () => {
    const handler = createHttpHandler(service as unknown as BrainServiceClass, sseClients);
    const res = makeMockRes();
    await handler(makeReq('OPTIONS', '/api/dashboard'), res as unknown as ServerResponse);
    expect(res.writeHead).toHaveBeenCalledWith(204);
  });

  it('unknown route returns 404', async () => {
    const handler = createHttpHandler(service as unknown as BrainServiceClass, sseClients);
    const res = makeMockRes();
    await handler(makeReq('GET', '/api/unknown'), res as unknown as ServerResponse);
    expect(res.writeHead).toHaveBeenCalledWith(404, expect.any(Object));
  });

  it('/api/dashboard returns dashboard payload', async () => {
    const dashData = { audit: { tasks: [] }, status: {}, dashboard: { sessions: [] } };
    (service.dashboard as ReturnType<typeof vi.fn>).mockReturnValue(dashData);
    const handler = createHttpHandler(service as unknown as BrainServiceClass, sseClients);
    const res = makeMockRes();
    await handler(makeReq('GET', '/api/dashboard'), res as unknown as ServerResponse);
    expect(res.writeHead).toHaveBeenCalledWith(
      200,
      expect.objectContaining({ 'Content-Type': 'application/json' })
    );
    expect(JSON.parse(res.body)).toEqual(dashData);
  });

  it('/api/status returns service config', async () => {
    const handler = createHttpHandler(service as unknown as BrainServiceClass, sseClients);
    const res = makeMockRes();
    await handler(makeReq('GET', '/api/status'), res as unknown as ServerResponse);
    const body = JSON.parse(res.body);
    expect(body.dbPath).toBe('/tmp/test.db');
    expect(body.isOpen).toBe(true);
  });

  it('/api/sessions returns session list', async () => {
    const sessions: DashboardSession[] = [
      {
        id: 's1',
        display_id: 'S-1',
        status: 'active',
        startedAt: '',
        endedAt: null,
        durationMinutes: null,
        toolCalls: 0,
        filesModified: 0,
        tasksCompleted: 0,
        taskRefs: [],
      },
    ];
    (service.sessionList as ReturnType<typeof vi.fn>).mockReturnValue(sessions);
    const handler = createHttpHandler(service as unknown as BrainServiceClass, sseClients);
    const res = makeMockRes();
    await handler(makeReq('GET', '/api/sessions'), res as unknown as ServerResponse);
    expect(JSON.parse(res.body)).toEqual(sessions);
  });

  it('/api/agents returns agent list', async () => {
    const agents = [{ id: 'a1', name: 'agent-1' }];
    (service.agentList as ReturnType<typeof vi.fn>).mockReturnValue(agents);
    const handler = createHttpHandler(service as unknown as BrainServiceClass, sseClients);
    const res = makeMockRes();
    await handler(makeReq('GET', '/api/agents'), res as unknown as ServerResponse);
    expect(JSON.parse(res.body)).toEqual(agents);
  });

  it('/api/pm/next passes prefix query param', async () => {
    const handler = createHttpHandler(service as unknown as BrainServiceClass, sseClients);
    const res = makeMockRes();
    await handler(makeReq('GET', '/api/pm/next?prefix=VNM'), res as unknown as ServerResponse);
    expect(service.pmNext).toHaveBeenCalledWith('VNM');
  });

  it('/api/pm/tasks passes workstream and status params', async () => {
    const handler = createHttpHandler(service as unknown as BrainServiceClass, sseClients);
    const res = makeMockRes();
    await handler(
      makeReq('GET', '/api/pm/tasks?workstream=VNM-07&status=in-progress'),
      res as unknown as ServerResponse
    );
    expect(service.pmTaskList).toHaveBeenCalledWith({
      workstream: 'VNM-07',
      status: 'in-progress',
    });
  });

  it('/api/pm/tasks/:id returns single task', async () => {
    const task = { id: 't1', display_id: 'VNM-01.01', title: 'My task' } as unknown as TaskMetadata;
    (service.pmTaskList as ReturnType<typeof vi.fn>).mockReturnValue([task]);
    const handler = createHttpHandler(service as unknown as BrainServiceClass, sseClients);
    const res = makeMockRes();
    await handler(makeReq('GET', '/api/pm/tasks/VNM-01.01'), res as unknown as ServerResponse);
    expect(JSON.parse(res.body)).toMatchObject({ display_id: 'VNM-01.01' });
  });

  it('/api/pm/tasks/:id returns 404 for unknown task', async () => {
    (service.pmTaskList as ReturnType<typeof vi.fn>).mockReturnValue([]);
    const handler = createHttpHandler(service as unknown as BrainServiceClass, sseClients);
    const res = makeMockRes();
    await handler(makeReq('GET', '/api/pm/tasks/NOPE'), res as unknown as ServerResponse);
    expect(res.writeHead).toHaveBeenCalledWith(404, expect.any(Object));
  });

  it('/api/pm/status/:prefix returns project status', async () => {
    const project = { prefix: 'VNM', name: 'My Project' };
    (service.pmStatus as ReturnType<typeof vi.fn>).mockReturnValue(project);
    const handler = createHttpHandler(service as unknown as BrainServiceClass, sseClients);
    const res = makeMockRes();
    await handler(makeReq('GET', '/api/pm/status/VNM'), res as unknown as ServerResponse);
    expect(service.pmStatus).toHaveBeenCalledWith('VNM');
    expect(JSON.parse(res.body)).toEqual(project);
  });

  it('/api/pm/status/:prefix returns 404 when not found', async () => {
    (service.pmStatus as ReturnType<typeof vi.fn>).mockReturnValue(null);
    const handler = createHttpHandler(service as unknown as BrainServiceClass, sseClients);
    const res = makeMockRes();
    await handler(makeReq('GET', '/api/pm/status/NOPE'), res as unknown as ServerResponse);
    expect(res.writeHead).toHaveBeenCalledWith(404, expect.any(Object));
  });

  it('/api/sessions/:id/detail returns composite session detail', async () => {
    const detail = {
      session: { sessionId: 's1', displayId: 'SNS-001', status: 'completed' },
      turns: [
        {
          index: 0,
          userMessage: 'hi',
          assistantResponse: 'hello',
          toolCalls: [],
          timestamp: '2026-01-01T00:00:00Z',
          tokenUsage: null,
        },
      ],
      tokenTimeline: [],
      compactions: [],
      taskEvents: [],
      agentEvents: [],
      subagents: [],
      frictionSignals: [],
      totalToolCalls: 0,
      totalErrors: 0,
      errorRate: 0,
    };
    (service.sessionDetail as ReturnType<typeof vi.fn>).mockReturnValue(detail);
    const handler = createHttpHandler(service as unknown as BrainServiceClass, sseClients);
    const res = makeMockRes();
    await handler(makeReq('GET', '/api/sessions/SNS-001/detail'), res as unknown as ServerResponse);
    expect(service.sessionDetail).toHaveBeenCalledWith('SNS-001');
    expect(res.writeHead).toHaveBeenCalledWith(
      200,
      expect.objectContaining({ 'Content-Type': 'application/json' })
    );
    const body = JSON.parse(res.body);
    expect(body.session.displayId).toBe('SNS-001');
    expect(body.turns).toHaveLength(1);
  });

  it('/api/sessions/:id/detail returns 404 when session not found', async () => {
    (service.sessionDetail as ReturnType<typeof vi.fn>).mockReturnValue(null);
    const handler = createHttpHandler(service as unknown as BrainServiceClass, sseClients);
    const res = makeMockRes();
    await handler(makeReq('GET', '/api/sessions/NOPE/detail'), res as unknown as ServerResponse);
    expect(res.writeHead).toHaveBeenCalledWith(404, expect.any(Object));
  });

  it('/ serves HTML or falls back to 404 based on dashboard build', async () => {
    const handler = createHttpHandler(service as unknown as BrainServiceClass, sseClients);
    const res = makeMockRes();
    await handler(makeReq('GET', '/'), res as unknown as ServerResponse);
    const code = res.writeHead.mock.calls[0]?.[0] as number;
    if (code === 200) {
      expect(res.headers['Content-Type']).toBe('text/html');
      expect(res.body.length).toBeGreaterThan(0);
    } else {
      expect(code).toBe(404);
    }
  });

  it('/api/events sets SSE headers and adds client', async () => {
    const handler = createHttpHandler(service as unknown as BrainServiceClass, sseClients);
    const res = makeMockRes();
    await handler(makeReq('GET', '/api/events'), res as unknown as ServerResponse);
    expect(res.writeHead).toHaveBeenCalledWith(
      200,
      expect.objectContaining({ 'Content-Type': 'text/event-stream' })
    );
    expect(sseClients.size).toBe(1);
  });
});

describe('broadcast', () => {
  it('sends formatted SSE message to all clients', () => {
    const clients: SseClients = new Set();
    const c1 = { write: vi.fn() } as unknown as ServerResponse;
    const c2 = { write: vi.fn() } as unknown as ServerResponse;
    clients.add(c1);
    clients.add(c2);

    broadcast(clients, 'update', { foo: 'bar' });

    const expected = `event: update\ndata: ${JSON.stringify({ foo: 'bar' })}\n\n`;
    expect(c1.write).toHaveBeenCalledWith(expected);
    expect(c2.write).toHaveBeenCalledWith(expected);
  });

  it('sends nothing when no clients connected', () => {
    // Should not throw
    expect(() => broadcast(new Set(), 'test', {})).not.toThrow();
  });
});
