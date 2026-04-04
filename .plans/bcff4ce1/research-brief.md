# Research Brief: VNM-42.159

Plan: bcff4ce1 | Project: VNM

## Current Implementation State (as of 2026-04-04)

All 10 originally-missing tools have been implemented. The MCP server now registers **28 tools** across 7 groups.

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

### Server entry (`src/server/index.ts`)

- `startMcpServer()` — MCP-only (stdio transport)
- `startMcpServerWithService()` — combined HTTP+MCP
- `initV2Runtime()` — registers `WorkflowChannel` push + SSE broadcast
- SSE broadcast works via `broadcast(sseClients, 'workflow', {...})` — dashboard path is healthy
- Channel push still uses `notifications/claude/channel` (broken in Claude Code) — fire-and-forget

### Channel Notification Status

**`brain_workflow_events` (implemented)** — Polls `workflow_runs` table directly via `rawDb`:
- Accepts `instanceId`, `since` (ISO timestamp), `limit`
- Returns snapshot of workflow runs with cursor for incremental polling
- Documented as reliable alternative to push notifications
- `WORKFLOW_CHANNEL_INSTRUCTIONS` still instructs passive listening — could be updated

**`notifications/claude/channel` (broken, kept as-is)** — fire-and-forget via `WorkflowChannel.push()`:
- GitHub issues #40729, #36802, #41733 confirm silent failures
- Still emitted but not relied upon
- No MCP resources (`notifications/resources/list_changed`) were added

### What Was NOT Done

1. **MCP Resources** — `notifications/resources/list_changed` not implemented; no `brain://workflow/{instanceId}` resources registered
2. **`WORKFLOW_CHANNEL_INSTRUCTIONS` update** — still says "events arrive in real-time, no polling needed" even though polling via `brain_workflow_events` is the actual reliable path
3. **Event ring buffer** — `brain_workflow_events` queries SQLite `workflow_runs` table (not step events); step-level events (step_complete, step_failed, assisted_step) are NOT persisted and cannot be polled

## Remaining Gaps

### Gap 1: Step-level events not pollable

`brain_workflow_events` returns workflow run rows (`status`, `current_step`) but not discrete step events. The coordinator cannot distinguish `step_complete` from `step_failed` from `assisted_step` via polling — it only sees the current workflow state.

**Fix needed**: Either:
- Add a `workflow_step_events` table and log events there, exposed via `brain_workflow_events`
- Or update `WorkflowRuntime` to maintain an in-memory event log (last N events) exposed via the tool

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
