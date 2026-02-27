# PM Module Stream 2 — Implementation Design

**Date:** 2026-02-26
**Status:** Approved
**Gate for:** Stream 3 (Orchestration Layer)
**Branch:** `feat/module-system`
**Depends on:** Streams 0+1 (complete), V1-V3 integration tests (passing)
**Authoritative spec:** `02-pm-module-design.md` (adapted for actual codebase APIs)

---

## Purpose

Implement the full PM module as the first brain module. This is Stream 2 of the task management framework — everything from the module skeleton through CRUD, state machine, dependency engine, CLI commands, telemetry, audit, and import tools.

The PM module stores all data as brain notes with `module: pm` frontmatter. No PM-specific tables — only brain's existing primitives (notes + metadata JSON, relations, activities).

---

## Architecture & File Structure

The PM module lives as a built-in brain module at `src/modules/pm/`.

```
src/modules/pm/
  index.ts              # BrainModule export (register function)
  types.ts              # PM-specific TypeScript types & interfaces
  ids.ts                # Display ID system (WEB-08.05 generation, parsing, sequence tracking)
  errors.ts             # Structured error types and Result type
  data/
    project-ops.ts      # Project CRUD (init, list, update, delete, use/active context)
    workstream-ops.ts   # Workstream CRUD
    task-ops.ts         # Task CRUD + state transitions
    decision-ops.ts     # Decision CRUD + impact tracking
    prompt-ops.ts       # Prompt lifecycle (write, version, staleness)
    capture-ops.ts      # GTD capture/process
    queries.ts          # Shared query helpers (json_extract wrappers, module-scoped lookups)
  engine/
    state-machine.ts    # Transition validation, virtual state computation
    dependency.ts       # DAG: eligible computation, cycle detection, wave grouping, impact analysis
    claims.ts           # Claim tokens, timeout, release
    dispatch.ts         # Prompt assembly, context bundling, staleness detection
  commands/
    project.ts          # brain pm init, list, status, use, update, delete
    workstream.ts       # brain pm workstream add, list, show, update, delete
    task.ts             # brain pm task add, list, show, update, done, block, unblock, claim, start, release, delete
    orchestration.ts    # brain pm next, dispatch, complete, briefing, waves
    decision.ts         # brain pm decision add, list, show, supersede
    prompt.ts           # brain pm prompt write, show, list, history
    context.ts          # brain pm context (JIT context delivery)
    verify.ts           # brain pm verify
    capture.ts          # brain pm capture, inbox, process
    audit.ts            # brain pm audit summary, cost, performance, executions, enrich
    import.ts           # brain pm import
```

**Key principle:** Each `data/*-ops.ts` file contains pure functions that take a `BrainDB` and return results. No Commander.js in the data layer. Commands import from data and engine, never the reverse.

---

## Module Registration

The PM module's `register()` function registers all extension points.

### Note Types (6)

| Type | Tier | Visibility | Schema required fields |
|------|------|------------|----------------------|
| `project` | `slow` | `public` | `prefix`, `status` |
| `workstream` | `slow` | `contextual` | `project`, `number`, `status` |
| `task` | `slow` | `contextual` | `project`, `workstream`, `number`, `status`, `mode`, `category`, `priority` |
| `decision` | `slow` | `public` | `project`, `status`, `source_task` |
| `prompt` | `slow` | `private` | `project`, `task`, `prompt_status` |
| `capture` | `fast` | `private` | `source` |

Visibility governs search behavior:
- `public` — projects and decisions always appear in general brain search
- `contextual` — workstreams and tasks appear when their project is active
- `private` — prompts and captures only accessible via `brain pm` commands

### Relation Types (4)

| Type | Inverse | Usage |
|------|---------|-------|
| `depends_on` | `blocks` | Task dependency DAG |
| `blocks` | `depends_on` | Reverse of depends_on (for display) |
| `impacts` | — | Decision → impacted tasks |
| `supersedes` | — | Decision → superseded decision |

### Extraction Strategy

`shouldExtract` returns `false` for all PM notes. PM has its own context system (dispatch, context commands) — memory extraction would create noise.

### Migration (Version 1)

Creates expression indexes on `notes.metadata` for fast `json_extract` queries:

```sql
CREATE INDEX IF NOT EXISTS idx_pm_display_id ON notes(module, json_extract(metadata, '$.display_id'));
CREATE INDEX IF NOT EXISTS idx_pm_status ON notes(module, json_extract(metadata, '$.status'));
CREATE INDEX IF NOT EXISTS idx_pm_project ON notes(module, json_extract(metadata, '$.project'));
CREATE INDEX IF NOT EXISTS idx_pm_type ON notes(module, json_extract(metadata, '$.type'));
```

