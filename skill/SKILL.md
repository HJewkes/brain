---
name: brain
description: Search and manage your second brain knowledge base. Use when the user asks about their notes, wants to find information, or needs to add/organize knowledge.
---

# Brain -- Knowledge Management

A CLI for managing a developer second brain with hybrid BM25 + vector search, LLM-powered memory extraction, and temporal intelligence over markdown notes.

## When to Use

- User asks "what do I know about X" or "find my notes on Y"
- User wants to save something to their knowledge base
- User asks about stale or outdated notes
- User wants to check their knowledge base status
- User wants to capture a quick thought or link
- User asks about extracted memories or facts

## Prerequisites

Brain CLI requires **Node 22+**. If using nvm, run `nvm use 22` first.

## Commands

Use `--json` flag on all commands when processing output programmatically.

| Command                                    | Purpose                             | Example                                                     |
| ------------------------------------------ | ----------------------------------- | ----------------------------------------------------------- |
| `brain search "<query>" --json`            | Hybrid search (BM25 + vector)       | `brain search "authentication patterns" --json --limit 5`   |
| `brain search "<query>" --memories --json` | Search notes + extracted memories   | `brain search "auth" --memories --json`                     |
| `brain search "<query>" --rerank --json`   | Search with cross-encoder reranking | `brain search "auth" --rerank --json`                       |
| `brain search "<query>" --expand --json`   | Search with graph-connected notes   | `brain search "auth" --json --expand`                       |
| `brain add <file>`                         | Add a note from file                | `brain add ~/draft.md --type research --tier slow`          |
| `brain add --title "X" --type note`        | Add from stdin                      | `echo "content" \| brain add --title "My Note" --type note` |
| `brain quick "thought"`                    | Zero-friction capture to inbox      | `brain quick "look into WebSockets vs SSE"`                 |
| `brain inbox --json`                       | View inbox items                    | `brain inbox --status pending --json`                       |
| `brain extract --all`                      | Extract memories from all notes     | Requires Ollama running locally                             |
| `brain extract --note <id>`                | Extract memories from one note      | `brain extract --note my-note-id`                           |
| `brain memories list --json`               | List active memories                | `brain memories list --container default --json`            |
| `brain memories history <id>`              | Show memory version chain           | `brain memories history mem-abc123`                         |
| `brain memories stats`                     | Memory count + expiry sweep         | Shows active count, runs auto-forget                        |
| `brain context <id> --json`                | Note context (relations + memories) | `brain context my-note --json`                              |
| `brain profile --format json`              | Agent context profile               | `brain profile --container default --format json`           |
| `brain status --json`                      | Database stats                      | Shows note count, embeddings, staleness                     |
| `brain stale --json`                       | Notes needing review                | `brain stale --tier slow --json`                            |
| `brain index`                              | Re-index all notes                  | Only run when user asks -- this is slow                     |
| `brain graph <note-id> --json`             | Show note relations                 | `brain graph my-note --json`                                |
| `brain doctor --json`                      | System health checks                | Shows DB, embedder, LLM, inbox, stale status                |
| `brain doctor --fix`                       | Auto-repair issues                  | Pulls missing models, resets failed inbox                   |
| `brain config get`                         | Show config                         | `brain config get`                                          |

## Search Filters

Filter results by metadata fields — all filters are optional and combinable:

```bash
brain search "query" --tier slow                    # Filter by note tier
brain search "query" --category research            # Filter by category
brain search "query" --tags "typescript,patterns"    # Filter by tags
brain search "query" --confidence high               # Filter by confidence level
brain search "query" --type decision                 # Filter by note type
brain search "query" --since 2025-01-01              # Filter by date
brain search "query" --module pm                     # Filter by module
brain search "query" --expand                        # Include graph-connected notes
brain search "query" --rerank                        # Cross-encoder reranking
brain search "query" --memories                      # Include extracted memories
```

## Note Conventions

**Types:** `note`, `decision`, `pattern`, `research`, `meeting`, `session-log`, `guide`

**Tiers:**

- `slow` -- permanent knowledge (notes, decisions, patterns, research). Has review intervals.
- `fast` -- ephemeral (meetings, session logs). Has expiry dates. Auto-archived.

**Key frontmatter fields:** `title`, `type`, `tier`, `tags`, `summary`, `confidence` (high/medium/low/speculative), `status` (current/outdated/deprecated/draft), `review-interval`, `related`

## Knowledge Graph

Notes can be linked via the `related` frontmatter field. Use `brain graph` to traverse and `--expand` in search to include connected notes.

```bash
brain graph <note-id> --depth 2 --json    # Traverse 2-hop connections
brain search "query" --expand --json       # Search with graph expansion
```

After adding or updating `related` fields in frontmatter, run `brain index` to rebuild connections.

## Rules

- Always use `--json` when you need to parse output
- Search before claiming information isn't in the knowledge base
- Do NOT run `brain index` unless the user explicitly asks -- it processes all files and is slow
- DO run `brain index` after bulk frontmatter changes (e.g., adding `related` fields) -- graph connections won't update until re-indexed
- When adding notes, include frontmatter with at minimum: title, type, tier
- Present search results with score, file path, and excerpt
