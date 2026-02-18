# Brain

Personal knowledge base with hybrid RAG search (BM25 + vector embeddings) over markdown notes.

## Install

```bash
npm install @titan-design/brain
```

Requires Node >= 22.

## Quick Start

```bash
brain init           # Initialize workspace
brain index          # Index notes
brain search "query" # Search
```

## Commands

| Command | Description |
|---------|-------------|
| `brain init` | Initialize workspace and database |
| `brain index` | Index all markdown notes |
| `brain search "query"` | Hybrid BM25 + vector search |
| `brain add <file>` | Add a note |
| `brain status` | Database stats |
| `brain stale` | Notes needing review |
| `brain graph <id>` | Show note relations |
| `brain template <type>` | Output frontmatter template |
| `brain archive` | Archive expired notes |
| `brain config` | View/set configuration |

## How It Works

Brain indexes markdown files with YAML frontmatter into a SQLite database. Search combines BM25 full-text search (via FTS5) with vector similarity (via sqlite-vec) using reciprocal rank fusion.

**Embedding backends:**
- **Local** — `@huggingface/transformers` (default, no external dependencies)
- **Ollama** — local Ollama server
- **Remote** — configurable API endpoint

**Note tiers:**
- `slow` — permanent knowledge (decisions, patterns, research) with review intervals
- `fast` — ephemeral (meetings, session logs) with expiry dates

## Development

```bash
npm install
npm test              # Vitest
npm run build         # tsup → dist/cli.js
npm run typecheck     # tsc --noEmit
npm run lint          # ESLint
npx tsx src/cli.ts    # Run CLI in dev
```

## License

MIT
