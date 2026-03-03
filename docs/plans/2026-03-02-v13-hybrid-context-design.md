# V13 Design: Hybrid Context, Activity Trails, Dependency Refactor

**Date:** 2026-03-02
**Status:** Approved
**Baseline:** V12 diagnostic (4.1/5 avg, 10/30 at 5/5, 12.5 calls/prompt)
**Observations registry:** `docs/pm-module/onboarding-observations-v3.md` (212 total, 170 open)

## Overview

V13 addresses the five fix targets from the V12 diagnostic plus regression test coverage for all resolved observations. Six workstreams across four waves.

**Key architectural decisions:**
- Relations table is the single source of truth for dependencies (drop frontmatter)
- Hybrid context scoring: graph distance × 0.6 + semantic similarity × 0.4
- Activity notes on every state transition with required relation edges
- Embedding lifecycle state (`embed_status`) on all notes
- Commands.md decomposed into per-group reference notes, indexed on init
- Intelligent command resolution with tiered error recovery (fuzzy → semantic → help menu)

---

## Section 1: Activity System + Embedding Lifecycle

### Activity Notes on State Transitions

Every task state transition creates an activity note. Transitions tracked: `claim`, `start`, `block`, `unblock`, `complete`, `cancel`.

**Activity note frontmatter schema:**

```yaml
---
id: volt-complete-volt-01-03-2026-03-02T14-30
title: "Complete: VOLT-01.03 → done"
type: activity
tier: slow
module: pm
project: VOLT
activity_type: complete
task_id: VOLT-01.03
from_state: in-progress
to_state: done
summary: "Implemented BLE adapter with retry logic"
newly_eligible:
  - VOLT-01.04
  - VOLT-02.01
completed_at: 2026-03-02T14:30:00Z
duration_minutes: 45
embed_status: queued
created: 2026-03-02T14:30:00Z
modified: 2026-03-02T14:30:00Z
---
```

**Required relations** (created atomically with the note):
- `activity --[recorded_for]--> task-note`
- `activity --[unblocked]--> downstream-task-note` (for each newly eligible task)

**activity_type enum** expands from `['onboard', 'import', 'delete']` to: `['onboard', 'import', 'delete', 'complete', 'claim', 'start', 'block', 'unblock', 'cancel']`.

**Implementation:** Extract `createActivityNote()` helper from the onboard pattern in `onboard.ts`. Call from `updateTaskStatus()` after the state transition succeeds.

### Embedding Lifecycle State

Add `embed_status` to every note's metadata:

| State | Meaning |
|-------|---------|
| `queued` | Note created/updated, needs embedding |
| `embedding` | Embedding in progress |
| `embedded` | Chunks + vectors current |
| `failed` | Embedding failed (error in metadata) |
| `stale` | Embedding model changed, needs re-embedding |

Plus `embed_updated_at` timestamp.

**Generated columns** (SQLite migration):

```sql
ALTER TABLE notes ADD COLUMN embed_status TEXT
  GENERATED ALWAYS AS (json_extract(metadata, '$.embed_status'));
ALTER TABLE notes ADD COLUMN activity_type TEXT
  GENERATED ALWAYS AS (json_extract(metadata, '$.activity_type'));
CREATE INDEX idx_notes_embed_status ON notes(embed_status);
CREATE INDEX idx_notes_activity_type ON notes(activity_type);
```

**Write pattern** (atomic note + eventual embedding):
1. Write markdown file
2. Single SQLite transaction: upsert note row + upsert relations + set `embed_status: queued`
3. Separately: process embedding queue → `embedding` → generate chunks → `embedded`

**Staleness detection:** `brain doctor` checks for notes stuck in `embedding` for >30 min → resets to `queued`. On model change: `UPDATE notes SET metadata = json_set(metadata, '$.embed_status', 'stale') WHERE embed_status = 'embedded'`.

### Observations Addressed

O-159 (complete no activity), O-27 (zero activities — extended to all transitions), O-94/O-114 (newly eligible not surfaced — computed and stored in activity note).

