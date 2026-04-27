# PM Module Architecture

A contributor guide to the internals of the `pm` brain module. Assumes TypeScript fluency and familiarity with CLI tools, but no prior knowledge of brain.

---

## 1. Module System Integration

Brain supports loadable modules through a `BrainModule` interface. Each module receives a `ModuleContext` during startup and uses it to register everything it needs:

```typescript
// src/modules/types.ts
export interface BrainModule {
  name: string;
  version: string;
  description: string;
  register(ctx: ModuleContext): void;
}

export interface ModuleContext {
  registerNoteType(noteType: ModuleNoteType): void;
  registerRelationType(relationType: ModuleRelationType): void;
  registerCommand(command: Command): void;
  registerExtractionStrategy(strategy: ModuleExtractionStrategy): void;
  registerFilter(filter: FilterProvider): void;
  registerMigration(migration: ModuleMigration): void;
}
```

The PM module entry point is `src/modules/pm/index.ts`. Its `register()` call installs:

- **6 note types**: `project`, `workstream`, `task`, `decision`, `prompt`, `capture`
- **4 relation types**: `depends_on`, `blocks`, `impacts`, `supersedes`
- **1 migration**: Creates SQLite indexes on `display_id`, `status`, `project`, and `type` inside the `notes` table metadata JSON column
- **1 extraction strategy**: `shouldExtract: () => false` — PM notes are never fed to the LLM memory extractor
- **1 filter**: `visibility: 'private'` — PM notes are excluded from the user's search results
- **22 command groups**: registered as subcommands of a top-level `pm` Commander command

All registration happens synchronously. The brain CLI calls `register()` once at startup before any command runs.

---

## 2. Layer Architecture

The PM module has three horizontal layers. Each layer only calls downward.

```
┌─────────────────────────────────────────────────────────┐
│  Commands  (src/modules/pm/commands/, 22 files)         │
│  CLI handlers · input validation · output formatting    │
├─────────────────────────────────────────────────────────┤
│  Data  (src/modules/pm/data/, 8+ files)                 │
│  Note CRUD · queries · cost calculations                │
├─────────────────────────────────────────────────────────┤
│  Engine  (src/modules/pm/engine/, 15 files)             │
│  State machine · routing · dispatch · templates         │
│  dependencies · claims · collisions · consistency       │
└─────────────────────────────────────────────────────────┘
         ↓
   brain-service / BrainDB / SQLite
```

**Commands** receive parsed CLI arguments, validate inputs, call into Data and Engine, then format output for the terminal (plain text or `--json`). Commands never query the database directly — they go through Data or Engine.

**Data** handles all note lifecycle: creating markdown files on disk, indexing them into SQLite, reading metadata back via queries, and writing relation rows. Data functions call `indexSingleFile()` from the core indexing service after any write so the database stays in sync with the filesystem.

**Engine** contains pure business logic with no direct filesystem access (except `worktree.ts` which invokes `git worktree`). Engine functions accept typed inputs and return `Result<T>` values. Engine may call Data for queries (e.g., `dependency.ts` calls `queries.getPmNotes`), but never the other direction.

---

## 3. Data Model

All PM data is stored as **markdown files with YAML frontmatter** in the brain notes directory. There is no separate PM database.

**File layout:**

```
{notesDir}/modules/pm/{PREFIX}/project.md
{notesDir}/modules/pm/{PREFIX}/{DISPLAY_ID}.md        ← workstream or task note
{notesDir}/modules/pm/{PREFIX}/{DISPLAY_ID}/          ← task content directory
{notesDir}/modules/pm/{PREFIX}/{DISPLAY_ID}/summary.md
```

A project with prefix `BRAIN` storing one workstream and one task looks like:

```
notes/modules/pm/BRAIN/project.md
notes/modules/pm/BRAIN/BRAIN-01.md       ← workstream
notes/modules/pm/BRAIN/BRAIN-01.01.md    ← task
notes/modules/pm/BRAIN/BRAIN-01.01/      ← task content dir
notes/modules/pm/BRAIN/BRAIN-01.01/summary.md
```

