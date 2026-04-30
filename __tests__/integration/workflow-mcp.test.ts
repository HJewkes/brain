/**
 * Workflow Executor V2 — MCP transport boundary tests.
 *
 * Covers AC-11 through AC-14 and EC-05 from
 * .plans/v2-e2e-low-01/acceptance-criteria.md.
 *
 * Wires WorkflowRuntime to createBrainMcpServer via InMemoryTransport.
 * BRAIN_EXECUTOR_V2=1 is set via vi.stubEnv before server construction.
 */
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { BrainDB } from '../../src/services/brain-db.js';
import type { BrainConfig } from '../../src/types.js';
import type { WorkflowFn } from '../../src/modules/workflow/runtime/types.js';
import type { BrainServiceClass } from '../../src/services/brain-service.js';
import { WorkflowRuntime } from '../../src/modules/workflow/runtime/runtime.js';
import { createBrainMcpServer } from '../../src/server/mcp.js';
import { createTestDb, createMockEmbedder } from '../helpers.js';
import { createWorkflowRunsTable, resolveAllAgents } from '../modules/workflow/helpers.js';

// ---------------------------------------------------------------------------
// Module-level mocks
// ---------------------------------------------------------------------------

vi.mock('../../src/modules/pm/data/task-ops.js', () => ({
  createTask: vi.fn().mockResolvedValue({
    ok: true,
    data: { display_id: 'VNM-01.001' },
  }),
  getTask: vi.fn().mockReturnValue({
    ok: true,
    data: { id: 't1', display_id: 'VNM-01.01', title: 'Test task', status: 'pending' },
  }),
  updateTaskStatus: vi.fn().mockResolvedValue({
    ok: true,
    data: { id: 't1', display_id: 'VNM-01.01', title: 'Test task', status: 'done' },
  }),
}));

vi.mock('../../src/modules/workflow/engine/dispatch.js', () => ({
  dispatchTemplate: vi.fn().mockResolvedValue({
    ok: true,
    data: { rendered: 'rendered prompt' },
  }),
}));

vi.mock('../../src/server/dispatch.js', () => ({
  dispatchTask: vi.fn().mockResolvedValue({
    pid: 55555,
    taskId: 'VNM-01.001',
    agentId: 'agent-mock',
    sessionId: 'sess-mock',
    model: 'sonnet',
    prompt: 'x',
  }),
  resolveProjectDir: vi.fn(() => '/tmp/test-project'),
}));

vi.mock('../../src/services/search.js', () => ({
  searchMemories: vi.fn().mockResolvedValue([]),
}));

// ---------------------------------------------------------------------------
// Inline workflow fixtures
// ---------------------------------------------------------------------------

const minimalWorkflow: WorkflowFn = async (ctx) => {
  await ctx.dispatch('step-a', 'template-a');
  await ctx.dispatch('step-b', 'template-b');
};

const assistedWorkflow: WorkflowFn = async (ctx) => {
  await ctx.dispatch('step-a', 'template-a');
  await ctx.assisted('review', 'template-review');
  await ctx.dispatch('step-b', 'template-b');
};

// ---------------------------------------------------------------------------
// makeServiceWithRuntime shim
// ---------------------------------------------------------------------------

function makeServiceWithRuntime(
  db: BrainDB,
  config: BrainConfig,
  runtime: WorkflowRuntime
): BrainServiceClass {
  return {
    db: {
      ...db,
      addInboxItem: vi.fn(),
      getNoteById: vi.fn().mockImplementation((id: string) => {
        if (id.endsWith('-workstream')) {
          return { id, type: 'workstream', title: 'Test Workstream' };
        }
        return null;
      }),
      forgetExpiredMemories: vi.fn(),
      getLatestMemories: vi.fn().mockReturnValue([]),
    },
    config,
    embedder: createMockEmbedder(),
    isOpen: true,
    agentList: vi.fn().mockReturnValue([]),
    search: vi.fn().mockResolvedValue([]),
    pmTaskList: vi.fn().mockReturnValue([]),
    pmOverview: vi.fn().mockReturnValue({ ok: true, data: {} }),
    pmTaskShow: vi.fn().mockReturnValue({ ok: true, data: {} }),
    pmTaskUpdate: vi.fn().mockReturnValue({ ok: true, data: {} }),
    pmNext: vi.fn().mockReturnValue({ ok: true, data: [] }),
    pmDispatch: vi.fn().mockResolvedValue({ ok: true, data: {} }),
    _workflowRuntime: runtime,
  } as unknown as BrainServiceClass;
}