---

## Section 2: Dependencies as Relations (Single Source of Truth)

### Problem

Dependencies live in two places: frontmatter `depends_on` arrays and relation table edges. The wave algorithm reads relations correctly, but task JSON serialization and virtual state computation read frontmatter — creating stale data when dependencies are added via inference or auto-linking.

### Migration: Relations as Authoritative

No historical migration needed — clean cut. All readers switch to relations, all writers stop updating frontmatter.

**Read path changes:**

| Consumer | Current Source | V13 Source |
|----------|---------------|------------|
| `computeWaves()` | relations table | no change |
| `getTask()` / `listTasks()` | frontmatter + `mergeDependsOn()` | relations only via `getDependencyDisplayIds(db, noteId)` |
| `computeVirtualState()` | task metadata (from above) | fed correct data from relations |
| `assembleContext()` | relations + frontmatter fallback | relations only |
| Task JSON output | frontmatter `depends_on` | computed from relations at serialization time |

**Write path changes:**

| Writer | Current | V13 |
|--------|---------|-----|
| `createTask(dependsOn)` | frontmatter + relations | relations only |
| `task update --depends-on` | frontmatter | relations only |
| `inferDependencies()` | relations only | no change |
| onboard auto-linking | relations only | no change |

**Frontmatter cleanup:** Stop writing `depends_on` in `buildTaskMarkdown()`. Existing frontmatter fields become inert.

### Virtual State Fix

```typescript
// In listTasks() enrichment:
const depRelations = db.getRelationsFrom(noteId)
  .filter(r => r.type === 'depends_on');
const hasDependencies = depRelations.length > 0;
const dependenciesComplete = depRelations.every(r => {
  const depNote = db.getNote(r.targetId);
  const depMeta = JSON.parse(depNote?.metadata ?? '{}');
  return depMeta.status === 'done' || depMeta.status === 'cancelled';
});
```

### Wave Output Improvements

- O-134: `--workstream <id>` filter on `brain pm waves`
- O-142: Project prefix as positional arg
- O-145: "No tasks in waves" message when empty
- O-92: Summary footer: `{N} tasks across {M} waves`

### Impact Analysis on Complete

```typescript
function computeNewlyEligible(db: BrainDB, completedTaskNoteId: string): string[] {
  const downstream = db.getRelationsTo(completedTaskNoteId)
    .filter(r => r.type === 'depends_on');
  return downstream.filter(rel => {
    const allDeps = db.getRelationsFrom(rel.sourceId)
      .filter(r => r.type === 'depends_on');
    return allDeps.every(dep => {
      const meta = JSON.parse(db.getNote(dep.targetId)?.metadata ?? '{}');
      return meta.status === 'done' || meta.status === 'cancelled';
    });
  }).map(rel => /* resolve to display_id */);
}
```

Feeds into the activity note's `newly_eligible` field and `complete` command output.

### Observations Addressed

O-108, O-114, O-134, O-142, O-145, O-92, O-163, O-176, O-195, O-196.

---

## Section 3: Hybrid Context Assembly (Graph + Semantic)

### Problem

`assembleContext()` finds related notes using semantic search only. Explicit relation edges are used for dependencies but not for discovering related docs. Structurally central notes that are textually dissimilar never surface.

### Hybrid Scoring Model

```
final_score = (0.6 × graph_score) + (0.4 × semantic_score)
```

- `graph_score`: distance-decayed from relation traversal (1.0 at depth 1, 0.5 at depth 2, 0.25 at depth 3)
- `semantic_score`: normalized cosine similarity (0.0–1.0)
- Notes with both graph links AND high semantic similarity rank highest
- Notes with only one signal still surface through their respective weight

### Implementation Flow

