# Design Review #2 — Full Consistency, Gap, and Research Analysis

**Date:** 2026-02-26
**Status:** Review
**Scope:** All design documents (00-06), research documents, brain codebase

---

> **Resolution Note:** This review was conducted before the storage architecture was finalized. References to `pm_tasks`, `pm_dependency_edges`, `pm_executions`, and other PM-specific tables throughout this document have been superseded by the three brain-level primitives design (notes.metadata, extended relations, activities). See docs 01 and 02 for the current architecture. Issues IC-01 through IC-13, GAP-01 through GAP-13, and OQ-01 through OQ-06 have all been resolved in the main design documents.

---

## Executive Summary

Three parallel reviews examined the design for internal consistency, functional gaps, and research needs. The findings cluster into **5 themes**:

1. **The `ready` state semantics are contradictory** — the state machine says `pending → ready` is an auto-transition, but the eligible task SQL filters on `status = 'pending'`. This is the single critical consistency issue.
2. **Doc 06's `pm_tasks` table is stale** — it predates the claimed state, categories, and telemetry additions. Several columns are missing.
3. **The `brain pm complete` CLI interface varies across docs** — different flag names, different token passing formats, different outcome enums.
4. **Telemetry data availability is unverified** — the entire cost tracking system assumes the Task tool returns token counts, which may not be the case.
5. **The two-source-of-truth problem (markdown ↔ SQL) needs a clear write-path rule** — some operations write markdown first, others write SQL first.

---

## Part 1: Internal Consistency Issues

### IC-01: `ready` state — fundamental semantic contradiction ⚠️ CRITICAL

The eligible task SQL (doc 02 line 299, doc 06 line 56) filters `status = 'pending'` with all deps done. But the state machine (doc 02 line 221) says `pending → ready` auto-transitions when deps are met, and `+ELIGIBLE` is defined as `ready + no WIP limit conflict`.

**The question:** Is `ready` a stored state or a virtual computed state?

If stored: the SQL should query `status = 'ready'`, and something must perform the `pending → ready` transition.
If virtual: remove `ready` from the stored state enum, and eligible = `pending` with all deps met.

**Recommendation:** Treat `ready` as virtual (OQ-07 below). This avoids cascading writes on every completion and keeps the dependency engine as a pure query. Stored states become: `pending | claimed | in-progress | done | blocked | cancelled`.

---

### IC-02: Doc 01 task schema missing states

Doc 01's JSON Schema enum (line 306): `['pending', 'in-progress', 'done', 'blocked', 'cancelled']`
Doc 02's state machine: `pending | ready | claimed | in-progress | done | blocked | cancelled`

Missing: `ready` and `claimed` (or just `claimed` if `ready` becomes virtual).

---

### IC-03: `pm_dependency_edges` column names differ

| | Doc 01 (line 529) | Doc 02 (line 274) |
|---|---|---|
| Source | `source_note_id` | `source_id` |
| Target | `target_note_id` | `target_id` |
| Relation | `relation_type` | `relation` |
| PK | 3-column | 2-column |

Doc 02 also adds a `project` column not in doc 01.

---

### IC-04: `pm_tasks` table in doc 06 is incomplete

Doc 06's `pm_tasks` CREATE TABLE (lines 22-46) is missing columns that are now in v1 scope:
- `category TEXT` (9-value enum, needed for model selection + auditing)
- `claimed_by TEXT`, `claim_token TEXT`, `claimed_at TEXT` (claim mechanism)
- `agent_id TEXT`, `parent_session TEXT` (execution tracking)

---

### IC-05: `brain pm complete` flags differ across docs

| Flag | Doc 02 (line 725) | Doc 03 (line 133) | Doc 04 (line 256) |
|---|---|---|---|
| Token data | `--tokens '{"input":...}'` (JSON blob) | `--input-tokens N --output-tokens M` (separate) | `--input-tokens N --output-tokens M --cache-read-tokens N` (separate) |
| Outcome | not shown | not shown | `--outcome success\|partial\|failed` |
| Session | not shown | not shown | `--session <id>` |
| Files modified | `--files-modified 4` | not shown | `--files-modified N` |

**Also:** Doc 02's outcome enum is `completed | failed | timeout | cancelled`. Doc 04 uses `success` and `partial` which aren't in that enum.

---

### IC-06: `in-progress → ready` transition not in state machine

Docs 03 (line 356) and 04 (line 297) say failed agents revert tasks to `ready`. Doc 02's transition table only allows `in-progress → done | blocked | pending`. No `in-progress → ready` path exists.

---

### IC-07: Session log type not updated

Doc 06 resolves I4: use `type: pm-session-log` not `session-log`. Doc 03 (line 420) still uses `type: session-log`.

