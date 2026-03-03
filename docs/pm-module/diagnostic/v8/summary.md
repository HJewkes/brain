# PM Module Diagnostic v8 — Summary

**Date:** 2026-03-01 | **Prompts:** 30/30 | **Model:** claude-sonnet-4-6

---

## Headline Metrics

| Metric | v7 | v8 | Delta |
|--------|----|----|-------|
| Total prompts run | 30 | 30 | — |
| Avg quality | 3.7/5 | **3.7/5** | flat |
| Brain CLI % | 94% | **94%** | flat |
| Prompts at 5/5 | 2/30 | **3/30** | **+1** |
| Prompts at ≤3/5 | 9/30 | **11/30** | **-2** ⚠ |
| Avg calls/prompt | 16.4 | **14.3** | **-2.1** |
| Total tool calls | 491 | **428** | **-12.8%** |
| Non-brain calls | 38 | **36** | **-2** |

**Headline:** Call efficiency improved significantly (+12.8% reduction), but quality is stagnant for
the second consecutive cycle and the low-end cohort grew. The O-57 alias fix delivered its call
savings, but a new cluster of discovery-layer gaps (O-75–O-92) is now the binding constraint on
quality. Two structural issues remain unaddressed for 8+ cycles: zero dependencies and zero graph
edges. A new blocker (O-102) was found: slug collision during onboarding silently discarded 9 of
10 ingested READMEs.

---

## Top Improvements

- **O-57 resolved — plural alias passthrough fixed.** `brain pm tasks` and `brain pm workstreams`
  no longer crash. This was the most-hit single friction source in v7 (14/30 prompts). Delivered
  the bulk of the 12.8% call reduction. P-08 dropped from 20 → 6 calls while holding 4/5 quality.

- **8 observations formally resolved.** O-17 (task titles in output), O-23 (category taxonomy),
  O-26 (100% task body completeness), O-50 (rich context output), O-51 (dispatch enrichment), O-54
  (partial: task show), O-55 (filter flags), O-63 (next priority sort). These represent genuine
  durable fixes from v3–v7 cycles that v8 evidence has now confirmed stable.

- **VW dataset upgraded.** 47-task dataset (from 39 in v7), prefix renamed VOL→VW, 100% body
  completeness, 100% acceptance criteria coverage, avg 806 bytes/task. The dataset is now the
  highest-quality PM corpus used in any diagnostic cycle.

- **P-27 recovered from 2/5 → 3/5.** Cross-system prompts, historically the lowest-scoring
  category, gained one point. Dispatch enrichment and task body quality improvements carried this.

- **O-58/O-59/O-63 stable.** Did-you-mean on wrong task IDs and project prefix validation (shipped
  in the v7 fix pass) held under 47-task load. Search title-only fix did not regress.

---

## Remaining Gaps

- **Quality ceiling at 3.7/5 — low cohort grew.** Prompts at ≤3/5 increased from 9 → 11. P-05,
  P-18, P-21, P-24, P-30 all dropped or stagnated. The discovery layer is the new binding constraint:
  `brain pm context` rejects project and workstream IDs (O-75, O-87), `brain context` silently
  fails on PM display IDs (O-90, O-86), and workstream show returns sparse one-liners (O-77).
  Together these hit P-01, P-02, P-03, P-05, P-08, P-10, P-12, P-13, P-19, P-26 — 10 of 30.

- **O-102 (new blocker): README slug collision silently discarded 9 of 10 ingested READMEs.**
  The onboard manifest claims 20 docs ingested; only 11 research notes exist in the DB. All 10
  README files resolved to the slug `readme` and overwrote each other. The node-sdk, voltra-private,
  and workout-analytics READMEs were lost. Affects onboarding reliability for any multi-repo project.

- **O-16/O-25 (structural, 8th cycle): zero dependencies and zero graph edges.** Every task is
  `+ELIGIBLE` simultaneously — the wave engine provides no sequencing signal. `brain graph` and
  `brain context` have no static edges to traverse; context is assembled purely via runtime vector
  similarity. Planning category prompts (P-11, P-20) cannot sequence work from PM data alone.

- **O-104 (corrects v7 claim): 0% brain project doc coverage.** V7 reported 35% coverage based on
  false-positive search hits (VW project docs matched PM terminology queries). The v8 gap analysis
  confirms: all 65 indexed notes are VW project data. No brain docs — commands.md, architecture.md,
  onboarding-observations.md, any diagnostic results — are searchable. Agents rely on skill prompt
  context alone and cannot discover prior findings (e.g. "what is O-57") via search.

- **O-82/O-83/O-84/O-100: task list JSON is incomplete, search defaults are broken.** `--search`
  is title-only and defaults to pending status (silently excludes done/blocked/in-progress tasks).
  Task JSON omits description, acceptance criteria, and dependency fields. Agents run N `task show`
  calls to fetch body content that should be available in the list response.

