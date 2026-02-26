# PM Module — Data Model & CLI Design

**Date:** 2026-02-25
**Status:** Draft
**Depends on:** 01-brain-module-system.md
**Part of:** Task Management Framework — Design Series

---

## Overview

The PM (project management) module is the first brain module. It provides structured project management as a brain extension: projects, workstreams, tasks, decisions, and prompts — all stored as brain notes with module-enforced schemas, connected by a dependency graph, and queryable through both brain search and PM-specific commands.

**Storage model:** PM uses three brain-level primitives — no PM-specific tables.

1. **Notes + metadata JSON** — All PM entities (tasks, decisions, projects, workstreams, prompts, captures) are brain notes with `module: pm`. Their PM-specific fields live in `notes.metadata` as JSON. Queried via `json_extract()`.
2. **Extended note_relations** — Brain's existing relation table, extended with `module` and `module_instance` columns. PM registers relation types: `depends_on`, `blocks`, `impacts`, `supersedes`. The dependency engine queries `note_relations WHERE module = 'pm' AND relation_type = 'depends_on'`.
3. **Activities** — A brain-level activity log table. PM writes execution telemetry, state changes, and reviews as activities with `module: 'pm'`. Token/model/cost data lives in the activity's `metadata` JSON.

This document covers the data model, state machine, dependency engine, decision propagation, CLI interface, and the prompt system.

---

## Data Model

### Entity Hierarchy

```
Project
  └── Workstream
        └── Task
              ├── Decision (captured during execution)
              └── Prompt (execution instructions)
```

All entities are brain notes with `module: pm` frontmatter. The hierarchy is expressed through frontmatter references, not directory structure — though a directory convention exists for prompt files and logs.

### Identifier System

Following Linear's pattern (research: clean, human-readable, unique):

- **Project prefix:** 2-5 uppercase chars, e.g., `WEB` (WebApp), `TM` (Task Management)
- **Workstream number:** 2-digit, e.g., `00`, `08`
- **Task number:** Sequential within workstream, e.g., `01`, `12`
- **Display ID:** `WEB-08.05` (project-workstream.task)
- **Internal ID:** UUID (brain note ID, used for storage and cross-references)
- **Fully qualified:** `pm:webproject:WEB-08.05` (for cross-module references)

```bash
brain pm task list                    # uses display IDs
brain pm task show WEB-08.05         # human-friendly
brain pm task show --id <uuid>       # escape hatch
```

### Note Type: Project

```yaml
---
type: project
module: pm
title: "WebApp Redesign"
prefix: WEB
status: active              # active | paused | completed | archived
phase: 1                    # current phase (project-defined)
phases:
  0: "Discovery"
  1: "Core Features"
  2: "Integration"
  3: "Polish"
appetite: "2 weeks"         # Shape Up: time budget, not estimate
created: 2026-02-25
tags: [ai, infrastructure]
---

Project description and goals in markdown body.
```

**Visibility:** public (searchable in general brain queries)
**Instance key:** This IS the instance — `module_instance` is derived from `prefix`

### Note Type: Workstream

```yaml
---
type: workstream
module: pm
module_instance: webproject
project: WEB
number: "08"
title: "API Integration"
status: active              # active | completed | blocked
phase: 1
tags: [api, integration]
---

Workstream overview, context, and notes in body.
```

**Visibility:** contextual (appears in search when project is active)

### Note Type: Task

```yaml
---
type: task
module: pm
module_instance: webproject
project: WEB
workstream: "08"
number: "05"
title: "Build Task Tracking MVP"
status: pending             # pending | claimed | in-progress | done | blocked | cancelled
mode: agent                 # human | assisted | agent | review
category: implementation    # research | implementation | configuration | design | review | validation | documentation | interview | migration
priority: high              # critical | high | medium | low
assignee: null              # human name or "agent"
depends_on:
  - WEB-08.04
  - WEB-07.04
blocks:
  - WEB-08.06
prompt_note: WEB-08.05      # linked prompt note (type: prompt), NOT a file path
estimated_time: "2h"
tags: [implementation, brain]
created: 2026-02-25
started_at: null
completed_at: null
blocked_reason: null
# Claim tracking (populated during execution)
claimed_by: null            # "agent" or human name
claim_token: null           # UUID, prevents race conditions
claimed_at: null
agent_id: null              # Claude Code sub-agent ID
parent_session: null        # orchestrator session ID
---

Task description, context, acceptance criteria in body.
```

**Visibility:** contextual
**Searchable fields:** title, body, tags

Tasks are directory-backed notes. On creation, brain manages a content directory at `{notesDir}/modules/pm/{PROJECT}-{WS}/{TASK}/` containing `summary.md` (post-completion) and `references/` (supplementary material). See doc 01, Directory-Backed Notes.

### Note Type: Decision

```yaml
---
type: decision
module: pm
module_instance: webproject
project: WEB
id: DEC-003
title: "REST API with versioned endpoints"
status: accepted            # proposed | accepted | superseded | rejected
source_task: WEB-03.01      # which task produced this decision
rationale: "Balances flexibility with backward compatibility"
impacts:
  - WEB-03.04               # tasks affected by this decision
  - WEB-04.01
  - WEB-10.02
supersedes: null             # DEC-ID if this replaces an earlier decision
tags: [architecture, api]
created: 2026-02-25
---

Full decision context and reasoning in body.
```

