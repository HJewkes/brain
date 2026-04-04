# Research Brief: VNM-42.19

Plan: bcff4ce1 | Project: VNM

## Existing Code

### MCP Server (`src/server/mcp.ts`)

Currently registers **17 tools** across 5 groups:

| Group | Tools |
|-------|-------|
| Search | `brain_search`, `brain_note_read`, `brain_memory_search`, `brain_memory_list` |
| PM | `brain_pm_task_list`, `brain_pm_task_show`, `brain_pm_task_update`, `brain_pm_next`, `brain_pm_overview` |
| Session/Agent | `brain_session_list`, `brain_agent_list`, `brain_inbox_add` |
| Dispatch | `brain_agent_dispatch`, `brain_agent_status` |
| Workflow | `brain_workflow_start`, `brain_workflow_status`, `brain_workflow_signal` |

### Server entry (`src/server/index.ts`)

- `startMcpServer()` — MCP-only (stdio transport)
- `startMcpServerWithService()` — combined HTTP+MCP
- `initV2Runtime()` — registers `WorkflowChannel` push + SSE broadcast
- SSE broadcast works via `broadcast(sseClients, 'workflow', {...})` — dashboard path is healthy
- Channel push uses `notifications/claude/channel` — broken in Claude Code

### Channel notification (`src/modules/workflow/runtime/channel.ts`)

- `WorkflowChannel.push()` calls `server.server.notification({ method: 'notifications/claude/channel', ... })`
- GitHub issues #40729, #36802, #41733 confirm these are silently dropped in Claude Code
- The `WORKFLOW_CHANNEL_INSTRUCTIONS` tells the coordinator to listen for `<channel source="brain" event="...">` tags — never arrives

### Functions available for missing tools

**`brain_pm_task_add`**
- `createTask(db, config, embedder, input: CreateTaskInput)` → `Result<TaskMetadata>`
- `src/modules/pm/data/task-ops.ts:187`
- Inputs: `project`, `workstream` (number), `name`, `description` (required), plus optional `mode`, `category`, `priority`, `dependsOn[]`, `dueDate`, `milestone`, `doneWhen`, `acceptanceCriteria[]`, `references[]`

**`brain_pm_workstream_list`**
- `listWorkstreams(db, prefix)` → `Result<WorkstreamMetadata[]>`
- `src/modules/pm/data/workstream-ops.ts:93` (already imported in `registerPmTools` for `brain_pm_overview`)

**`brain_pm_workstream_add`**
- `createWorkstream(db, config, embedder, input: CreateWorkstreamInput)` → `Result<WorkstreamMetadata>`
- `src/modules/pm/data/workstream-ops.ts:93`
- Inputs: `project`, `name`, optional `description`

**`brain_pm_context`** (rich task context bundle)
- `buildAgentDispatchContext(db, taskDisplayId)` → `AgentDispatchContext | null`
- `src/modules/agents/dispatch-context.ts:49`
- Returns: task title, body, workstream, prompt, dependencies, decisions, constraints, waveInfo, routing, fileOwnership

**`brain_pm_wave`** (dependency-ordered dispatch waves)
- `computeWaves(db, prefix)` → `WaveAssignment[]`
- `src/modules/pm/engine/dependency.ts:191`
- Returns array of `{ wave: number, taskIds: string[] }` — topological wave grouping

**`brain_pm_capture`** (lightweight intake)
- `createCapture(db, config, embedder, input: CaptureInput)` → `Result<CaptureRecord>`
- `src/modules/pm/data/capture-ops.ts:56`
- Inputs: `content` (required), optional `source`, `project`
- Distinct from `brain_inbox_add` — PM-aware, writes to `modules/pm/captures/`, indexes

**`brain_note_add`**
- No dedicated "add note" service method yet
- Pattern: write markdown file to `config.notesDir`, call `indexSingleFile(db, embedder, filePath, markdown, hash, mtime)`
- `src/services/indexing.ts` exports `indexSingleFile`
- Need to: construct frontmatter, resolve path from `type`+`tier`, write file, index it
- Simplest approach: write to `~/brain/<type>/<slug>.md`, then index

**`brain_note_list`**
- `svc.db.getAllNotes()` → `NoteRecord[]` (all notes, no filtering by module or visibility)
- Filter by `note.type` and/or `note.tier` in application layer
- `src/services/repos/note-repo.ts:85`
- Should exclude PM private notes (filter `module !== 'pm'` or `visibility !== 'private'`) unless caller opts in

**`brain_session_show`**
- `svc.sessionGet(displayId)` → `SessionMetadata | null`
- Already implemented in `BrainServiceClass` at `src/services/brain-service.ts:171`
- Not yet exposed as MCP tool

**`brain_memory_add`**
- `svc.db.addMemory(entry: MemoryEntry)` → void
- `src/services/brain-db.ts:709`
- Need to construct `MemoryEntry` with required fields: `id`, `memory`, `sourceNoteId`, `sourceChunkId`, `containerTag`, `category`, `isLatest`, `parentMemoryId`, `rootMemoryId`, `relationType`, `validAt`, `invalidAt`, `forgetAfter`, `isForgotten`, `isInference`, `createdAt`
- Also need to embed and store the vector for search to work
- `src/services/repos/memory-repo.ts` has `addMemory` with vector upsert logic

### Channel notification analysis

The `notifications/claude/channel` push mechanism is broken for the MCP stdio transport case — Claude Code drops them silently. Two replacement strategies:

