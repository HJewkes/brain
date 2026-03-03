# PM Module Diagnostic v6 — Observations

**Date:** 2026-02-28
**Sources:** test-bench-results.md, session-audit.md, data-audit.md, gap-analysis.md
**Baseline observations:** docs/pm-module/onboarding-observations.md (O-01 through O-74), docs/pm-module/diagnostic/v5/observations.md (O-101 through O-133)

---

## New Observations

### O-134: Active project state not respected on first CLI invocation in a new session

- **Severity:** friction
- **Where:** `brain pm status`, `brain pm tasks --priority critical`, `brain pm tasks --status open`
- **What happened:** `brain pm list` shows the project as `(active)` but the very next command (`brain pm status`, `brain pm tasks`) fails with "no active project set" or "no active project specified". The session has to explicitly re-run `brain pm use <prefix>` before any project-scoped command works, even though the active state appears persisted.
- **Expected:** If `brain pm list` shows `(active)`, all project-scoped commands should honour that context without requiring re-invocation of `brain pm use`.
- **Fix:** Ensure the active project is loaded from persistent storage on every CLI invocation, not just after an explicit `use` call within the same process. Audit `resolveProject()` to confirm it reads from the persisted state file before requiring `--project`.
- **Test bench evidence:** P-01, P-04

---

### O-135: `brain pm briefing` shows "Blocked: 0" despite dependency-blocked tasks

- **Severity:** friction
- **Where:** `brain pm briefing`
- **What happened:** The session audit found briefing reported "Blocked: 0" when 9 tasks were dependency-constrained (Wave 1). The synthesis agent's own summary correctly described 9 blocked tasks. The O-106 fix added virtual state computation to `listTasks()` and `--status blocked` now filters correctly, but `briefing` computes its blocked count via a different code path that was not updated.
- **Expected:** Briefing should distinguish dependency-blocked tasks from eligible ones. The "Blocked" count should match `brain pm task list --status blocked`.
- **Fix:** Update `assembleProjectBriefing()` to use the same virtual state logic as `listTasks()` for its count aggregation.
- **Test bench evidence:** session-audit.md recommendation #3

---

### O-136: Plural command aliases don't pass through filter options — regression of O-112

- **Severity:** friction
- **Where:** `brain pm tasks`, `brain pm workstreams` (plural aliases)
- **What happened:** The v6 fix for O-112 added `tasks` and `workstreams` as alias commands. These work for bare listing but reject all filter arguments. Commands like `brain pm tasks --priority critical`, `brain pm tasks --status blocked`, `brain pm tasks --search "test"`, `brain pm tasks --json`, and `brain pm workstreams --project VOLTR` all fail with "too many arguments" or "unknown option". Every agent session that discovered the short form spent 1-2 extra calls when it hit a filtering use case.
- **Expected:** Plural alias commands should forward all flags to the underlying singular command. `brain pm tasks --priority critical --json` should behave identically to `brain pm task list --priority critical --json`.
- **Fix:** Implement aliases as option-passthrough wrappers using Commander's `.passThroughOptions()` or by re-declaring the full option set on the alias commands.
- **Test bench evidence:** P-01, P-06, P-07, P-17, P-18, P-19, P-21, P-22, P-23, P-28, P-30 (11 of 30 prompts)

---

### O-137: `brain pm next` has no `--workstream` filter and no `--json` flag

- **Severity:** friction
- **Where:** `brain pm next`
- **What happened:** P-05 needed to find eligible work in a specific workstream. `brain pm next` has no `--workstream` flag — agents must request `--limit 50` and filter in a python pipe. P-20 needed the complete eligible list programmatically but output is capped at "and 21 more eligible tasks" with no `--all` or `--json` flag to get the full machine-readable list.
- **Expected:** `brain pm next --workstream 6` returns only tasks from workstream 6. `brain pm next --json` returns the full list as a JSON array without truncation.
- **Fix:** Add `--workstream <n>` filter flag and `--json` output flag to `brain pm next`. The `--json` flag should return all results without the display cap.
- **Test bench evidence:** P-05, P-20

---

### O-138: `brain pm complete` doesn't enforce the claim token guard

- **Severity:** friction
- **Where:** `brain pm complete <id>`
- **What happened:** P-16 found that `brain pm complete` accepts a completion call without a valid `--token`. The claim token mechanism is supposed to prevent concurrent agent completions on the same task, but the guard appears un-enforced — the command does not reject when the token is absent or wrong.
- **Expected:** Completing a task without a matching claim token should fail with a clear error indicating the token is required and how to obtain one via `brain pm task claim`.
- **Fix:** In the `complete` command handler, require `--token` and validate it against the stored `claim_token`. Return a descriptive error if absent or mismatched.
- **Test bench evidence:** P-16