### Commands

A single `brain pm` parent command with subcommands for each entity type and orchestration. Registered as one Commander.js command tree.

---

## Adaptations from Doc 02

The design doc was written before Streams 0+1 were implemented. Known adaptations:

**Table name:** Doc 02 references `note_relations`. The actual table is `relations`. All queries adapt accordingly (`FROM relations WHERE module = 'pm'`).

**API signatures:** The actual module system APIs:
- `loadModules({ modules: [pmModule] })` returns `{ registry, errors }`
- `getRelationsFiltered(opts)` on BrainDB for module-scoped relation queries
- `getModuleNoteIds(filter)` on BrainDB for module-scoped note queries
- `validateNoteFrontmatter(frontmatter, schema)` for schema validation
- Relations upserted via `db.upsertRelations(noteId, relations)` during indexing

**Metadata storage:** `frontmatterToRecord()` stores `JSON.stringify(parsed.frontmatter)` in `notes.metadata` when `module` is present. PM-specific fields must be in frontmatter to appear in metadata. The `json_extract()` queries from doc 02 work against this.

**Active project context:** `brain pm use <prefix>` stores in brain's `db_meta` table as `pm_active_project` key. Simple, no filesystem state.

**Display ID resolution:** All CLI commands accept display IDs (WEB-08.05) and resolve to brain note IDs via `json_extract(metadata, '$.display_id')` lookup. Common pattern wrapped in `queries.ts`.

---

## Structured Error System

Every PM command returns structured errors with `--json`.

### Error Types

```typescript
interface PmError {
  error: true;
  code: PmErrorCode;
  message: string;
  details?: Record<string, unknown>;
}

type PmErrorCode =
  | 'PROJECT_EXISTS'
  | 'NOT_FOUND'
  | 'INVALID_TRANSITION'
  | 'INVALID_CLAIM_TOKEN'
  | 'ALREADY_CLAIMED'
  | 'CYCLE_DETECTED'
  | 'NO_PROMPT'
  | 'HAS_DEPENDENTS'
  | 'WIP_LIMIT'
  | 'DUPLICATE_ID'
  | 'INVALID_INPUT';
```

### Result Pattern

Every data-layer function returns `{ ok: true, data } | { ok: false, error: PmError }`. Commands check the result and either output JSON or write to stderr. Error handling stays at the boundary.

### CLI Behavior

- With `--json`: outputs `PmError` JSON to stdout, exit code 1
- Without `--json`: writes human-readable error to stderr, exit code 1
- Success with `--json`: outputs result JSON to stdout, exit code 0

Built in Wave 1, used by every subsequent wave.

---

## Data Layer Patterns

### Write Path

```
CLI command args
  → data/*-ops.ts builds frontmatter object with PM fields
  → writes markdown file to notesDir (frontmatter + body)
  → calls indexSingleFile() which:
    → parseMarkdown() coerces frontmatter (module present → type preserved)
    → frontmatterToRecord() stores full frontmatter as metadata JSON
    → upsertNote() writes to notes table
    → upsertRelations() writes depends_on/blocks/impacts to relations table
    → FTS indexed (including content_dir if present)
```

PM never writes directly to the notes table. It writes markdown files and lets the existing indexing pipeline handle storage. All PM notes are real brain notes — searchable, graphable, memory-extractable (though extraction is skipped by strategy).

### Read Path

```
CLI command
  → data/queries.ts helper
  → SQL query with json_extract() on notes.metadata
  → results mapped to PM TypeScript types
```

### Key Query Helpers (`queries.ts`)

- `resolveDisplayId(db, displayId)` → brain note ID (or NOT_FOUND error)
- `getProjectNotes(db, prefix)` → all notes for a project
- `getTasksByStatus(db, prefix, status)` → tasks filtered by status
- `getEligibleTasks(db, prefix)` → the +READY computation SQL from doc 02
- `getActiveProject(db)` → reads `pm_active_project` from db_meta

### Relation Management

Dependencies in frontmatter (`depends_on: [WEB-08.04]`) use display IDs. Resolution happens at write time — when `brain pm task add --depends-on WEB-08.04` runs, display IDs are resolved to note IDs immediately. Errors surface at input time. The frontmatter stores display IDs for human readability, and the command also calls `db.upsertRelations()` to create relation edges. Re-indexing rebuilds them from frontmatter.

### Directory-Backed Tasks

