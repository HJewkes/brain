# Research: MCP Server Hardening (VNM-42.179)

Plan: bcff4ce1 | Task: VNM-42.179 (re-run; originally VNM-42.163)

## Current State (post-implementation audit)

### Workstream 1: CLI-to-MCP Migration — COMPLETE

All 10 tools from the task description are now registered in `src/server/mcp.ts` (commit 9dd3849):

| Tool | Handler | Status |
|------|---------|--------|
| `brain_pm_task_add` | `createTask()` from `task-ops.ts` | ✓ Implemented |
| `brain_note_add` | write file + `indexSingleFile()` | ✓ Implemented |
| `brain_note_list` | `svc.db.getAllNotes()` + filter | ✓ Implemented |
| `brain_pm_context` | `getTask()` + `getPmNotes()` + sessions + relations | ✓ Implemented |
| `brain_pm_wave` | `computeWaves(db, prefix)` | ✓ Implemented |
| `brain_pm_capture` | `svc.db.addInboxItem()` with PM prefix | ✓ Implemented |
| `brain_pm_workstream_list` | `listWorkstreams(db, prefix)` | ✓ Implemented |
| `brain_pm_workstream_add` | `createWorkstream()` | ✓ Implemented |
| `brain_session_show` | `svc.sessionDetail(displayId)` | ✓ Implemented |
| `brain_memory_add` | `svc.db.addMemory()` + `MemoryEntry` construct | ✓ Implemented |

Total MCP tools registered: **27** (up from 17)

Tool registration structure:
- `registerSearchTools` — brain_search, brain_note_read, brain_memory_search, brain_memory_list
- `registerNoteTools` — brain_note_list, brain_note_add
- `registerMemoryTools` — brain_memory_add
- `registerPmTools` — brain_pm_task_list, brain_pm_task_show, brain_pm_task_update, brain_pm_next, brain_pm_overview
- `registerPmExtTools` — brain_pm_task_add, brain_pm_workstream_list, brain_pm_workstream_add, brain_pm_wave, brain_pm_context, brain_pm_capture
- `registerSessionAgentTools` — brain_session_list, brain_agent_list, brain_session_show, brain_inbox_add
- `registerDispatchTools` — brain_agent_dispatch, brain_agent_status
- `registerWorkflowTools` — brain_workflow_start, brain_workflow_status, brain_workflow_signal, brain_workflow_events

---

### Workstream 2: Channel Notification Fix — PARTIAL

#### What's done

`brain_workflow_events` polling tool (line 776–836 in mcp.ts) — queries `workflow_runs` table directly:
- Accepts `instanceId`, `since` (ISO timestamp), `limit`
- Returns snapshot of workflow runs with a cursor for incremental polling
- Works as a reliable fallback; does not depend on broken notification path

#### What remains broken

`notifications/claude/channel` in `src/modules/workflow/runtime/channel.ts`:
- Still uses the broken `notifications/claude/channel` notification method
- GitHub issues #40729, #36802, #41733 confirm these are silently dropped
- `WORKFLOW_CHANNEL_INSTRUCTIONS` still tells coordinator to passively listen for `<channel>` tags — which never arrive
- File is **read-only** (owned by another worker) — cannot be modified directly

`sendResourceListChanged()` in `src/server/index.ts`:
- The `channelPush` lambda does NOT call `server.sendResourceListChanged()`
- This is the standard MCP notification path that Claude Code reliably delivers
- File IS owned by this worker — this addition has NOT been made yet

#### Gap: `sendResourceListChanged` not wired

The `initV2Runtime` function in `src/server/index.ts` defines `channelPush`:
```ts
channelPush: (event: string, meta: Record<string, string>) => {
  channel.push(event, meta);          // broken for MCP-to-coordinator
  if (sseClients?.size) {             // works for dashboard
    broadcast(sseClients, 'workflow', { event, ...meta });
    broadcast(sseClients, 'refresh', {});
  }
}
```

Missing: `server.sendResourceListChanged()` call after `channel.push()`.

To add this, the `server` reference must be threaded into `initV2Runtime`. Currently `server` is created in `startMcpServer()` / `startMcpServerWithService()` and passed to `initV2Runtime` already — it's the first parameter.

#### Gap: WORKFLOW_CHANNEL_INSTRUCTIONS not updated

`WORKFLOW_CHANNEL_INSTRUCTIONS` in `channel.ts` (read-only) still says "events arrive in real-time, you don't need to poll." This is false. The coordinator should be polling `brain_workflow_events` instead.

Since `channel.ts` is read-only:
- The instructions can be overridden in `mcp.ts` via the `instructions` option passed to `McpServer`
- Or a local constant can shadow/replace it in `src/server/index.ts`

---

## Implementation Plan for Remaining Work

### Change 1: Wire `sendResourceListChanged` in `src/server/index.ts`

In `initV2Runtime`, add the resource notification after `channel.push`:

```ts
channelPush: (event: string, meta: Record<string, string>) => {
  channel.push(event, meta);
  // Standard MCP notification — reliably delivered by Claude Code
  server.server.sendResourceListChanged().catch(() => {});
  if (sseClients?.size) { ... }
}
```

The `server` variable is already in scope — no signature changes needed.

### Change 2: Update coordinator instructions

Either override `WORKFLOW_CHANNEL_INSTRUCTIONS` locally in `index.ts`, or create a new constant in `mcp.ts`:

```ts
const UPDATED_CHANNEL_INSTRUCTIONS = `
Events from the brain workflow engine:
- Poll brain_workflow_events to check for updates.
- Pass "cursor" from previous response as "since" for incremental polling.
- On resource list change notification: re-poll brain_workflow_events immediately.
- Assisted steps: use brain_workflow_signal with action "complete" when done.
`.trim();
```

### Change 3 (optional): Register workflow resources

For `sendResourceListChanged` to be meaningful, register a resource:
```ts
server.resource('workflow-events', 'brain://workflow/events', async () => ({
  contents: [{ uri: 'brain://workflow/events', text: 'Use brain_workflow_events tool to fetch events.' }]
}));
```

---

## Risk Assessment

| Risk | Severity | Mitigation |
|------|----------|------------|
| `sendResourceListChanged` may not trigger coordinator re-poll in practice | Medium | `brain_workflow_events` polling is the primary path — resource notification is a hint |
| `brain_workflow_events` queries `workflow_runs` table which may not exist in all DB states | Low | SQL query will return empty results gracefully |
| `brain_note_add` writes to `config.notesDir` which may be misconfigured | Low | Already handled by existing indexing conventions |
| `brain_pm_context` returns relations from notes table — may miss PM private notes | Low | `getPmNotes` is PM-aware |

---

## Summary

**Done**: All 10 CLI-to-MCP tools are implemented. `brain_workflow_events` polling exists.

**Remaining**: 
1. Wire `server.sendResourceListChanged()` into `channelPush` lambda in `src/server/index.ts`
2. Update coordinator instructions to prioritize polling over passive channel listening
3. (Optional) Register a `brain://workflow/events` resource for the resource notification to reference