---

### O-139: No way to recover a lost claim token or see in-progress tasks after session restart

- **Severity:** friction
- **Where:** `brain pm next`, `brain pm task list`
- **What happened:** P-16 noted that if a session restarts after claiming a task, the claim token is lost. There is no `brain pm task list --status in-progress` or equivalent that shows which tasks are currently claimed and their tokens visible, so work cannot resume cleanly.
- **Expected:** `brain pm task list --status in-progress` should show all claimed/in-progress tasks with their tokens so work can resume.
- **Fix:** Ensure `--status in-progress` returns tasks in both `claimed` and `in-progress` states. Add the claim token to plain text output of `task show` when status is claimed/in-progress.
- **Test bench evidence:** P-16

---

### O-140: `brain index` silently deletes notes with no explanation

- **Severity:** friction
- **Where:** `brain index`
- **What happened:** During the onboarding session, `brain index` printed "Indexed 0, deleted 9" without identifying what was deleted or why. The deleted notes were likely stale PM notes from a prior run, but this was impossible to confirm from the output alone.
- **Expected:** When notes are deleted during indexing, output should identify the deleted notes (title or path) and the reason (e.g., "file no longer exists on disk"). A `--dry-run` flag should preview deletions before they execute.
- **Fix:** In the file scanner deletion path, log each deleted note's title and deletion reason. Print the affected note list whenever count > 0.
- **Test bench evidence:** session-audit.md anomaly

---

### O-141: No CI coverage report ingestion pipeline

- **Severity:** observation
- **Where:** planning commands
- **What happened:** P-12 found that tasks have aspirational coverage targets (e.g., "raise coverage to 80%") but actual percentages from CI are not stored. The question "what is the current test coverage across repos?" is unanswerable from PM data.
- **Expected:** A `brain pm coverage import` command (or equivalent) stores actual coverage metrics per repo and surfaces them in `brain pm status` or task context.
- **Fix:** Add optional `brain pm coverage import <prefix> --from <file>` that ingests coverage JSON from standard reporters (Istanbul, coverage.py) and links metrics to workstreams/tasks.
- **Test bench evidence:** P-12

---

### O-142: `brain pm task show <workstream-display-id>` returns NOT_FOUND with no routing hint

- **Severity:** friction
- **Where:** `brain pm task show VOLTR-03`
- **What happened:** P-12 tried `brain pm task show VOLTR-03` to inspect workstream 3 as a unit. The command returns NOT_FOUND because VOLTR-03 is a workstream display ID, not a task ID. There is no hint that this is a workstream and no routing to `workstream show`.
- **Expected:** The NOT_FOUND error should note "VOLTR-03 is a workstream, not a task. Try `brain pm workstream show VOLTR-03`." Alternatively, auto-route to workstream show when the ID pattern matches a workstream.
- **Fix:** In the task show NOT_FOUND path, check if the given ID matches a workstream display ID pattern and include the corrected command in the error.
- **Test bench evidence:** P-12

---

### O-143: `brain pm task list --search` only matches task titles — misses workstream-scoped tasks

- **Severity:** friction
- **Where:** `brain pm task list --search <term>`
- **What happened:** P-30 searched `--search 'analytics'` and got 0 results, even though VOLTR-05 is named "Analytics Accuracy and Completeness" with 7 tasks. The filter matches only task title substrings, not workstream names or descriptions. Users must know the workstream number to find tasks by domain.
- **Expected:** `--search 'analytics'` returns tasks belonging to workstreams with "analytics" in their name or description, plus tasks with "analytics" in their own title or body.
- **Fix:** Extend the `--search` filter in `listTasks()` to also match against the parent workstream's `title` and `description` fields.
- **Test bench evidence:** P-30

---

### O-144: No `--sort` or `--limit` flags on `brain pm task list`

- **Severity:** friction
- **Where:** `brain pm task list`
- **What happened:** P-29 needed the top 3 highest-priority tasks across all workstreams. `--sort priority` fails with "unknown option". There is no `--limit N` flag. Getting top-N requires retrieving all tasks and filtering in python. Agents must know exact priority level names to filter rather than requesting a sorted enumeration.
- **Expected:** `brain pm task list --sort priority --limit 3` returns the 3 highest-priority tasks.
- **Fix:** Add `--sort <field>` (accepting `priority`, `created`, `updated`, `workstream`) and `--limit <n>` options to `listTasks()`. Priority sort should use the canonical order: critical > high > medium > low.
- **Test bench evidence:** P-29

---

### O-145: `brain pm prompt show` doesn't accept prompt display IDs

