# Documentation Coverage Gap Analysis — V8

Analyzed: 2026-03-01
Scope: `/Users/hjewkes/Documents/projects/brain/` repo docs vs brain knowledge base (`~/brain/`)

**Status vs V7:** The v7 gap analysis claimed core PM docs (architecture.md, commands.md, guide.md,
quickstart.md) were confirmed ingested. This was incorrect — those claims were likely based on
search results that returned VW project docs with similar names (e.g. VW's `docs/architecture.md`
matched queries for PM architecture). The current knowledge base contains **zero brain project
documentation**. All 65 indexed notes are VW (voltras-workspace) PM data.

**New in v8:** 3 empty placeholder files added at `docs/pm-module/diagnostic/v8/` (data-audit,
session-audit, gap-analysis). The v8 design doc is at `docs/plans/2026-02-28-v8-testing-design.md`.
VW project task count grew from 39 (v7) to 47 (v8) with prefix renamed from VOL → VW.

---

## Available Documentation

### Root Docs

| File path | Topic | Ingested |
|-----------|-------|----------|
| `README.md` | Project overview, quick-start, CLI summary | **No** |
| `CLAUDE.md` | Dev standards, architecture overview, command reference | **No** |
| `docs/review-deferred.md` | Deferred review item tracker | **No** |
| `skill/SKILL.md` | Published brain skill documentation | **No** |

### Note Templates

| File path | Topic | Ingested |
|-----------|-------|----------|
| `templates/decision.md` | Decision note structure | **No** |
| `templates/meeting.md` | Meeting note structure | **No** |
| `templates/note.md` | Generic note structure | **No** |
| `templates/research.md` | Research note structure | **No** |

### Core PM Docs (`docs/pm-module/` top-level)

| File path | Topic | Ingested |
|-----------|-------|----------|
| `docs/pm-module/architecture.md` | PM internals: data model, state machine, routing, templates | **No** |
| `docs/pm-module/commands.md` | Complete `brain pm` reference with flags and examples | **No** |
| `docs/pm-module/guide.md` | PM user guide: projects, workstreams, tasks, decisions, orchestration | **No** |
| `docs/pm-module/quickstart.md` | PM 10-minute setup walkthrough | **No** |
| `docs/pm-module/demo.md` | Demo script for PM module | **No** |
| `docs/pm-module/diagnostic-workflow.md` | Repeatable diagnostic loop procedure | **No** |
| `docs/pm-module/e2e-testing-strategy.md` | E2E and integration test design | **No** |
| `docs/pm-module/onboarding-observations.md` | 750 lines of accumulated findings (O-01 through O-~80) | **No** |
| `docs/pm-module/test-bench-prompts.md` | Human-readable test bench prompt catalog | **No** |

### Validation Docs (`docs/pm-module/validation/`)

| File path | Topic | Ingested |
|-----------|-------|----------|
| `docs/pm-module/validation/assisted-walkthrough.md` | Assisted mode walkthrough | **No** |
| `docs/pm-module/validation/orchestrator-walkthrough.md` | Orchestrator mode walkthrough | **No** |
| `docs/pm-module/validation/decision-capture.md` | Decision capture validation | **No** |
| `docs/pm-module/validation/skill-chain.md` | Skill chain validation | **No** |

### Diagnostic Prompts (`docs/pm-module/diagnostic/prompts/`)

| File path | Topic | Ingested |
|-----------|-------|----------|
| `diagnostic/prompts/component-analysis.md` | Component analysis prompt | **No** |
| `diagnostic/prompts/data-audit.md` | Data audit prompt | **No** |
| `diagnostic/prompts/gap-analysis.md` | Gap analysis prompt (this prompt) | **No** |
| `diagnostic/prompts/observations.md` | Observations prompt | **No** |
| `diagnostic/prompts/session-audit.md` | Session audit prompt | **No** |
| `diagnostic/prompts/setup.md` | Setup prompt | **No** |
| `diagnostic/prompts/summary.md` | Summary synthesis prompt | **No** |
| `diagnostic/prompts/synthesis.md` | Cross-run synthesis prompt | **No** |
| `diagnostic/prompts/test-bench/P-01.md` through `P-30.md` | 30 individual test bench prompts | **No** (0/30) |

### Diagnostic Results (`docs/pm-module/diagnostic/v1–v8/`)

