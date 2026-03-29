# Design: Platform Critical Path

Plan: platform-critical-path | Project: VNM | Workstream: VNM-42

## Architecture Decision: The Brain Daemon

All five phases converge on a single architectural primitive: **a persistent brain process** that serves MCP tools, the dashboard UI, background jobs, and agent coordination from one Node.js process with one SQLite connection.

```
brain serve [--port 7420] [--install]

  ┌─────────────────────────────────────────────┐
  │              Brain Daemon (Node.js)          │
  │                                              │
  │  ┌──────────┐  ┌──────────┐  ┌───────────┐  │
  │  │ MCP      │  │ HTTP     │  │ Background │  │
  │  │ Server   │  │ Server   │  │ Worker     │  │
  │  │ (stdio)  │  │ (Koa/    │  │ (job queue)│  │
  │  │          │  │  Express) │  │            │  │
  │  └────┬─────┘  └────┬─────┘  └─────┬──────┘  │
  │       │             │              │          │
  │  ┌────┴─────────────┴──────────────┴──────┐  │
  │  │         BrainServiceClass               │  │
  │  │    (single SQLite connection, open)      │  │
  │  └────────────────────────────────────────┘  │
  └─────────────────────────────────────────────┘
         │              │              │
    Claude Code    Browser UI    Scheduled jobs
    Cursor          (React)      (extract, consolidate,
    Any MCP client               index, decay)
```

### Why one process

- **SQLite**: one writer at a time. A persistent connection avoids open/close overhead (~50ms per CLI invocation) and prevents WAL checkpoint contention.
- **State sharing**: MCP tools, dashboard SSE, and background jobs all need current DB state. One process, one connection, zero coordination.
- **Operational simplicity**: user runs one thing or installs one launchd agent.

## Phase 1: MCP Server + Dashboard Daemon

### Deliverables

1. `src/commands/serve.ts` — enhanced to be the brain daemon entry point
2. `src/server/mcp.ts` — MCP tool definitions using @modelcontextprotocol/sdk
3. `src/server/http.ts` — HTTP routes for dashboard + SSE
4. `src/server/index.ts` — orchestrates MCP + HTTP + job worker

### MCP Transport: stdio

MCP stdio is the standard for local servers. The daemon registers in `.claude/settings.local.json`:

```json
{
  "mcpServers": {
    "brain": {
      "command": "npx",
      "args": ["tsx", "src/cli.ts", "serve", "--mcp"]
    }
  }
}
```

When invoked with `--mcp`, the daemon serves MCP over stdio (stdin/stdout). Without `--mcp`, it serves HTTP for the dashboard. Both modes share the same BrainServiceClass instance.

### MCP Tools (12 tools, read + write)

**Search & Knowledge (4)**
| Tool | Description | Params |
|------|-------------|--------|
| `brain_search` | Hybrid BM25+vector search | query, limit?, tier?, category? |
| `brain_note_read` | Read a note by ID | noteId |
| `brain_memory_search` | Search extracted memories | query, limit? |
| `brain_memory_list` | List memories with filters | category?, limit?, active? |

**Project Management (5)**
| Tool | Description | Params |
|------|-------------|--------|
| `brain_pm_task_list` | List tasks | status?, workstream?, priority? |
| `brain_pm_task_show` | Show task detail with context | taskId |
| `brain_pm_task_update` | Update task status/body | taskId, status?, body? |
| `brain_pm_task_create` | Create a new task | title, workstream, category, priority, description? |
| `brain_pm_next` | Get next eligible tasks | — |

**Session & Agent (3)**
| Tool | Description | Params |
|------|-------------|--------|
| `brain_session_list` | List recent sessions | limit? |
| `brain_agent_list` | List agents with status | status? |
| `brain_inbox_add` | Quick capture to inbox | text, title? |

### HTTP Routes

| Route | Method | Description |
|-------|--------|-------------|
| `/` | GET | Serve dashboard (static build or redirect to Vite) |
| `/api/dashboard` | GET | Full dashboard data (audit + status + dashboard) |
| `/api/events` | GET | SSE stream for live updates |
| `/api/search` | POST | Search endpoint for dashboard |
| `/api/health` | GET | Health check |

### Dashboard Serving

- **Production**: `npm run build:dashboard` produces `dist/dashboard/`. Daemon serves static files.
- **Development**: `brain serve --dev` proxies to Vite dev server on a separate port (HMR).
- Both modes use the same `/api/*` endpoints for data.

### Process Management

- `brain serve` — manual start, foreground
- `brain serve --port 7420` — custom port
- `brain serve --install` — register launchd agent (KeepAlive, auto-restart)
- `brain serve --uninstall` — remove launchd agent
- `brain serve --mcp` — MCP stdio mode (for .claude/settings.local.json)

