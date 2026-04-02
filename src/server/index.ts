import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { getSharedInstance, closeSharedInstance } from '../services/brain-service.js';
import type { BrainServiceClass } from '../services/brain-service.js';
import { createBrainMcpServer } from './mcp.js';
import type { ResolveOptions } from '../services/config.js';
import {
  WorkflowChannel,
  WORKFLOW_CHANNEL_INSTRUCTIONS,
} from '../modules/workflow/runtime/channel.js';

async function initV2Runtime(
  svc: BrainServiceClass,
  server: ReturnType<typeof createBrainMcpServer>
): Promise<{ stopReconciler: () => void } | null> {
  if (process.env.BRAIN_EXECUTOR_V2 !== '1') return null;

  const { WorkflowRuntime } = await import('../modules/workflow/runtime/runtime.js');
  const { workflows } = await import('../modules/workflow/flows/index.js');
  const { workflowRuntimeMigrationV1 } = await import('../modules/workflow/runtime/migration.js');

  const channel = new WorkflowChannel(server);

  const runtime = new WorkflowRuntime({
    db: svc.db,
    config: svc.config,
    embedder: svc.embedder,
    channelPush: (event: string, meta: Record<string, string>) => channel.push(event, meta),
  });

  for (const [name, fn] of Object.entries(workflows)) {
    runtime.register(name, fn);
  }

  workflowRuntimeMigrationV1.up(svc.db.rawDb);

  await runtime.hydrate();
  runtime.startReconciler();

  (svc as unknown as Record<string, unknown>)._workflowRuntime = runtime;
  process.stderr.write('Workflow runtime V2 active\n');

  return runtime;
}

/** Start MCP-only server (no HTTP). Used by `brain serve --mcp`. */
export async function startMcpServer(resolveOpts?: ResolveOptions): Promise<void> {
  process.stderr.write(`[brain-mcp] BRAIN_EXECUTOR_V2=${process.env.BRAIN_EXECUTOR_V2 ?? 'unset'}\n`);
  const svc = await getSharedInstance(resolveOpts);
  const server = createBrainMcpServer(
    svc,
    process.env.BRAIN_EXECUTOR_V2 === '1'
      ? { channelInstructions: WORKFLOW_CHANNEL_INSTRUCTIONS }
      : undefined
  );

  const runtime = await initV2Runtime(svc, server);

  const transport = new StdioServerTransport();
  await server.connect(transport);

  const shutdown = () => {
    runtime?.stopReconciler();
    closeSharedInstance();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

/** Start MCP server with an existing service instance. Used by `brain serve` (HTTP + MCP). */
export async function startMcpServerWithService(
  svc: BrainServiceClass,
  onShutdown?: () => void
): Promise<void> {
  const server = createBrainMcpServer(
    svc,
    process.env.BRAIN_EXECUTOR_V2 === '1'
      ? { channelInstructions: WORKFLOW_CHANNEL_INSTRUCTIONS }
      : undefined
  );

  const runtime = await initV2Runtime(svc, server);

  const transport = new StdioServerTransport();
  await server.connect(transport);

  const shutdown = () => {
    runtime?.stopReconciler();
    onShutdown?.();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
