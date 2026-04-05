# Research: MCP Server Hardening (VNM-42.211)

Plan: bcff4ce1 | Task: VNM-42.211

## Current State (code audit 2026-04-04)

Both workstreams are **complete**. All 10 CLI-to-MCP tools are implemented and both channel notification fixes are in place.

### Workstream 1: CLI-to-MCP Migration — COMPLETE

All 10 tools from the task description are registered in `src/server/mcp.ts`. Total: **28 tools** across 8 groups.

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

---

### Workstream 2: Channel Notification Fix — COMPLETE

All three changes are in place in `src/server/index.ts`.

#### `brain_workflow_events` polling tool ✓

Registered in `src/server/mcp.ts` (lines 776–836). Queries `workflow_runs` table directly:
- Accepts `instanceId`, `since` (ISO timestamp), `limit`
- Returns run state snapshots with a cursor for incremental polling
- Primary event delivery path, independent of broken `notifications/claude/channel`

#### `sendResourceListChanged` wired ✓

`channelPush` in `initV2Runtime` calls `server.server.sendResourceListChanged()` after every workflow event (`src/server/index.ts:48`):

```ts
channelPush: (event: string, meta: Record<string, string>) => {
  channel.push(event, meta);
  // Standard MCP resource notification — reliable alternative to broken claude/channel.
  server.server.sendResourceListChanged().catch(() => {});
  if (sseClients?.size) { ... }
},
```

#### `WORKFLOW_CHANNEL_INSTRUCTIONS` updated ✓

Local constant in `src/server/index.ts` (lines 11–25) provides polling-first instructions passed to `createBrainMcpServer` via `{ channelInstructions }`. Instructs coordinator to:
1. Call `brain_workflow_events` periodically or after resource list change notifications
2. Use cursor-based incremental polling
3. Re-poll immediately on resource list change notification

The stale `WORKFLOW_CHANNEL_INSTRUCTIONS` from `channel.ts` (read-only) is effectively overridden.

---

### Remaining / Optional

**`resources` capability not declared**: `createBrainMcpServer` declares `capabilities: { tools: {} }` but not `resources: {}`. Without this, Claude Code may not subscribe to `notifications/resources/list_changed`. The `sendResourceListChanged()` call fires but may be silently ignored. This is the only remaining gap.

**No workflow resource registered**: No `brain://workflow/runs` resource URI exists. `sendResourceListChanged` fires without a corresponding resource, which is semantically incomplete per MCP spec.

Fix for both (in `src/server/mcp.ts`, `createBrainMcpServer`):

```ts
capabilities: {
  tools: {},
  resources: {},   // add this
  ...(options?.channelInstructions ? { experimental: { 'claude/channel': {} } } : {}),
},
```

And in `registerWorkflowTools`:

```ts
server.resource(
  'workflow-runs',
  'brain://workflow/runs',
  async () => ({
    contents: [{
      uri: 'brain://workflow/runs',
      mimeType: 'application/json',
      text: 'Use the brain_workflow_events tool to poll for workflow run states.',
    }],
  })
);
```

This change is low-risk and improves reliability of the `sendResourceListChanged()` hint.

---

## Risk Assessment

| Risk | Severity | Status |
|------|----------|--------|
| `sendResourceListChanged` may not trigger coordinator re-poll without `resources` capability | Medium | Fixable in mcp.ts (owned) |
| `brain_workflow_events` queries run-level not step-level data | Low | Coordinator can call `brain_workflow_status` for detail; step events deferred |
| `brain_workflow_events` queries `workflow_runs` table which may not exist in all DB states | Low | Returns empty results gracefully |

---

## Summary

**Done**: All 10 CLI-to-MCP tools implemented (28 total). `brain_workflow_events` polling tool registered. `sendResourceListChanged()` wired into `channelPush`. `WORKFLOW_CHANNEL_INSTRUCTIONS` updated to polling-first via local override.

**Remaining for implementation phase** (owned, in `src/server/mcp.ts`):
1. Add `resources: {}` to `capabilities` in `createBrainMcpServer`
2. Register `brain://workflow/runs` resource in `registerWorkflowTools`
versions | Medium | Mitigated — polling is primary path; notification is a hint |
| `brain_workflow_events` queries `workflow_runs` table in all DB states | Low | Returns empty results gracefully |
| `brain_note_add` writes to `config.notesDir` | Low | Handled by existing indexing conventions |
| No registered resource for `brain://workflow/events` | Low | Non-blocking; tool polling works without it |

---

## Summary

**Both workstreams are complete** as of recent changes to `src/server/index.ts` and `src/server/mcp.ts`:

1. All 10 CLI-to-MCP tools implemented (27 total tools)
2. `brain_workflow_events` polling tool registered
3. `sendResourceListChanged()` wired into `channelPush`
4. `WORKFLOW_CHANNEL_INSTRUCTIONS` updated to polling-first via local override

The only remaining item is the optional `brain://workflow/events` resource registration for MCP spec completeness.
er workflow resources

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