---

### IC-08: Phase numbering misaligned

- Doc 00: 3 streams with sub-items
- Doc 02: 6 phases
- Doc 03: 3 phases (parallel dispatch in Phase 1)
- Doc 04: 5 phases but Phase 2 is missing (jumps 1→3→4→5)

No mapping between these numbering schemes.

---

### IC-09: `brain pm project update` used but undefined

Docs 04 and 06 reference `brain pm project update OC --status completed`. Doc 02 defines no `project update` command.

---

### IC-10: `brain pm audit summary --session current` undocumented

Doc 03 (line 245) uses this flag. Doc 02's audit commands only show `--project` filtering.

---

### IC-11: `brain pm task done` vs `brain pm complete` overlap

Doc 02 defines both. Their relationship is unclear — is `task done` a simple status update while `complete` is the telemetry-aware orchestration command?

---

### IC-12: `pm_tasks` table vs view unresolved

Doc 01 says "view/materialized cache." Doc 06 creates a concrete table. Doc 06's v1 scope says "(or view over metadata)." Pick one.

---

### IC-13: Identifier format inconsistent

Doc 01: `pm:openclaw:08.02`. Doc 02: `pm:openclaw:OC-08.05`. Doc 02 also uses bare `OC-08.04` in depends_on. The canonical fully qualified format is not established.

---

## Part 2: Functional Gaps

### GAP-01: State machine edge cases undefined ⚠️ CRITICAL

No specification for:
- Claiming an already-claimed task (error? queue? steal?)
- Completing a task not in `in-progress` state
- Cancelling a task that blocks others (dependents become permanently stuck?)
- Deleting a project with in-progress tasks

**Recommendation:** Add an "Edge Cases" section to doc 02's state machine. At minimum: invalid transitions return structured errors; cancelling a blocker cascades `blocked` to dependents with reason.

### GAP-02: No testing strategy ⚠️ CRITICAL

Zero specification across all 7 documents for: test framework, test surface, test fixtures, regression testing for the state machine, dependency engine, claim concurrency, or module isolation.

**Recommendation:** Add a testing section. Key test targets: state machine transitions (unit), dependency engine cycle detection (unit), eligible task computation (integration), CLI round-trips (integration), `brain index` with module notes (integration).

### GAP-03: Migration path from current brain unspecified ⚠️ CRITICAL

Brain is at v0.3.0 with no module system. The design requires `ALTER TABLE notes ADD COLUMN module TEXT`, `module_instance TEXT`, `metadata TEXT` (though `metadata` already exists unused). No migration SQL is specified. No guidance on whether `brain index` must rerun.

**Recommendation:** Add migration section to doc 01. The existing `schemaV1` in brain-db.ts already has a `metadata TEXT` column (set to `null` by `frontmatterToRecord()`). Only `module` and `module_instance` need to be added.

### GAP-04: `metadata` JSON validation unspecified