Tasks get a content directory at `{notesDir}/modules/pm/{PROJECT}/{DISPLAY_ID}/` containing:
- `summary.md` — written on completion
- `references/` — supplementary material added during execution

The `content_dir` frontmatter field points to this directory. Brain's FTS integration indexes `.md`/`.txt` files from it automatically.

---

## Wave Breakdown

Implementation follows vertical slices — 8 sequential waves, each delivering a working end-to-end feature with unit and integration tests.

### Wave 1: Module Skeleton + Project CRUD

**Builds:** `index.ts`, `types.ts`, `ids.ts`, `errors.ts`, `data/project-ops.ts`, `data/queries.ts`, `commands/project.ts`

**Delivers:** `brain pm init`, `brain pm list`, `brain pm status`, `brain pm use`, `brain pm project update`, `brain pm project delete`

**Unit tests** (`__tests__/modules/pm/`):
- `ids.test.ts` — Display ID generation, parsing, sequence allocation, edge cases (duplicate prefix, invalid format)
- `project-ops.test.ts` — Create project note with correct metadata JSON, list projects, update status/phase, delete with/without active tasks
- `queries.test.ts` — `json_extract` wrapper helpers, module-scoped note lookups
- `errors.test.ts` — Error construction, code mapping, JSON serialization

**Wave integration test** (`__tests__/integration/pm/wave-1-project.test.ts`):
- `brain pm init "Test" --prefix TST` → project note written to disk with correct frontmatter
- `brain pm list --json` → returns the project
- `brain pm status --json` → shows project with zero tasks
- `brain pm use tst` → sets active project context
- `brain pm project delete TST` → removes project note
- Structured error: init with duplicate prefix → `PROJECT_EXISTS` error JSON

### Wave 2: Workstream CRUD

**Builds:** `data/workstream-ops.ts`, `commands/workstream.ts`

**Delivers:** `brain pm workstream add/list/show/update/delete`

**Unit tests:**
- `workstream-ops.test.ts` — Create workstream linked to project, list by project, auto-number assignment, delete with/without tasks

**Wave integration test** (`__tests__/integration/pm/wave-2-workstream.test.ts`):
- Init project → add workstream → list shows it → show returns detail
- Add workstream without project → `NOT_FOUND` error
- Delete workstream with tasks → error unless `--force`

### Wave 3: Task CRUD + State Machine

**Builds:** `data/task-ops.ts`, `engine/state-machine.ts`, `commands/task.ts`

**Delivers:** `brain pm task add/list/show/update/done/block/unblock/delete` with full state transitions

**Unit tests:**
- `state-machine.test.ts` — Every valid transition, every invalid transition with error codes, virtual state computation (`+READY`, `+BLOCKED`, `+STALE`, `+OVERDUE`), WIP limit checks
- `task-ops.test.ts` — Create task with metadata JSON, directory-backed note creation (content_dir), list with filters (workstream, mode, status, eligible), update fields, delete with cascade

**Wave integration test** (`__tests__/integration/pm/wave-3-task.test.ts`):
- Full lifecycle: add → show → update status → done → verify DB state
- Invalid transition: done on a pending task → `INVALID_TRANSITION`
- Block/unblock round-trip
- Task with `content_dir` → directory created, FTS indexed
- `--json` output for all commands parses correctly

### Wave 4: Dependency Engine + Waves

**Builds:** `engine/dependency.ts`, `commands/orchestration.ts` (partial — `next` and `waves`)

**Delivers:** `brain pm next`, `brain pm waves`, cycle detection, eligible computation, impact analysis

**Unit tests:**
- `dependency.test.ts` — The algorithmic heart:
  - Eligible computation: empty graph (all ready), linear chain, diamond deps, cross-workstream deps
  - Cycle detection (incremental DFS): A→B→C→A returns `CYCLE_DETECTED` with path
  - Wave grouping: topological level assignment, in-flight tasks excluded
  - Impact analysis: completing task X identifies newly-unblocked downstream tasks
  - Standard project fixture exercised at multiple completion stages

**Wave integration test** (`__tests__/integration/pm/wave-4-deps.test.ts`):
- Build the standard 6-task fixture via CLI commands
- `brain pm next` → returns TEST-01.01 and TEST-02.01 (no deps)
- Complete TEST-01.01 → `brain pm next` includes TEST-01.02, TEST-02.02 still blocked
- Complete TEST-02.01 → TEST-02.02 now eligible (diamond resolved)
- `brain pm waves --json` → correct wave grouping at each stage
- Add cyclic dependency → `CYCLE_DETECTED` error with cycle path