```
assembleRelatedNotes(db, embedder, entityNoteId, limit=10):

  1. Graph pass:
     - traverseGraph(db, entityNoteId, maxDepth=3)
     - Score each node: 1.0 / (2 ^ depth)
     - Exclude self, exclude already-gathered dependencies
     - Result: Map<noteId, { graph_score, relation_type, depth }>

  2. Semantic pass:
     - search(db, embedder, queryText, { limit: 15, includePm: true })
     - Normalize scores to 0.0–1.0 range
     - Result: Map<noteId, { semantic_score }>

  3. Fusion:
     - Union both maps
     - final_score = (0.6 × graph_score) + (0.4 × semantic_score)
     - Notes in only one pass get 0.0 for the missing score
     - Sort descending, take top `limit`

  4. Label source:
     - 'linked' if graph_score > 0 AND semantic_score > 0
     - 'graph' if graph_score > 0 only
     - 'semantic' if semantic_score > 0 only

  Return: RelatedNote[] with { noteId, title, score, source, relation_type?, depth? }
```

### Integration Points

| Command | Current | V13 |
|---------|---------|-----|
| `brain pm context <task-id>` | semantic only | hybrid |
| `brain pm context <workstream-id>` | semantic only (often NOT_FOUND) | hybrid, fix workstream lookup |
| `brain pm dispatch <task-id>` | semantic only | hybrid |
| `brain context <path>` | fails for PM notes | route PM paths to hybrid, KB paths stay semantic |

### Self-Exclusion Fix (O-151)

Filter `noteId === entityNoteId` from both passes before fusion.

### PM Notes in Default Search (O-49)

- `brain search` includes PM notes by default (remove exclusion filter)
- Add `--exclude-pm` flag for KB-only results
- PM notes tagged `module: pm` for post-hoc filtering

### Observations Addressed

O-146, O-151, O-49, O-72, O-86, O-87, O-122, O-123, O-154, O-190, O-209.

---

## Section 4: CLI Surface Polish + Intelligent Command Resolution

### New Top-Level Shortcuts

**`brain pm show <id>` (O-131):**

```
brain pm show VOLT        → project show VOLT
brain pm show VOLT-01     → workstream show VOLT-01
brain pm show VOLT-01.03  → task show VOLT-01.03
```

Detection: contains `.` → task; contains `-` but no `.` → workstream; otherwise → project.

**`brain pm claim <id>` (O-143):**

```
brain pm claim VOLT-01.03  → task claim VOLT-01.03
```

Passes through `--start` and `--json`.

**`brain pm task <id>` shorthand (O-133):**

Single argument matching display ID pattern (contains `.`) defaults to `show`:

```
brain pm task VOLT-01.03  → task show VOLT-01.03
```

### Flag Aliases

**`--format json` (O-137):** On all commands with `--json`, accept `--format <value>`. If `format === 'json'`, set `json = true`. Otherwise emit clear error pointing to `--json`.

**`brain pm next --all` (O-130):** Add `--all` flag to disable truncation. `--limit 0` as equivalent.

### Namespace Redirect Errors (O-139)

```
$ brain pm task show VOLT-01
Error: VOLT-01 is a workstream, not a task.
  → Use: brain pm workstream show VOLT-01
```

Uses same `.`-based pattern matching from `pm show`.

### dispatch Without Mandatory ID (O-144)

```
brain pm dispatch              → auto-selects top eligible task
brain pm dispatch VOLT-01.03   → explicit (current behavior)
brain pm dispatch --workstream VOLT-01  → top eligible in workstream (O-135)
```

### Intelligent Command Resolution

Three-tier recovery when a PM subcommand is unrecognized:

**Tier 1 — Fuzzy match** (instant, no DB needed):
Levenshtein distance ≤ 2 against known subcommands:
```
$ brain pm taks list
Error: Unknown command "taks". Did you mean "task"?
```

**Tier 2 — Semantic search** (uses indexed reference docs):
Search brain's reference notes for the user's input. Confidence-based behavior:
- Score > 0.9 + read-only operation: auto-suggest with explanation
- Score > 0.9 + write operation: suggest, require confirmation
- Score 0.7–0.9: show top 2-3 suggestions
- Score < 0.7: fall back to Tier 3

