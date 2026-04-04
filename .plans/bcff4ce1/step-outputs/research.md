# Research Brief: MCP Server Hardening (VNM-42.20)

## Scope

Two parallel workstreams:
1. **CLI-to-MCP Migration** — expose 10 new tools in `src/server/mcp.ts`
2. **Channel Notification Fix** — replace broken `notifications/claude/channel` with reliable alternatives

---

## Workstream 1: CLI-to-MCP Migration

### Current Tool Inventory (already registered)

`brain_search`, `brain_note_read`, `brain_memory_search`, `brain_memory_list`,
`brain_pm_task_list`, `brain_pm_task_show`, `brain_pm_task_update`, `brain_pm_next`,
`brain_pm_overview`, `brain_session_list`, `brain_agent_list`, `brain_inbox_add`,
`brain_agent_dispatch`, `brain_agent_status`, `brain_workflow_start`,
`brain_workflow_status`, `brain_workflow_signal`

### Missing Tools — Handler Mapping

#### 1. `brain_pm_task_add`
- **Handler**: `createTask(db, config, embedder, input: CreateTaskInput)` → `Result<TaskMetadata>`
- **File**: `src/modules/pm/data/task-ops.ts`
- **Input schema** (CreateTaskInput):
  - `project: string` — prefix e.g. "VNM"
  - `workstream: number` — workstream number
  - `name: string` — task title
  - `description: string` — required (tasks without body content are invisible to search)
  - `mode?: TaskMode` — default 'auto'
  - `category?: TaskCategory` — default 'implementation'
  - `priority?: TaskPriority` — default 'medium'
  - `dependsOn?: string[]` — display IDs e.g. ["VNM-42.19"]
  - `dueDate?, milestone?, doneWhen?, acceptanceCriteria?, references?`

#### 2. `brain_note_add`
- **Handler**: write markdown to file + `indexSingleFile(db, embedder, filePath, content, hash, mtime)`
- **File**: `src/services/indexing.ts`
- **Approach**: write to `config.notesDir/<tier>/<type>/<slug>.md`, then index
- **Input schema**: `{ title: string, content: string, type?: string, tier?: 'fast'|'slow', tags?: string[] }`
- **Note**: URL import is too complex (extraction pipeline); for URL capture use `brain_inbox_add`

#### 3. `brain_note_list`
- **Handler**: `svc.db.getAllNotes()` → `NoteRecord[]`, then filter by type/tier/module
- **Alt for module notes**: `svc.db.getModuleNoteIds({ module, type })` + `getNotesByIds()`
- **Input schema**: `{ type?: string, tier?: string, module?: string, limit?: number }`

#### 4. `brain_pm_context`
- **Handler**: composite — combines task + workstream + sessions + agents
- **Sources**:
  - Task: `getTask(db, displayId)`
  - Workstream: `getWorkstream(db, wsDisplayId)` from `src/modules/pm/data/workstream-ops.ts`
  - Sessions: `getSessionsForTask(db, displayId)` from `src/modules/sessions/data/session-ops.ts`
  - Agents: `svc.agentList().filter(a => a.brain_task === displayId)` (client-side filter — listAgents has no brain_task filter)
  - Body: read task file content
- **Input schema**: `{ displayId: string }`

#### 5. `brain_pm_wave`
- **Handler**: `computeEligible(db, prefix)` from `src/modules/pm/engine/dependency.ts`
  - Returns `string[]` of display IDs with satisfied dependencies
  - Already imported in `mcp.ts` (used by `brain_pm_overview`)
- **Input schema**: `{ prefix?: string, workstream?: string, limit?: number }`

#### 6. `brain_pm_capture`
- **Handler**: lighter alias of `brain_pm_task_add` — only `project`, `workstream`, `name`, `description` required
- **Recommendation**: implement as `brain_pm_task_add` with fewer required fields rather than a separate tool
  (to avoid duplication, expose this as `brain_pm_task_add` with all optional fields truly optional except description)

#### 7. `brain_pm_workstream_list`
- **Handler**: `listWorkstreams(db, prefix)` → `Result<WorkstreamMetadata[]>`
- **File**: `src/modules/pm/data/workstream-ops.ts`
- **Already imported** in `mcp.ts`
- **Input schema**: `{ prefix?: string }` — auto-resolves to default project if omitted

#### 8. `brain_pm_workstream_add`
- **Handler**: `createWorkstream(db, config, embedder, input: CreateWorkstreamInput)` → `Result<WorkstreamMetadata>`
- **File**: `src/modules/pm/data/workstream-ops.ts`
- **Input schema**: `{ project: string, name: string, description?: string }`

#### 9. `brain_session_show`
- **Handler**: `svc.sessionGet(displayId)` → `SessionMetadata | null`
  - Or `svc.sessionDetail(displayId)` → `SessionDetailData | null` (richer, includes segments/agents)
- **Input schema**: `{ displayId: string }`

#### 10. `brain_memory_add`
- **Handler**: `svc.db.addMemory(entry: MemoryEntry)` + optional embedding via `svc.embedder`
- **File**: `src/services/brain-db.ts`
- **Input schema**: `{ memory: string, containerTag?: string, sourceNoteId?: string }`
- **Approach**: generate UUID, build MemoryEntry, call addMemory, optionally embed and upsertMemoryVector