**Display ID format** (defined in `src/modules/pm/ids.ts`):

| Note type   | Pattern              | Example         |
|-------------|----------------------|-----------------|
| Project     | `{PREFIX}`           | `BRAIN`         |
| Workstream  | `{PREFIX}-{WS:02d}`  | `BRAIN-01`      |
| Task        | `{PREFIX}-{WS:02d}.{N:02d}` | `BRAIN-01.01` |

Prefixes are 2–5 uppercase alphanumeric characters. Workstream and task numbers are zero-padded to two digits.

**Metadata storage:** After indexing, YAML frontmatter fields are stored in the `notes.metadata` JSON column. Queries extract them with SQLite's `json_extract()`. The migration in `index.ts` installs indexes on the most-queried fields.

**Relations** are stored in brain's `relations` table: `depends_on`, `blocks`, `impacts`, `supersedes`. The `depends_on` / `blocks` pair is bidirectional (each is the other's `inverse`).

**Example task frontmatter:**

```yaml
---
id: brain-01.01-task
title: "Implement search indexing"
type: task
tier: slow
module: pm
project: BRAIN
workstream: 1
display_id: BRAIN-01.01
number: 1
status: pending
mode: agent
category: implementation
priority: high
depends_on: [BRAIN-01.00]
created: 2026-02-27
modified: 2026-02-27
---
```

---

## 4. State Machine

Source: `src/modules/pm/engine/state-machine.ts`

### Stored States

Seven states are persisted in frontmatter. Valid transitions:

```
pending  ──→  claimed  ──→  in-progress  ──→  pending-merge  ──→  done
   │             │                │
   └──→ blocked ←┘                └──→ blocked
   │                                       │
   └──→ cancelled                          └──→ cancelled

pending  ←──  blocked  ──→  cancelled
claimed  ←──  (no reverse to pending from in-progress)
```

The `pending-merge` state represents work that has been submitted as a PR and is awaiting review/merge. It is set by the review lifecycle (`brain pm review create`).

In code:

```typescript
const TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  'pending':        ['claimed', 'blocked', 'cancelled'],
  'claimed':        ['in-progress', 'pending', 'cancelled'],
  'in-progress':    ['done', 'pending-merge', 'blocked', 'cancelled'],
  'pending-merge':  ['done', 'in-progress', 'cancelled'],
  'done':           [],
  'blocked':        ['pending', 'cancelled'],
  'cancelled':      [],
};
```

`validateTransition(from, to)` returns `Result<void>`, failing with `INVALID_TRANSITION` if the transition is not in the table.

### Virtual States

Five computed states are never persisted — they are derived at query time by `computeVirtualState()`:

| Virtual state | Condition |
|---------------|-----------|
| `+READY`      | `pending` with no dependencies, or all dependencies `done` |
| `+ELIGIBLE`   | Same as `+READY` (both are emitted together) |
| `+BLOCKED`    | `pending` or `claimed` but has unfinished dependencies |
| `+STALE`      | `in-progress` and `claimed_at` is older than 7 days |
| `+OVERDUE`    | (type defined, not yet computed by `computeVirtualState`) |

`getTask()` in `data/task-ops.ts` calls `computeVirtualState()` and returns the virtual states alongside the stored metadata. Virtual states eliminate stale state bugs: if dependency status changes, the computed answer changes automatically with no migration needed.

### WIP Limiting

`canClaim(currentWip, wipLimit)` enforces the project-level WIP cap. If the project's `wip_limit` is set and the number of in-progress tasks equals or exceeds it, claiming fails with `WIP_LIMIT`.

---

## 5. Dependency Engine

Source: `src/modules/pm/engine/dependency.ts`

Dependencies are stored as `depends_on` relations in the `relations` table. The engine reads them via `db.getRelationsFrom()` and builds an in-memory adjacency list (DAG) for analysis.

