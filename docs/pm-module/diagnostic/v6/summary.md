# PM Module Diagnostic v6 — Summary

**Date:** 2026-02-28 | **Prompts:** 30/30 | **Model:** claude-sonnet-4-6

---

## Headline Metrics

| Metric | v5 | v6 | Delta |
|--------|----|----|-------|
| Total prompts run | 30 | 30 | — |
| Avg quality | 3.5/5 | 3.5/5 | -0.1 (flat) |
| Brain CLI % | 95% | 94% | -1.0pp |
| Prompts at 5/5 | 5/30 | 4/30 | -1 |
| Prompts at ≤3/5 | 14/30 | 15/30 | +1 |
| Avg calls per prompt | 15.5 | 17.0 | +1.5 |

**Headline:** v6 fixes resolved real plumbing issues but did not move quality. The targeted fixes
(O-103–O-106, O-124) hit the right problems; the problem is that task body regression (O-149),
plural alias breakage (O-136), and session state loss (O-134) were introduced in the same cycle,
cancelling the gains. Net result: flat score with more friction.

---

## Top Improvements

- **O-105/O-106 resolved — blocked filter now works.** `task list --json` includes `virtualStates`
  and `depends_on`; `--status blocked` correctly filters virtual state. P-07 improved 4→5 and
  dropped from 13 calls to 5 — the single largest individual improvement this cycle.

- **O-104 resolved — `--cwd` flag unblocks onboarding.** Component detection now works when the
  CLI is run outside the repo root. The v6 onboard session succeeded end-to-end in ~6m with 57%
  first-try success rate and zero discovery overhead (skill prompt eliminated all help lookups).

- **O-124 resolved — no auto-Triage workstream.** The spurious Triage workstream that polluted
  workstream lists and confused agent routing is gone. V6 project structure is 7 genuine cross-
  cutting workstreams.

- **P-07 efficiency gain.** Blocked-task discovery dropped from 13 calls → 5 calls. The virtual
  state + depends_on data in `--json` output let agents answer the question in one batch query
  instead of N+1 `task show` calls.

- **Onboarding data quality improved on most axes.** 7 real workstreams, 41 tasks with correct
  priority/category distribution, 8 valid dependency edges, 4-level priority pyramid. Categories
  used: 7 types with no monoculture (contrast: v3 was 100% "feature").

---

## Remaining Gaps

- **O-149 (task body regression) — 0% body completeness, was 100% in v5.** All 41 tasks have
  empty bodies (`body: ""`). The v6 synthesis agent prompt change inadvertently dropped the body
  generation instruction. Every prompt that reads a task in detail (P-03, P-05, P-08, P-11, P-19,
  P-26, P-29) scores poorly because task context is title-only. This is the single largest quality
  driver for v7.

- **O-136 (plural alias passthrough broken) — O-112 regression.** `brain pm tasks`, `brain pm
  workstreams` accept zero filter options. Commands like `tasks --priority critical`, `tasks
  --status blocked --json`, `tasks --search "..."` all fail with "unknown option" or "too many
  arguments". Affected 11/30 prompts (P-01, P-06, P-07, P-17–P-19, P-21–P-23, P-28, P-30).
  Adds 1-3 extra calls per affected prompt as agents fall back to the singular form.

- **O-134 (active project not respected in fresh sessions).** `brain pm list` shows `(active)` but
  `brain pm tasks`, `brain pm status` fail with "no active project set" in the same session. Forces
  an extra `brain pm use <prefix>` call on every fresh session. Confirmed P-01, P-04.

- **O-102 (dispatch output = context) — confirmed for sixth cycle.** `brain pm dispatch` output is
  still identical to `brain pm context`. Agents reading dispatch output get no enriched brief, no
  upstream dependency summaries, no linked docs. P-25 (2/5) and P-24 improved 2→3 but only
  because the agent gave up on dispatch and assembled context manually.

