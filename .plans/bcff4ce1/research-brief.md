# Research Brief: VNM-42.211

Plan: bcff4ce1 | Project: VNM

## Current Implementation State (as of 2026-04-04, updated VNM-42.211)

All 10 originally-missing tools have been implemented. The MCP server now registers **28 tools** across 8 groups.

### Full Tool Inventory (`src/server/mcp.ts`)

| Group | Tools |
|-------|-------|
| Search | `brain_search`, `brain_note_read`, `brain_memory_search`, `brain_memory_list` |
| Notes | `brain_note_list`, `brain_note_add` |
| Memory | `brain_memory_add` |
| PM (core) | `brain_pm_task_list`, `brain_pm_task_show`, `brain_pm_task_update`, `brain_pm_next`, `brain_pm_overview` |
| PM (ext) | `brain_pm_task_add`, `brain_pm_workstream_list`, `brain_pm_workstream_add`, `brain_pm_wave`, `brain_pm_context`, `brain_pm_capture` |
| Session/Agent | `brain_session_list`, `brain_agent_list`, `brain_session_show`, `brain_inbox_add` |
| Dispatch | `brain_agent_dispatch`, `brain_agent_status` |
| Workflow | `brain_workflow_start`, `brain_workflow_status`, `brain_workflow_signal`, `brain_workflow_events` |

### Server entry (`src/server/index.ts`) — FULLY IMPLEMENTED

- `startMcpServer()` — MCP-only (stdio transport)
- `startMcpServerWithService()` — combined HTTP+MCP
- `initV2Runtime()` — registers `WorkflowChannel` push + SSE broadcast + `sendResourceListChanged()`
- SSE broadcast works via `broadcast(sseClients, 'workflow', {...})` — dashboard path healthy
- `server.server.sendResourceListChanged().catch(() => {})` wired in `channelPush` lambda ✓
- `WORKFLOW_CHANNEL_INSTRUCTIONS` overridden in `index.ts` with polling-first instructions ✓

### Channel Notification Status — RESOLVED

**`brain_workflow_events` (implemented)** — Polls `workflow_runs` table directly via `rawDb`:
- Accepts `instanceId`, `since` (ISO timestamp), `limit`
- Returns snapshot of workflow runs with cursor for incremental polling
- Is the primary reliable path; documented in updated instructions

**`WORKFLOW_CHANNEL_INSTRUCTIONS` (updated in `index.ts`)** — Overrides channel.ts default:
- Polling-first: tells coordinator to call `brain_workflow_events` after events
- Includes cursor-based incremental polling instructions
- `sendResourceListChanged()` fires as hint to trigger immediate re-poll

**`notifications/claude/channel` (broken, fire-and-forget)** — still emitted:
- GitHub issues #40729, #36802, #41733 confirm silent failures
- Kept for forward compatibility but not relied upon

## Remaining Optional Gap

**`resources` capability not declared + no resource registered**: `createBrainMcpServer` declares `capabilities: { tools: {} }` but not `resources: {}`. Without this, Claude Code may not subscribe to `notifications/resources/list_changed`, so `sendResourceListChanged()` may be silently ignored. No `brain://workflow/runs` resource URI is registered.

Fix (low risk, in `src/server/mcp.ts` which is owned):
1. Add `resources: {}` to capabilities
2. Register `brain://workflow/runs` resource in `registerWorkflowTools`

## Implementation Ownership

Files owned and complete:
- `src/server/mcp.ts` — all 28 tools implemented; optional resource fix goes here
- `src/server/index.ts` — `sendResourceListChanged()` wired, polling instructions active
ts) exposed via the tool

### Gap 2: `WORKFLOW_CHANNEL_INSTRUCTIONS` is misleading

Current instructions say "events arrive in real-time as workflow steps complete. You don't need to poll." This is incorrect — notifications don't arrive in practice.

**Fix needed**: Update instructions to say poll `brain_workflow_events` after each `brain_workflow_signal` or periodically.

### Gap 3: MCP resources not registered

The task description requested MCP resources as one replacement strategy. Resources would allow `notifications/resources/list_changed` to hint the coordinator to re-fetch.

**Fix needed** (optional / lower priority): Register `brain://workflow/runs` as an MCP resource; call `server.sendResourceListChanged()` from `channelPush` lambda.

## Recommendations for Implementation Phase

1. **Fix channel instructions** (high value, trivial effort): Update `WORKFLOW_CHANNEL_INSTRUCTIONS` in `channel.ts` — owned by parallel worker, flag to coordinator
2. **Enhance event polling** (medium value, low effort): Extend `brain_workflow_events` to include step-level events from an in-memory log on `WorkflowRuntime`
3. **MCP resources** (low priority): Skip or defer; polling tool covers the use case adequately

## Implementation Ownership

Files within scope:
- `src/server/mcp.ts` — owned, all 10 tools already implemented
- `src/server/index.ts` — owned, SSE path working; `channelPush` lambda could call `sendResourceListChanged()`

Files needing changes but read-only:
- `src/modules/workflow/runtime/channel.ts` — update `WORKFLOW_CHANNEL_INSTRUCTIONS`; coordinator must sequence this

## Knowledge Gaps

1. Whether `sendResourceListChanged()` is available on `McpServer` (SDK v1.27.1+) — needs verification before implementing
2. Whether step-level event persistence is needed for current workflow use cases or if run-level polling suffices