### Key functions

**`buildDependencyGraph(db, prefix)`** — builds `Map<displayId, displayId[]>` from all `depends_on` relations within a project. Returns adjacency list: each key maps to the list of tasks it depends on.

**`computeEligible(db, prefix)`** — returns sorted display IDs of all `pending` tasks whose every dependency is `done`.

**`detectCycle(db, prefix, fromId, toId)`** — runs DFS from `toId` through existing `depends_on` edges. If the walk reaches `fromId`, adding this edge would close a cycle. Returns `Result<void>` with `CYCLE_DETECTED` error including the full cycle path. Self-dependencies are caught before the DFS.

**`computeWaves(db, prefix)`** — Kahn's algorithm for topological layering. Returns `WaveAssignment[]` where wave 0 contains tasks with no active dependencies, wave 1 contains tasks whose only dependencies are in wave 0, and so on. Used by orchestration to identify which tasks can run in parallel.

**`computeImpact(db, prefix, taskId)`** — simulates completing `taskId` and returns the display IDs of `pending` tasks that would become eligible as a result. Uses a reverse adjacency list built from `buildReverseGraph()`.

---

## 6. Routing Table

Source: `src/modules/pm/engine/routing.ts`

The routing table maps `TaskCategory` to an execution profile. Only tasks with `mode: 'agent'` are dispatched; all others return the non-agent default (sonnet, no isolation, no verification).

```typescript
const ROUTING_TABLE: Record<TaskCategory, RoutingResult> = {
  implementation: { agentType: 'general-purpose', model: 'opus',   isolation: 'worktree', verify: true,  concurrency: 'sequential-within-workstream' },
  infrastructure: { agentType: 'general-purpose', model: 'opus',   isolation: 'worktree', verify: true,  concurrency: 'sequential-within-workstream' },
  migration:      { agentType: 'general-purpose', model: 'opus',   isolation: 'worktree', verify: true,  concurrency: 'sequential-within-workstream' },
  design:         { agentType: 'general-purpose', model: 'opus',   isolation: 'none',     verify: false, concurrency: 'parallel' },
  research:       { agentType: 'Explore',         model: 'sonnet', isolation: 'none',     verify: false, concurrency: 'parallel' },
  review:         { agentType: 'Explore',         model: 'sonnet', isolation: 'none',     verify: false, concurrency: 'parallel' },
  documentation:  { agentType: 'general-purpose', model: 'sonnet', isolation: 'none',     verify: false, concurrency: 'parallel' },
  testing:        { agentType: 'general-purpose', model: 'haiku',  isolation: 'none',     verify: false, concurrency: 'parallel' },
  configuration:  { agentType: 'general-purpose', model: 'haiku',  isolation: 'none',     verify: false, concurrency: 'parallel' },
};
```

`computeRouting(category, mode)` is a pure lookup — no LLM decision, no dynamic dispatch. Categories that touch code (`implementation`, `infrastructure`, `migration`) get worktree isolation and a post-execution verification pass. Read-only categories (`research`, `review`) use the Explore agent type. Light-weight categories (`testing`, `configuration`) use Haiku.

The `isolation: 'worktree'` flag tells the caller to allocate a git worktree (via `engine/worktree.ts`) before launching the agent. The `verify: true` flag means a second read-only agent runs after the implementation agent to execute test/typecheck/lint/build.

---

## 7. Template Rendering

Source: `src/modules/pm/engine/template.ts` and `src/modules/pm/engine/dispatch.ts`

### Context Assembly

`assembleContext(db, taskDisplayId)` in `dispatch.ts` builds a `ContextBundle` from four sources:

1. **Task metadata** — loaded from `notes.metadata` JSON
2. **Dependency summaries** — for each `depends_on` entry, fetches the dependency's metadata and reads `summary.md` from its content directory if present
3. **Decision summaries** — finds all `decision` notes in the project whose `impacts` array includes this task's display ID
4. **Prompt content** — finds the `prompt` note linked to this task (skips `superseded` prompts)