---

## Recommended Fix Targets

### 1. Fix context/navigation layer (O-75, O-85, O-86, O-87, O-88, O-90) — **Medium**
- **What:** Handle project and workstream IDs in `brain pm context` (return project/workstream
  briefing instead of NOT_FOUND). Add did-you-mean to context error path. Route PM display ID
  patterns in base `brain context` to `brain pm context`. Add `brain pm project show/list`.
- **Affected prompts:** P-01, P-02, P-03, P-05, P-08, P-10, P-12, P-13, P-19, P-26 — 10/30.
- **Expected impact:** +0.3–0.5 avg quality; could shift 3–4 prompts from ≤3/5 to 4/5.
- **Scope:** Medium — `context` command dispatch + project command group additions.

### 2. Fix README slug collision during onboarding (O-102) — **Small–Medium**
- **What:** Derive slugs from component name + filename during onboard ingestion (e.g.
  `node-sdk-readme`). Detect collisions before write; auto-suffix or error with a clear message.
- **Affected prompts:** Onboarding reliability for any multi-repo project. Directly resolves the
  9/20 missing research notes in the VW dataset.
- **Expected impact:** Information integrity blocker — must fix before next onboarding run.
- **Scope:** Small–Medium — slug generation in `onboard` ingestion phase.

### 3. Enrich task list JSON and fix search defaults (O-82, O-83, O-84, O-100) — **Small–Medium**
- **What:** (a) Add `description`, `acceptance_criteria`, `depends_on`, `blocked_by` fields to task
  JSON output. Add `--full` flag for complete body. (b) Default `--search` to all statuses; make
  `--status pending` explicit. (c) Extend `--search` FTS to match task note body, not just title.
- **Affected prompts:** P-06, P-07, P-20, P-27, P-29, P-30 — directly. P-11 indirectly.
- **Expected impact:** Eliminates N-call body-fetch loops; planning category gains ordering signal.
- **Scope:** Small for (a)+(b); Medium for (c) (FTS query join).

### 4. Self-ingest brain project docs (O-104) — **Small (one-time ops)**
- **What:** Run `brain ingest` over README.md, CLAUDE.md, docs/pm-module/*.md,
  docs/pm-module/diagnostic/v1–v8/, and docs/pm-module/diagnostic/prompts/test-bench/*.
  Add a post-diagnostic re-index step to diagnostic-workflow.md (R-2 from gap-analysis.md).
- **Affected prompts:** Reduces non-brain call count systemically; enables `"what is O-57"` queries
  in setup agents. Closes the false v7 coverage claim. Expected -3 to -5 non-brain calls/cycle.
- **Scope:** Small — shell commands to run, plus two-line update to diagnostic-workflow.md.

### 5. Encode task dependencies in setup agent prompt (O-16) — **Medium**
- **What:** Update the onboard synthesis agent prompt to emit `deps: [VW-XX.YY]` frontmatter for
  clear ordering constraints (interface → implementation → test chains). At minimum encode the 6
  identified ordering constraints in the current VW dataset.
- **Affected prompts:** P-07, P-11, P-15, P-20 gain wave-based ordering signal.
- **Expected impact:** Planning category breaks out of 3/5 floor; wave output becomes actionable.
- **Scope:** Medium — synthesis agent prompt + post-creation dependency pass.

---

## Decision Points

1. **O-25 (graph, 8 cycles, 0 edges) — address in v9 or defer again?** The context command works
   via runtime vector similarity, masking the gap in single-task prompts. The cost shows up in
   cross-system prompts (P-26, P-27 stuck at 3/5) and research→task linking. Two paths remain:
   (a) auto-link at `brain index` time via vector threshold; (b) synthesis agent emits `brain pm
   relate` calls after task creation. Which approach — and is this the cycle to act?

2. **O-99 (temporal dimension) — add due_date/milestone to schema now or defer?** Planning prompts
   (P-11, P-20) cannot answer time-bounded questions from PM data. The data model change is small
   but affects task schema, frontmatter validation, and filter flags. Low risk; medium effort.

3. **O-103 (project note body empty) — automated synthesis or manual?** The project note should
   contain a description, goals, and repo inventory after onboarding. This could be an LLM synthesis
   step in `onboard` (reliable, automatic) or a post-onboard prompt to the setup agent (fragile).
   If synthesis is added to `onboard`, it also closes the gap for `brain pm context VW` (O-75).

4. **Workstream show enrichment (O-77) — scope with O-75 or separately?** The project context
   gap (O-75) and workstream show gap (O-77) share the same data layer and hit the same prompts.
   Shipping them together reduces round-trips but increases scope of Fix Target #1.
