# @titan-design/brain

Developer second brain — hybrid RAG search (BM25 + vector embeddings), LLM-powered memory extraction, project management with AI orchestration, and temporal intelligence.

## Features

- **Hybrid Search** — BM25 + vector with RRF/score fusion, optional cross-encoder reranking
- **Memory Engine** — LLM-extracted facts with version chaining, temporal validity, auto-forgetting
- **Project Management** — Full PM module: projects, workstreams, tasks, dependencies, waves, dispatch
- **AI Orchestration** — Agent routing, claim tokens, worktree isolation, verification, cost tracking
- **Inbox Pipeline** — Zero-friction capture from CLI, file import, RSS feeds
- **Module System** — Extensible plugin architecture with namespace isolation
- **Workflow Runtime** — V2 imperative workflows: TypeScript async functions with memoized dispatch, agent supervision, and channel-based push events
- **MCP Server** — Model Context Protocol server (stdio + HTTP) exposing brain tools to Claude and other MCP clients
- **Hook Dispatch** — Centralized Claude Code hook infrastructure: ownership, git-safety, WIP limits, DoD checks, friction detection
- **Session Intelligence** — Session event capture, analytics, restore/resume context, and briefing generation
- **Agent Module** — Agent lifecycle management: spawn, track, worktree allocation, done-handler
- **Codebase Indexing** — Architecture scanning with incremental note generation and post-merge hooks

## Install

```bash
npm install @titan-design/brain
```

Requires Node >= 22.

## Quick Start

```bash
brain init                    # Initialize workspace
brain index                   # Index notes
brain search "query"          # Hybrid BM25 + vector search
brain quick "thought"         # Capture to inbox
brain extract --all           # Extract memories (requires Ollama)
```

## PM Module Quick Start

```bash
brain pm init "My Project" --prefix MY
brain pm use MY
brain pm workstream add "Core Features" --project MY
brain pm task add "First task" --project MY --workstream 1 --category implementation
brain pm waves
brain pm briefing
```

See [PM Quick Start](docs/pm-module/quickstart.md) for the full 5-minute guide.

## Commands

### Core

| Command                 | Description                                                     |
| ----------------------- | --------------------------------------------------------------- |
| `brain init`            | Initialize workspace and database                               |
| `brain index`           | Index all markdown notes                                        |
| `brain search "query"`  | Hybrid BM25 + vector search                                     |
| `brain add <file>`      | Add a note from file or stdin                                   |
| `brain quick "text"`    | Zero-friction capture to inbox                                  |
| `brain inbox`           | View/manage inbox items                                         |
| `brain import <paths>`  | Smart import with three-tier extraction (`--dry-run`, `--tier`) |
| `brain ingest`          | Bulk-import files to inbox                                      |
| `brain feed`            | Manage RSS feed subscriptions                                   |
| `brain extract`         | Extract memories from notes (Ollama)                            |
| `brain memories`        | List, history, and stats for memories                           |
| `brain context <id>`    | Show context for a note (relations + memories)                  |
| `brain lineage <id>`    | Show memory version lineage                                     |
| `brain profile`         | Generate agent context profile                                  |
| `brain tidy`            | LLM-powered note cleanup suggestions                            |
| `brain doctor`          | System health checks (`--fix` for auto-repair)                  |
| `brain install-hooks`   | Set up launchd/systemd scheduled processing                     |
| `brain status`          | Database stats                                                  |
| `brain stale`           | Notes needing review                                            |
| `brain graph <id>`      | Show note relations                                             |
| `brain template <type>` | Output frontmatter template                                     |
| `brain archive`         | Archive expired notes                                           |
| `brain config`          | View/set configuration                                          |
| `brain notes`           | Notes operations                                                |
| `brain format`          | Output formatting utilities                                     |
| `brain dashboard`       | React dashboard launcher                                        |
| `brain launch`          | Launch brain with session briefing                              |
| `brain mcp`             | MCP server — stdio + HTTP (alias: `serve`)                      |
| `brain hook`            | Hook dispatch, status, and install                              |
| `brain agent`           | Agent lifecycle (`list`, `show`, `migrate-ao`)                  |
| `brain session`         | Session intelligence (`list`, `analytics`, `restore`)           |
| `brain workflow`        | V2 workflow runtime (`start`, `status`, `signal`)               |
| `brain codebase`        | Architecture indexing (`index`, `install-hook`)                 |
| `brain instances`       | Workflow instance management                                    |
| `brain pr-feedback`     | PR feedback ingestion                                           |

### Project Management (`brain pm`)

#### Project