A **context hash** is computed as `SHA256(JSON.stringify({ task, deps, decisions, prompt }))`. `isContextStale(bundle, db)` recomputes the hash and compares — if anything changed the bundle is stale and needs reassembly.

### Prompt Rendering

`renderAgentPrompt(bundle, options)` assembles the agent's system prompt as a multi-section markdown document:

- Task ID and role statement
- Dependencies section (if any)
- Decisions section (if any)
- Instructions section (from prompt note content)
- Validation section (category-specific commands: `npm test`, `npm run typecheck`, etc.)
- Status reporting section (shell commands for the agent to update task status)
- Worktree section (path if isolated, or "working in main tree")
- Completion instructions

`renderVerificationPrompt(bundle, options)` produces a simpler prompt for the read-only verification agent. It lists four checks (`npm test`, `npm run typecheck`, `npm run lint`, `npm run build`) and instructs the agent to report PASS/FAIL for each without modifying code.

`renderBriefingSummary(briefingJson)` renders a project status table (done/in-progress/eligible/blocked counts) plus eligible task list and recommendations.

---

## 8. Key Design Decisions

### Markdown-first storage

PM notes are real files on disk, not just database rows. The database is an index, not the source of truth. This means:

- Notes survive database corruption and can be rebuilt by re-indexing
- Project history is naturally git-versioned
- Humans can edit notes directly without tooling
- Each task has a content directory (`{DISPLAY_ID}/`) for agent artifacts like `summary.md`

The write path is always: write file → call `indexSingleFile()` → database updates. Reads always go through the database (faster, filterable by metadata).

### Module-scoped visibility

PM notes register `visibility: 'private'`. The `FilterProvider` tells the search system to exclude them from hybrid search results. A user querying "search for auth bugs" will not see their task notes in results. PM data is internal to the module.

### Claim tokens

When a task is claimed, a UUID token and timestamp are written to frontmatter:

```typescript
export function generateClaim(): ClaimResult {
  return { token: randomUUID(), claimedAt: new Date().toISOString() };
}
```

The token has a **10-minute TTL** (`DEFAULT_CLAIM_TIMEOUT_MS`). `isClaimStale()` checks elapsed time. A stale claim can be reclaimed by another agent without manual intervention. This prevents abandoned agent runs from permanently blocking tasks.

### Worktree budget

Git worktrees are allocated per-workstream (not per-task). If a workstream already has a worktree, additional tasks in that workstream reuse it. A project's `wip_limit` sets the maximum number of concurrent worktrees (default: 3). Allocations are persisted as JSON in the brain metadata key-value store (`META_KEY = 'pm_worktree_allocations'`).

This prevents unbounded parallel isolation that would exhaust disk or CPU. Tasks within a workstream run sequentially within their shared worktree.

### Virtual states

`+READY`, `+ELIGIBLE`, `+BLOCKED`, and `+STALE` are never written to disk. They are computed fresh each time `getTask()` is called. If a dependency completes, the blocked task's virtual state automatically becomes `+READY` on the next read with no update needed.

Storing derived state would require keeping it consistent across updates — a classic source of bugs. Computing it removes that class of problem entirely.

### Category-based routing

The routing table is a static lookup. There is no LLM call to decide which agent or model to use. Given `(category, mode)`, the result is deterministic and testable. This makes orchestration auditable: you can predict what will run before any agent is launched.

### Context hashing

`assembleContext()` hashes its full output bundle. Before an agent launches, the orchestrator can call `isContextStale()` to check whether the task, its dependencies, its decisions, or its prompt have changed since the bundle was assembled. This detects staleness cheaply (one hash comparison) without re-fetching all data.

### File-ownership collision detection