| Version | Files | Ingested |
|---------|-------|----------|
| v1 | test-bench-results.md | **No** |
| v2 | test-bench-results.md | **No** |
| v3 | test-bench-results.md | **No** |
| v4 | data-audit, gap-analysis, observations, session-audit, summary, test-bench-results (6) | **No** |
| v5 | data-audit, gap-analysis, observations, session-audit, summary, test-bench-results (6) | **No** |
| v6 | data-audit, gap-analysis, observations, session-audit, summary, test-bench-results (6) | **No** |
| v7 | data-audit, gap-analysis, observations, session-audit, summary, test-bench-results (6) | **No** |
| v8 | data-audit, session-audit, gap-analysis (3, all empty at analysis time) | **No** |

### Research Docs (`docs/plans/pm-module/research/`)

| File path | Topic | Ingested |
|-----------|-------|----------|
| `research/orchestration-patterns.md` | Orchestration patterns survey | **No** |
| `research/methodologies.md` | PM methodology research | **No** |
| `research/tools-and-patterns.md` | Tools and agentic patterns survey | **No** |

### Design Plan Docs (`docs/plans/`)

| Category | Count | Ingested |
|----------|-------|----------|
| Dated plans (`2026-02-*-design.md`) | 17 | **No** |
| PM module design docs (`00-overview` through `04-workflows`) | 5 | **No** |
| PM module stream/review docs | 7 | **No** |
| V8 testing design doc | 1 (new) | **No** |
| **Total** | **29** | **0** |

---

## Coverage Summary

| Category | Total Files | Ingested | Coverage |
|----------|-------------|----------|----------|
| Root docs | 4 | 0 | **0%** |
| Templates | 4 | 0 | **0%** |
| Core PM docs (top-level) | 9 | 0 | **0%** |
| Validation walkthroughs | 4 | 0 | **0%** |
| Diagnostic prompts (main) | 8 | 0 | **0%** |
| Test-bench prompts (P-01–P-30) | 30 | 0 | **0%** |
| Diagnostic results (v1–v7) | 27 | 0 | **0%** |
| Diagnostic results (v8 placeholders) | 3 | 0 | **0%** |
| Research docs | 3 | 0 | **0%** |
| Design plans | 29 | 0 | **0%** |
| **Total** | **121** | **0** | **0%** |

**V7 → V8 delta:** V7 reported 35% coverage (40/113 ingested). This was inaccurate. The v7 agent
likely misidentified VW project docs (e.g. `docs/architecture.md` = Titan Design System) as brain
project docs when validating ingestion via search. Actual coverage at v8 analysis time: **0%**. All
65 indexed notes are VW project PM data (47 tasks + 5 workstreams + 1 project + 1 onboard-manifest
+ 11 VW docs). No brain project documentation exists in the knowledge base.

---

## Major Gaps

### Gap 1: No self-ingestion of brain project docs (0/121 files) — Critical

The brain project has never been onboarded into its own knowledge base. No brain docs are
searchable via `brain search`. An agent debugging PM behavior cannot search:

- `"how does dispatch work"` → finds VW architecture, not brain's dispatch logic
- `"PM task commands flags"` → finds VW changelog, not brain's commands reference
- `"onboarding observations"` → returns nothing useful

The practical cost: agents rely entirely on skill prompt context or must read files directly.
They cannot discover or cross-reference documentation organically.

### Gap 2: All 750 lines of `onboarding-observations.md` unindexed — High Impact

Accumulated findings from 8 diagnostic cycles (O-01 through O-~80) with severity, root cause,
and resolution status per observation. Without this indexed:
- A setup agent cannot search "what observations were fixed in v7" or "what is O-57"
- Gap analysis agents must re-derive patterns that are already documented
- Agents preparing fix recommendations cannot confirm whether a proposed fix addresses a known observation

### Gap 3: All 27 diagnostic result files (v1–v7) unindexed — High Impact

These documents encode the complete quality evolution of the PM module across 8 cycles. Without
them indexed:
- No searchable history of what broke, when it broke, and what fixed it
- Cannot search "which prompts were affected by O-135" or "v6 observations"
- Each diagnostic cycle re-discovers context that is already captured in prior summaries
- Test bench result comparisons require reading files directly rather than searching

### Gap 4: All 30 test-bench prompts unindexed — High Impact

The 30 individual `P-*.md` files define the exact scenarios used for quality evaluation. Without
them indexed:
- Setup agents cannot discover test scenarios via search
- Cannot query "what does P-12 test" or find prompts that target specific command categories
- No baseline for understanding what the test bench covers and where it is incomplete

### Gap 5: Core PM docs not searchable — High Impact

`architecture.md`, `commands.md`, `guide.md`, `quickstart.md` are the primary reference docs for
agents using the PM module. Without indexing:
- Agents do not discover flag names or command patterns through search (they trial-and-error)
- Non-brain tool calls increase as agents read help text instead of finding indexed reference
- v7 non-brain calls (38/491) would likely decrease if command docs were searchable

### Gap 6: Validation walkthroughs unindexed — Medium Impact