### Wave 5: Claim Mechanism + Dispatch

**Builds:** `engine/claims.ts`, `engine/dispatch.ts`, `commands/orchestration.ts` (complete — `dispatch`, `complete`)

**Delivers:** `brain pm task claim/start/release`, `brain pm dispatch`, `brain pm complete`

**Unit tests:**
- `claims.test.ts` — Claim returns token, start validates token, invalid token rejected, release reverts to pending, stale claim detection (>10 min)
- `dispatch.test.ts` — Prompt assembly algorithm (prompt note + dependency summaries + decisions + constraints), context hash computation, staleness detection

**Wave integration test** (`__tests__/integration/pm/wave-5-dispatch.test.ts`):
- Claim → start → complete lifecycle with token validation
- Double-claim → `ALREADY_CLAIMED` error
- Invalid token on start → `INVALID_CLAIM_TOKEN`
- `brain pm dispatch TST-01.01 --json` → valid context bundle JSON with prompt, decisions, deps
- `brain pm complete` → activity record created, impact analysis returned

### Wave 6: Decision + Prompt Lifecycle

**Builds:** `data/decision-ops.ts`, `data/prompt-ops.ts`, `commands/decision.ts`, `commands/prompt.ts`

**Delivers:** `brain pm decision add/list/show/supersede`, `brain pm prompt write/show/list/history`

**Unit tests:**
- `decision-ops.test.ts` — Create decision with impacts relations, list by task/project, supersede (old→superseded, new→accepted)
- `prompt-ops.test.ts` — Write prompt note, version (superseded/current), staleness detection after new decision

**Wave integration test** (`__tests__/integration/pm/wave-6-decisions.test.ts`):
- Add decision with impacts → relations created in DB
- Supersede decision → old marked superseded, new is accepted
- Write prompt → dispatch includes it
- New decision after dispatch → prompt detected as stale
- `brain pm prompt list --status stub` → finds tasks without prompts

### Wave 7: Context + Verify + Briefing

**Builds:** `commands/context.ts`, `commands/verify.ts`, `commands/orchestration.ts` (briefing)

**Delivers:** `brain pm context`, `brain pm verify`, `brain pm briefing`

**Unit tests:**
- Context assembly: `--decisions`, `--deps`, `--since` filters
- Verify plan generation from task metadata

**Wave integration test** (`__tests__/integration/pm/wave-7-context.test.ts`):
- `brain pm context TST-01.02 --json` → includes dependency summaries and decisions
- `brain pm context TST-01.02 --since <timestamp>` → filters to recent activities
- `brain pm verify TST-01.01 --json` → returns verification plan
- `brain pm briefing --json` → full session briefing with project state

### Wave 8: Telemetry + Audit + Import + Errors

**Builds:** `commands/audit.ts`, `commands/import.ts`, `commands/capture.ts`, remaining error polish

**Delivers:** `brain pm audit summary/cost/performance/executions/enrich`, `brain pm import`, `brain pm capture/inbox/process`, structured error format verified across all commands

**Unit tests:**
- Cost estimation from token counts with model pricing
- Audit query aggregation (by category, model, mode)
- Import parsing (JSON and markdown formats)
- Capture note creation and processing flow

**Wave integration test** (`__tests__/integration/pm/wave-8-audit.test.ts`):
- Complete several tasks with telemetry → `brain pm audit summary --json` returns correct aggregates
- `brain pm capture "note"` → `brain pm inbox` shows it
- `brain pm import --from-json` → project created with tasks and dependencies
- All error codes verified: every `--json` error has correct `code`, `message`, `details`

---

## Wave Dependencies

```
Wave 1 (skeleton + project)
  │
  ├─► Wave 2 (workstream) ── needs project to exist
  │     │
  │     ├─► Wave 3 (task + state machine) ── needs workstream to attach to
  │     │     │
  │     │     ├─► Wave 4 (deps + waves) ── needs tasks for DAG operations
  │     │     │     │
  │     │     │     ├─► Wave 5 (claims + dispatch) ── needs deps for eligible guard
  │     │     │     │     │
  │     │     │     │     ├─► Wave 6 (decisions + prompts) ── needs dispatch for staleness
  │     │     │     │     │     │
  │     │     │     │     │     ├─► Wave 7 (context + verify + briefing) ── assembles from all prior
  │     │     │     │     │     │     │
  │     │     │     │     │     │     ├─► Wave 8 (telemetry + audit + import) ── cross-cutting
```

Strictly sequential — each wave's integration test exercises features from all prior waves.

---

## Testing Strategy