- **Brain doc coverage at 0% — full regression.** 60 brain project docs (including `commands.md`,
  `architecture.md`, all design plans) are not indexed. A `brain init` or db reset between cycles
  wiped the v5 partial coverage. Agents discover command syntax by trial/error rather than search.
  Root cause: no `--force` guard on `brain init`, no `brain pm onboard --self` path (O-146, O-147).

---

## Recommended Fix Targets

### 1. Restore task body generation in synthesis agent (O-149 / O-26) — **Medium**
- **What:** Audit the `brain pm onboard` synthesis agent prompt and restore body generation:
  2-3 sentence done description, acceptance criteria bullets, relevant doc/file references.
  Use the v5 prompt as baseline. Also set `mode: manual` for hardware/vendor tasks.
- **Test bench impact:** P-03, P-05, P-08, P-11, P-19, P-26, P-29 (7 prompts). Context Assembly
  category (currently 2.7/5 avg) should move to 3.5+. Most impactful single fix available.
- **Scope:** Medium — prompt engineering with validation step; no schema changes needed.

### 2. Fix plural alias option passthrough (O-136) — **Small**
- **What:** Implement `tasks`/`workstreams`/`waves` aliases using Commander `.passThroughOptions()`
  or by re-declaring the full option set. `brain pm tasks --priority critical --json` must behave
  identically to `brain pm task list --priority critical --json`.
- **Test bench impact:** 11 prompts recover 1-3 wasted calls each. Eliminates a class of
  confusion that spans Discovery, Navigation, Filtering, and Write Ops categories.
- **Scope:** Small — Commander configuration change only.

### 3. Fix active project session state (O-134) — **Small**
- **What:** Audit `resolveProject()` to confirm it reads from the persisted state file on every
  CLI invocation, not just after an in-process `use` call. Add integration test for fresh-session
  active project resolution.
- **Test bench impact:** P-01, P-04 each save 1 extra call. Removes the most common first-step
  friction in every agent session.
- **Scope:** Small — likely a one-line fix in project resolution path.

### 4. Ingest core brain docs into KB (O-103, gap-analysis) — **Small / Operational**
- **What:** Run the ingest commands from gap-analysis recommendations section. At minimum:
  `commands.md` (1510 lines), `architecture.md`, `guide.md`, `onboarding-observations.md`.
  Then add `brain init` guard (O-146) and `brain pm onboard --self` path (O-147) to prevent
  re-regression.
- **Test bench impact:** Command syntax discovery improves across ~15 prompts. Agents stop
  guessing flag names and hitting "unknown option" errors.
- **Scope:** Operational fix is zero code. O-146 and O-147 are medium scope.

### 5. Fix dispatch enrichment (O-102) and claim token display (O-101) — **Medium**
- **What:** Wire `brain pm dispatch` to pull related search results, upstream dependency task
  titles, workstream context, and relevant research docs into the brief. Add claim token to plain-
  text output of `brain pm task claim` (not just JSON).
- **Test bench impact:** P-16 (4→5), P-24 (3→4), P-25 (2→4). Restores Agent Commands category
  from its current 2.5/5 floor.
- **Scope:** Medium — requires enrichment logic in dispatch command handler.

---

## Decision Points

1. **Brain doc ingestion strategy.** Three options: (a) run ingest commands manually before each
   diagnostic cycle (operational, fragile); (b) build `brain pm onboard --self --docs-dir ./docs`
   (permanent fix, medium scope, O-147); (c) add `brain watch --repo ./docs` for auto-reindex on
   commit (durable but large scope). Which approach and in which order?

2. **Task body enforcement — prompt vs schema.** Option A: update synthesis agent prompt to require
   body content (low effort, uncertainty about whether it holds). Option B: add a required
   `acceptance_criteria` schema field with create-time validation (enforced, higher effort). The v6
   regression (100% → 0%) suggests prompt-only is fragile. Which approach?

3. **O-25 (note graph relations) — address now or defer again?** Sixth consecutive cycle with
   zero relations. O-25 is the highest cumulative call-cost gap across all diagnostic history —
   8 prompts, 5–20 extra calls each. But it requires an architectural decision (auto-link at index
   vs explicit `brain pm relate`). Defer to v8, or scope a minimal solution now?