**Visibility:** public (decisions should always be searchable)

### Note Type: Prompt

```yaml
---
type: prompt
module: pm
module_instance: webproject
project: WEB
task: WEB-08.05
title: "Build Task Tracking MVP"
prompt_status: current       # stub | current | superseded
mode: agent
scope:
  - WEB-08.05
---

Full prompt content in body (the execution instructions for the agent or human).
```

**Visibility:** private (only accessed through `brain pm dispatch`)

### Prompt Lifecycle

Prompts are **brain notes** with `type: prompt`, linked to tasks by convention (same display ID prefix).

- A task's prompt is a brain note, NOT a filesystem path. The `prompt_file` field in task frontmatter is **removed** — use the linked prompt note instead.
- `brain pm prompt write WEB-08.05 --content "..."` creates a prompt note linked to task WEB-08.05
- `brain pm dispatch WEB-08.05` reads the prompt note, assembles context (dependency summaries, decisions), and renders the final agent prompt
- Prompt versioning: `brain pm prompt write` on an existing prompt creates a new version. Previous versions are preserved with `prompt_status: superseded`. The latest is `prompt_status: current`.
- `brain pm prompt list --status stub` finds tasks with no prompt note (stubs needing content)

---

## State Machine

### Stored States

`pending | claimed | in-progress | done | blocked | cancelled`

```
                    ┌──────────────┐
                    │   pending    │  (waiting for dependencies or dispatch)
                    └──────┬───────┘
                           │ orchestrator claims (+READY guard)
                    ┌──────▼───────┐
                    │   claimed    │  (assigned to agent/human, timeout: 10min)
                    └──────┬───────┘
                           │ work begins
                    ┌──────▼───────┐
             ┌──────│ in-progress  │──────┐
             │      └──────┬───────┘      │
             │             │              │
       blocked by    completed      failed/needs
       external      successfully    revision
             │             │              │
      ┌──────▼───────┐ ┌──▼────┐  ┌──────▼───────┐
      │   blocked    │ │ done  │  │  pending      │
      └──────────────┘ └───────┘  │  (re-queued)  │
                                  └───────────────┘
```

### State Transitions

| From | To | Trigger | Validation |
|------|----|---------|------------|
| pending | claimed | Orchestrator assigns to agent/human | Task must be +READY, WIP limit check, claim_token generated |
| claimed | in-progress | Agent/human starts work | claim_token must match |
| claimed | pending | Claim timeout (>10 min) or explicit release | Auto-revert on stale claims |
| in-progress | done | Task completed | Acceptance criteria met, validation passes |
| in-progress | blocked | External blocker | `blocked_reason` required |
| in-progress | pending | Needs revision | Re-enters dependency check |
| blocked | pending | Blocker resolved | `blocked_reason` cleared |
| any | cancelled | Explicitly cancelled | Update `blocks` dependents |

### Claim Mechanism

Claims prevent race conditions when multiple orchestrator sessions or parallel agents might grab the same task:

```bash
brain pm task claim WEB-08.05              # → returns claim_token UUID
brain pm task start WEB-08.05 --token <t>  # → claimed → in-progress (validates token)
brain pm complete WEB-08.05 --token <t>    # → in-progress → done (validates token)
brain pm task release WEB-08.05            # → claimed → pending (explicit release)
```

Stale claim detection: `brain pm task list --status claimed --stale` returns tasks claimed >10 minutes ago with no transition. The orchestrator auto-reverts these to `pending` on session start.

### Computed States (Virtual, like Taskwarrior)

- **`+READY`** — `pending` + all `depends_on` tasks are `done` (never stored, always computed)
- **`+ELIGIBLE`** — `+READY` + no WIP limit conflict
- **`+BLOCKED`** — has unfinished dependencies
- **`+BLOCKING`** — other tasks depend on this one
- **`+OVERDUE`** — past `due` date
- **`+STALE`** — in-progress for >48h with no log updates

### WIP Limits (from Kanban research)

Default limits (configurable in module config):
- `in-progress` tasks per project: 5
- `in-progress` agent tasks (concurrent): 3
- `review` tasks pending: 3

When a limit is hit, `brain pm next` surfaces the limit and suggests completing existing work first.

### Edge Cases

| Scenario | Behavior |
|----------|----------|
| Claim an already-claimed task | Error: `ALREADY_CLAIMED` with existing claim info |
| Complete a task not in `in-progress` | Error: `INVALID_TRANSITION` |
| Cancel a task that blocks others | Dependents transition to `blocked` with reason "dependency <id> cancelled" |
| Delete a project with in-progress tasks | Error unless `--force`; force cancels all non-done tasks first |
| Stale claim (>10min, no start) | Auto-reverts to `pending` on next `brain pm next` or `brain pm briefing` |
| Complete with invalid claim token | Error: `INVALID_CLAIM_TOKEN` |
| Add dependency that creates cycle | Error: `CYCLE_DETECTED` with cycle path shown; dependency NOT added |
| Dispatch a task with no prompt | Error: `NO_PROMPT` with suggestion to run `brain pm prompt write` |

---

## Dependency Engine

### Graph Representation

Dependencies stored in two places:
1. **Frontmatter** — `depends_on` and `blocks` arrays on task notes (human-readable source of truth)
2. **note_relations** — Brain's relation table with `module = 'pm'` scoping (computed index for fast graph operations)

