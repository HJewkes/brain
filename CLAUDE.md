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
| `npm test` | Run all tests (Vitest) |
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
| `status` | Show index status |
| `stale` | Find notes needing review |
| `graph` | Explore note relations |
| `template` | Manage note templates |
| `archive` | Archive old notes |
| `config` | View/set configuration |

## Architecture

```
src/
  cli.ts              — Entry point, Commander program
  types.ts            — All TypeScript interfaces
  commands/           — 20 CLI commands
  services/           — Core logic (brain-db, config, file-scanner, markdown-parser, search, graph, memory-extractor, ollama, reranker)
  adapters/           — Embedder backends (local/ollama/remote) with factory
```

- **Storage**: SQLite via better-sqlite3 with FTS5 for text search and sqlite-vec for vector search
- **Embeddings**: Local (@huggingface/transformers), Ollama, or remote backends
- **Search**: Hybrid BM25 + vector with RRF/score fusion, optional cross-encoder reranking, memory search
- **Notes**: Markdown files with YAML frontmatter, organized by tier (slow/fast) and type
- **Memories**: LLM-extracted facts with version chaining, temporal validity, and auto-forgetting
- **Inbox**: Zero-friction capture pipeline (CLI, file import, RSS feeds)
- **LLM**: Ollama integration for memory extraction, reconciliation, and note cleanup

## Testing

- Unit tests: `__tests__/services/` and `__tests__/adapters/`
- Integration tests: `__tests__/integration/` — exercises full CLI pipeline via execSync
- Framework: Vitest with globals enabled
- Conventions: Arrange-Act-Assert, mock only external dependencies

## Key Conventions

- Node16 module resolution: all imports use `.js` extensions
- ESM-only (`"type": "module"` in package.json)
- Native modules (better-sqlite3, sqlite-vec) are external in tsup build
- Config stored via env-paths (`~/Library/Preferences/brain` on macOS)
