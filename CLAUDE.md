# Brain — Developer Second Brain

Personal knowledge base and memory engine with hybrid RAG search (BM25 + vector embeddings), LLM-powered memory extraction, and temporal intelligence.

## Quick Start

```bash
npm install
npx tsx src/cli.ts init           # Initialize workspace
npx tsx src/cli.ts index          # Index notes
npx tsx src/cli.ts search "query" # Search
npx tsx src/cli.ts quick "thought" # Capture to inbox
npx tsx src/cli.ts extract --all  # Extract memories (requires Ollama)
```

## Commands

| Command | Description |
|---------|-------------|
| `npm test` | Run all tests (Vitest, ~2,350 tests) |
| `npm run build` | Build with tsup (output: `dist/cli.js`) |
| `npm run typecheck` | TypeScript type checking |
| `npm run lint` | ESLint |
| `npx tsx src/cli.ts` | Run CLI in development |

## CLI Commands

| Command | Description |
|---------|-------------|
| `init` | Initialize workspace |
| `index` | Index notes (`--inbox`, `--extract`, `--watch`) |
| `search` | Hybrid search (`--memories`, `--rerank`, `--container`) |
| `add` | Create a note from file/stdin |
| `quick` | Capture text to inbox |
| `inbox` | View/manage inbox items |
| `import` | Smart import with three-tier extraction (`--dry-run`, `--tier`, `--urls`) |
| `ingest` | Bulk-import files to inbox |
| `feed` | Manage RSS feed subscriptions |
| `extract` | Extract memories from notes (Ollama) |
| `memories` | List/history/stats for extracted memories |
| `context` | Show context for a note (relations + memories) |
| `profile` | Generate agent context profile from memories |
| `tidy` | LLM-powered note cleanup suggestions |
| `doctor` | Check system health (`--fix` for auto-repair) |
| `install-hooks` | Set up launchd/systemd scheduled processing |
| `status` | Show index status |
| `stale` | Find notes needing review |
| `graph` | Explore note relations |
| `template` | Manage note templates |
| `archive` | Archive old notes |
| `config` | View/set configuration |
| `pm` | Project management module (init, tasks, waves, dispatch, audit) |
| `hook` | Hook dispatch, status, and install (`dispatch`, `status`, `install`) |
| `agent` | Agent lifecycle management (`list`, `show`, `migrate-ao`) |
| `session` | Session intelligence (`list`, `analytics`, `restore`) |
| `workflow` | Workflow engine (`register`, `observe`, `improve`, `report`) |
| `codebase` | Architecture indexing (`index`, `install-hook`) |

## Architecture

```
src/
  cli.ts                — Entry point, Commander program
  types.ts              — All TypeScript interfaces and constants
  utils.ts              — Shared utilities (slugify)
  commands/             — 22 CLI commands
  services/
    brain-db.ts         — Database facade (delegates to repos)
    brain-service.ts    — Resource management (withBrain/withDb helpers)
    repos/
      note-repo.ts      — Notes, files, chunks, relations, FTS, search queries
      memory-repo.ts    — Memory entries, history, vectors
      capture-repo.ts   — Inbox items, feed records
    config.ts           — Configuration loading via env-paths
    file-scanner.ts     — File change detection (hash-based)
    markdown-parser.ts  — Frontmatter parsing + heading-aware chunking
    indexing.ts         — Index pipeline (file scanning, chunking, embedding)
    search.ts           — Hybrid search orchestration (BM25 + vector + memory)
    graph.ts            — Note relation traversal (batch queries)
    memory-extractor.ts — LLM fact extraction and reconciliation
    extraction-pipeline.ts — Three-tier extraction orchestrator
    extraction-tiers/   — Deterministic, LLM classifier, agent queue
    ollama.ts           — Ollama client, health checks, hasModel/requireOllama helpers
    health.ts           — System health checks (database, embedder, LLM, inbox, stale notes)
    reranker.ts         — Cross-encoder reranking pipeline
  adapters/             — Embedder backends (local/ollama/remote) with factory
  modules/
    types.ts            — Module system interfaces
    registry.ts         — ModuleRegistry class
    context.ts          — Module context factory
    loader.ts           — Module discovery and loading
    validation.ts       — Frontmatter schema validation
    knowledge/          — Knowledge module (core note types)
    pm/                 — Project management module (34 files)
      commands/         — 15 command groups (incl. check)
      data/             — CRUD operations and queries
      engine/           — State machine, routing, dispatch, templates, worktrees, dependencies, consistency
    agents/             — Agent orchestration (lifecycle, worktrees, state, done-handler)
    sessions/           — Session intelligence (capture, restore, briefing, analytics)
    workflow/           — Workflow engine (definitions, lifecycle, friction, observe, improve)
    codebase/           — Architecture indexing (scanner, notes, post-merge hook)
  hooks/                — Hook dispatch infrastructure
    registry.ts         — HookRegistry with register/dispatch
    config.ts           — resolveHookConfig from ao.config.json
    checks/             — Core checks (ownership, git-safety, workspace, dod, wip, worktree, workflow-resource)
  utils/
    template.ts         — Shared template substitution (single/double brace styles)
```

