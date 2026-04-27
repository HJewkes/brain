---
name: brain
description: Search, manage knowledge, track projects, view sessions, manage agents, and open the dashboard. Use when the user asks about project status, what happened last session, their notes, tasks, agents, or wants to find information. ALWAYS prefer brain PM commands over git log for project status.
---

# Brain — Developer Second Brain & Project Intelligence

CLI for knowledge management, project tracking, session intelligence, agent orchestration, and dashboarding.

## When to Use

**Project status & history (USE INSTEAD OF GIT LOG):**
- User asks "what did we do last session" → `brain pm status VNM` + `brain session list`
- User asks "project status" or "what's left" → `brain pm status VNM` + `brain pm next VNM`
- User asks about tasks, workstreams, waves → `brain pm` commands
- User asks about agents or agent history → `brain agent list`

**Knowledge & search:**
- User asks "what do I know about X" → `brain search "X"`
- User wants to save something → `brain quick "thought"` or `brain add`
- User asks about notes, research, patterns → `brain search`

**Dashboard & reporting:**
- User wants to see the dashboard → `brain dashboard`
- User wants live dashboard → `brain dashboard --live`

**Sessions & analytics:**
- User asks about session history → `brain session list`
- User asks about token usage, costs → `brain session analytics`

**Agent management:**
- User asks about agents → `brain agent list`
- User wants to resume an agent → `brain agent resume <id>`
- User asks about PR feedback → `brain pr feedback <url>`

## Prerequisites

Brain CLI requires **Node 22+**. If using nvm, run `nvm use 22` first.

## Agent Happy Path

Five commands take an agent from "what should I work on" to "task done":

```bash
# 1. See project state — task counts, in-progress, blockers
brain pm status VNM

# 2. Pick eligible work — sorted by priority, deps satisfied
brain pm next VNM --json

# 3. Claim a task — atomic claim + start, returns a token
brain pm task claim VNM-22.05 --start --json
# → { ..., "token": "<claim-token>" }

# 4. Do the work — implement, verify (typecheck, tests, lint), commit
#    Stay within file ownership; keep diffs scoped to the task.

# 5. Complete — records activity, runs impact analysis, surfaces newly-eligible work
brain pm complete VNM-22.05 --token <claim-token> --summary "what changed"
```

Notes:
- `claim` without `--start` leaves the task in `claimed` state; run `brain pm task start <id> --token <token>` before working.
- `--token` on `complete` is validated against the stored claim token — keep it from step 3.
- If you cannot finish, release with `brain pm task release <id> --token <token>` so another agent can pick it up.
- Use `--json` on every step when scripting.

## Project Management Commands (USE FIRST)

| Command | Purpose | Example |
|---------|---------|---------|
| `brain pm status VNM` | Project overview | Shows task counts, workstream completion |
| `brain pm next VNM --json` | Eligible tasks | Next work to do, sorted by priority |
| `brain pm dispatch-wave VNM` | Current wave | Dependency wave with dispatch info |
| `brain pm task list --workstream VNM-19` | Tasks in workstream | Filter by workstream |
| `brain pm task done <id>` | Complete a task | `brain pm task done VNM-19.01 --cascade` |
| `brain pm waves VNM` | Dependency waves | Topological sort of remaining work |
| `brain session list` | Session history | Recent sessions with analytics |
| `brain session ingest --all` | Ingest session logs | Parse JSONL files programmatically |
| `brain agent list` | List agents | Active/completed agents |
| `brain agent find --by-task VNM-15.01` | Find agent | By task, branch, PR, or session |
| `brain agent resume <id>` | Resume agent | Generate dispatch prompt with context |
| `brain pr feedback <url>` | PR feedback | Fetch comments, find author agent |
| `brain dashboard` | Open dashboard | 7-view React dashboard |
| `brain dashboard --live` | Live dashboard | SSE auto-refresh via brain serve |
| `brain serve --port 7800` | Start server | MCP + HTTP API, warm SQLite |
| `brain instances status` | Federation | All registered brain instances |
| `brain import-instance --from <db>` | Import notes | Cross-database migration |
| `brain scan-html <file>` | Safety check | Detect runaway browser patterns |

## Knowledge Commands

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