- **Severity:** friction
- **Where:** `brain pm prompt show <id>`
- **What happened:** P-29 called `brain pm prompt show VOLTR-P01` after `brain pm prompt list` returned `VOLTR-P01`. The command returned NOT_FOUND. Prompt show only accepts task display IDs (e.g., VOLTR-03.01), not the prompt IDs that `prompt list` generates. The error message doesn't explain this distinction.
- **Expected:** `brain pm prompt show <prompt-id>` should accept the ID format returned by `brain pm prompt list`, or the error should clarify the expected format.
- **Fix:** Either accept prompt display IDs in `prompt show`, or change `prompt list` to show the task IDs that `prompt show` expects. Add a clear error message when the format is wrong.
- **Test bench evidence:** P-29

---

### O-146: `brain init` has no safeguard against clearing an existing index

- **Severity:** friction
- **Where:** `brain init`
- **What happened:** The gap-analysis identified a full regression from v5 to v6: all 61 previously indexed brain project docs were wiped between diagnostic cycles. A `brain init` or database migration cleared the index with no warning. There is no `--preserve-index` flag, no confirmation prompt when an existing index would be cleared, and no recovery path.
- **Expected:** `brain init` when an existing index is present should warn: "61 notes currently indexed. Re-initializing will clear all index data. Use --force to proceed, or --preserve-index to keep existing notes."
- **Fix:** Before clearing the database, check note count. If > 0, require `--force` to proceed destructively. Add `--preserve-index` to reinitialize config without touching note/chunk/embedding tables.
- **Test bench evidence:** gap-analysis.md root cause #1

---

### O-147: `brain pm onboard` cannot target brain's own `docs/` directory

- **Severity:** friction
- **Where:** `brain pm onboard` when brain manages itself
- **What happened:** `brain pm onboard` ingests docs from the external project being managed. When brain is used to manage its own development, there is no supported path to ingest `docs/pm-module/`, `docs/plans/`, or `src/` documentation. Coverage of brain's own 60+ doc files has been 0% across multiple diagnostic cycles as a result.
- **Expected:** A `--self` flag or `brain pm onboard brain --self --docs-dir ./docs/pm-module` targets the current working directory's doc tree.
- **Fix:** Add a `--self` flag to `brain pm onboard` that bypasses the external component scanner and ingests a specified local directory under the active project namespace.
- **Test bench evidence:** gap-analysis.md root cause #2

---

### O-148: V6 quality flat — no improvement despite fixes; context assembly and agent commands remain worst

- **Severity:** observation
- **Where:** test bench aggregate
- **What happened:** Average quality remained at 3.5/5 (identical to v5). Prompts at ≤3/5 increased from 14 to 15. The v6 fixes targeted plumbing issues that weren't primary quality drivers. Context Assembly (2.7/5) and Agent Commands (2.5/5) are driven by O-102 (dispatch regression), O-118 (brain context path failure), O-126 (empty project note), and O-149 (empty task bodies).
- **Root cause:** The v6 fix scope (O-103, O-104, O-105, O-106, O-124) did not address empty bodies (O-26/O-149), dispatch regression (O-102), or context path failure (O-118). These three gaps account for most quality failures in the two worst categories.
- **Fix direction:** Next fix pass should prioritize: (1) task body population by the synthesis agent, (2) O-102 dispatch enrichment, (3) O-118 brain context path resolution.
- **Test bench evidence:** aggregate scorecard

---

### O-149: Task body completeness regression — v6 onboard creates 0% populated bodies (was 100% in v5)

- **Severity:** friction
- **Where:** `brain pm onboard` synthesis agent — task body generation
- **What happened:** O-26 was resolved in v5 (all 43 tasks had body content). In v6, all 41 tasks have empty bodies (0%). The v6 synthesis agent prompt either no longer instructs body writing, or the prompt changes introduced in v6 inadvertently removed the body generation requirement.
- **Expected:** Every task created by `brain pm onboard` should have a substantive body: 2-3 sentence "done" description, acceptance criteria bullets, and references to relevant docs or code files.
- **Fix:** Audit the synthesis agent prompt in `brain pm onboard` and restore the body generation instruction using the v5 prompt as the baseline.
- **Test bench evidence:** data-audit.md, P-08, P-11, P-19, P-26, P-29

---

## Confirmed Observations

Existing observations confirmed as still present by v6 evidence:

