# Research: MCP Server Hardening (VNM-42.17)

## Current MCP Tool Inventory (src/server/mcp.ts)

17 tools already registered across 5 groups:

**Search:** `brain_search`, `brain_note_read`, `brain_memory_search`, `brain_memory_list`  
**PM:** `brain_pm_task_list`, `brain_pm_task_show`, `brain_pm_task_update`, `brain_pm_next`, `brain_pm_overview`  
**Session/Agent:** `brain_session_list`, `brain_agent_list`, `brain_inbox_add`  
**Dispatch:** `brain_agent_dispatch`, `brain_agent_status`  
**Workflow:** `brain_workflow_start`, `brain_workflow_status`, `brain_workflow_signal`

## Missing Tools — Implementation Mapping

All 10 have existing backend functions. No new business logic required.

| Tool | Backend function | File |
|------|-----------------|------|
| `brain_pm_task_add` | `createTask(db, config, embedder, input)` | `src/modules/pm/data/task-ops.ts:187` |
| `brain_note_add` | `indexSingleFile` + `writeFileSync` | `src/services/indexing.ts:128` |
| `brain_note_list` | `db.getAllNotes()` filtered by type/tier | `src/services/repos/note-repo.ts:85` |
| `brain_pm_context` | Compose: `getTask` + `listTasks` (deps) + `getSessionsForTask` + `searchMemories` | Multiple |
| `brain_pm_wave` | `computeWaves(db, prefix)` | `src/modules/pm/engine/dependency.ts:191` |
| `brain_pm_capture` | Same as `brain_inbox_add` but with PM tags/metadata | `src/services/brain-db.ts:709` |
| `brain_pm_workstream_list` | `listWorkstreams(db, prefix)` | `src/modules/pm/data/workstream-ops.ts:136` |
| `brain_pm_workstream_add` | `createWorkstream(db, config, embedder, input)` | `src/modules/pm/data/workstream-ops.ts:93` |
| `brain_session_show` | `svc.sessionDetail(displayId)` | `src/services/brain-service.ts:345` |
| `brain_memory_add` | `svc.db.addMemory(entry)` | `src/services/brain-db.ts:709` |

### Tool-specific notes

**brain_pm_task_add** — `CreateTaskInput` requires: `project`, `workstream` (number), `name`, `description`. Optional: `mode`, `category`, `priority`, `dependsOn[]`, `dueDate`, `milestone`, `doneWhen`, `acceptanceCriteria[]`, `references[]`. Function writes a markdown file, indexes it, and returns `Result<TaskMetadata>`.

**brain_note_add** — Needs to write a temp/inbox file then call `indexSingleFile`. Simplest path: write to inbox dir and call `indexSingleFile`. Alternative: reuse `brain_inbox_add` flow (already captures content without indexing). For URL ingestion, the import pipeline exists but is complex; suggest supporting `content` param only in v1, URL as stretch goal.

**brain_note_list** — `db.getAllNotes()` returns all `NoteRecord[]`. Filter by `type` and/or `tier` fields. Exclude module-private notes (where `visibility = 'private'` or `module != null`) unless caller opts in. Cap default at 50.

**brain_pm_context** — Compose in one call:
1. `getTask(db, displayId)` — task metadata
2. `listTasks(db, prefix)` filtered by `display_id IN task.depends_on` — blocking tasks
3. `getSessionsForTask(db, displayId)` — recent sessions
4. `searchMemories(db, embedder, task.title, 5, containerTag)` — relevant memories

**brain_pm_wave** — `computeWaves(db, prefix)` returns `WaveAssignment[]` with `{ wave: number, taskIds: string[] }`. Need to resolve `prefix` from param. Add task metadata enrichment (title, status, priority) per task ID.

**brain_pm_capture** — Lightweight: same `InboxItem` structure as `brain_inbox_add` but could accept optional `tags` and `project` fields for downstream routing. Functionally identical to `brain_inbox_add`; may be an alias with extended params.

**brain_pm_workstream_add** — `createWorkstream` is async (calls `indexSingleFile`). `BrainServiceClass` doesn't wrap it yet — needs direct call with `svc.db`, `svc.config`, `svc.embedder`.

