# Brain — Developer Second Brain

Personal knowledge base with hybrid RAG search (BM25 + vector embeddings) over markdown notes.

## Quick Start

```bash
npm install
npx tsx src/cli.ts init           # Initialize workspace
npx tsx src/cli.ts index          # Index notes
npx tsx src/cli.ts search "query" # Search
```

## Commands

| Command | Description |
|---------|-------------|
| `npm test` | Run all tests (Vitest) |
| `npm run build` | Build with tsup (output: `dist/cli.js`) |
| `npm run typecheck` | TypeScript type checking |
| `npm run lint` | ESLint |
| `npx tsx src/cli.ts` | Run CLI in development |

## Architecture

```
src/
  cli.ts              — Entry point, Commander program
  types.ts            — All TypeScript interfaces
  commands/           — 10 CLI commands (init, index, search, status, add, stale, graph, template, archive, config)
  services/           — Core logic (brain-db, config, file-scanner, markdown-parser, search, graph)
  adapters/           — Embedder backends (local/ollama/remote) with factory
```

- **Storage**: SQLite via better-sqlite3 with FTS5 for text search and sqlite-vec for vector search
- **Embeddings**: Local (@huggingface/transformers), Ollama, or remote backends
- **Search**: Hybrid BM25 + vector with reciprocal rank fusion (RRF)
- **Notes**: Markdown files with YAML frontmatter, organized by tier (slow/fast) and type

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