| Command                             | Description                              |
| ----------------------------------- | ---------------------------------------- |
| `brain pm init <name> --prefix <P>` | Initialize a new project                 |
| `brain pm use <prefix>`             | Set active project context               |
| `brain pm list`                     | List all projects                        |
| `brain pm status [prefix]`          | Show project status                      |

#### Workstreams

| Command                                   | Description              |
| ----------------------------------------- | ------------------------ |
| `brain pm workstream add <name>`          | Add a workstream         |
| `brain pm workstream list`                | List workstreams         |
| `brain pm workstream show <id>`           | Show workstream detail   |
| `brain pm workstream update <id>`         | Update a workstream      |
| `brain pm workstream delete <id>`         | Delete a workstream      |

#### Tasks

| Command                             | Description                                                              |
| ----------------------------------- | ------------------------------------------------------------------------ |
| `brain pm task add <name>`          | Create a task                                                            |
| `brain pm task list`                | List tasks (filterable by status, workstream)                            |
| `brain pm task show <id>`           | Show task detail                                                         |
| `brain pm task update <id>`         | Update task fields                                                       |
| `brain pm task claim <id>`          | Claim an eligible task (pending → claimed)                               |
| `brain pm task start <id>`          | Start a claimed task (claimed → in-progress)                             |
| `brain pm task done <id>`           | Mark done (low-level — use `brain pm complete` for full impact tracking) |
| `brain pm task release <id>`        | Release a claim (claimed → pending)                                      |
| `brain pm task block <id>`          | Mark task as blocked                                                     |
| `brain pm task unblock <id>`        | Unblock a task                                                           |
| `brain pm task reset <id>`          | Reset a completed task to pending                                        |
| `brain pm task delete <id>`         | Delete a task                                                            |
| `brain pm task migrate <id>`        | Move a task to a different workstream                                    |

#### Planning & Dispatch

| Command                             | Description                                               |
| ----------------------------------- | --------------------------------------------------------- |
| `brain pm next`                     | Show eligible tasks (all deps satisfied)                  |
| `brain pm waves`                    | Topological wave grouping of remaining tasks              |
| `brain pm dispatch <id>`            | Assemble context bundle for a task                        |
| `brain pm dispatch-wave`            | Dispatch an entire wave of tasks in parallel              |
| `brain pm complete <id>`            | Mark done, run impact analysis                            |
| `brain pm overview`                 | High-level project overview across all workstreams        |
| `brain pm briefing`                 | Session briefing with project state overview              |
| `brain pm context`                  | Show PM context for the active project                    |
| `brain pm render-prompt <id>`       | Render the agent prompt for a task                        |
| `brain pm burndown`                 | Burndown chart and velocity stats                         |

#### Maintenance

| Command                             | Description                                               |
| ----------------------------------- | --------------------------------------------------------- |
| `brain pm audit summary`            | Activity log, cost tracking                               |
| `brain pm check [--deep]`           | Consistency check (structural + semantic analysis)        |
| `brain pm verify`                   | Run verification for completed tasks                      |
| `brain pm import`                   | Import tasks from external data                           |
| `brain pm relate`                   | Create relations between tasks                            |
| `brain pm activity`                 | View project activity log                                 |
| `brain pm review`                   | Review commands                                           |
| `brain pm pull`                     | Pull and sync from remote                                 |
| `brain pm rename-prefix`            | Rename a project prefix                                   |
| `brain pm onboard`                  | Onboarding workflow                                       |
| `brain pm setup`                    | Configure PM module (paths, hooks)                        |
| `brain pm install-hooks`            | Install PM hooks and skills (orchestrator + sanity-check) |

## Architecture