// ---------------------------------------------------------------------------
// Response parsing helper
// ---------------------------------------------------------------------------

function parseResult(result: { content: Array<{ type: string; text: string }> }): unknown {
  return JSON.parse(result.content[0].text);
}

// ---------------------------------------------------------------------------
// Shared test setup
// ---------------------------------------------------------------------------

const embedder = createMockEmbedder();

let db: BrainDB;
let dbPath: string;
let notesDir: string;
let config: BrainConfig;
let runtime: WorkflowRuntime;
let client: Client;

beforeEach(async () => {
  ({ dbPath, db } = createTestDb());
  createWorkflowRunsTable(db);
  notesDir = join(tmpdir(), `wf-mcp-${randomUUID()}`);
  mkdirSync(notesDir, { recursive: true });
  config = {
    notesDir,
    dbPath,
    embedder: 'local',
    fusionWeights: { bm25: 0.3, vector: 0.7 },
  };
  vi.clearAllMocks();

  runtime = new WorkflowRuntime({ db, config, embedder });
  runtime.register('minimal', minimalWorkflow);
  runtime.register('assisted', assistedWorkflow);

  // BRAIN_EXECUTOR_V2 must be set before createBrainMcpServer() is called
  vi.stubEnv('BRAIN_EXECUTOR_V2', '1');

  const service = makeServiceWithRuntime(db, config, runtime);
  const server = createBrainMcpServer(service);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: 'test-client', version: '1.0.0' });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await client.close();
  db.close();
  if (existsSync(notesDir)) {
    rmSync(notesDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// AC-11: MCP start tool returns runtimeVersion v2
// ---------------------------------------------------------------------------

describe('AC-11: brain_workflow_start returns runtimeVersion v2', () => {
  test('start tool returns instanceId and runtimeVersion v2', async () => {
    const result = await client.callTool({
      name: 'brain_workflow_start',
      arguments: {
        workflowId: 'minimal',
        project: 'VNM',
        workstream: 53,
        context: { projectDir: '/tmp' },
      },
    });

    const parsed = parseResult(result as { content: Array<{ type: string; text: string }> });
    const data = parsed as Record<string, unknown>;

    expect(data.runtimeVersion).toBe('v2');
    expect(typeof data.instanceId).toBe('string');
    expect((data.instanceId as string).length).toBeGreaterThan(0);

    // Cleanup: resolve agents so the workflow doesn't linger
    const runId = data.instanceId as string;
    await resolveAllAgents(runtime, runId);
  });
});

// ---------------------------------------------------------------------------
// AC-12: MCP status tool reflects running state
// ---------------------------------------------------------------------------

describe('AC-12: brain_workflow_status reflects running state', () => {
  test('status is running before agents are resolved', async () => {
    const startResult = await client.callTool({
      name: 'brain_workflow_start',
      arguments: {
        workflowId: 'minimal',
        project: 'VNM',
        workstream: 53,
        context: { projectDir: '/tmp' },
      },
    });

    const startData = parseResult(
      startResult as { content: Array<{ type: string; text: string }> }
    ) as Record<string, unknown>;
    const instanceId = startData.instanceId as string;

    const statusResult = await client.callTool({
      name: 'brain_workflow_status',
      arguments: { instanceId },
    });

    const statusData = parseResult(
      statusResult as { content: Array<{ type: string; text: string }> }
    ) as Record<string, unknown>;

    expect((statusData.instance as Record<string, unknown>).instance_status).toBe('running');
    expect(statusData.runtimeVersion).toBe('v2');

    // Cleanup
    await resolveAllAgents(runtime, instanceId);
  });
});

// ---------------------------------------------------------------------------
// AC-13: MCP status tool reflects completed state
// ---------------------------------------------------------------------------

describe('AC-13: brain_workflow_status reflects completed state', () => {
  test('status is completed after all agents resolved', async () => {
    const startResult = await client.callTool({
      name: 'brain_workflow_start',
      arguments: {
        workflowId: 'minimal',
        project: 'VNM',
        workstream: 53,
        context: { projectDir: '/tmp' },
      },
    });

    const startData = parseResult(
      startResult as { content: Array<{ type: string; text: string }> }
    ) as Record<string, unknown>;
    const instanceId = startData.instanceId as string;

    await resolveAllAgents(runtime, instanceId);

    await vi.waitFor(() => {
      expect(runtime.getStatus(instanceId)?.status).toBe('completed');
    });

    const statusResult = await client.callTool({
      name: 'brain_workflow_status',
      arguments: { instanceId },
    });

    const statusData = parseResult(
      statusResult as { content: Array<{ type: string; text: string }> }
    ) as Record<string, unknown>;

    expect((statusData.instance as Record<string, unknown>).instance_status).toBe('completed');
  });
});

// ---------------------------------------------------------------------------
// AC-14: MCP signal tool unblocks paused assisted workflow
// ---------------------------------------------------------------------------

describe('AC-14: brain_workflow_signal unblocks paused assisted workflow', () => {
  test('signal completes paused workflow', async () => {
    const startResult = await client.callTool({
      name: 'brain_workflow_start',
      arguments: {
        workflowId: 'assisted',
        project: 'VNM',
        workstream: 53,
        context: { projectDir: '/tmp' },
      },
    });

    const startData = parseResult(
      startResult as { content: Array<{ type: string; text: string }> }
    ) as Record<string, unknown>;
    const instanceId = startData.instanceId as string;

    // Resolve step-a so workflow reaches the assisted step
    await vi.waitFor(() => {
      expect(runtime.activeRuns.get(instanceId)?.ctx.activeAgent?.stepId).toBe('step-a');
    });
    runtime.activeRuns.get(instanceId)!.ctx.resolveAgent('step-a', 'step-a done');

    // Wait for pause at assisted review step
    await vi.waitFor(() => {
      expect(runtime.getStatus(instanceId)?.status).toBe('paused');
    });

    // Signal the review step via MCP
    await client.callTool({
      name: 'brain_workflow_signal',
      arguments: {
        instanceId,
        stepId: 'review',
        action: 'complete',
      },
    });

    // Resolve remaining agents (step-b)
    await resolveAllAgents(runtime, instanceId);

    await vi.waitFor(() => {
      expect(runtime.getStatus(instanceId)?.status).toBe('completed');
    });

    // Verify final status via MCP
    const finalStatus = await client.callTool({
      name: 'brain_workflow_status',
      arguments: { instanceId },
    });

    const finalData = parseResult(
      finalStatus as { content: Array<{ type: string; text: string }> }
    ) as Record<string, unknown>;

    expect((finalData.instance as Record<string, unknown>).instance_status).toBe('completed');
  });
});

// ---------------------------------------------------------------------------
// EC-05: MCP status on nonexistent instanceId
// ---------------------------------------------------------------------------

describe('EC-05: brain_workflow_status on nonexistent instanceId', () => {
  test('returns error or not_found; no unhandled exception', async () => {
    const result = await client.callTool({
      name: 'brain_workflow_status',
      arguments: { instanceId: 'does-not-exist-' + randomUUID() },
    });

    const content = (result as { content: Array<{ type: string; text: string }> }).content;
    expect(content).toBeDefined();
    expect(content.length).toBeGreaterThan(0);

    // Response may be plain text (error) or JSON — either is acceptable
    const text = content[0].text;
    expect(text).toMatch(/not.found|error|workflow/i);
  });
});