```
$ brain pm dependencies VOLT-01.03
Error: Unknown command "dependencies".
Suggested: brain pm task show VOLT-01.03 --json (shows depends_on field)
           brain pm waves --workstream VOLT-01 (dependency ordering)
```

**Tier 3 — Contextual help menu** (static fallback):
```
Available commands:
  Project:    init, list, status, use, show, delete
  Workstream: add, list, show
  Task:       add, list, show, update, claim, complete, block
  Planning:   waves, next, dispatch, briefing
  Context:    context, audit, check
  Data:       onboard, activity, relate
```

Grouped by function, not alphabetical.

**Implementation:** Single `resolveUnknownCommand()` function. Tier 1 is pure string matching. Tier 2 only runs if DB + embedder available (post-init). Tier 3 is static. Write operations identified by checking against set: `['add', 'update', 'delete', 'claim', 'complete', 'block', 'done', 'cancel']`.

### Observations Addressed

O-130, O-131, O-133, O-135, O-137, O-139, O-143, O-144, O-41, O-35.

---

## Section 5: Commands.md Decomposition + Init Indexing Fix

### Problem

`brain init` writes `commands.md` (1,510 lines) and `architecture.md` as monolithic reference notes but never indexes them into SQLite. Even if indexed, a single giant note returns as a blob.

### Decomposition Strategy

Split into per-command-group source files:

```
docs/pm-module/commands/
  _index.md          — Overview: enum values, aliases, conventions (~50 lines)
  project.md         — init, list, status, use, show, update, delete
  workstream.md      — add, list, show, update, delete
  task.md            — add, list, show, update, done, block, claim, etc.
  planning.md        — waves, next, dispatch, briefing, orchestrate
  context.md         — context, verify, audit, check
  data.md            — onboard, relate, activity, import, capture
  setup.md           — setup, decision, prompt, template
```

~8 files, each 100-200 lines. Original `commands.md` stays as-is for humans.