The `note_relations` rows are rebuilt on `brain index` — the frontmatter is authoritative.

PM stores dependencies as brain relations:
- `source_id`: the task note that depends on another
- `target_id`: the note it depends ON
- `relation_type`: `depends_on` (also `blocks`, `impacts` for other edge types)
- `module`: `pm`
- `module_instance`: the project instance (e.g., `webproject`)

Brain's `onNoteDelete` cascade automatically cleans up relations when notes are deleted.

### Eligible Task Computation

The "next eligible task" query (adapted from research on build system DAGs):

```sql
-- Eligible tasks: pending with all dependencies done (+READY computation)
SELECT n.id,
       json_extract(n.metadata, '$.display_id') as display_id,
       json_extract(n.metadata, '$.title') as title,
       json_extract(n.metadata, '$.priority') as priority,
       json_extract(n.metadata, '$.mode') as mode
FROM notes n
WHERE n.module = 'pm' AND n.module_instance = ?
  AND json_extract(n.metadata, '$.type') = 'task'
  AND json_extract(n.metadata, '$.status') = 'pending'
  AND NOT EXISTS (
    SELECT 1 FROM note_relations r
    JOIN notes dep ON dep.id = r.target_id
    WHERE r.source_id = n.id
      AND r.relation_type = 'depends_on'
      AND r.module = 'pm'
      AND json_extract(dep.metadata, '$.status') != 'done'
  )
ORDER BY
  CASE json_extract(n.metadata, '$.priority')
    WHEN 'critical' THEN 0 WHEN 'high' THEN 1
    WHEN 'medium' THEN 2 WHEN 'low' THEN 3
  END,
  json_extract(n.metadata, '$.display_id');
```

### Cycle Detection

- **On `brain pm task add --depends-on`**: incremental check — DFS from target to source. If adding the edge would create a cycle, the dependency is rejected with error `CYCLE_DETECTED` and the cycle path is shown.
- **On `brain index`**: full Tarjan's SCC as a safety net. Any cycles found mark all tasks in the cycle as `blocked` with reason "circular dependency: <cycle path>".

### Impact Analysis

When a task completes:

```typescript
async function onTaskComplete(taskId: string, db: BrainDB): Promise<TaskImpact> {
  // 1. Find tasks blocked by this one (via note_relations)
  const unblocked = db.query(`
    SELECT r.source_id FROM note_relations r
    WHERE r.target_id = ? AND r.relation_type = 'depends_on' AND r.module = 'pm'
      AND r.source_id NOT IN (
        SELECT r2.source_id FROM note_relations r2
        JOIN notes dep ON dep.id = r2.target_id
        WHERE r2.relation_type = 'depends_on' AND r2.module = 'pm'
          AND r2.target_id != ?
          AND json_extract(dep.metadata, '$.status') != 'done'
      )
  `, [taskId, taskId]);

  // 2. Newly eligible tasks are now +READY (virtual state, no status change needed)
  // They remain 'pending' but will appear in brain pm next / brain pm task list --eligible

  // 3. Check for decision impacts (via note_relations with relation_type = 'impacts')
  const decisions = await getDecisionsFromTask(taskId);
  const impactedTasks = decisions.flatMap(d => d.impacts);

  return { unblocked, impactedTasks, decisions };
}
```

---

## Decision Propagation

### How Decisions Flow

1. **Capture** — During task execution, the agent/human records a decision
2. **Store** — Decision note created with `impacts` field listing affected tasks
3. **Propagate** — When impacted tasks are dispatched, their prompt context includes the decision
4. **Detect staleness** — If a prompt was rendered before a decision that impacts it, flag it

### Decision Capture

```bash
# During task execution
brain pm decision add "Use PostgreSQL for persistence" \
  --task WEB-03.01 \
  --impacts WEB-03.04,WEB-04.01 \
  --tags architecture,database

# Or the orchestrator captures it automatically from agent output
```

### Prompt Staleness Detection

Each prompt rendering records a content hash and timestamp. When a new decision lands that impacts a task:

```typescript
async function checkPromptFreshness(taskId: string): Promise<boolean> {
  // Last-dispatch metadata is stored on the task note's metadata
  const task = db.get('SELECT metadata FROM notes WHERE id = ?', taskId);
  const lastHash = json_extract(task.metadata, '$.last_dispatch_hash');
  if (!lastHash) return false; // never dispatched, always fresh

  const decisions = await getDecisionsImpactingTask(taskId);
  const latestDecision = decisions.sort((a, b) => b.created - a.created)[0];
  const lastDispatchAt = json_extract(task.metadata, '$.last_dispatch_at');

  return !latestDecision || latestDecision.created < lastDispatchAt;
}
```

Prompt cache is handled in-memory by the dispatch command: compute a content hash, compare with `last_dispatch_hash` and `last_dispatch_at` stored in the task note's metadata. No separate cache table needed.

When `brain pm dispatch` detects a stale prompt, it:
1. Re-renders the prompt with updated decision context
2. Highlights what changed since last render
3. Updates `last_dispatch_hash` and `last_dispatch_at` on the task note's metadata

### Decision Impact Relations

Decision impacts are stored as `note_relations` with `relation_type: 'impacts'`:

When `brain pm decision add "..." --impacts WEB-08.05,WEB-08.06` is called:
- Creates a decision note with `type: decision` in notes.metadata
- Creates `note_relations` entries: decision → each impacted task with `relation_type: 'impacts'`
- `brain pm dispatch` queries these relations to assemble decision context into the prompt