```
src/
  cli.ts                 — Entry point, Commander program
  types.ts               — TypeScript interfaces and constants
  utils.ts               — Shared utilities (slugify)
  utils/
    template.ts          — Shared template substitution (single/double brace styles)
  commands/              — Core CLI commands
  services/
    brain-db.ts          — Database facade (delegates to repos)
    brain-service.ts     — Resource lifecycle (withBrain/withDb)
    repos/               — Domain repositories (note, memory, capture)
    config.ts            — Configuration loading via env-paths
    file-scanner.ts      — File change detection (hash-based)
    markdown-parser.ts   — Frontmatter parsing + heading-aware chunking
    indexing.ts          — Index pipeline (file scanning, chunking, embedding)
    search.ts            — Hybrid search orchestration (BM25 + vector + memory)
    graph.ts             — Note relation traversal (batch queries)
    memory-extractor.ts  — LLM fact extraction and reconciliation
    extraction-pipeline.ts — Three-tier extraction orchestrator
    extraction-tiers/    — Deterministic, LLM classifier, agent queue
    ollama.ts            — Ollama client, health checks
    health.ts            — System health checks
    reranker.ts          — Cross-encoder reranking pipeline
  adapters/              — Embedder backends (local/ollama/remote) with factory
  hooks/
    registry.ts          — HookRegistry with register/dispatch
    config.ts            — resolveHookConfig from ao.config.json
    checks/              — Core checks (ownership, git-safety, workspace, dod, wip, worktree, workflow-resource, friction)
  modules/
    types.ts             — Module system interfaces
    registry.ts          — ModuleRegistry class
    context.ts           — Module context factory
    loader.ts            — Module discovery and loading
    validation.ts        — Frontmatter schema validation
    knowledge/           — Knowledge module (core note types)
    pm/                  — Project management module (34 files)
      commands/          — 15 command groups (incl. check)
      data/              — CRUD operations and queries
      engine/            — State machine, routing, dispatch, templates, worktrees, dependencies, consistency
    agents/              — Agent orchestration (lifecycle, worktrees, state, done-handler)
    sessions/            — Session intelligence (capture, restore, briefing, analytics)
    workflow/            — V2 imperative workflow runtime
      runtime/           — WorkflowRuntime, WorkflowContext, signals, channels, migration
      flows/             — 6 workflow definitions (planning, implementation, review, brainstorming, pr-lifecycle, ux-prototype)
      engine/            — Template rendering (dispatch, templates, output-capture)
      templates/         — Agent prompt templates
    codebase/            — Architecture indexing (scanner, notes, post-merge hook)
  server/                — MCP server (stdio + HTTP transports)
```

**Storage:** SQLite via better-sqlite3 with FTS5 full-text search and sqlite-vec for vector search.

## How It Works

Brain indexes markdown files with YAML frontmatter into a SQLite database. It combines three layers:

**Search** — Hybrid BM25 full-text search (FTS5) + vector similarity (sqlite-vec) with reciprocal rank fusion. Optional cross-encoder reranking via `--rerank`.

**Memory extraction** — Ollama LLM extracts discrete facts from notes, reconciled against existing memories (ADD/UPDATE/DELETE). Memories are versioned with parent chains, temporal validity (`valid_at`/`invalid_at`), and automatic forgetting (`forget_after`).

**Capture pipeline** — Zero-friction ingestion from CLI quick capture, file import, and RSS feed subscriptions. Items flow through an inbox queue before being indexed.

### Embedding Backends

- **Local** — `@huggingface/transformers` (default, no external dependencies)
- **Ollama** — local Ollama server
- **Remote** — configurable API endpoint

### Note Tiers

- `slow` — permanent knowledge (decisions, patterns, research) with review intervals
- `fast` — ephemeral (meetings, session logs) with expiry dates

### Knowledge Graph

Link related notes and traverse connections:

1. Add `related` field to YAML frontmatter:
   ```yaml
   related:
     - database-migration-patterns
     - service-architecture-overview
   ```
2. Re-index after adding relations: `brain index`
3. Traverse the graph:
   ```bash
   brain graph <note-id>           # Show direct relations
   brain graph <note-id> --depth 2 # Show 2-hop connections
   brain graph <note-id> --json    # Machine-readable output
   ```
4. Use `--expand` in search to include graph-connected notes:
   ```bash
   brain search "query" --expand
   ```

## Testing

```bash
npm test          # ~4,035 tests (Vitest)
npm run typecheck # TypeScript checking
npm run lint      # ESLint
npm run build     # Production build (tsup)
npx tsx src/cli.ts # Run CLI in development
```

## Documentation

### Project Management

- [PM Quick Start](docs/pm-module/quickstart.md)
- [PM User Guide](docs/pm-module/guide.md)
- [PM Architecture](docs/pm-module/architecture.md)
- [PM Command Reference](docs/pm-module/commands.md)
- [Demo Workflow](docs/pm-module/demo.md)

### Subsystems

- [Workflow Runtime](docs/workflow/quickstart.md) — V2 imperative workflows with memoized dispatch and agent supervision
- [MCP Server](docs/mcp/quickstart.md) — MCP tool catalog, stdio/HTTP transports, example sessions
- [Hook Dispatch](docs/hooks/quickstart.md) — Ownership, git-safety, WIP limits, DoD checks, configuration
- [Agent Module](docs/agents/quickstart.md) — Agent lifecycle, worktree allocation, done-handler
- [Session Intelligence](docs/sessions/quickstart.md) — Session ingestion, analytics, briefings, restore flow
- [Codebase Indexing](docs/codebase/quickstart.md) — Architecture scanning, post-merge hook setup

## License

MIT