| Observation | Evidence | Notes |
|-------------|----------|-------|
| O-101 | P-16 | Claim token missing from plain text output — regression of O-57 |
| O-102 | P-16, P-25 | Dispatch output identical to context — regression of O-51 |
| O-109 | P-01, P-02, P-03 | No unified `brain pm show <prefix>` — 4 commands needed for overview |
| O-111 | P-02 | `brain pm audit` has no `--project` flag; requires `brain pm use` first |
| O-113 | P-15 | `waves --json` omits `depends_on` from task objects |
| O-116 | P-11, P-20 | No due date, sprint, or milestone field on tasks |
| O-117 | P-05, P-14, P-24, P-25 | No fuzzy/name-based workstream or task lookup |
| O-118 | P-02, P-09, P-19, P-26 | `brain context <path>` fails for PM module note paths |
| O-119 | P-27 | `brain search` returns mixed PM/KB results with no scoping |
| O-120 | P-09 | No full document retrieval via CLI — search returns snippets only |
| O-121 | P-30 | `--memories` flag has no visible effect |
| O-125 | data-audit | 13 non-contiguous task number gaps across 7 workstreams |
| O-126 | data-audit, P-03 | Project note body is empty (`# voltras-workspace` only) |
| O-25 | P-02, P-08, P-09, P-10, P-19, P-26, P-27, P-29 (8 prompts) | Zero note relations — most frequent gap in v6 |
| O-16 | P-05, P-07, P-11, P-12, P-15, P-23, P-29 (7 prompts) | Insufficient dependencies — wave engine underutilized |
| O-49 | P-26, P-27, P-30 | PM task notes unsearchable via plain `brain search` |
| O-24 | data-audit | All 41 tasks `mode: auto`, including hardware-requiring tasks |
| O-27 | data-audit | Zero activities recorded — no audit trail from onboarding |

---

## Resolved Observations

Observations that appear fixed based on v6 cycle evidence:

| Observation | Prior Status | V6 Evidence |
|-------------|-------------|-------------|
| O-105 | v6-fixed | P-07 confirms `task list --json` now includes `virtualStates` and `depends_on` |
| O-106 | v6-fixed | P-07 confirms `--status blocked` returns correct results |
| O-104 | v6-fixed | Session audit confirms `--cwd` flag resolves component detection issue |
| O-124 | v6-fixed | Data audit: no auto-Triage workstream in v6 project structure |

**Partial resolutions:**

| Observation | Prior Status | V6 Evidence |
|-------------|-------------|-------------|
| O-112 | v6-partial | Aliases added but don't forward filter options — see O-136 |
| O-103 | v6-partial | Onboard injects commands.md as skill context, but not indexed in KB (0% brain docs — gap-analysis) |
| O-108 | v6-partial | NOT_FOUND now shows known prefixes; fuzzy prefix matching still absent |
| O-110 | v6-partial | Workstream descriptions in `list --json`; `workstream show` text output still sparse (P-13, P-24) |
| O-130 | v6-partial | commands.md + architecture.md ingested during onboard session but cleared between cycles |

---

## Punch List Updates

Recommended status changes based on v6 evidence:

| ID | Severity | Recommended Status | Reason |
|----|----------|--------------------|--------|
| O-26 | suggestion | **re-activated** | V6 onboard creates 0% body completeness (was 100% in v5) — see O-149 |
| O-101 | blocker | **confirmed** | Claim token still absent from plain text claim output |
| O-102 | friction | **confirmed** | Dispatch still identical to context output |
| O-104 | blocker | **resolved** | `--cwd` flag working — confirmed by session audit |
| O-105 | friction | **resolved** | `virtualStates`/`depends_on` confirmed in `task list --json` |
| O-106 | friction | **resolved** | `--status blocked` correctly filters by virtual state |
| O-112 | friction | **regression** | Aliases exist but don't forward options — O-136 opened |
| O-124 | friction | **resolved** | Triage workstream no longer auto-created |
| O-134 | friction | **new** | Active project state not respected in fresh sessions |
| O-135 | friction | **new** | Briefing blocked=0 display bug |
| O-136 | friction | **new** | Plural alias option passthrough broken (O-112 regression) |
| O-137 | friction | **new** | `brain pm next` missing `--workstream` and `--json` |
| O-138 | friction | **new** | `brain pm complete` doesn't enforce token guard |
| O-139 | friction | **new** | No claim token recovery after session restart |
| O-140 | friction | **new** | `brain index` silent deletions with no explanation |
| O-141 | observation | **new** | No CI coverage ingestion pipeline |
| O-142 | friction | **new** | `brain pm task show` for workstream ID returns NOT_FOUND with no hint |
| O-143 | friction | **new** | Task `--search` matches titles only, not workstream descriptions |
| O-144 | friction | **new** | No `--sort` or `--limit` on `brain pm task list` |
| O-145 | friction | **new** | `brain pm prompt show` doesn't accept prompt display IDs |
| O-146 | friction | **new** | `brain init` has no safeguard against clearing existing index |
| O-147 | friction | **new** | `brain pm onboard` can't self-target brain repo docs |
| O-148 | observation | **new** | V6 quality flat — no improvement despite fixes |
| O-149 | friction | **new** | Task body completeness regression (v6 onboard → 0% bodies) |