### Three Test Layers

1. **Unit tests** — Pure function tests for the data/engine layer. Real BrainDB with temp files, no external mocks. Fast, isolated.
2. **Wave integration tests** — End-to-end per wave: CLI command → data layer → DB → query back. One test file per wave in `__tests__/integration/pm/`.
3. **Cumulative integration tests** — After all 8 waves, V4-V7 from the verification strategy proving the full PM module works as a brain module.

### Cumulative Integration Tests (V4-V7)

After all 8 waves, at `__tests__/integration/pm-smoke.test.ts`:

**V4. PM Module Smoke Test** — Load PM module via `loadModules`, create project/workstream/tasks, verify all indexed with correct module/type, relations stored with module scope, query scoping works.

**V5. State Machine + Dependency Engine** — Full lifecycle: create tasks with deps, verify blocked/ready states, complete tasks, verify unblocking cascade, cycle detection.

**V6. CLI Commands** — Programmatic Commander.js `parseAsync` for all major command paths. Verify JSON output contracts.

**V7. Directory-Backed Tasks** — Create task with content_dir, write files, index, search for content, dispatch includes directory contents.

### Standard Project Fixture

Reusable across Wave 4+ tests at `__tests__/fixtures/pm-project.ts`:

```
Project: TEST, 2 workstreams, 6 tasks
  TEST-01.01 (pending, no deps)              — immediately +READY
  TEST-01.02 (pending, depends on 01.01)
  TEST-01.03 (pending, depends on 01.02)
  TEST-02.01 (pending, no deps)              — immediately +READY
  TEST-02.02 (pending, depends on 01.01, 02.01) — diamond
  TEST-02.03 (pending, depends on 01.03, 02.02) — deep chain
```

Exercises: linear chains, diamonds, cross-workstream deps, and eligible computation at various completion stages. Built using the PM data layer (not raw SQL).

### Gate Criteria (per wave)

1. All new unit tests pass
2. Wave integration test passes
3. `npx vitest run` — zero regressions
4. `npx tsc --noEmit` — zero type errors
5. No new lint warnings

### Test File Summary

```
__tests__/
  modules/pm/
    ids.test.ts
    errors.test.ts
    project-ops.test.ts
    workstream-ops.test.ts
    task-ops.test.ts
    state-machine.test.ts
    dependency.test.ts
    claims.test.ts
    dispatch.test.ts
    decision-ops.test.ts
    prompt-ops.test.ts
    queries.test.ts
    cost.test.ts
    import.test.ts
    capture-ops.test.ts
  integration/pm/
    wave-1-project.test.ts
    wave-2-workstream.test.ts
    wave-3-task.test.ts
    wave-4-deps.test.ts
    wave-5-dispatch.test.ts
    wave-6-decisions.test.ts
    wave-7-context.test.ts
    wave-8-audit.test.ts
  integration/
    pm-smoke.test.ts        # V4-V7 cumulative
  fixtures/
    pm-project.ts           # Standard 6-task fixture
```

---

## Estimated Test Counts

| Wave | Unit tests | Integration tests | Running total |
|------|-----------|-------------------|--------------|
| 1 | ~20 | ~8 | ~28 |
| 2 | ~10 | ~6 | ~44 |
| 3 | ~30 | ~10 | ~84 |
| 4 | ~25 | ~10 | ~119 |
| 5 | ~20 | ~10 | ~149 |
| 6 | ~20 | ~8 | ~177 |
| 7 | ~10 | ~8 | ~195 |
| 8 | ~15 | ~10 | ~220 |
| V4-V7 | — | ~20 | ~240 |

**Total:** ~240 new tests on top of existing 517, bringing the suite to ~757.

---

## New Files Summary

| Category | Count | Location |
|----------|-------|----------|
| Source | ~18 | `src/modules/pm/` (types, ids, errors, 6 data ops, 4 engine, index) |
| Commands | ~11 | `src/modules/pm/commands/` |
| Unit tests | ~15 | `__tests__/modules/pm/` |
| Wave integration tests | 8 | `__tests__/integration/pm/` |
| Cumulative integration | 1 | `__tests__/integration/pm-smoke.test.ts` |
| Fixtures | 1 | `__tests__/fixtures/pm-project.ts` |

---

## Success Criteria

- All ~240 new tests pass
- No regressions in existing 517 tests (~757 total)
- `npx tsc --noEmit` clean
- V4-V7 cumulative integration tests pass
- Manual smoke: `brain pm init` → create tasks → `brain pm waves --json` → dispatch → complete lifecycle works end-to-end
