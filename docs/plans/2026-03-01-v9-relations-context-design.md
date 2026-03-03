# V9 Design: Auto-Relations, Context Navigation, and Task Enrichment

**Date:** 2026-03-01
**Scope:** Fix targets 1-5 from V8 diagnostic + temporal fields + auto-dependency detection
**Observations addressed:** O-16, O-25, O-75, O-76, O-77, O-79, O-80, O-81, O-82, O-83, O-84, O-85, O-86, O-87, O-88, O-90, O-91, O-94, O-96, O-97, O-99, O-100, O-102, O-103, O-104

---

## 1. Auto-Relations at Index Time (O-25, O-16)

### Problem

Zero graph edges after 8 diagnostic cycles. `brain graph` returns nothing. Context assembly relies entirely on runtime vector similarity. Wave engine can't sequence tasks (all in Wave 0).

### Design

Three relation sources, all created during indexing — no extra commands needed.

#### 1a. PM Hierarchy Edges

When PM notes are created or indexed, create `parent` relations:

- **Project → Workstream:** When a workstream is created, create `parent` relation from project note ID to workstream note ID.
- **Workstream → Task:** When a task is created, create `parent` relation from workstream note ID to task note ID.

**Where:** `createTask()` in `task-ops.ts`, workstream creation in `workstream-ops.ts`, project creation in `project-ops.ts`. Each `create*` function calls `db.upsertRelation(parentNoteId, childNoteId, 'parent')` after note creation.

**Cleanup:** When a task/workstream is deleted, its parent relation is removed (cascade from note deletion already handles this via `deleteNote`).

#### 1b. Markdown Link Extraction

During `parseMarkdown()`, extract `[text](target)` links from note body where target matches a known note ID or relative path that resolves to a note.

**New function in `markdown-parser.ts`:**
```typescript
function extractNoteLinks(content: string): string[] {
  const linkPattern = /\[([^\]]*)\]\(([^)]+)\)/g;
  const links: string[] = [];
  for (const match of content.matchAll(linkPattern)) {
    const target = match[2];
    // Skip external URLs, anchors, images
    if (target.startsWith('http') || target.startsWith('#') || target.startsWith('!')) continue;
    // Strip .md extension, extract slug
    const slug = target.replace(/\.md$/, '').split('/').pop() ?? target;
    links.push(slug);
  }
  return links;
}
```

**Relation creation in `indexing.ts`:** After parsing, for each extracted link that resolves to an existing note ID in the DB, create a `related-to` relation.

#### 1c. Category-Based Auto-Dependencies

During onboarding, after all tasks are created, run a dependency inference pass:

