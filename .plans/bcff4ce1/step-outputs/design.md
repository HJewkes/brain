**Design approach:** Both primary workstreams (CLI-to-MCP migration and channel notification fix) are already complete per the research phase. The only remaining gap is MCP spec compliance: the server declares `capabilities: { tools: {} }` but omits `resources: {}`, so `sendResourceListChanged()` may be silently ignored by clients. The fix is two small additions to `src/server/mcp.ts` (owned): add `resources: {}` to capabilities and register a `brain://workflow/runs` resource in `registerWorkflowTools`.

**Files:** 1 file to modify (`src/server/mcp.ts`). No new files.

**Changes:**

1. **`createBrainMcpServer` — add `resources: {}` capability** (line ~851):
   ```ts
   capabilities: {
     tools: {},
     resources: {},   // declare so clients subscribe to list_changed notifications
     ...(options?.channelInstructions ? { experimental: { 'claude/channel': {} } } : {}),
   },
   ```

2. **`registerWorkflowTools` — register `brain://workflow/runs` resource** (after existing tool registrations, before closing brace):
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

**Acceptance criteria:**
1. `createBrainMcpServer` capabilities object includes `resources: {}`
2. `brain://workflow/runs` resource is registered and readable
3. `sendResourceListChanged()` fires on every workflow event (already wired in `src/server/index.ts`)
4. All existing tests pass (no regressions)
5. TypeScript compiles with no errors

**Key decisions:**
- Register resource in `registerWorkflowTools` (not a separate function) — keeps workflow-related registration co-located
- Resource content is instructional text pointing to the polling tool, not live data — keeps resource handler trivial and avoids DB access in resource reads
- `resources: {}` is unconditional — not gated on `channelInstructions` option — because resources are a permanent server capability

**Open questions:**
None. The fix is well-scoped and self-contained.

DONE VNM-42.219 Design: add resources capability + brain://workflow/runs resource to mcp.ts for sendResourceListChanged compliance
