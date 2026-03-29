# Research Brief: Platform Critical Path

Plan: platform-critical-path | Project: VNM | Workstream: VNM-42

## Vision

Transform brain from a personal knowledge base into an autonomous software development platform. Five phases, each enabling the next:

1. **MCP Server** — Make brain queryable by agents natively
2. **Spec Pipeline** — Structured intent for agent dispatch
3. **Background Processing** — Self-maintaining knowledge base
4. **Observability** — Trust and quality measurement
5. **Parallel Agent Autonomy** — Scale up agent throughput

## Phase 1: MCP Server

### What exists
- Brain CLI with 22+ commands (search, pm, memory, session, workflow, agent, etc.)
- BrainServiceClass with .create(), .search(), .dashboard(), .pmTaskList(), .sessionList(), .agentList(), .pmStatus(), .pmNext()
- HTTP serve command with SSE streaming for dashboard data
- Instance registry for multi-brain federation

### What needs building
- MCP server exposing brain tools via TypeScript MCP SDK
- Tool definitions: search, note_read, memory_search, pm_task_list, pm_task_show, pm_next, pm_dispatch, session_list
- Registration in .claude/settings.local.json for auto-discovery
- Consider: persistent server combining MCP + HTTP dashboard + SSE in one process
- Consider: if persistent, SQLite connection pooling avoids per-command open/close overhead

### Key design decisions
- stdio MCP (per-command, stateless) vs HTTP MCP (persistent server, stateful)?
- If persistent: combine MCP + HTTP dashboard + SSE streaming in one process?
- How to handle BrainService lifecycle (open/close per request vs keep-alive)?

### Existing tasks
- VNM-36.01: Design unified brain MCP server [high]
- VNM-36.02: Implement brain MCP server [high]
- VNM-31.10, VNM-32.01, VNM-35.06 (subsumed by unified server)

## Phase 2: Spec Pipeline

### What exists
- Workflow engine with 6 definitions, 19 templates, DAG-based progression
- Planning workflow: research -> interview -> design -> critic -> spectests -> decompose -> implement -> review
- PM dispatch with context assembly (graph traversal, semantic search, decisions)
- Template filling via dispatchTemplate()

### What needs building
- /plan skill entry point (VNM-41.01)
- Sequential phase orchestration (VNM-41.02)
- Template variable resolution (PLAN_ID, RESEARCH_FOCUS, etc.)
- Artifact indexing so brain search finds spec content (VNM-41.03)
- Human approval gate callbacks (VNM-41.04)
- Spec CRUD commands in PM CLI (VNM-33.02)

### Existing tasks
- VNM-41.01-06: Workflow System Activation
- VNM-33.01-03: Spec-Driven Development

## Phase 3: Background Processing

### What exists
- install-hooks.ts — launchd/systemd scheduled processing
- Session capture hooks
- Memory extraction pipeline (Ollama LLM)
- File scanner with hash-based change detection

### What needs building
- SQLite job queue (VNM-37.01)
- WatchPaths for event-driven indexing (VNM-37.02)
- Post-session extraction trigger (VNM-37.03)
- Nightly memory consolidation (VNM-37.04)

### Existing tasks
- VNM-37.01-06: Background Processing

## Phase 4: Observability

### What exists
- Session module: ToolCall[], FrictionSignal[], SegmentMetadata
- Dashboard with session list, detail view, agent status
- Eval harness with hit-rate/MRR/NDCG metrics

### What needs building
- Session quality scorer (VNM-34.01)
- OpenInference span export (VNM-34.02)
- Golden dataset from reference sessions (VNM-34.03)
- Agent session replay viewer (VNM-34.05)

### Existing tasks
- VNM-34.01-05: Agent Observability

## Phase 5: Parallel Agent Autonomy

### What exists
- Agent module: spawn, track, complete, worktree allocation
- PM dispatch with dependency-ordered waves
- WIP limits, claim tokens, agent-done handler

### What needs building
- Queue-based agent dispatch from PM waves
- Multiple concurrent agents with coordinated file ownership
- Cross-agent handoff protocol (VNM-32.06)
- Aggregate observability across parallel agents
- Priority-based scheduling

### Existing tasks
- VNM-32.06-07: Agent-Native PM
- VNM-38.01-04: Agent Isolation

## Cross-Phase Architecture Insight

The MCP server is the convergence point. If brain runs as a persistent process:
- MCP tools give agents access (Phase 1)
- The running process serves the dashboard UI (Phase 1 bonus)
- SQLite connection stays open — no per-command overhead (Phase 3)
- Job queue worker runs in the same process (Phase 3)
- OpenInference spans export from the running process (Phase 4)
- Agent dispatch triggers go through the server (Phase 5)

This suggests the MCP server should be designed as a **brain daemon** from the start.

## Knowledge Gaps

1. Can a single Node.js process serve MCP (stdio), HTTP (dashboard), SSE (live updates), and run background jobs?
2. TypeScript MCP SDK support for persistent servers vs stdio?
3. Migration path from CLI-first to server-first without breaking existing workflows?
4. Target concurrency for parallel agents? 3? 10? 50?

## Suggested Interview Questions

1. Should the brain daemon be always-running (launchd keepAlive) or start-on-demand?
2. Is the dashboard UI a static build served by the daemon, or separate Vite dev server?
3. For Phase 5, what's the target agent concurrency?
4. Should MCP expose write operations (create task, update status) or read-only initially?
5. How important is remote access vs local-only?