### Prompt Assembly Algorithm

When `brain pm dispatch <id> --json` renders a prompt:

1. Load the task's prompt note (type: prompt, current version)
2. Load completed dependency summaries: for each `depends_on` task that is `done`, fetch its completion log
3. Load relevant decisions: query `note_relations WHERE relation_type = 'impacts' AND target_id = task_id AND module = 'pm'` for decisions impacting this task
4. Load project constraints from project note metadata
5. Assemble into the agent prompt template (instructions first, context second)
6. Compute `context_hash = SHA256(prompt_content + sorted_decision_ids + sorted_dependency_ids)`
7. Compare with `last_dispatch_hash` on the task note's metadata — if hash matches, prompt hasn't changed since last dispatch

This ensures agents always receive current context, and stale prompts are detectable.

---

## CLI Interface

### Project Commands

```bash
brain pm init "WebApp Redesign" --prefix WEB --phases "Discovery,Core Features,Integration,Polish"
brain pm list                         # list all projects
brain pm use webproject                # set active project context
brain pm status                       # current project state (the session briefing)
brain pm status --json                # machine-readable for orchestrator

brain pm project update <prefix> [options]
  --status <value>     # active | paused | completed
  --phase <n>          # current phase number
  --appetite <text>    # time budget
  --automation <assisted|autonomous>

brain pm project delete <prefix> [--force]
  # Requires all tasks done/cancelled unless --force
```

### Workstream Commands

```bash
brain pm workstream add "API Integration" --number 08 --phase 1
brain pm workstream list              # list workstreams in active project
brain pm workstream show 08           # workstream detail

brain pm workstream update <number> [options]
  --status <value>     # active | paused | completed
  --phase <n>          # phase number
  --automation <assisted|autonomous>

brain pm workstream delete <number> [--force]
  # Requires all tasks done/cancelled unless --force
```

### Task Commands

```bash
brain pm task add "Build Task Tracking MVP" \
  --workstream 08 --mode agent --priority high \
  --depends-on WEB-08.04,WEB-07.04

brain pm task list                    # all tasks in active project
brain pm task list --eligible          # tasks computed as +READY
brain pm task list --workstream 08    # filter by workstream
brain pm task list --mode agent       # only agent-executable tasks
brain pm task show WEB-08.05          # full task detail
brain pm task update WEB-08.05 --status in-progress
brain pm task update WEB-08.05 --worktree <path>  # record worktree assignment
brain pm task done WEB-08.05 --log "Implemented all CLI commands, tests passing"
brain pm task block WEB-08.05 --reason "Waiting on API access"
brain pm task unblock WEB-08.05

brain pm task delete <display-id> [--force]
  # Removes task and cleans up dependency edges
  # Fails if other tasks depend on this one unless --force
  # --force cascades: dependents get blocked with reason "dependency deleted"
```

**`brain pm task done` vs `brain pm complete`:**
- `brain pm task done <id> --log "..."` — simple status update, sets status to `done`, no telemetry.
- `brain pm complete <id> ...` — orchestration-aware completion: creates an activity record with execution telemetry, captures decisions, returns impact analysis (newly unblocked tasks). Used by the orchestrator skill.

### Orchestration Commands

```bash
brain pm next                         # recommend next task (considers priority, mode, dependencies)
brain pm next --mode agent            # next agent-executable task
brain pm next --mode assisted         # next human-assisted task

brain pm dispatch WEB-08.05            # render full execution prompt for this task
brain pm dispatch WEB-08.05 --json    # structured output for Claude Code

brain pm complete <display-id> [options]
  --token <uuid>           # Claim token (required for agent tasks)
  --outcome <value>        # completed | partial | failed | timeout | cancelled (default: completed)
  --log <text>             # Completion summary
  --model <name>           # Model used (e.g., claude-opus-4-6)
  --agent-id <id>          # Sub-agent identifier
  --session <id>           # Orchestrator session ID
  --input-tokens <n>       # Input token count
  --output-tokens <n>      # Output token count
  --cache-read-tokens <n>  # Cache read token count
  --tool-uses <n>          # Number of tool invocations
  --duration <seconds>     # Wall-clock duration
  --files-modified <n>     # Files changed count
  --decisions <text>       # Inline decision capture
  # All telemetry flags are optional — they populate the activity's metadata if provided,
  # but can also be backfilled by `brain pm audit enrich` from transcript parsing.

brain pm briefing                     # full session start briefing
brain pm briefing --json              # structured for orchestrator prompt

# Wave computation (dependency-free parallel groups)
brain pm waves --json                    # all eligible tasks grouped into waves
brain pm waves --project WEB --json      # specific project

# Just-in-time context (on-demand context retrieval)
brain pm context <display-id> --json                # full task context
brain pm context <display-id> --decisions --json     # decisions impacting this task
brain pm context <display-id> --deps --json          # dependency completion summaries
brain pm context <display-id> --since <ISO-8601>     # changes since timestamp
```

### Verification Commands

```bash
brain pm verify <display-id> --json                  # verification plan for a completed task
brain pm verify <display-id> --record --outcome <passed|failed> --log "..."
brain pm verify <display-id> --summary               # validate summary.md quality
```

### Decision Commands

