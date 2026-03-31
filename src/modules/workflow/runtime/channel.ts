/**
 * WorkflowChannel — push-based event delivery to Claude Code coordinator sessions.
 *
 * Wraps an MCP Server instance and sends typed workflow events via the
 * experimental `claude/channel` capability. Events appear as
 * `<channel source="brain" event="...">` tags in the coordinator session.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

export class WorkflowChannel {
  private server: McpServer;

  constructor(mcp: McpServer) {
    this.server = mcp;
  }

  push(event: string, meta: Record<string, string>, detail?: string): void {
    const content = this.formatContent(event, meta, detail);

    // Fire-and-forget — never block the workflow or throw
    this.server.server
      .notification({
        method: 'notifications/claude/channel',
        params: {
          content,
          meta: { source: 'brain', event, ...meta },
        },
      } as Parameters<typeof this.server.server.notification>[0])
      .catch(() => {});
  }

  private formatContent(event: string, meta: Record<string, string>, detail?: string): string {
    switch (event) {
      case 'step_complete':
        return `Workflow step "${meta.step}" completed.${meta.signal ? ` Signal: ${meta.signal}` : ''} Task: ${meta.taskId}`;
      case 'workflow_complete':
        return `Workflow ${meta.workflow} completed successfully.`;
      case 'step_failed':
        return `Workflow step "${meta.step}" failed: ${detail ?? 'unknown error'}`;
      case 'assisted_step':
        return `Workflow paused at assisted step "${meta.step}". ${detail ?? ''}`;
      case 'needs_intervention':
        return `Workflow ${meta.workflow} needs intervention: ${detail ?? 'stalled'}`;
      default:
        return `Workflow event: ${event}`;
    }
  }
}

export const WORKFLOW_CHANNEL_INSTRUCTIONS = `
Events from the brain workflow engine arrive as <channel source="brain" event="...">.
Handle each event type:

- event="step_complete": A workflow step finished. Check for signals (needs_revision, has_open_questions).
  The workflow engine handles routing automatically — this is informational.
- event="workflow_complete": All steps done. Review the results.
- event="step_failed": An agent died or errored. Check the error detail and decide whether to retry.
- event="assisted_step": The workflow is paused waiting for your input. Read the prompt and respond
  using brain_workflow_signal with action "complete" when ready.
- event="needs_intervention": Something is stuck. Check brain_workflow_status for details.

These events arrive in real-time as workflow steps complete. You don't need to poll brain_workflow_status.
`.trim();
