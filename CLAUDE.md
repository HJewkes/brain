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
| `npm test` | Run all tests (Vitest, 1,095 tests) |
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
    pm/                 — Project management module (34 files)
      commands/         — 15 command groups (incl. check)
      data/             — CRUD operations and queries
      engine/           — State machine, routing, dispatch, templates, worktrees, dependencies, consistency
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

## Enforcement (ao plugin)

This project uses the `ao` enforcement plugin. Hooks enforce automatically:
- **File ownership**: Writes scoped to src/, __tests__/, docs/, scripts/, skill/, templates/
- **WIP limits**: Max 4 concurrent agents
- **Clean workspace**: Tasks require clean git state
- **Definition of Done**: Completion requires passing typecheck + tests + lint

Query research insights: `ao query-insights --mechanism hook --status not-started --limit 10`