```bash
brain pm decision add "Use REST over GraphQL" --task WEB-03.01 --impacts WEB-03.04,WEB-04.01
brain pm decision list                # all decisions in active project
brain pm decision list --task WEB-03.01  # decisions from a specific task
brain pm decision show DEC-003
brain pm decision supersede DEC-003 --with "Switch to GraphQL" --reason "..."
brain pm decision update <id> --superseded-by <new-id>
  # Mark a decision as superseded
```

### Import/Migration

```bash
brain pm import --from-json ~/project/tasks.json
  # Reads structured task data (status, dependencies, prompts)
  # Creates project, workstream, task, prompt notes
  # Preserves dependency graph
  # Maps existing task IDs to new display IDs

brain pm import --from-markdown ~/project/TODO.md
  # Parses markdown task lists into PM tasks
```

### Error Format

All commands return structured errors with `--json`:

```json
{
  "error": true,
  "code": "INVALID_TRANSITION",
  "message": "Cannot complete task WEB-08.05: current status is 'pending', expected 'in-progress'",
  "details": {
    "taskId": "WEB-08.05",
    "currentStatus": "pending",
    "expectedStatus": "in-progress"
  }
}
```

Standard error codes:
- `DUPLICATE_ID` — entity with this identifier already exists
- `NOT_FOUND` — referenced entity does not exist
- `INVALID_TRANSITION` — status transition not allowed from current state
- `INVALID_CLAIM_TOKEN` — claim token doesn't match or task not claimed
- `ALREADY_CLAIMED` — task is already claimed by another session
- `CYCLE_DETECTED` — adding this dependency would create a cycle
- `NO_PROMPT` — task has no prompt note for dispatch
- `PROJECT_EXISTS` — project with this prefix already exists
- `HAS_DEPENDENTS` — cannot delete/cancel; other tasks depend on this one
- `WIP_LIMIT` — work-in-progress limit reached for this status

---

## Output Formats

### `brain pm status --json`

```json
{
  "project": {
    "name": "WebApp Redesign",
    "prefix": "WEB",
    "phase": 1,
    "phaseName": "Core Features"
  },
  "progress": {
    "total": 72,
    "done": 12,
    "inProgress": 3,
    "ready": 5,
    "blocked": 2,
    "pending": 50
  },
  "workstreams": [
    {
      "number": "00",
      "name": "User Authentication",
      "status": "active",
      "progress": { "done": 5, "total": 9 }
    }
  ],
  "eligible": [
    {
      "id": "WEB-01.04",
      "title": "Configure OAuth providers",
      "mode": "assisted",
      "priority": "medium",
      "workstream": "01"
    }
  ],
  "blocked": [
    {
      "id": "WEB-07.01",
      "title": "Verify read-only behavior",
      "blockedBy": ["WEB-05.04"],
      "reason": null
    }
  ],
  "recentDecisions": [
    {
      "id": "DEC-003",
      "title": "REST API with versioned endpoints",
      "task": "WEB-03.01",
      "created": "2026-02-25"
    }
  ]
}
```

### `brain pm dispatch WEB-08.05 --json`

```json
{
  "task": {
    "displayId": "WEB-08.05",
    "title": "Build Task Tracking MVP",
    "mode": "agent",
    "workstream": "API Integration"
  },
  "prompt": "# Task WEB-08.05: Build Task Tracking MVP\n\n...",
  "context": {
    "decisions": [
      { "id": "DEC-001", "summary": "REST API chosen, versioned endpoints required" }
    ],
    "completedDependencies": [
      { "id": "WEB-08.04", "summary": "Task tracking design approved" },
      { "id": "WEB-07.04", "summary": "Execute permissions enabled" }
    ],
    "relatedNotes": [
      "logs/task-tracking-design.md"
    ]
  },
  "validation": [
    "All task CLI commands implemented per design",
    "Existing tests still pass",
    "New tests cover core task operations",
    "Build succeeds"
  ],
  "outputLocation": "workstreams/08-api-integration/logs/"
}
```

---

## Context Bundling for Agents

When `brain pm dispatch` renders a prompt for an agent task, it bundles exactly the context needed:

1. **The prompt itself** — Full execution instructions
2. **Completed dependency summaries** — One-line summary of each dependency's output
3. **Relevant decisions** — Any ADRs that impact this task
4. **Project constraints** — Budget, tech stack, conventions
5. **Validation criteria** — What "done" looks like

This prevents context pollution — the agent gets a focused, self-contained instruction set, not the entire project state.

---

## Hill Chart Integration (from Shape Up research)

Tasks optionally track their position on the hill chart:

```yaml
hill_position: exploring    # exploring | executing | done
```

- **Exploring** (uphill): Still discovering unknowns, creating sub-tasks, researching
- **Executing** (downhill): All unknowns resolved, just executing known work
- **Done**: Complete

This is more informative than task count progress bars. `brain pm status` can show:

```
Workstream 08 — API Integration
  ▲ exploring: WEB-08.04 (design task tracking)
  ▼ executing: WEB-08.03 (configure CLI access)
  ✓ done: WEB-08.01, WEB-08.02
```

---

## Task Categories (Taxonomy)

The `category` field classifies what kind of work a task represents, independent of `mode` (who does it). This enables cost and performance auditing across task types.