### Database Layer

Repository pattern: `BrainDB` is a facade that delegates to three domain repos (`NoteRepo`, `MemoryRepo`, `CaptureRepo`). Each repo owns the SQL, row types, and mappers for its tables. Cross-repo operations like `deleteNote` (cascades across memories, chunks, FTS, relations) live in the facade.

Commands access the DB through `withBrain`/`withDb` helpers in `brain-service.ts` which handle resource lifecycle (try/finally close).

### Key Subsystems

- **Storage**: SQLite via better-sqlite3 with FTS5 for text search and sqlite-vec for vector search
- **Embeddings**: Local (@huggingface/transformers), Ollama, or remote backends
- **Search**: Hybrid BM25 + vector with RRF/score fusion, optional cross-encoder reranking, memory search
- **Notes**: Markdown files with YAML frontmatter, organized by tier (slow/fast) and type
- **Memories**: LLM-extracted facts with version chaining, temporal validity, and auto-forgetting
- **Inbox**: Zero-friction capture pipeline (CLI, file import, RSS feeds)
- **LLM**: Ollama integration for memory extraction, reconciliation, and note cleanup
- **Module System**: Plugin architecture with namespace isolation, visibility tiers, schema enforcement, command registration, directory-backed notes, and module migrations
- **PM Module**: Project/workstream/task management with dependency waves, agent routing, worktree isolation, claim tokens, verification agents, telemetry, and consistency checking
- **Agent Module**: Agent lifecycle (spawn, track, complete), worktree allocation, extensible context storage, ao migration
- **Session Module**: Session intelligence with event capture, analytics, restore/resume context, and briefing generation
- **Workflow Module**: Workflow definitions, lifecycle, friction detection, observation system, and improvement suggestions
- **Codebase Module**: Architecture indexing with incremental scanning, note generation, and post-merge hooks
- **Hook System**: Centralized dispatch for Claude Code hooks (pre-tool-use, session-start, agent-done, etc.) with configurable checks and module handlers

## Testing

- Unit tests: `__tests__/services/` and `__tests__/services/repos/`
- Adapter tests: `__tests__/adapters/`
- Integration tests: `__tests__/integration/`
- PM unit tests: `__tests__/modules/pm/`
- PM integration tests: `__tests__/integration/pm/`
- Eval tests: `__tests__/eval/` — chunk quality benchmarks
- Framework: Vitest with globals enabled
- Conventions: Arrange-Act-Assert, mock only external dependencies

## Key Conventions

- Node16 module resolution: all imports use `.js` extensions
- ESM-only (`"type": "module"` in package.json)
- Native modules (better-sqlite3, sqlite-vec) are external in tsup build
- Config stored via env-paths (`~/Library/Preferences/brain` on macOS)
- Deferred review items tracked in `docs/review-deferred.md`
- Module notes use `module` field in frontmatter for namespace isolation
- PM notes are `visibility: 'private'` — kept separate from the user's knowledge base

## Enforcement (brain hooks)

Hook dispatch via `brain hook dispatch <event>`. Configured in `.claude/settings.local.json`.

Registered checks:
- **File ownership**: Writes scoped to paths in `.claude/ownership.json`
- **Git safety**: Blocks destructive git operations on protected branches
- **WIP limits**: Max concurrent agents (configurable in ao.config.json)
- **Clean workspace**: Tasks require clean git state
- **Definition of Done**: Completion requires passing typecheck + tests + lint
- **Worktree isolation**: Agents confined to their allocated worktree
- **Workflow resources**: Tool calls validated against workflow resource allocations

Module hook handlers:
- **agents:agent-done**: Marks agents completed, releases worktrees, updates PM
- **sessions:start**: Creates session record, generates briefing context
- **sessions:capture**: Captures tool events for session analytics
- **workflow:friction**: Real-time friction pattern detection

Install hooks: `brain hook install --project` or `brain hook install --user`
View status: `brain hook status`