`engine/collisions.ts` scans task descriptions for file path patterns and detects overlaps across the set of concurrently eligible tasks. `dispatch-wave` reports these collisions before any agent is launched, so overlapping work can be serialized (via `depends_on`) before dispatch rather than discovered as a merge conflict after.

### Review lifecycle (pending-merge)

When an agent submits a PR, `brain pm review create` transitions the source task to `pending-merge` and creates a new review task. Downstream tasks that depended on the source task are rewired to depend on the review task instead, so they remain blocked until the PR is actually merged and the review task is completed. This prevents downstream work from starting on unmerged code.

---

## File Index

```
src/modules/pm/
  index.ts              — Module registration (note types, relations, commands, migration)
  types.ts              — All TypeScript types (TaskStatus, VirtualState, metadata interfaces)
  errors.ts             — Result<T> monad, PmError, ok()/fail() helpers
  ids.ts                — Display ID parsing, formatting, and next-number allocation
  commands/
    project.ts          — pm project create/list/show/update/delete
    workstream.ts       — pm workstream create/list/show/update/delete
    task.ts             — pm task create/list/show/update/delete/claim/start/release/reset/migrate
    decision.ts         — pm decision create/list/show/update/supersede
    prompt.ts           — pm prompt write/show/list/history
    orchestration.ts    — pm next/waves/dispatch/complete/briefing/overview/render-prompt
    orchestrate.ts      — pm orchestrate session-start/route/render/worktree-*/agent-done/session-end
    context.ts          — pm context (show task context bundle)
    verify.ts           — pm verify (generate verification checklist)
    capture.ts          — pm capture/inbox/process
    audit.ts            — pm audit summary/cost/performance/executions/enrich/cleanup
    check.ts            — pm check (structural + semantic consistency checks)
    import.ts           — pm import (bulk task import from JSON)
    install-hooks.ts    — pm install-hooks (Claude Code hooks + skills)
    dispatch-wave.ts    — pm dispatch-wave (wave analysis + collision detection)
    pull.ts             — pm pull (next eligible task for dispatch)
    review.ts           — pm review create (PR review task lifecycle)
    burndown.ts         — pm burndown run/status/launch (orchestrator loop)
    activity.ts         — pm activity list/show (activity note management)
    rename-prefix.ts    — pm rename-prefix (project prefix rename)
    relate.ts           — pm relate (create/remove note relations)
    onboard.ts          — pm onboard (codebase project setup)
  data/
    queries.ts          — Cross-entity queries: getPmNotes, getEligibleTasks, resolveDisplayId
    project-ops.ts      — Project CRUD
    workstream-ops.ts   — Workstream CRUD
    task-ops.ts         — Task CRUD + status updates + virtual state computation
    decision-ops.ts     — Decision CRUD
    prompt-ops.ts       — Prompt CRUD
    capture-ops.ts      — Capture note CRUD
    cost.ts             — Token cost estimation utilities
  engine/
    state-machine.ts    — Transition table, validateTransition, computeVirtualState, canClaim
    dependency.ts       — DAG construction, cycle detection, wave computation, impact analysis
    routing.ts          — Category → execution profile lookup table
    dispatch.ts         — ContextBundle assembly (task + workstream + deps + decisions + related notes)
    template.ts         — Agent prompt, verification prompt, briefing summary rendering
    claims.ts           — Claim token generation, validation, and staleness checks
    collisions.ts       — File-ownership overlap detection across concurrent tasks
    consistency.ts      — Structural checks: orphans, broken deps, blocked-without-cause, cancelled deps
    concurrency.ts      — WIP accounting and slot management
    activity.ts         — Activity note recording helpers
    command-resolution.ts — Shared command/workstream resolution utilities
    rename-prefix.ts    — Prefix rename logic (file moves + frontmatter rewrite)
    review-context.ts   — Review task context assembly for PR lifecycle
    detect.ts           — Project/workstream auto-detection from cwd
    doc-scanner.ts      — Documentation file discovery for onboarding
```