| Category | Description | Typical Model | Cost Profile |
|----------|-------------|---------------|-------------|
| `research` | Information gathering, surveys, analysis | Sonnet | High input tokens (web/docs), moderate output |
| `implementation` | Writing code, building features | Opus | High output tokens, many tool calls |
| `configuration` | Config files, setup, infrastructure changes | Haiku/Sonnet | Low token count, fast |
| `design` | Architecture, data model, interface design | Opus | Moderate tokens, thinking-heavy |
| `review` | Evaluate artifacts, provide feedback | Sonnet | High input (reading), moderate output |
| `validation` | Run tests, verify, check types, security audit | Haiku | Low tokens, mostly bash commands |
| `documentation` | Write docs, READMEs, guides | Sonnet | Moderate output |
| `interview` | Interactive Q&A with human | — | Human time, not token cost |
| `migration` | Move data, transform formats, transfer state | Sonnet | Variable |

A task can be `mode: agent, category: research` (agent does the research) or `mode: assisted, category: configuration` (human + agent configure together). The combination of mode + category drives model selection and cost expectations.

---

## Execution Telemetry

Every task execution (agent or human) produces a telemetry record. This enables cost tracking, performance auditing, and execution history.

### Execution Telemetry as Activities

PM execution telemetry is stored as brain **activities** — a core primitive available to all modules.

Each task execution creates an activity:

```json
{
  "id": "exec-uuid",
  "note_ids": ["task-note-id"],
  "module": "pm",
  "module_instance": "webproject",
  "activity_type": "execution",
  "actor_type": "agent",
  "actor_id": "agent-abc123",
  "session_id": "session-xyz",
  "metadata": {
    "display_id": "WEB-08.05",
    "attempt": 1,
    "model": "claude-sonnet-4-6",
    "category": "research",
    "mode": "agent",
    "input_tokens": null,
    "output_tokens": null,
    "cache_read_tokens": null,
    "total_tokens": null,
    "tool_uses": null,
    "estimated_cost_usd": null,
    "transcript_path": "~/.claude/projects/.../agent-abc123.jsonl",
    "files_modified": 0,
    "validation_passed": true,
    "decisions_captured": 1
  },
  "outcome": "completed",
  "started_at": "2026-02-26T10:00:00Z",
  "completed_at": "2026-02-26T10:05:00Z"
}
```

Token fields are nullable (Phase 1). `brain pm audit enrich` parses transcript files to backfill them (Phase 2).

### Data Collection

Token and timing data is collected in two phases:

**Phase 1 (on complete):** `brain pm complete` creates an activity with what the orchestrator knows at completion time: model, agent_id, session_id, timestamps, outcome. Token fields in the activity's metadata are nullable — the Task tool does NOT return token counts.

**Phase 2 (enrichment):** `brain pm audit enrich` parses agent transcript JSONL files to backfill token counts and compute costs:

```bash
brain pm audit enrich [--project <prefix>] [--task <display-id>]
  # Finds activities with activity_type='execution' and null token fields
  # Parses agent transcript JSONL files referenced by metadata.transcript_path
  # Backfills: input_tokens, output_tokens, cache_read_tokens, total_tokens, estimated_cost_usd
```

**Orchestrator tracking** — The orchestrator records `claimed_at`, `started_at`, `completed_at` timestamps as it manages the task lifecycle.

**Session hook** — A `SessionStart` hook writes the session ID and transcript path to `$CLAUDE_ENV_FILE` so they persist across the session:
```bash
# SessionStart hook
SESSION_ID=$(jq -r '.session_id' < /dev/stdin)
TRANSCRIPT=$(jq -r '.transcript_path' < /dev/stdin)
echo "export BRAIN_PM_SESSION=$SESSION_ID" >> "$CLAUDE_ENV_FILE"
echo "export BRAIN_PM_TRANSCRIPT=$TRANSCRIPT" >> "$CLAUDE_ENV_FILE"
```

Then `brain pm complete --session $BRAIN_PM_SESSION` reads from the env var.

### Cost Estimation

Estimated cost is computed from token counts using published model pricing:

```typescript
const MODEL_PRICING: Record<string, { input: number; output: number; cacheRead: number }> = {
  'claude-opus-4-6':   { input: 15.0, output: 75.0, cacheRead: 1.5 },
  'claude-sonnet-4-6': { input: 3.0,  output: 15.0, cacheRead: 0.3 },
  'claude-haiku-4-5':  { input: 0.8,  output: 4.0,  cacheRead: 0.08 },
};
// Per million tokens. Actual pricing may change — make this configurable.

function estimateCost(exec: Execution): number {
  const pricing = MODEL_PRICING[exec.model];
  if (!pricing) return 0;
  return (
    (exec.input_tokens * pricing.input +
     exec.output_tokens * pricing.output +
     exec.cache_read_tokens * pricing.cacheRead) / 1_000_000
  );
}
```

### Recording an Execution

```bash
brain pm complete WEB-08.05 \
  --token <claim_token> \
  --log "Implemented all CLI commands, tests passing" \
  --agent-id a4b6e491c93ded012 \
  --session $BRAIN_PM_SESSION \
  --model claude-opus-4-6 \
  --outcome completed \
  --duration 748 \
  --files-modified 4
```

Token fields are omitted at completion time — they are backfilled by `brain pm audit enrich` from transcript parsing. In practice, the orchestrator wraps this call and passes the metadata it knows at completion time.

Internally, `brain pm complete` creates an activity record:

```typescript
// brain pm complete creates an activity record
await createActivity({
  noteIds: [taskNoteId],
  module: 'pm',
  moduleInstance: project,
  activityType: 'execution',
  actorType: executorType,
  actorId: agentId,
  sessionId,
  metadata: { model, category, displayId, attempt, transcriptPath, ... },
  outcome,
  startedAt,
  completedAt: new Date().toISOString(),
});
```

---

## Audit Commands

### Cost Auditing

All audit commands query `activities WHERE module = 'pm' AND activity_type = 'execution'`:

```sql
-- Cost by category
SELECT json_extract(a.metadata, '$.category') as category,
       COUNT(*) as tasks,
       SUM(json_extract(a.metadata, '$.estimated_cost_usd')) as cost
FROM activities a
WHERE a.module = 'pm' AND a.module_instance = ?
  AND a.activity_type = 'execution'
  AND a.outcome = 'completed'
GROUP BY category;
```

```bash
brain pm audit cost --project WEB
# Output: total estimated cost by phase and workstream

brain pm audit cost --project WEB --by category
# Output: cost breakdown by task category (research, implementation, etc.)

brain pm audit cost --project WEB --by model
# Output: cost breakdown by model (opus, sonnet, haiku)

brain pm audit cost --since 2026-02-25
# Output: daily cost tracking (for budget monitoring)

brain pm audit cost --project WEB --json
# Output: structured cost report for export
```

### Performance Auditing

```bash
brain pm audit performance --project WEB
# Output: avg duration by category, token usage, failure rates

brain pm audit performance --project WEB --by mode
# Output: agent vs human vs assisted efficiency comparison

brain pm audit performance --model opus
# Output: all opus executions — was the model choice justified?
```

### Execution History

```bash
brain pm audit executions --task WEB-08.05
# Output: all attempts for a task — who, when, which model, tokens, cost, outcome

brain pm audit executions --project WEB --status failed
# Output: all failed executions — for debugging patterns

brain pm audit executions --agent-id a4b6e491c93ded012
# Output: details for a specific agent run, including transcript path
```

### Summary Report

```bash
brain pm audit summary --project WEB --json
# Output: comprehensive audit report
```

```json
{
  "project": "WEB",
  "totalExecutions": 48,
  "totalCostUsd": 12.50,
  "byCategory": {
    "research": { "count": 12, "costUsd": 3.20, "avgDurationSec": 180, "failRate": 0.08 },
    "implementation": { "count": 8, "costUsd": 5.10, "avgDurationSec": 420, "failRate": 0.12 },
    "configuration": { "count": 15, "costUsd": 1.80, "avgDurationSec": 60, "failRate": 0.0 },
    "review": { "count": 6, "costUsd": 1.40, "avgDurationSec": 90, "failRate": 0.0 },
    "validation": { "count": 7, "costUsd": 1.00, "avgDurationSec": 45, "failRate": 0.14 }
  },
  "byModel": {
    "claude-opus-4-6": { "count": 10, "costUsd": 7.20, "totalTokens": 580000 },
    "claude-sonnet-4-6": { "count": 28, "costUsd": 4.50, "totalTokens": 920000 },
    "claude-haiku-4-5": { "count": 10, "costUsd": 0.80, "totalTokens": 340000 }
  },
  "byMode": {
    "agent": { "count": 30, "costUsd": 10.20, "avgDurationSec": 200 },
    "assisted": { "count": 12, "costUsd": 2.10, "avgDurationSec": 300 },
    "human": { "count": 6, "costUsd": 0.20, "avgDurationSec": 0 }
  },
  "retryRate": 0.06,
  "avgDecisionsPerTask": 0.4
}
```

---

## Capture & Process (GTD Inbox)

### Capture Note Type

```yaml
---
type: capture
module: pm
module_instance: webproject
title: "Need to handle edge case in auth flow"
source: session           # session | manual | agent
captured_at: 2026-02-26T10:00:00Z
processed: false
---
Quick thought about the auth flow - what if the token expires mid-request?
```

### Commands

```bash
brain pm capture "Need to handle auth edge case"              # quick capture
brain pm capture --from-agent WEB-08.05 "Auth token expiry"   # agent surfaced this
brain pm inbox                                                 # list unprocessed captures
brain pm inbox --count                                         # just the count
brain pm process                                               # interactive: classify each capture
```

### Processing Flow

`brain pm process` presents each unprocessed capture and asks:

1. **Create task** — `brain pm task add` with the capture content as starting context
2. **Create decision** — `brain pm decision add`
3. **Add to existing task** — append as a note/comment on an existing task
4. **Discard** — mark as processed, no action
5. **Skip** — leave unprocessed for later

After processing, the capture note is marked `processed: true` with `processed_as: task|decision|note|discarded`.

This prevents the "capturing without processing" anti-pattern identified across all methodologies.

---

## Implementation Phases

### Phase 1: Core Data Model & Brain Primitives
- Project, workstream, task, decision note types with metadata JSON
- Extend `note_relations` with `module` and `module_instance` columns (brain-level migration)
- Create the `activities` table (brain-level migration)
- PM registers relation types (`depends_on`, `blocks`, `impacts`, `supersedes`) and activity types (`execution`)
- Module registration with brain
- Basic CRUD commands
- Tests

### Phase 2: Dependency Engine
- Dependency edges stored in `note_relations` with `module = 'pm'`
- Eligible task computation via `json_extract()` on notes.metadata
- Impact analysis on completion
- Cycle detection
- Tests