**Rules (within each workstream):**
- `testing` tasks depend on `implementation` tasks with overlapping title keywords
- `docs` tasks depend on `implementation` tasks in the same workstream
- `review` tasks depend on `implementation` + `testing` tasks in the same workstream
- Tasks with `research` category are never auto-depended-upon (they're exploratory)

**Where:** New function `inferDependencies()` in `src/modules/pm/engine/dependency.ts`, called at end of onboard after all tasks exist. Creates `depends_on` relations in the relations table.

**Safety:** Only creates edges within the same workstream. Cross-workstream dependencies require explicit `depends_on` frontmatter or the future semantic skill.

---

## 2. Context/Navigation Layer (O-75, O-85-O-90)

### Problem

`brain pm context` only accepts task IDs. Project/workstream IDs return NOT_FOUND. Base `brain context` doesn't route PM IDs. No `project show` or enriched `workstream show`.

### Design

#### 2a. Extend `brain pm context` to All ID Types

Detect ID type from format:
- **Task** (`VW-01.03`): existing `assembleDispatch()` behavior
- **Workstream** (`VW-01`): new `assembleWorkstreamContext()`
- **Project** (`VW`): new `assembleProjectContext()`

**`assembleWorkstreamContext()` returns:**
```typescript
{
  workstream: { displayId, title, status, description },
  taskSummary: { total, byStatus: Record<Status, number>, byPriority: Record<Priority, number> },
  eligibleTasks: TaskMetadata[],  // top 5
  decisions: DecisionSummary[],   // decisions impacting workstream tasks
  relatedNotes: SearchResult[],   // semantic search on workstream title
}
```

**`assembleProjectContext()` returns:**
```typescript
{
  project: { prefix, name, status, phase, description },
  workstreams: Array<{ displayId, title, status, taskCount, doneCount }>,
  criticalTasks: TaskMetadata[],    // critical priority, not done
  statusDistribution: Record<Status, number>,
  recentDecisions: DecisionSummary[],
}
```

**Where:** `src/modules/pm/engine/dispatch.ts` — new functions alongside existing `assembleDispatch`.

#### 2b. Route PM Patterns from Base `brain context`

In `src/commands/context.ts`:
- After the existing note lookup fails, check if the ID matches PM display ID pattern: `/^[A-Z]{2,5}(-\d{2}(\.\d{2})?)?$/`
- If match and PM module is registered, call `pm context` handler
- If no match, fall through to existing "note not found" error

#### 2c. Did-You-Mean on Context Errors

When context resolution fails:
- Run `didYouMeanTask()` (already exists in `task-ops.ts`)
- Include available project prefixes in error: `Available projects: VW, API`

#### 2d. `brain pm project show <prefix>` and `brain pm project list`

- `show`: reads project note body + workstream summary + task distribution
- `list`: alias for existing `brain pm list`

**Where:** `src/modules/pm/commands/project.ts` — add `show` and `list` subcommands.

#### 2e. Enrich `brain pm workstream show`

Current output: one-line display ID + status. Add:
- Note body (description)
- Task counts by status and priority
- Top 3 eligible tasks
- Associated decisions

**Where:** `src/modules/pm/commands/workstream.ts` — extend show action.

---

## 3. Slug Collision Fix + Onboarding Enrichment (O-102, O-103)

### Problem

All README files from different components slugify to `readme`. Only the last survives. Project note body is empty after onboarding.

### Design

#### 3a. Component-Aware Slug Generation

During onboard doc ingestion, prefix slug with component name when collision would occur:

```typescript
function onboardSlug(title: string, component?: string): string {
  const base = slugify(title);
  if (!component) return base;
  // If the title IS the component name, no prefix needed
  if (slugify(component) === base) return base;
  return `${slugify(component)}-${base}`;
}
```

Examples:
- `packages/node-sdk/README.md` (component: `node-sdk`) → `node-sdk-readme`
- `packages/node-sdk/architecture.md` (component: `node-sdk`) → `node-sdk-architecture`
- `docs/overview.md` (no component) → `overview`

Additionally, track used slugs within the ingestion batch. If collision detected (same slug already used in this batch), append `-2`, `-3`, etc.

**Where:** `src/modules/pm/commands/onboard.ts` — replace lines 88-89.

#### 3b. Project Note Body Synthesis

After Phase 3 (discover) completes, synthesize project note body from discovery metadata:

```markdown
## Overview
{project name} — {component count} components, {doc count} docs ingested

## Components
- **{component.name}** ({component.type}) — {component.docCount} docs
...

## Key Documentation
- [{title}]({slug}) — {score-based ranking description}
...
```

Deterministic template fill — no LLM needed. Written during Phase 2 (create project), but after Phase 3 (discover docs) so we have the data. Reorder: detect → discover → create project with body → ingest docs.

**Where:** `src/modules/pm/commands/onboard.ts` — reorder phases, add `synthesizeProjectBody()`.

---

## 4. Task List Enrichment (O-82, O-83, O-84, O-100)

### Problem

Task list JSON omits description, acceptance criteria, and dependency fields. Search defaults to pending-only and title-only.

### Design

#### 4a. Extended Task List JSON

Add to `task list --json` output:
- `description` — first 500 chars of task note body (always included)
- `acceptance_criteria` — extracted bullet list (parsed from body under "Acceptance criteria:" heading)
- `depends_on` — array of display IDs
- `blocked_by` — array of display IDs (reverse dep lookup)
- `created` / `modified` — ISO timestamps

Add `--full` flag that includes complete body text.

Add `--short` / `--brief` flag that suppresses descriptions and shows only structural fields (display_id, title, status, priority, category). Useful for triage/overview workflows where body content is noise.

Default behavior: include `description` (truncated to 500 chars). `--full` expands to complete body. `--short` removes descriptions entirely.

**Where:** `src/modules/pm/data/task-ops.ts` — `listTasks()` and `getTaskMetadata()`.

#### 4b. Fix Search Defaults

- Default `--search` to **all statuses** (user must explicitly pass `--status pending` to filter)
- Extend FTS query to include task note body (join notes table body with FTS index)

**Where:** `src/modules/pm/data/task-ops.ts` — `searchTasks()` query.

#### 4c. Briefing nextActions Enrichment (O-79)

Change from single task to top 5 eligible tasks grouped by workstream:

```
Next actions:
  VW-01: BLE Protocol Completeness
    VW-01.01 [critical] Fix broken test imports in checksum.test.ts
    VW-01.03 [high]     Implement ReplayBLEAdapter
  VW-03: VBT Autoregulation Engine
    VW-03.01 [critical] Implement ExerciseModel persistence
```

**Where:** `src/modules/pm/engine/dispatch.ts` — `assembleBriefing()`.

---

## 5. Temporal Fields (O-99)

### Problem

No `due_date`, `milestone`, or time-bounded fields. Planning prompts can't answer temporal queries.

### Design

Add optional fields to task frontmatter schema:
- `due_date` — ISO 8601 date string (e.g., `2026-03-15`)
- `milestone` — free-text string (e.g., `v1.0`, `Q2 launch`)

**Schema changes:**
- `src/modules/pm/types.ts` — add to `TaskMetadata` interface
- `src/modules/pm/validation.ts` — allow in frontmatter schema
- `src/modules/pm/data/task-ops.ts` — parse from frontmatter, include in JSON output
- `src/modules/pm/commands/task.ts` — add `--due` and `--milestone` flags to `task add` and `task update`

**Filter support:**
- `task list --due-before 2026-03-15` — tasks due before date
- `task list --milestone v1.0` — tasks in milestone
- Virtual state `+OVERDUE` — task with `due_date` in the past and status not done/cancelled

---

## 6. Quick Wins

### 6a. Command Aliases (O-80, O-96, O-97)
- `brain pm ls` → alias for `brain pm list`
- `tasks` becomes full passthrough to `task` subcommand (not just `task list`)

### 6b. Workstream Display ID in Task Add (O-91)
- `brain pm task add --workstream VW-01` accepts display IDs
- Parse display ID to extract workstream number

### 6c. Hardcoded Prefix Cleanup (O-81)
- Audit all error messages for hardcoded project prefixes (VOLT-06, etc.)
- Replace with dynamic substitution from active project

### 6d. Complete Surfaces Unblocked Tasks (O-94)
- After `brain pm complete`, run impact analysis
- Print newly ELIGIBLE tasks

### 6e. Self-Ingest Brain Docs (O-104)
- Add post-diagnostic step to `scripts/diagnostic/run.sh` that runs `brain ingest` over brain's own docs
- Document in `docs/pm-module/diagnostic-workflow.md`

---

## Observation Coverage

| Fix | Observations | Test Bench Impact |
|-----|-------------|-------------------|
| Auto-relations | O-16, O-25 | P-03, P-07, P-09, P-10, P-11, P-12, P-15, P-19, P-20, P-26, P-27 |
| Context/navigation | O-75, O-76, O-77, O-81, O-85, O-86, O-87, O-88, O-90 | P-01, P-02, P-03, P-05, P-08, P-10, P-12, P-13, P-19, P-26 |
| Slug collision + onboard | O-102, O-103 | Onboarding reliability |
| Task list enrichment | O-79, O-82, O-83, O-84, O-100 | P-06, P-07, P-20, P-27, P-29, P-30 |
| Temporal fields | O-99 | P-11, P-20 |
| Quick wins | O-80, O-81, O-91, O-94, O-96, O-97, O-104 | P-04, P-14, P-16, P-17, P-18, P-23 |

**Total: 25 observations addressed across all 6 sections.**

**Expected V9 quality impact:** +0.4–0.6 avg quality (3.7 → 4.1–4.3). Prompts at ≤3/5 should drop from 11 to 3-5.

---

## Future Work (Not in This Cycle)

- **Semantic relation skill:** Claude Code skill that analyzes workstream/doc content and adds semantic `related-to` edges beyond what rules can detect
- **`brain pm plan` command (O-89):** Goal-based task sequencing with dependency-aware ordering
- **`brain pm verify` acceptance criteria parsing (O-93):** Convert acceptance criteria to verification steps
- **`brain pm task block --reason` (O-95):** Store blocking reason in activity log
- **`brain pm audit --project` filter (O-78):** Project-scoped audit queries
- **`brain search --type/--module` filters (O-107):** Note type filtering in search