Assisted mode, orchestrator mode, decision capture, and skill chain walkthroughs define the
expected behavior of end-to-end PM workflows. Without them indexed, agents debugging workflow
failures have no indexed behavioral spec to query.

### Gap 7: V7 Correction — false positive ingestion claims

V7 gap analysis reported architecture.md, commands.md, guide.md, quickstart.md as "Ingested: Yes"
based on brain search hits. The hits returned were VW project files (`docs/architecture.md` =
Titan Design System Architecture). The search-based ingestion verification method used in v7 is
unreliable when another project's docs contain similarly-named sections.

---

## Root Causes

### 1. The brain project has never been self-onboarded

`brain pm onboard` was only run for the VW (voltras-workspace) project. The brain project's own
documentation was never passed through `brain ingest` or `brain pm onboard`. The primary workspace
(`~/brain/`) contains only `_index.md` and the VW PM module directory.

### 2. Self-ingestion is architecturally awkward

The brain tool is designed to ingest user notes and project context *for other projects*. Using it
to index its own developer documentation requires the project to treat itself as a managed workspace
— a workflow that the onboard skill doesn't guide agents toward. There's no `brain pm onboard --self`
or `brain ingest ./docs/` shortcut that naturally covers project docs.

### 3. V7 ingestion verification used unreliable search-match heuristic

The v7 gap analysis verified ingestion by running `brain search "<topic>"` and checking if a hit
appeared. This failed because VW project docs (architecture.md = Titan Design System, commands
reference = voltra SDK) contain overlapping terms that score above threshold for PM-related queries.
Reliable ingestion verification requires checking note file paths, not just search rank.

### 4. High-churn diagnostic outputs have no re-indexing cadence

Even if brain docs were indexed once, the diagnostic results directory grows by 3–6 files per cycle.
There is no hook or workflow step that re-indexes `docs/pm-module/diagnostic/` after each cycle.
Post-diagnostic content is always stale relative to the knowledge base.

### 5. Diagnostic prompts stored as 30 separate files

30 individual `P-*.md` files require an explicit wildcard or directory path for bulk ingestion.
Without a consolidated file, any ingest step requires capturing the full subdirectory glob.

---

## Recommendations

### R-1: Self-ingest brain project docs (closes Gaps 1, 2, 3, 4, 5, 6)

Run a one-time ingest pass covering all high-value brain repo docs:

```bash
brain ingest README.md CLAUDE.md
brain ingest docs/pm-module/architecture.md docs/pm-module/commands.md
brain ingest docs/pm-module/guide.md docs/pm-module/quickstart.md
brain ingest docs/pm-module/diagnostic-workflow.md docs/pm-module/onboarding-observations.md
brain ingest docs/pm-module/validation/
brain ingest docs/pm-module/diagnostic/prompts/
brain ingest docs/pm-module/diagnostic/prompts/test-bench/
brain ingest docs/pm-module/diagnostic/v1/ docs/pm-module/diagnostic/v2/
brain ingest docs/pm-module/diagnostic/v3/ docs/pm-module/diagnostic/v4/
brain ingest docs/pm-module/diagnostic/v5/ docs/pm-module/diagnostic/v6/
brain ingest docs/pm-module/diagnostic/v7/
```

This is a one-time operation. The resulting notes should use `type: reference` or `type: research`,
`tier: slow`, to keep them out of PM module isolation.

### R-2: Add post-diagnostic re-index step to the diagnostic workflow

After completing each diagnostic cycle, add a step to `diagnostic-workflow.md`:

```bash
brain ingest docs/pm-module/diagnostic/v8/*.md
brain ingest docs/pm-module/onboarding-observations.md  # updated each cycle
brain index
```

This ensures that new diagnostic results are immediately searchable in the next cycle's setup.

### R-3: Fix ingestion verification to use path-based confirmation

When a gap analysis agent checks whether a file is indexed, it should use a path-anchored query:

```bash
brain search --filter path:"architecture.md" --limit 5
```

or verify by note slug. Relying on topical search rank alone produces false positives when another
project's docs overlap in terminology (as occurred in v7).

### R-4: Consolidate test-bench prompts into a single indexed file

Produce `docs/pm-module/diagnostic/prompts/test-bench-all.md` by concatenating all 30 `P-*.md`
files with section headers. A single file is easier to ingest, chunk, and reference in skill
prompts. The 30-file structure can remain for operational use; the consolidated file serves indexing.

### R-5: Add a `--self` option to `brain pm onboard` or a `brain ingest-docs` convenience command

For future sessions, a single command that ingests the project's own developer documentation
reduces friction and eliminates the need for agents to construct the correct ingest paths manually.