No specification for: validating JSON on write, handling malformed JSON (SQLite's `json_extract` returns NULL silently), indexing metadata fields, or the contract modules can rely on.

**Recommendation:** Validate metadata is well-formed JSON on index. Add `json_valid(metadata)` check. Contract: metadata is always valid JSON or NULL.

### GAP-05: Claim timeout implementation unspecified

Who runs the timeout check? (Cron? Every `brain pm` command? Only on briefing?) What happens to telemetry when a claim times out? How does timeout interact with the session hook?

**Recommendation:** `brain pm briefing` and `brain pm next` run a stale-claim sweep as a side effect. Timeout creates an execution record with outcome `timeout`.

### GAP-06: Error message format undefined

All commands specified for happy path only. No structured error JSON format. The orchestrator parses `--json` output — if errors aren't structured, parsing breaks.

**Recommendation:** Define `{ "error": true, "code": "INVALID_TRANSITION", "message": "...", "details": {...} }`. Standardize error codes: `DUPLICATE_ID`, `INVALID_DEPENDENCY`, `INVALID_TRANSITION`, `INVALID_CLAIM_TOKEN`, `CYCLE_DETECTED`, `NO_PROMPT`, `PROJECT_EXISTS`.

### GAP-07: Prompt lifecycle ambiguous

Task frontmatter has `prompt_file` (filesystem path). Prompts are also brain notes with `type: prompt`. Which is source of truth? Can a task have one but not the other? What does `brain pm dispatch` read?

**Recommendation:** Pick one. Prompts as brain notes, `prompt_file` removed or aliased.

### GAP-08: Decision propagation mechanism underspecified

How does `brain pm dispatch` assemble decisions into the prompt? The `impacts` field is a JSON array of display IDs — how is the join performed? What about decisions captured after a task was created?

### GAP-09: Dependency engine — cycle detection timing

Does cycle detection run on every `brain pm task add --depends-on` (immediate feedback) or only on `brain index` (delayed discovery)? Users who create cycles interactively won't know until the next index.

**Recommendation:** Validate incrementally on `task add` (simple DFS from target to source). Full Tarjan's on `brain index` as safety net.

### GAP-10: `brain pm capture` / `brain pm process` data model undefined

Listed as CLI commands but no note type, schema, or interactive flow specified. Not implementable as written.

**Recommendation:** Either define the capture data model or explicitly defer to v2.

### GAP-11: Missing CRUD commands

- `brain pm project update` — referenced but not defined
- `brain pm project delete` — not mentioned
- `brain pm workstream update` / `delete` — not mentioned
- `brain pm task delete` — only cancel exists
- `brain pm decision update` — only supersede exists

### GAP-12: Module `register()` error handling

If a module's `register()` throws, does brain fail to start? Skip the module? Log and continue? A broken PM module would block all brain functionality if not handled.

**Recommendation:** Catch, log, mark module as failed, continue without it.

### GAP-13: `pm_decisions.impacts` storage

Stored as JSON array of display IDs in a TEXT column. No index. Query requires `json_each()` or LIKE (full table scan). Display IDs could change if tasks move workstreams.

**Recommendation:** Junction table `pm_decision_impacts(decision_id, task_note_id)` with proper FKs and indexes.

---

## Part 3: Open Design Questions

### OQ-01: Is `ready` a stored state or a virtual computed state?

See IC-01. **Recommendation:** Virtual. Remove from stored enum. `pending` + all deps met = ready (computed at query time). Simplifies storage, avoids cascading writes on completion.

### OQ-02: Where does PM task status live?

Brain's `notes.status` enum is `current | outdated | deprecated | draft`. PM status is `pending | claimed | in-progress | done | blocked | cancelled`. These are incompatible.

**Options:**
- A) PM notes always store `notes.status = 'current'`; PM status lives in `pm_tasks.status` only
- B) Widen `NoteStatus` like `NoteType`

**Recommendation:** A. PM owns its own status column.

### OQ-03: Dependency engine — SQL vs application-layer?