---

## Workstream 2: Channel Notification Fix

### Problem

`notifications/claude/channel` (experimental) is silently dropped in Claude Code:
- GitHub issues #40729, #36802, #41733: notifications not delivered to coordinator session

Current implementation in `src/modules/workflow/runtime/channel.ts`:
```ts
this.server.server.notification({ method: 'notifications/claude/channel', params: { content, meta } })
```
This path is broken for MCP-to-coordinator delivery.

### What Works

The SSE bridge in `src/server/index.ts` works fine (dashboard path). Keep it unchanged.

### Solution A: MCP Resources + `notifications/resources/list_changed`

MCP SDK v1.27.1 exposes `server.sendResourceListChanged()` — sends `notifications/resources/list_changed`,
a **standard** MCP notification that Claude Code reliably delivers.

**Approach**:
1. Register workflow runs as resources: `server.resource('workflow-run', new ResourceTemplate('brain://workflow/{instanceId}', { list: ... }), callback)`
2. On every workflow event: call `server.sendResourceListChanged()`
3. Coordinator reads current status via `resources/read` on the workflow resource URI

**Limitation**: runtime is initialized after `createBrainMcpServer()` returns.
Use same deferred reference pattern as current `getV2Runtime(svc)`.

### Solution B: `brain_workflow_events` Polling Tool

In-memory event log stored in `WorkflowRuntime` (or a thin wrapper), polled by coordinator:

**Event shape**:
```ts
interface WorkflowEvent {
  id: number           // monotonic counter
  instanceId: string
  event: string
  meta: Record<string, string>
  timestamp: string
}
```

**Tool**: `brain_workflow_events({ since?: string, instanceId?: string, limit?: number })`
- Returns events since `since` (ISO timestamp or numeric event ID)
- Coordinator tracks `lastTimestamp` and calls every N seconds

**Event log management**: cap at 1000 events with FIFO eviction.

### Recommendation: Implement Both

- **Solution A** (resources + list_changed): push-based, Claude Code delivers it reliably
- **Solution B** (events polling tool): reliable fallback, also useful for audit/debugging

Modified `WorkflowChannel.push()` (in channel.ts — **read-only file**):
- Cannot modify `channel.ts` directly (owned by another worker)
- Instead: wire `sendResourceListChanged()` into `channelPush` lambda in `src/server/index.ts`
- The lambda is defined in `index.ts` (owned by this worker) — add the resource notification call there

---

## Implementation Plan

### Files to modify (within ownership scope):
- **`src/server/mcp.ts`**: add 10 new tools + resource registration + event log management
- **`src/server/index.ts`**: add `server.sendResourceListChanged()` call in `channelPush` lambda

### New registration functions to add in `mcp.ts`:
- `registerNoteTools(server, svc)` — `brain_note_add`, `brain_note_list`
- `registerPmExtTools(server, svc)` — `brain_pm_task_add`, `brain_pm_capture`, `brain_pm_workstream_list`, `brain_pm_workstream_add`, `brain_pm_context`, `brain_pm_wave`
- `registerSessionExtTools(server, svc)` — `brain_session_show`
- `registerMemoryExtTools(server, svc)` — `brain_memory_add`
- `registerWorkflowResourceTools(server, svc)` — `brain_workflow_events` tool + resource template

### New imports needed in `mcp.ts`:
```ts
import { createTask } from '../modules/pm/data/task-ops.js';
import { createWorkstream, getWorkstream } from '../modules/pm/data/workstream-ops.js';
import { getSessionsForTask } from '../modules/sessions/data/session-ops.js';
import { ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { slugify } from '../utils.js';
import { createHash } from 'node:crypto';
import { indexSingleFile } from '../services/indexing.js';
```

### Event log wiring in `index.ts`:
```ts
// In initV2Runtime, after server.connect() is called, add to channelPush:
channelPush: (event, meta) => {
  channel.push(event, meta);          // existing (broken for MCP)
  eventLog.push({ ... });             // new: in-memory log
  server.sendResourceListChanged();   // new: standard MCP notification
  if (sseClients?.size) { ... }       // existing (SSE dashboard)
}
```

---

## Key Risks

1. **`brain_note_add` path resolution**: must derive file path from type/tier config.
   `config.notesDir` is `~/brain/` (not the project repo). Follow same convention as index command.

2. **`brain_pm_context` agent filter**: `listAgents` has no `brain_task` filter — filter client-side.

3. **Resource notification timing**: `sendResourceListChanged()` is called inside `channelPush`
   which fires after `server.connect()` — transport is alive, so this is safe.

4. **Event log memory**: cap at 1000 events FIFO. No persistence needed (in-memory).

5. **`brain_pm_capture` vs `brain_pm_task_add`**: recommend collapsing into one tool
   with fewer required fields, to avoid duplicate tool confusion for LLMs.

6. **`listWorkstreams` already imported**: `mcp.ts` already imports it for `brain_pm_overview`.
   `brain_pm_workstream_list` just needs to expose it as a dedicated tool.
