import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { getSharedInstance, closeSharedInstance } from '../services/brain-service.js';
import { createBrainMcpServer } from './mcp.js';
import type { ResolveOptions } from '../services/config.js';

export async function startMcpServer(resolveOpts?: ResolveOptions): Promise<void> {
  const svc = await getSharedInstance(resolveOpts);
  const server = createBrainMcpServer(svc);
  const transport = new StdioServerTransport();
  await server.connect(transport);

  process.on('SIGINT', () => {
    closeSharedInstance();
    process.exit(0);
  });
}
