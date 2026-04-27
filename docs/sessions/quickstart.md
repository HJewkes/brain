# Session Intelligence Quick Start

The session module ingests Claude Code session JSONL files, extracts structured metadata, and generates summaries at multiple levels of detail. Sessions become searchable brain notes linked to PM tasks, enabling project briefings, analytics, and context restoration when resuming interrupted work.

## Prerequisites

- brain initialized and indexed
- At least one Claude Code session JSONL file (typically under `~/.claude/projects/`)

---

## 1. What Problem It Solves

Long agent sessions contain a wealth of information — decisions made, tasks completed, errors encountered — that disappears when the context window compacts. The session module preserves that history as structured notes, so you can answer questions like "what did we decide last Tuesday?" or "which tasks did last session's agent complete?" without re-reading raw JSONL.

---

## 2. Ingest Sessions

Discover and ingest Claude Code session files:

```bash
brain session ingest
```

Output:

```
Discovered: 12 sessions
Skipped (already ingested): 9
Ingested: 3
  SNS-041  2026-04-26  VNM  feat/search  45 min  completed
  SNS-042  2026-04-27  VNM  feat/tests   22 min  completed
  SNS-043  2026-04-27  VNM  main         8 min   active
```

To re-ingest an already-processed session: `brain session ingest --force`

To ingest only recent sessions: `brain session ingest --since 2026-04-25`

---

## 3. List Sessions

```bash
brain session list
```

Output:

```
SNS-041  2026-04-26  VNM  feat/search   45 min  completed
SNS-042  2026-04-27  VNM  feat/tests    22 min  completed
SNS-043  2026-04-27  VNM  main           8 min  active
```

Filter by status: `brain session list --status active`

---

## 4. Show Session Detail

```bash
brain session show SNS-041
```

Shows:
- L0 summary (one-liner)
- Tasks worked and completed
- Commits made
- Token usage and tool call counts
- Segments (compaction boundaries)
- Error count

---

## 5. Restore Session Context

When resuming after an interruption, restore the session context to brief your next agent:

```bash
brain session restore SNS-041
```

Output is a structured context block containing: what was in progress, last decisions, open tasks, and suggested next steps.

---

## 6. Get a Project Briefing

Generate a current-state briefing across all recent sessions for a project:

```bash
brain session briefing
```

Output:

```
=== Project Briefing: VNM ===
Active branch: feat/search
Recent sessions: 3 (last: SNS-043, 8 min ago)
Tasks in progress: MY-01-003, MY-01-004
Last completed: MY-01-002 (SNS-042)
Recommended next: MY-01-003 (implementation, high)
```

---

## 7. View Analytics

```bash
brain session analytics
```

Shows session counts, average duration, task throughput, error rates, and tool usage by project.

---

## How It Works

`discoverSessions` (`src/modules/sessions/ingestion/discovery.ts`) scans `~/.claude/projects/` for JSONL files. The ingestion pipeline (`src/modules/sessions/ingestion/pipeline.ts`) parses each file, generates a three-level summary (L0: one-liner, L1: key events, L2: timeline), detects task links, and creates a brain note with structured frontmatter. Sessions are stored as `type: session` notes with `module: sessions` isolation.

Capture hooks fire during active sessions to record tool events and generate briefing context at session start.

---

## Session Note Fields

Each ingested session note includes:

```yaml
session_id: <UUID>
display_id: SNS-041
project: VNM
branch: feat/search
status: completed
duration_minutes: 45
total_turns: 156
tool_calls: 243
tasks_worked: [MY-01-002, MY-01-003]
tasks_completed: [MY-01-002]
commits: [sha1, sha2]
```

---

## Related

- Ingestion pipeline: `src/modules/sessions/ingestion/pipeline.ts`
- Discovery: `src/modules/sessions/ingestion/discovery.ts`
- Capture hooks: `src/modules/sessions/hooks/`
- MCP tools: `brain_session_list`, `brain_session_show`
