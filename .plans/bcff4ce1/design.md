# Design: MCP Server Hardening

## Approach

The MCP server is hardened across two workstreams. The first extends tool coverage from the original 18 tools to 28 by wiring existing CLI handler functions into MCP tool registrations — no new business logic. Each tool group is isolated in a `register*Tools` function in `src/server/mcp.ts`. The second fixes the broken `notifications/claude/channel` path by: (a) adding a `brain_workflow_events` polling tool as the reliable primary path, (b) firing `sendResourceListChanged()` on every workflow event as a hint to trigger immediate re-polling, and (c) overriding `WORKFLOW_CHANNEL_INSTRUCTIONS` in `src/server/index.ts` with polling-first guidance.

One remaining gap: the server declares `capabilities: { tools: {} }` without `resources: {}`, meaning clients may not subscribe to `notifications/resources/list_changed`. Fixing this requires adding the capability declaration and registering a `brain://workflow/runs` resource so the `sendResourceListChanged()` calls are semantically valid per MCP spec.

Both files are owned by this task. All 28 tools and the polling instruction override are already implemented; only the resources capability and resource registration remain.

## Files to Create/Modify

| Action | Path | Purpose |
|--------|------|---------|
| Modify | `src/server/mcp.ts` | Add `resources: {}` to capabilities; register `brain://workflow/runs` resource |
| Modify | `src/server/index.ts` | Already complete — `sendResourceListChanged()` wired, instructions overridden |

No new files. No test files (existing integration tests cover the tool surface).

## API Shapes / Type Signatures

### Resources capability (in `createBrainMcpServer`)

```typescript
capabilities: {
  tools: {},
  resources: {},  // add this
  ...(options?.channelInstructions ? { experimental: { 'claude/channel': {} } } : {}),
},
```

### Workflow resource (in `registerWorkflowTools`)

```typescript
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

### `brain_workflow_events` tool schema (already implemented)

```typescript
{
  instanceId: z.string().optional(),  // filter by instance
  since: z.string().optional(),       // ISO timestamp cursor
  limit: z.number().optional(),       // default 20
}
// returns: { events: WorkflowRunSnapshot[], cursor: string, hint: string }
```

### `WORKFLOW_CHANNEL_INSTRUCTIONS` (in `src/server/index.ts`, already implemented)

Overrides the stale `channel.ts` default. Tells coordinator to:
1. Call `brain_workflow_events` periodically or on resource list change
2. Use cursor for incremental updates
3. Re-poll immediately on `notifications/resources/list_changed`

## Data Flow

```
Workflow step completes
  → WorkflowRuntime.channelPush(event, meta)
    → WorkflowChannel.push(event, meta)          # broken claude/channel (kept for compat)
    → server.server.sendResourceListChanged()     # hint: re-poll now
    → broadcast(sseClients, 'workflow', ...)      # dashboard SSE path
  
Coordinator receives notifications/resources/list_changed
  → calls brain_workflow_events { since: cursor }
  → reads run snapshots from workflow_runs table
  → updates local understanding of workflow state
```

## Key Decisions

| Decision | Chosen | Alternative | Rationale |
|----------|--------|-------------|-----------|
| Event delivery | Polling (`brain_workflow_events`) | Push (`notifications/claude/channel`) | Claude Code silently drops channel notifications (3 open GH issues); polling is reliable |
| Event granularity | Run-level (from `workflow_runs` table) | Step-level (in-memory log) | Run-level covers current use cases; step-level deferred until needed |
| Resource URI | `brain://workflow/runs` | `brain://workflow/events` | Runs table is the source; "runs" is more accurate than "events" |
| Resources capability | Add to `createBrainMcpServer` | Skip (rely on tool polling alone) | Semantically required for `sendResourceListChanged()` to be valid per MCP spec |
| Instruction override | Local const in `index.ts` | Modify `channel.ts` | `channel.ts` is read-only (owned by parallel workers); local override achieves same effect |

## Risks and Mitigations

| Risk | Severity | Mitigation |
|------|----------|------------|
| `sendResourceListChanged()` silently ignored without `resources` capability | Medium | Fix by adding `resources: {}` to capabilities |
| `workflow_runs` table missing in fresh DBs | Low | `brain_workflow_events` query returns empty gracefully |
| `McpServer.server.sendResourceListChanged` unavailable in old SDK versions | Low | SDK v1.27.1 confirmed in package.json; `.catch(() => {})` suppresses any error |
| MCP resource read returns stale instructions | Low | Resource body directs to `brain_workflow_events` tool; actual data always comes from tool |

## Scaffolding vs. Implementation

- **Already complete (wave 1):** All 28 tool registrations, `brain_workflow_events` polling tool, `sendResourceListChanged()` wired in `channelPush`, `WORKFLOW_CHANNEL_INSTRUCTIONS` overridden
- **Remaining (single change):** Add `resources: {}` capability + register `brain://workflow/runs` resource in `src/server/mcp.ts`

This is a single-file, two-line change in `registerWorkflowTools` and a one-line addition to `createBrainMcpServer`. No waves needed.

## PR Boundaries

- **Option A:** One PR for everything (the entire hardening — already the existing branch state)
- **Option B:** Separate PR for resource capability fix

**Recommendation:** Option A. The resources capability fix is a two-line addition completing an already-merged change set. It belongs in the same PR as the rest of the hardening work.