Eligible task computation (SQL `NOT EXISTS` join) vs cycle detection (Tarjan's in TypeScript).

**Recommendation:** SQL for eligible tasks (hot path, simple). TypeScript for cycle detection (infrequent, complex algorithm).

### OQ-04: `pm_tasks` — populate `notes.metadata` or not?

Brain already has an unused `metadata TEXT` column. Should indexing populate it with full frontmatter JSON?

**Recommendation:** Yes. One-line change to `frontmatterToRecord()`. Enables simple modules to query without creating tables. PM still uses `pm_tasks` for structured queries. Free extensibility.

### OQ-05: Prompt template rendering engine?

**Recommendation:** None for v1. `brain pm dispatch` assembles context in TypeScript code around the raw prompt text. No template engine needed.

### OQ-06: Markdown ↔ SQL write path?

State changes (claim, start, complete) must update both markdown frontmatter and SQL tables. But `brain index` rebuilds SQL from markdown.

**Recommendation:** PM commands write to BOTH markdown and SQL in the same operation. `brain index` re-derives from markdown, which is safe because frontmatter was already updated. Claim-only fields (`claim_token`, `claimed_at`) must also be in frontmatter so `brain index` preserves them.

---

## Part 4: Research Opportunities

### RO-01: Claude Code Hook System ⚠️ HIGH PRIORITY

**What:** Do Claude Code hooks expose `$CLAUDE_SESSION_ID`? What env vars are available? How do hooks work in practice?

**Why:** Session tracking is load-bearing for telemetry linkage. If the env var doesn't exist, the entire session tracking approach breaks.

**Where:** Claude Code docs on hooks, empirical testing by creating a SessionStart hook.

### RO-02: Task Tool Return Values ⚠️ HIGH PRIORITY

**What:** Does the Claude Code Task tool return `inputTokens`, `outputTokens`, `durationSeconds`, `agentId` in its result?

**Why:** The entire `pm_executions` telemetry table depends on this data. If unavailable, cost tracking is non-functional.

**Where:** Claude Code docs, empirical testing by running a sub-agent and inspecting the result.

**Fallback:** If not available: parse agent transcript JSONL files, or make telemetry fields nullable and best-effort.

### RO-03: SQLite JSON Performance

**What:** How does `json_extract()` perform on the metadata column at brain's scale (hundreds to low thousands of notes)?

**Where:** SQLite JSON1 docs, Simon Willison's Datasette benchmarks, empirical testing with 10K rows.

**Expected:** Sub-100ms for brain's scale. Generated columns if needed for hot paths.

### RO-04: Commander.js Dynamic Subcommand Registration

**What:** Can `program.addCommand()` be called by modules between core command registration and `parseAsync()`?

**Why:** Module CLI injection depends on this.

**Where:** Commander.js docs + brain's `cli.ts` pattern. Likely works — Commander builds the tree lazily.

### RO-05: SQLite Optimistic Concurrency for Claims

**What:** Best pattern for exclusive task claiming in SQLite without advisory locks?

**Recommendation already likely:** `BEGIN IMMEDIATE; UPDATE pm_tasks SET status = 'claimed', claim_token = ? WHERE note_id = ? AND status = 'pending' AND [+READY check]; COMMIT;` then check `changes() === 1`. `IMMEDIATE` acquires write lock at BEGIN, preventing TOCTOU races. Note: since `ready` is now virtual, the claim query must verify eligibility inline (all deps done via relations).

### RO-06: Brain's Indexing Pipeline Extension Points

**What:** Where can the PM module hook into `indexSingleFile()`? Currently no callbacks exist.

**Best option:** Post-index hook — after `indexFiles()` returns `indexedNoteIds`, module system processes them. Simpler than per-note callbacks.

### RO-07: Frontmatter Round-Trip Fidelity

**What:** Does `gray-matter` stringify preserve field order, comments, formatting?

**Why:** `brain pm task update` must modify frontmatter without corrupting other fields or generating noisy diffs.

**Recommendation:** Targeted regex for simple scalar updates (status, assignee). Full gray-matter round-trip for complex field changes.

### RO-08: Claude Code Skill Auto-Loading

**What:** Can skills conditionally auto-load based on project context?

**Likely answer:** No. Skills are always available when present in `~/.claude/skills/`. The orchestrator skill should gracefully degrade with "no active PM project" if invoked without one.

---

## Part 5: Implementation Risk Assessment

| ID | Risk | Likelihood | Impact | Mitigation |
|----|------|-----------|--------|------------|
| IR-01 | NoteType widening breaks exhaustive switch/case checks | Medium | High | Grep all `NoteType` references before widening; atomic change with coercion update |
| IR-02 | Sub-agent telemetry data unavailable from Task tool | High | High | Research RO-02 first; design nullable telemetry; consider transcript parsing fallback |
| IR-03 | Frontmatter round-trip corruption on complex YAML | Medium | Medium | Regex for scalars, gray-matter for complex; comprehensive round-trip tests |
| IR-04 | Claim timeout races with legitimately slow tasks | Medium | Medium | Timeout only reverts `claimed` (not `in-progress`); token validation prevents stale completions |
| IR-05 | Module system partial implementation breaks brain startup | Medium | High | Feature flag (`config.modules`); `withModules()` as new function not modifying `withBrain()` |
| IR-06 | Context bundle size exceeds sub-agent limits | Low-Med | Medium | Token budget for bundles; direct deps only; instructions-first ordering |
| IR-07 | Decision impact arrays stale or incomplete | High | Medium | Impacts are advisory; also match by tag overlap; accept as inherent limitation |
| IR-08 | Markdown ↔ SQL divergence on state changes | High | High | Write-path rule: PM commands always update BOTH; `brain index` safe because frontmatter already updated |

---

## Recommended Priority for Resolution

**Before implementation starts:**
1. Resolve IC-01 / OQ-01 — settle `ready` state semantics (virtual vs stored)
2. Resolve OQ-06 — establish the markdown ↔ SQL write-path rule
3. Complete RO-01 and RO-02 — verify hooks and telemetry data availability
4. Define GAP-02 — testing strategy (what to test, what framework)
5. Define GAP-03 — migration path from current brain

**During implementation (phase 1):**
6. Fix IC-04 through IC-06 — update doc 06's `pm_tasks` table
7. Canonicalize IC-05 — single `brain pm complete` flag spec
8. Add GAP-01 — state machine edge cases
9. Add GAP-06 — structured error format
10. Complete RO-05, RO-06 — claim pattern + indexing hooks

**Can defer:**
11. GAP-10 — capture/process data model (defer to v2)
12. GAP-13 — decision impacts junction table (optimize later if slow)
13. RO-03 — SQLite JSON benchmarks (unlikely bottleneck at brain's scale)

---

## References

- 00-overview.md through 06-review-resolutions.md
- Brain source: types.ts, brain-db.ts, brain-service.ts, indexing.ts, cli.ts
- Research: tools-and-patterns.md, methodologies.md, orchestration-patterns.md