**Generated reference notes** (in brain's notes dir):

```
~/brain/modules/pm/reference/
  pm-ref-overview.md
  pm-ref-project.md
  pm-ref-workstream.md
  pm-ref-task.md
  pm-ref-planning.md
  pm-ref-context.md
  pm-ref-data.md
  pm-ref-setup.md
```

Each with YAML frontmatter: `type: reference`, `tier: slow`, `module: pm`, `embed_status: queued`.

**Relations between reference notes:**
- `pm-ref-overview --[parent]--> pm-ref-task` (etc.)
- `pm-ref-task --[related]--> pm-ref-planning`
- `pm-ref-context --[related]--> pm-ref-data`

### Init Indexing Fix

Update `ingestBrainReferenceDocs()` to:
1. Read decomposed source files from `docs/pm-module/commands/*.md`
2. Write each as a reference note with frontmatter
3. **Call `indexSingleFile()` for each** — note row + FTS + chunks + `embed_status: queued`
4. Create relation edges between reference notes
5. Hash-based skip logic stays (don't re-write/re-index if unchanged)

### Two-Tier Reference Data Architecture

**Tier 1 (V13):** Ingestion-based. Decomposed files → reference notes via pipeline. Produces working baseline for evaluation.

**Tier 2 (V14+, deferred):** Golden dataset. After diagnostic evaluation, export optimized state as JSON seed files (`src/modules/pm/seed/reference-notes.json`, `reference-relations.json`). On init: if golden dataset exists and version matches → bulk INSERT (fast, deterministic). Else → fall back to ingestion.

V13 stubs the golden path: `if (goldenDatasetExists(config)) return seedFromGolden(db, config)`.

### Observations Addressed

O-104, O-41, O-35.

---

## Section 6: Regression Tests

### Strategy

~40 regression tests across 4 files covering all 42 resolved observations. Each test encodes the original failure scenario and asserts the fix holds.

**`__tests__/modules/pm/v13-regressions-navigation.test.ts`** (~10 tests):
O-05, O-09, O-11, O-17, O-36, O-39, O-40, O-54, O-55, O-113.

**`__tests__/modules/pm/v13-regressions-state.test.ts`** (~7 tests):
O-52, O-57, O-58, O-59, O-61, O-62, O-63.

**`__tests__/modules/pm/v13-regressions-context.test.ts`** (~6 tests):
O-50, O-51, O-64, O-65, O-75, O-76.

**`__tests__/modules/pm/v13-regressions-data.test.ts`** (~10 tests):
O-66, O-68, O-70, O-73, O-80, O-88, O-91, O-97, O-102, O-103.

**Previously regressed observations** (extra scrutiny):

| ID | Regression | Extra Assertion |
|----|-----------|-----------------|
| O-57 | O-166 | Token in both JSON and text output |
| O-63 | O-130 | Ordering with 4+ tasks at different priorities |
| O-83 | O-188 | `--full` produces longer output than without |
| O-103 | O-165 | Project note body contains workstream names |

### Test Pattern

```typescript
// Regression: O-57 — claim output must include token
it('task claim shows claim token in output', () => {
  const result = pm('task claim', taskId);
  expect(result.exitCode).toBe(0);
  const json = JSON.parse(result.stdout);
  expect(json.token).toBeDefined();
  expect(json.token).toMatch(/^[a-f0-9-]+$/);
});
```

All use in-process DB test pattern (`tmpDbPath`, direct function calls).

---

## Section 7: Wave Structure + Scope Summary

### Wave Structure

**Wave 1 — Foundation (parallel, no interdependencies):**
- Embedding lifecycle state (migration + `embed_status` field)
- Relations as single source of truth (refactor readers + writers)
- CLI shortcuts + flag aliases (`pm show`, `pm claim`, `task <id>`, `--format`, `--all`)
- Commands.md decomposition (8 source files + `ingestBrainReferenceDocs` update)
- Regression tests: navigation + state files

**Wave 2 — Depends on Wave 1:**
- Activity notes on state transitions (needs embedding lifecycle)
- Wave output improvements (needs relations source of truth)
- Impact analysis on complete (needs relations + activity notes)
- Namespace redirect errors (needs CLI routing logic)
- Regression tests: context + data files

**Wave 3 — Depends on Wave 2:**
- Hybrid context assembly (needs relations + embedding lifecycle)
- PM notes in default search (same pipeline changes)
- Intelligent command resolution Tiers 1-3 (needs indexed reference docs)

**Wave 4 — Integration:**
- Integration tests (all waves complete)
- Diagnostic prep

**Gate per wave:** `npx vitest run && npx tsc --noEmit`

### Observation Tally

- **35 observations directly addressed** by new implementation
- **3 observations indirectly improved**
- **42 resolved observations** covered by regression tests
- **Total impact:** 80 of 212 observations touched

### Success Criteria

| Metric | V12 Baseline | V13 Target |
|--------|-------------|------------|
| Avg quality | 4.1/5 | ≥ 4.3/5 |
| Prompts at 5/5 | 10/30 | ≥ 14/30 |
| Prompts at ≤3/5 | 7/30 | ≤ 4/30 |
| Avg calls/prompt | 12.5 | ≤ 10 |
| Non-brain calls | 16 | ≤ 8 |
| Regression test count | 0 | 40+ |

### Deferred to V14+

**Golden dataset for reference docs:**
V13 uses ingestion-based reference doc seeding. After evaluating diagnostic results against the ingested baseline, export optimized state as JSON seed files (`src/modules/pm/seed/reference-notes.json`, `reference-relations.json`). Enables hand-tuned chunk boundaries, boosted embedding metadata, and pre-built relations. `brain init` checks for golden dataset first → bulk INSERT if version matches, else falls back to ingestion. Code stub added in V13: `if (goldenDatasetExists(config)) return seedFromGolden(db, config)`.

**Atomic CRUD robustness pass:**
Currently `indexSingleFile` does file write → note upsert → FTS update → embedding generation in sequence. If embedding fails, note row exists but chunks don't. Need: note row + relations in a single SQLite transaction (atomic), embedding generation as a separate eventual-consistency step. The V13 embedding lifecycle (`embed_status: queued → embedding → embedded`) is the foundation; V14 should make the write path fully transactional. This affects all note writes, not just activities.

**Co-citation and link prediction (Adamic Adar):**
V13 implements graph-first hybrid scoring using existing relation edges. V14+ could add co-citation analysis: if notes A and B are both linked to C, suggest A↔B as related (even without direct link). Obsidian's graph-analysis plugin implements this. Enables discovering missing links during onboard or `pm check`. Also enables Adamic Adar scoring where notes linked through rare shared neighbors rank higher than those through hub nodes.

**Diagnostic loop — ingest diagnostic artifacts:**
52 diagnostic files exist, 0 are indexed. The V12 summary suggested ingesting gap-analysis and summary files as brain notes. We decided this adds noise during active development. Revisit post-stabilization — potentially as a post-release step where diagnostic results become part of the project's knowledge base, not during iteration cycles.

**Remaining open observations not addressed by V13:**

| Category | IDs | Brief |
|----------|-----|-------|
| Navigation | O-77, O-78, O-81, O-93, O-96, O-98, O-109, O-111, O-116, O-118, O-126, O-127, O-138, O-141, O-145, O-150 | Workstream show sparse, audit no --project, briefing [object Object], notes list truncation, search JSON empty metadata, index silent, memories no default, token inconsistency, blocker N+1, snippet truncation, waves empty |
| Context | O-45, O-90, O-101, O-147 | Zero-relation notes, context display_id fails, context no --json, no inverse doc→tasks query |
| Task mgmt | O-16, O-21, O-24, O-43, O-44, O-82, O-84, O-89, O-95, O-99, O-100, O-110, O-115, O-120, O-121, O-128, O-136, O-148, O-149, O-152 | Cross-workstream deps partial, category chaos, task update --depends-on, no planning command, temporal model, search defaults, filter validation |
| Onboarding | O-06, O-07, O-22, O-28, O-30, O-31, O-32, O-33, O-47, O-48, O-105, O-106, O-119, O-125, O-132 | No Claude-assisted onboarding, doc-first discovery, cross-repo docs, onboard --dry-run, profile empty hint |
| Search | O-53, O-69, O-107, O-112 | Search loop inflation, workstream-scoped search, note type filter, --memories schema change |
| Agent exp | O-08, O-12, O-15, O-20, O-34, O-35 (partial), O-42, O-46, O-60 | Demo project, workstream model gap, agent surfaces CLI commands, skill never triggered |
| Docs | O-01, O-10, O-38, O-71, O-117, O-124 | Where to run commands, reset cleanup, check --deep stub, briefing --full |
| Suggestions | O-140, O-155, O-157, O-158, O-160, O-193, O-194, O-211, O-212 | Structured files field, PM health stats, tags, task chunking, scaffold, onboard --self, pm docs list, bulk import |
| V10-unique | O-161–O-192 | Various friction items (memories crash, waves --json, onboard ingests brain docs, case sensitivity, dispatch no --json, etc.) |
| V11-unique | O-195–O-210 (partial) | Virtual state bugs (partially addressed), displayId null, briefing defaults, ghost project, acceptance_criteria empty |

---

## Research References

- [Obsidian graph-analysis](https://github.com/SkepticMystic/graph-analysis) — Co-citation, Adamic Adar, Jaccard algorithms for link prediction
- [state_machines-audit_trail](https://github.com/state-machines/state_machines-audit_trail) — after_transition callback pattern for audit logging
- [Statesman](https://dev.to/daviducolo/a-deep-dive-into-the-statesman-gem-for-ruby-building-flexible-state-machines-5b83) — Separate transition model, JSONB metadata, forward-only undo
- [clig.dev](https://clig.dev/) — CLI guidelines: discoverability, error messages, help text