**brain_session_show** — `svc.sessionDetail(displayId)` exists and returns full `SessionDetailData`. Truncate turns list to avoid huge responses (default last 10).

**brain_memory_add** — `db.addMemory(entry: MemoryEntry)` requires: `id` (UUID), `memory` (string), `sourceNoteId` (nullable), `containerTag` (nullable), `createdAt`, `validUntil` (nullable), `confidence` (nullable). Simple wrapper.

## Channel Notification Analysis

### Current implementation
`WorkflowChannel.push()` in `src/modules/workflow/runtime/channel.ts:18` fires:
```
notifications/claude/channel  (experimental)
```
This is fire-and-forget (`.catch(() => {})`). According to GitHub issues #40729, #36802, #41733, Claude Code silently drops these notifications — they never reach the coordinator session.

### What works
The SSE path in `src/server/index.ts:28-38` using `broadcast(sseClients, 'workflow', ...)` works correctly for the dashboard. `channelPush` is a composite that calls both `channel.push()` (MCP) and `broadcast()` (SSE).

### Fix strategy

**Option A: MCP Resources (standards-compliant)**
- Expose workflow runs as MCP resources: `brain://workflows/{instanceId}`
- Send `notifications/resources/list_changed` when status changes
- Coordinator polls `resources/read` on notification
- Pro: standards-compliant. Con: coordinator must implement resource read logic; list_changed still needs coordinator to act on notification.

**Option B: Polling tool `brain_workflow_events` (pragmatic)**
- Maintain an in-memory event log (circular buffer, last N events)
- Tool accepts `since` (ISO timestamp or sequence number) and returns events since that point
- Coordinator polls on a schedule or after each tool response
- Pro: works today, no dependency on notification delivery. Con: coordinator must poll.

**Option C: Hybrid (recommended)**
- Keep `channel.push()` as best-effort (no change to existing code)
- Add `brain_workflow_events` polling tool for reliable delivery
- Add MCP resource exposure for workflow runs (triggers `notifications/resources/list_changed`)
- Coordinator uses polling as primary, treats channel push as acceleration

### Event log design for Option B/C
Store events in `WorkflowRuntime` as an append-only array:
```typescript
interface WorkflowEvent {
  seq: number;      // monotonic sequence
  instanceId: string;
  event: string;    // step_complete | workflow_complete | step_failed | assisted_step
  meta: Record<string, string>;
  timestamp: string;
}
```
`brain_workflow_events(since?: number)` returns events with `seq > since`. Coordinator tracks last seen `seq`.

Cap at 1000 events in memory (rolling window). No DB required.

## Key Findings

1. **10 missing tools are thin wrappers** — all backend functions exist, registration is the only work.
2. **`brain_note_add` is the most complex** — file write + indexing pipeline; scope to `content` param only.
3. **`brain_pm_context` needs composition** — 4 parallel queries, no new data access needed.
4. **`brain_pm_capture` can alias `brain_inbox_add`** with extended params, or be identical.
5. **Channel notifications are provably broken** — event log + polling tool is the right fix.
6. **Hybrid approach for notifications** — add `brain_workflow_events` without removing existing push attempt.
7. **No schema migrations needed** — event log lives in `WorkflowRuntime` memory.
8. **`BrainServiceClass` needs 3 new wrapper methods** for workstream_add, pm_task_add, pm_wave — to keep MCP handlers thin.

## Implementation Order (suggested)

1. Simple getters first: `brain_note_list`, `brain_pm_workstream_list`, `brain_session_show`, `brain_memory_add`
2. Composed reads: `brain_pm_context`, `brain_pm_wave`
3. Mutations: `brain_pm_task_add`, `brain_pm_workstream_add`, `brain_pm_capture`
4. Write pipeline: `brain_note_add`
5. Event system: in-memory log in `WorkflowRuntime`, `brain_workflow_events` tool
6. MCP resource exposure (stretch): workflow runs as resources

## Knowledge Gaps

1. Should `brain_note_list` expose private/module notes (PM tasks, sessions)? Default exclude is safer.
2. Should `brain_pm_capture` be a distinct tool or just alias `brain_inbox_add`?
3. For `brain_memory_add` — should `containerTag` be required to avoid orphaned memories?
4. MCP resources: does Claude Code actually honor `notifications/resources/list_changed` today?
