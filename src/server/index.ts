import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { getSharedInstance, closeSharedInstance } from '../services/brain-service.js';
import type { BrainServiceClass } from '../services/brain-service.js';
import { createBrainMcpServer } from './mcp.js';
import type { ResolveOptions } from '../services/config.js';
import { WorkflowChannel } from '../modules/workflow/runtime/channel.js';

// Polling-first instructions: brain_workflow_events is the reliable path.
// notifications/claude/channel is broken (GitHub #40729, #36802, #41733).
// sendResourceListChanged() fires as a hint to trigger an immediate poll.
const WORKFLOW_CHANNEL_INSTRUCTIONS = `
Events from the brain workflow engine arrive via polling — NOT passive channel tags.

To monitor workflow progress:
1. Call brain_workflow_events periodically (every 30-60s) or after resource list change notifications.
2. Pass the "cursor" from each response as "since" in the next call for incremental updates.
3. On resource list change notification: re-poll brain_workflow_events immediately.

Event types returned by brain_workflow_events:
- status="running": workflow active, check currentStep
- status="complete": all steps done, review results with brain_workflow_status
- status="failed": check the error field, use brain_workflow_signal to retry

Assisted steps: use brain_workflow_signal with action "complete" when your input is ready.
`.trim();
import type { SseClients } from '../commands/serve-http.js';
import { broadcast } from '../commands/serve-http.js';

async function initV2Runtime(
  svc: BrainServiceClass,
  server: ReturnType<typeof createBrainMcpServer>,
  sseClients?: SseClients
): Promise<{ stopReconciler: () => void }> {
  const { WorkflowRuntime } = await import('../modules/workflow/runtime/runtime.js');
  const { workflows } = await import('../modules/workflow/flows/index.js');
  const { workflowRuntimeMigrationV1 } = await import('../modules/workflow/runtime/migration.js');

  const channel = new WorkflowChannel(server);

  const runtime = new WorkflowRuntime({
    db: svc.db,
    config: svc.config,
    embedder: svc.embedder,
    channelPush: (event: string, meta: Record<string, string>) => {
      channel.push(event, meta);
      // Standard MCP resource notification — reliable alternative to broken claude/channel.
      // Signals coordinator to re-poll brain_workflow_events.
      server.server.sendResourceListChanged().catch(() => {});
      if (sseClients?.size) {
        try {
          broadcast(sseClients, 'workflow', { event, ...meta });
          broadcast(sseClients, 'refresh', {});
        } catch {
          // SSE broadcast failure is non-fatal
        }
      }
    },
  });

  for (const [name, fn] of Object.entries(workflows)) {
    runtime.register(name, fn);
  }

  workflowRuntimeMigrationV1.up(svc.db.rawDb);

  await runtime.hydrate();
  runtime.startReconciler();

  (svc as unknown as Record<string, unknown>)._workflowRuntime = runtime;
  process.stderr.write('Workflow runtime active\n');

  return runtime;
}

/** Start MCP-only server (no HTTP). Used by `brain serve --mcp`. */
export async function startMcpServer(resolveOpts?: ResolveOptions): Promise<void> {
  const svc = await getSharedInstance(resolveOpts);
  const server = createBrainMcpServer(svc, {
    channelInstructions: WORKFLOW_CHANNEL_INSTRUCTIONS,
  });

  const runtime = await initV2Runtime(svc, server);

  const transport = new StdioServerTransport();
  await server.connect(transport);

  const shutdown = () => {
    runtime.stopReconciler();
    closeSharedInstance();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

/** Start MCP server with an existing service instance. Used by `brain serve` (HTTP + MCP). */
export async function startMcpServerWithService(
  svc: BrainServiceClass,
  onShutdown?: () => void,
  sseClients?: SseClients
): Promise<void> {
  const server = createBrainMcpServer(svc, {
    channelInstructions: WORKFLOW_CHANNEL_INSTRUCTIONS,
  });

  const runtime = await initV2Runtime(svc, server, sseClients);

  const transport = new StdioServerTransport();
  await server.connect(transport);

  const shutdown = () => {
    runtime.stopReconciler();
    onShutdown?.();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