### Phase 3: State Machine & WIP
- State transitions with validation
- WIP limit enforcement
- Virtual computed states
- Tests

### Phase 4: Orchestration Commands
- `brain pm next`, `dispatch`, `complete`, `briefing`
- Context bundling for agent dispatch
- Prompt staleness detection
- JSON output for all commands
- Tests

### Phase 5: Decision Propagation
- Decision CRUD
- Impact tracking
- Prompt re-rendering on decision changes
- ADR supersession chain
- Tests

### Phase 6: Import & Migration
- JSON task data importer
- Generic markdown importer
- Tests

---

## Open Questions

1. **Workstream vs Epic vs Module** — Are workstreams sufficient, or do we need a separate "epic" concept for cross-workstream initiatives? Start with workstreams only, add if needed.

2. **Multi-project views** — Can `brain pm task list` span projects? Start with single-project scope, add `--all-projects` later.

3. **Task templates** — Should common task patterns (research → design → review → implement → verify) be templatable? Yes, but defer to Phase 7.

4. **Prompt versioning** — How do we track prompt iterations? The `prompt_status` field (stub, v1, v2, current) plus git history may be sufficient.

---

## Testing Strategy

### Framework

Brain uses **Vitest** (`vitest: ^3.0.5`) with `globals: true`. Tests live in a top-level `__tests__/` directory mirroring `src/`: unit tests under `__tests__/services/` and `__tests__/commands/`, integration tests under `__tests__/integration/`. The PM module follows the same layout — no co-located `*.test.ts` next to source files.

Run with `npm test` (`vitest run`). Coverage via `@vitest/coverage-v8`.

### Unit Tests

**State machine transitions:**
- Valid transitions: `pending→claimed` (+READY guard), `claimed→in-progress`, `in-progress→done`, etc.
- Invalid transitions: return `INVALID_TRANSITION` error with current/expected status
- Edge cases: double-claim returns `ALREADY_CLAIMED`, complete without `in-progress` returns error
- Virtual states: `+READY` computation (`pending` + all deps `done`), `+ELIGIBLE` (`+READY` + WIP limit)

**Dependency engine:**
- Eligible task computation: tasks with all deps `done` appear in `+READY` set
- Cycle detection (incremental DFS): adding `A→B→C→A` returns `CYCLE_DETECTED` with path
- Impact analysis: completing task X correctly identifies newly eligible downstream tasks
- Empty graph: all tasks are immediately `+READY`
- Diamond dependencies: task with two deps, both must complete before it becomes `+READY`

**Claim mechanism:**
- Claim returns token, transitions `pending→claimed`
- Start with valid token transitions `claimed→in-progress`
- Start with invalid token returns `INVALID_CLAIM_TOKEN`
- Release reverts `claimed→pending`
- Timeout: claimed >10 min without start reverts to `pending`

**Cost estimation:**
- Model pricing lookup for known models
- Cost calculation from token counts
- Unknown model returns zero cost (not an error)

### Integration Tests

**CLI command round-trips:**
- `brain pm init` → `brain pm status` shows project
- `brain pm task add` → `brain pm task list` includes task
- `brain pm task add --depends-on` with cycle → rejected with `CYCLE_DETECTED`
- `brain pm complete` → unblocked tasks appear in `brain pm next`
- `brain pm capture` → `brain pm inbox` shows capture
- `--json` output parses as valid JSON for all commands
- Error commands return structured error JSON with correct `code` field

**Module lifecycle:**
- Module registers types, commands, migrations
- Module with broken `register()` → brain continues, module marked failed
- Module migrations run on first load
- Module commands appear in `brain pm --help`

**Database integrity:**
- `brain index` with PM notes populates notes.metadata correctly
- PM dependency edges stored in note_relations with correct module scoping
- Activities created on task completion with correct metadata
- Delete a note → note_relations cascade, activities retain historical record

### Test Fixtures

**Standard project fixture:** A small project with known dependency structure for golden-file testing:

```
Project: TEST, 2 workstreams, 6 tasks
  TEST-01.01 (pending, no deps)                    — immediately +READY
  TEST-01.02 (pending, depends on 01.01)
  TEST-01.03 (pending, depends on 01.02)
  TEST-02.01 (pending, no deps)                    — immediately +READY
  TEST-02.02 (pending, depends on 01.01, 02.01)   — diamond
  TEST-02.03 (pending, depends on 01.03, 02.02)   — deep chain
```

This fixture exercises: linear chains, diamonds, cross-workstream deps, and eligible computation at various completion stages.

### What We Don't Test

- The orchestrator skill (it's a Claude Code prompt — tested by scripted CLI sequences, not automated tests)
- Transcript file parsing (external format, tested manually)
- Claude Code hook integration (tested empirically during development)

---

## References

- Research: tools-and-patterns.md (Taskwarrior UDAs, Linear's identifier pattern, Tarjan's SCC, ready-queue SQL)
- Research: methodologies.md (GTD capture, Shape Up appetite/hill charts, Kanban WIP limits, ADR pattern)
- Research: orchestration-patterns.md (state machines, decision propagation, context bundling)
- Design: 01-brain-module-system.md (module registration, namespace isolation, visibility tiers)
- Prior execution framework (dependencies.json schema, prompt file format, orchestrator.md)
