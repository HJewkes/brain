import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { getSharedInstance, closeSharedInstance } from '../services/brain-service.js';
import { createBrainMcpServer } from './mcp.js';
import type { ResolveOptions } from '../services/config.js';
import {
  WorkflowChannel,
  WORKFLOW_CHANNEL_INSTRUCTIONS,
} from '../modules/workflow/runtime/channel.js';

export async function startMcpServer(resolveOpts?: ResolveOptions): Promise<void> {
  const svc = await getSharedInstance(resolveOpts);

  const useV2 = process.env.BRAIN_EXECUTOR_V2 === '1';

  const server = createBrainMcpServer(
    svc,
    useV2 ? { channelInstructions: WORKFLOW_CHANNEL_INSTRUCTIONS } : undefined
  );

  if (useV2) {
    const { WorkflowRuntime } = await import('../modules/workflow/runtime/runtime.js');
    const { workflows } = await import('../modules/workflow/flows/index.js');
    const { workflowRuntimeMigrationV1 } = await import('../modules/workflow/runtime/migration.js');

    const channel = new WorkflowChannel(server);

    const runtime = new WorkflowRuntime({
      db: svc.db,
      config: svc.config,
      embedder: svc.embedder,
      channelPush: (event, meta) => channel.push(event, meta),
    });

    for (const [name, fn] of Object.entries(workflows)) {
      runtime.register(name, fn);
    }

    workflowRuntimeMigrationV1.up(svc.db.rawDb);

    await runtime.hydrate();
    runtime.startReconciler();

    (svc as unknown as Record<string, unknown>)._workflowRuntime = runtime;
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);

  const shutdown = () => {
    if (process.env.BRAIN_EXECUTOR_V2 === '1') {
      const runtime = (svc as unknown as Record<string, unknown>)._workflowRuntime as
        | { stopReconciler(): void }
        | undefined;
      runtime?.stopReconciler();
    }
    closeSharedInstance();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
