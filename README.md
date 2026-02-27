# @titan-design/brain

Developer second brain — hybrid RAG search (BM25 + vector embeddings), LLM-powered memory extraction, project management with AI orchestration, and temporal intelligence.

## Features

- **Hybrid Search** — BM25 + vector with RRF/score fusion, optional cross-encoder reranking
- **Memory Engine** — LLM-extracted facts with version chaining, temporal validity, auto-forgetting
- **Project Management** — Full PM module: projects, workstreams, tasks, dependencies, waves, dispatch
- **AI Orchestration** — Agent routing, claim tokens, worktree isolation, verification, cost tracking
- **Inbox Pipeline** — Zero-friction capture from CLI, file import, RSS feeds
- **Module System** — Extensible plugin architecture with namespace isolation

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

| Command | Description |
|---------|-------------|
| `brain init` | Initialize workspace and database |
| `brain index` | Index all markdown notes |
| `brain search "query"` | Hybrid BM25 + vector search |
| `brain add <file>` | Add a note from file or stdin |
| `brain quick "text"` | Zero-friction capture to inbox |
| `brain inbox` | View/manage inbox items |
| `brain ingest` | Bulk-import files to inbox |
| `brain feed` | Manage RSS feed subscriptions |
| `brain extract` | Extract memories from notes (Ollama) |
| `brain memories` | List, history, and stats for memories |
| `brain context <id>` | Show context for a note (relations + memories) |
| `brain lineage <id>` | Show memory version lineage |
| `brain profile` | Generate agent context profile |
| `brain tidy` | LLM-powered note cleanup suggestions |
| `brain doctor` | System health checks (`--fix` for auto-repair) |
| `brain install-hooks` | Set up launchd/systemd scheduled processing |
| `brain status` | Database stats |
| `brain stale` | Notes needing review |
| `brain graph <id>` | Show note relations |
| `brain template <type>` | Output frontmatter template |
| `brain archive` | Archive expired notes |
| `brain config` | View/set configuration |

### Project Management (`brain pm`)

| Command | Description |
|---------|-------------|
| `brain pm init <name> --prefix <P>` | Initialize a new project |
| `brain pm use <prefix>` | Set active project context |
| `brain pm list` | List all projects |
| `brain pm status [prefix]` | Show project status |
| `brain pm workstream add <name>` | Add a workstream |
| `brain pm task add <name>` | Create a task |
| `brain pm task list` | List tasks (filterable by status, workstream) |
| `brain pm task done <id>` | Mark task done |
| `brain pm next` | Show eligible tasks (all deps satisfied) |
| `brain pm waves` | Topological wave grouping of remaining tasks |
| `brain pm dispatch <id>` | Assemble context bundle for a task |
| `brain pm complete <id>` | Mark done, run impact analysis |
| `brain pm briefing` | Session briefing with project state overview |
| `brain pm audit summary` | Activity log, cost tracking |
| `brain pm setup` | Configure PM module (paths, hooks) |
| `brain pm install-hooks` | Install PM git hooks |

## Architecture

```
src/
  cli.ts                 — Entry point, Commander program
  types.ts               — TypeScript interfaces and constants
  utils.ts               — Shared utilities
  commands/              — 22 core CLI commands
  modules/
    types.ts             — Module system interfaces
    registry.ts          — ModuleRegistry class
    context.ts           — Module context factory
    loader.ts            — Module discovery and loading
    validation.ts        — Frontmatter schema validation
    pm/                  — Project management module
      commands/          — 14 command groups
      data/              — CRUD operations and queries
      engine/            — Dependency waves, dispatch, state machine, claims
  services/
    brain-db.ts          — Database facade
    brain-service.ts     — Resource lifecycle (withBrain/withDb)
    repos/               — Domain repositories (note, memory, capture)
    config.ts            — Configuration loading
    search.ts            — Hybrid search orchestration
    memory-extractor.ts  — LLM fact extraction and reconciliation
    indexing.ts          — Index pipeline
    reranker.ts          — Cross-encoder reranking
  adapters/              — Embedder backends (local/ollama/remote)
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

## Testing

```bash
npm test          # 1,067 tests (Vitest)
npm run typecheck # TypeScript checking
npm run lint      # ESLint
npm run build     # Production build (tsup)
npx tsx src/cli.ts # Run CLI in development
```

## Documentation

- [PM Quick Start](docs/pm-module/quickstart.md)
- [PM User Guide](docs/pm-module/guide.md)
- [PM Architecture](docs/pm-module/architecture.md)
- [PM Command Reference](docs/pm-module/commands.md)
- [Demo Workflow](docs/pm-module/demo.md)

## License

MIT