### Implementation sequence

1. Refactor BrainServiceClass for keep-alive (don't auto-close)
2. Create `src/server/mcp.ts` with tool definitions
3. Create `src/server/http.ts` with dashboard + API routes
4. Wire `brain serve` to start both, or `--mcp` for stdio-only
5. Register MCP server in settings
6. Test with MCP Inspector + Claude Code

## Phase 2: Spec Pipeline

### Deliverables

1. `/plan` skill that Claude can invoke
2. Sequential orchestration in workflow engine
3. Template variable resolution from context
4. Artifact indexing as brain notes

### Design

The `/plan` skill:
1. Creates a PM task for the planning work on the active workstream
2. Creates a `.plans/<slug>/` directory
3. Instantiates the planning workflow (WF-PLANNING)
4. Expands into step tasks
5. Dispatches the research template with filled variables
6. Returns the research brief template as Claude's instructions

Phase orchestration: when a step task is marked `done`, the workflow engine evaluates gates on the next step(s) and dispatches them automatically. The `agent-done` hook triggers `workflow advance`.

### Dependencies on Phase 1

The MCP server enables agents to query brain during research/design phases without manual CLI invocation. Spec artifacts indexed as notes become searchable via `brain_search`.

## Phase 3: Background Processing

### Deliverables

1. Job queue table in brain.db (or separate jobs.db)
2. Worker loop in the daemon process
3. WatchPaths launchd config for re-indexing
4. Post-session extraction trigger

### Design

The daemon's event loop:
```
setInterval(processJobQueue, 5000)  // drain pending jobs every 5s
```

Job types: `index` (fast, ~100ms), `extract` (slow, 2-8s), `consolidate` (batch, 30-120s), `brief` (session start, 5-15s).

Post-session: the `sessions:capture` hook completion emits a `session-end` event. The daemon enqueues extraction jobs for notes touched during the session.

### Dependencies on Phase 1

The daemon process is the job worker. No separate process needed.

## Phase 4: Observability

### Deliverables

1. Session quality scorer
2. OpenInference span export
3. Scores visible in dashboard

### Design

The scorer runs on every session completion (hook-driven). Scores are stored as session metadata. The dashboard shows score trends over time.

OpenInference spans are emitted from the daemon to a local Phoenix instance (optional, opt-in). The daemon is the natural emission point since it processes all session events.

### Dependencies on Phase 1

Dashboard serves the score visualization. The daemon emits spans.

## Phase 5: Parallel Agent Autonomy

### Deliverables

1. Queue-based dispatch: PM waves → agent spawn queue
2. 5-10 concurrent agents with coordinated ownership
3. Aggregate observability dashboard
4. Priority scheduling

### Design

Target: 5-10 agents. This means:
- 5-10 worktrees active simultaneously
- Port allocation: BASE_PORT + (worktree_index * 10)
- File ownership enforced via .claude/ownership.json (already exists)
- Agent-done handler releases worktree + advances workflow

The daemon orchestrates: when a wave of tasks becomes eligible, it dispatches agents up to the WIP limit. As agents complete, it dispatches the next wave.

### Dependencies on Phases 1-4

Agents query brain via MCP (Phase 1). Dispatch briefs include spec context (Phase 2). Knowledge stays current (Phase 3). Human monitors quality via dashboard (Phase 4).

## Acceptance Criteria

### Phase 1
- [ ] `brain serve` starts daemon on localhost:7420
- [ ] MCP tools queryable via Claude Code (search, PM, sessions)
- [ ] Dashboard accessible at localhost:7420
- [ ] `brain serve --install` creates launchd agent
- [ ] All 12 MCP tools pass integration tests

### Phase 2
- [ ] `/plan` skill creates workflow + dispatches research
- [ ] Workflow auto-advances through phases on step completion
- [ ] Spec artifacts searchable via brain search
- [ ] Human approval gates pause and resume workflow

### Phase 3
- [ ] New notes in ~/brain/ indexed within 10s (WatchPaths)
- [ ] Post-session extraction triggers automatically
- [ ] Nightly consolidation job runs and completes
- [ ] Job queue drains correctly under daemon

### Phase 4
- [ ] Every session gets a quality score
- [ ] Scores visible in dashboard with trend
- [ ] OpenInference export works with Phoenix (opt-in)

### Phase 5
- [ ] 5+ agents run in parallel without file conflicts
- [ ] Dashboard shows aggregate agent status
- [ ] Wave-based dispatch fills up to WIP limit automatically
- [ ] Port conflicts resolved via index-based allocation
