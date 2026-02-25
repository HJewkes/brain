# Brain

Personal knowledge base and memory engine with hybrid RAG search (BM25 + vector embeddings), LLM-powered memory extraction, and temporal intelligence.

## Install

```bash
npm install @titan-design/brain
```

Requires Node >= 22.

## Quick Start

```bash
brain init                    # Initialize workspace
brain index                   # Index notes
brain search "query"          # Hybrid search
brain quick "thought"         # Capture to inbox
brain extract --all           # Extract memories (requires Ollama)
```

## Commands

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

## How It Works

Brain indexes markdown files with YAML frontmatter into a SQLite database. It combines three layers:

**Search** — Hybrid BM25 full-text search (FTS5) + vector similarity (sqlite-vec) with reciprocal rank fusion. Optional cross-encoder reranking via `--rerank`.

**Memory extraction** — Ollama LLM extracts discrete facts from notes, then reconciles them against existing memories (ADD/UPDATE/DELETE). Memories are versioned with parent chains, temporal validity (`valid_at`/`invalid_at`), and automatic forgetting (`forget_after`).

**Capture pipeline** — Zero-friction ingestion from CLI quick capture, file import, and RSS feed subscriptions. Items flow through an inbox queue before being indexed.

### Embedding Backends

- **Local** — `@huggingface/transformers` (default, no external dependencies)
- **Ollama** — local Ollama server
- **Remote** — configurable API endpoint

### Note Tiers

- `slow` — permanent knowledge (decisions, patterns, research) with review intervals
- `fast` — ephemeral (meetings, session logs) with expiry dates

## Architecture

```
src/
  cli.ts                — Entry point, Commander program
  types.ts              — All TypeScript interfaces
  utils.ts              — Shared utilities
  commands/             — CLI commands (22 commands)
  services/
    brain-db.ts         — Database facade (delegates to repos)
    brain-service.ts    — Resource management (withBrain/withDb)
    repos/
      note-repo.ts      — Notes, files, chunks, relations, FTS, search queries
      memory-repo.ts    — Memory entries, history, vectors
      capture-repo.ts   — Inbox items, feed records
    config.ts           — Configuration loading
    file-scanner.ts     — File change detection
    markdown-parser.ts  — Frontmatter + heading-aware chunking
    search.ts           — Hybrid search orchestration
    graph.ts            — Note relation traversal
    indexing.ts         — Index pipeline
    memory-extractor.ts — LLM fact extraction and reconciliation
    ollama.ts           — Ollama client and health checks
    health.ts           — System health check service
    reranker.ts         — Cross-encoder reranking
  adapters/             — Embedder backends (local/ollama/remote)
```

**Storage:** SQLite via better-sqlite3 with FTS5 and sqlite-vec

## Development

```bash
npm install
npm test              # Vitest (380 tests)
npm run build         # tsup → dist/cli.js
npm run typecheck     # tsc --noEmit
npm run lint          # ESLint
npx tsx src/cli.ts    # Run CLI in dev
```

## License

MIT
