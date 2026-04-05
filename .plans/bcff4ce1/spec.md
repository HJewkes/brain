# Spec: MCP Server Hardening

## Problem

The brain MCP server originally exposed only basic search/memory tools, leaving Claude Code coordinators unable to create tasks, capture notes, inspect project state, or reliably monitor workflow progress. Channel notifications (`notifications/claude/channel`) are silently dropped in several Claude Code versions (GitHub #40729, #36802, #41733), so workflow events were never reliably delivered to the coordinator session. Without reliable event delivery and sufficient tool coverage, the coordinator cannot autonomously drive planning and implementation workflows.

## Requirements

1. The MCP server must expose at least 28 tools covering: search, note CRUD, memory, PM core (task list/show/update/next/overview), PM extended (task add, workstream list/add, wave dispatch, rich context, lightweight capture), session/agent (session list/show, agent list/dispatch/status, inbox add), and workflow (start, status, signal, event polling).

2. Coordinators must be able to poll workflow run states incrementally using a cursor-based interface (`brain_workflow_events` with `since` and `instanceId` filters).

3. The MCP server must declare the `resources` capability so that `notifications/resources/list_changed` is processed by clients that support it.

4. A `brain://workflow/runs` resource must be registered so that `sendResourceListChanged()` notifications are semantically valid per MCP spec.

5. `channelPush` in the workflow runtime must call `sendResourceListChanged()` on every workflow event to hint coordinators to re-poll.

6. Server instructions must direct coordinators to use polling (`brain_workflow_events`) as the primary event delivery path, not passive channel tags.

## Constraints

- No new database tables or schema changes.
- No changes to existing tool schemas or behavior — only additions.
- `notifications/claude/channel` must remain emitted for forward compatibility.
- All new tools must wire to existing handler functions — no new business logic.
- Node16 ESM: all imports use `.js` extensions.

## Out of Scope

- Step-level event persistence (run-level polling via `workflow_runs` table is sufficient).
- Push-based reliable delivery (polling is the solution; push is best-effort).
- SSE bridge changes (already working via `serve-http.ts`).
- Dashboard changes.

## Dependencies

- `@modelcontextprotocol/sdk` v1.27.1+ (McpServer.server.sendResourceListChanged available).
- Existing PM, session, agent, and workflow module handler functions (already imported in `mcp.ts`).