**Option A: MCP Resources + `notifications/resources/list_changed`**
- Register a resource: `brain://workflow/events` (or per-instance URIs)
- On each event, call `server.server.notification({ method: 'notifications/resources/list_changed' })`
- Claude Code should trigger a resource re-fetch, making the event visible
- Downside: the coordinator must call `resources/read` to get the event — not a push

**Option B: `brain_workflow_events` polling tool**
- Add a tool that returns events since a timestamp or sequence ID
- Coordinator polls: e.g. `brain_workflow_events({ since: "2024-..." })` returns array of `{ event, meta, timestamp }`
- Events stored in the `WorkflowRuntime` instance (or SQLite for persistence)
- No broken notification path; works with any client
- Coordinator's `WORKFLOW_CHANNEL_INSTRUCTIONS` updated to poll instead of passively receive

**Option C: Hybrid (recommended)**
- Implement Option B (`brain_workflow_events` tool) as the reliable fallback — always works
- Also attempt Option A resource notification as a hint (best-effort, same fire-and-forget pattern)
- Coordinator instructions updated: "poll `brain_workflow_events` periodically; treat resource change notifications as polling hints if they arrive"

The SSE dashboard path already works and should NOT be changed.

## External Findings

- MCP `notifications/resources/list_changed` is part of the MCP spec and should be reliable
- Claude Code GitHub issues confirm `notifications/claude/channel` is experimental and broken:
  - #40729: notifications silently dropped in stdio mode
  - #36802: channel capability not wired in production Claude Code builds
  - #41733: no error — just silent failure
- MCP resource subscriptions (`resources/subscribe`) are more reliable than experimental channels
- The `@modelcontextprotocol/sdk` `McpServer` class supports resource registration via `server.resource()`

## Knowledge Gaps

1. Whether `notifications/resources/list_changed` actually triggers a coordinator re-read in practice — needs validation
2. How the runtime should store events for the polling tool (in-memory ring buffer vs SQLite `workflow_events` table vs nothing — just the `stepResults` map)
3. Whether `brain_note_add` should support URL import (the task description mentions "content/URL") — that's a much heavier operation involving fetch + extraction
4. Whether `brain_memory_add` needs full embedding on the fast path — may need async option
5. The `brain_pm_context` tool overlaps with the existing dispatch path in `brain_agent_dispatch` — need clarity on whether it returns the same bundle or a lighter summary

## Recommendations

### CLI-to-MCP Migration

1. **`brain_pm_task_add`** — straightforward: zod schema wrapping `CreateTaskInput`, call `createTask()`, return `Result.data`
2. **`brain_pm_workstream_list`** — already imported; one-liner wrapping `listWorkstreams()`
3. **`brain_pm_workstream_add`** — wrap `createWorkstream()`, same pattern as task_add
4. **`brain_pm_capture`** — wrap `createCapture()`, distinct from `brain_inbox_add` (PM-aware vs generic)
5. **`brain_pm_context`** — wrap `buildAgentDispatchContext()`, return full `AgentDispatchContext`; import is async (dynamic import needed or move to static)
6. **`brain_pm_wave`** — wrap `computeWaves()`, takes prefix, returns wave assignments
7. **`brain_session_show`** — wrap `svc.sessionGet(displayId)`, simplest of all
8. **`brain_note_list`** — `getAllNotes()` + filter by type/tier; exclude PM private notes by default
9. **`brain_note_add`** — write file to notesDir + `indexSingleFile()`; start with content-only (skip URL import for now)
10. **`brain_memory_add`** — construct `MemoryEntry` with UUID; embed via `svc.embedder.embed([memory])` then call `addMemory`

### Channel Notification Fix

- **Primary fix**: Add `brain_workflow_events` polling tool. Store events in a ring buffer on the `WorkflowRuntime` instance (last 500 events, keyed by sequence ID or timestamp). Tool accepts `since` (ISO timestamp or sequence number).
- **Secondary fix**: Replace `notifications/claude/channel` with `notifications/resources/list_changed` as a best-effort hint. Register `brain://workflow/events` resource.
- **Update `WORKFLOW_CHANNEL_INSTRUCTIONS`** to instruct polling rather than passive listening.
- **Do NOT touch the SSE broadcast path** in `src/server/index.ts` — it works for the dashboard.

### Implementation order (suggested for next step)

1. Add simple read-only tools first: `brain_pm_workstream_list`, `brain_session_show`, `brain_pm_wave`, `brain_note_list`
2. Add write tools: `brain_pm_task_add`, `brain_pm_workstream_add`, `brain_pm_capture`, `brain_memory_add`
3. Add context bundle: `brain_pm_context` (involves dynamic import of agents module)
4. Add note creation: `brain_note_add` (file I/O + indexing)
5. Fix channel: add event ring buffer to runtime, `brain_workflow_events` tool, update instructions

## Suggested Interview Questions

1. Should `brain_note_add` support URL import in this phase, or content-only? URL import requires fetch + extraction pipeline and is much more complex.
2. For `brain_memory_add`, should embedding happen synchronously (blocking response) or fire-and-forget? The embedding call can take 100-500ms with Ollama.
3. For `brain_pm_context`, should it return the full `AgentDispatchContext` (same as dispatch path) or a lighter summary? The full context includes file ownership, breaking changes, architecture indexing — is that needed over MCP?
4. For the `brain_workflow_events` ring buffer, should events persist across server restarts (SQLite) or in-memory only? In-memory is simpler but drops events on restart.
5. Is there a budget/priority concern about testing `notifications/resources/list_changed` in practice before committing to that path?
