# PM Module Diagnostic v5 — Observations

**Date:** 2026-02-28
**Sources:** test-bench-results.md, session-audit.md, data-audit.md, gap-analysis.md
**Baseline observations:** docs/pm-module/onboarding-observations.md (O-01 through O-100)

---

## New Observations

### O-101: `brain pm task claim` plain text output omits claim_token — regression of O-57

- **Severity:** blocker
- **Where:** `brain pm task claim <id>` — plain text workflow
- **What happened:** The claim_token is returned in `--json` output but NOT shown in plain text output. An agent not using `--json` has no token and cannot call `task start`. O-57 was marked "v3-fixed" but the fix only applies when `--json` is passed.
- **Expected:** Plain text claim output should show the token prominently: `Token: abc-123 (needed for task start)`.
- **Fix:** Update the plain text formatter in `claim` to include the token alongside the updated task status.
- **Test bench evidence:** P-16 ("typical workflow")

---

### O-102: `brain pm dispatch` output is identical to `brain pm context` — regression of O-51

- **Severity:** friction
- **Where:** `brain pm dispatch <task-id>`
- **What happened:** P-16 and P-25 both found that `dispatch` and `context` return the same content: task name, status, description, workstream. No additional codebase snippets, architecture references, prompt templates, or workstream context is included. O-51 was marked "v3-fixed" but the enrichment is absent.
- **Expected:** `dispatch` should produce a self-contained agent prompt: task objective, related architecture docs (from search), files to modify, validation steps, completion criteria.
- **Fix:** Wire `dispatch` to aggregate context beyond the task note body — pull related search results, upstream dependency descriptions, and workstream notes.
- **Test bench evidence:** P-16, P-25

---

### O-103: `commands.md` (1452 lines) not indexed — primary agent CLI reference unavailable

- **Severity:** blocker
- **Where:** `docs/pm-module/commands.md`
- **What happened:** The complete `brain pm` command reference (all subcommands, flags, arguments, enum options, examples) is not indexed. Agents must infer syntax from `--help` or hallucinate flags. Every command malformation error in the test bench traces to this gap — agents tried wrong flag names (`--format json`, `--filter status=done`, `brain pm tasks`, `--all`) that are absent because they lacked the reference.
- **Expected:** `brain search "task add flags"` should return the exact `task add` syntax. Any command-related query should surface the relevant section from `commands.md`.
- **Fix:** `brain ingest docs/pm-module/commands.md`. Longer term: include in the brain self-knowledge base and refresh on each build.
- **Test bench evidence:** P-02, P-04, P-05, P-07, P-08, P-12, P-13, P-14, P-17, P-18, P-20, P-22, P-25

---

### O-104: `brain pm onboard` working directory sensitivity — wrong dir gives 1 component instead of 4

- **Severity:** blocker
- **Where:** `brain pm onboard <name>` — run from home dir vs workspace root
- **What happened:** Agent ran `brain pm onboard voltras-workspace --prefix VOLTRAS` from `~` (home directory) and only 1 component was detected. Re-running from `~/Documents/projects/voltras-workspace` detected 4 components. The CLI gives no warning that the scan found an unusually small number of components or that it was run outside a project directory.
- **Expected:** Either (a) require `--dir <path>` when no local project is detected, or (b) warn: "Only 1 component detected. Run from your project root or use `--dir <path>` for better coverage."
- **Fix:** Add a component count heuristic check — if fewer than 2 components detected, print a warning suggesting the user check their working directory or use `--dir`.
- **Test bench evidence:** session-audit.md

---

### O-105: `brain pm task list --json` omits `virtualStates` and `depends_on` fields

- **Severity:** friction
- **Where:** `brain pm task list --json`
- **What happened:** P-07 (blocked tasks) needed to find all blocked tasks. `task list --json` doesn't include `virtualStates` (e.g., `BLOCKED`, `READY`, `ELIGIBLE`) or `depends_on` arrays — both are present in `task show --json`. This forces an N+1 pattern: 1 list call + 43 individual show calls to find blocked tasks.
- **Expected:** `task list --json` should include all fields present in `task show --json` so the full task graph can be assembled in one call.
- **Fix:** Extend `listTasks()` query to include `depends_on` from the dependency join and compute virtual states for each task before returning the list.
- **Test bench evidence:** P-07, P-15, P-29

---

### O-106: Virtual states (blocked/ready/eligible) not queryable via `--status` filter

- **Severity:** friction
- **Where:** `brain pm task list --status blocked`
- **What happened:** `--status blocked` returns zero results even when blocked tasks exist. The `status` field in storage is always `pending`/`claimed`/`in-progress`/`done` — the blocked state is a computed `virtualState`. Agents who ask for blocked tasks get an empty response with no explanation.
- **Expected:** Either `--status blocked` should trigger a virtual state filter (checking for dependency blocks), or the help text should explain that `blocked` is a virtual state not queryable via `--status`.
- **Fix:** Add a `--virtual-state` flag to `task list`, or make `--status` smart enough to translate `blocked`/`ready`/`eligible` into the appropriate virtual state query.
- **Test bench evidence:** P-07

---

### O-107: `brain pm task list --workstream <display-id>` silently returns empty — bug (upgrade of O-60)

- **Severity:** bug
- **Where:** `brain pm task list --workstream VOLT-06`
- **What happened:** Multiple prompts (P-07, P-19, P-22) found that `--workstream VOLT-06` returns "No tasks found" even when tasks clearly exist for that workstream. The filter appears to expect a raw integer (e.g., `6`) not the display ID. O-60 noted "--workstream takes number not name" as deferred, but the actual behavior is worse: passing a display ID silently returns empty rather than erroring.
- **Expected:** Either accept display IDs (`VOLT-06`) and resolve them, or fail with a clear message: "Workstream filter expects a number (e.g., `--workstream 6`). Run `workstream list` to find the number."
- **Fix:** Resolve display IDs to numbers in `--workstream` parsing, or add early validation that errors with guidance.
- **Test bench evidence:** P-07, P-19, P-22

---

### O-108: NOT_FOUND errors give no recovery guidance — wrong prefix, empty workstream undistinguishable

- **Severity:** friction
- **Where:** `brain pm task show <id>`, `brain pm context <id>`, `brain pm dispatch <id>`
- **What happened:** Multiple prompts used `VLT-01.01` when the actual prefix is `VOLT`. NOT_FOUND error gives no hint about the correct prefix, nearby task IDs, or whether the workstream is empty vs the task doesn't exist. P-08, P-21, P-23, P-24, P-25 all spent 5+ calls diagnosing the same ambiguity.
- **Expected:** NOT_FOUND should include: (a) list of known project prefixes, (b) suggestion to run `pm list` to see valid prefixes, (c) if the workstream exists but is empty, note that explicitly.
- **Fix:** In `resolveTask()`, catch NOT_FOUND and add context: query known prefixes, suggest the closest match, note if the workstream (parsed from the ID) is valid but empty.
- **Test bench evidence:** P-08, P-21, P-23, P-24, P-25

---

### O-109: No `brain pm show <prefix>` command — no unified project detail view in one call

- **Severity:** friction
- **Where:** `brain pm show VOLT`
- **What happened:** P-01 tried `brain pm show VOLT` (unknown command). Getting a full project overview requires chaining: `pm list` → `pm status` → `pm workstream list` → `pm briefing` — 4 calls for information that should be one.
- **Expected:** `brain pm show VOLT` returns: project name/prefix, description, workstream count + names, task count breakdown, wave summary, top eligible tasks. Equivalent to a structured `pm status --full`.
- **Fix:** Add `brain pm show <prefix>` or enhance `pm status <prefix>` to include workstream list and priority breakdown inline.
- **Test bench evidence:** P-01, P-03

---

### O-110: Workstream descriptions not accessible from any PM CLI command

- **Severity:** friction
- **Where:** `brain pm workstream list`, `brain pm workstream show`
- **What happened:** P-02, P-05, P-26 all found that workstream descriptions are invisible. `workstream list` shows name/status only. `workstream show` returns id/title/project/number/status — no description, goals, or scope. Agents cannot determine which workstream covers "Mobile App" work without reading all 43 task titles.
- **Expected:** `workstream show VOLT-06` should include the description field that was set at creation.
- **Fix:** Include `description` in `formatWorkstreamLine` and `workstream show` output (plain text and JSON).
- **Test bench evidence:** P-02, P-05, P-16, P-26

---

### O-111: `brain pm audit` has no `--project` flag — impossible to scope to one project

- **Severity:** friction
- **Where:** `brain pm audit`
- **What happened:** P-02 tried `brain pm audit --project VOLT` and got "unknown option". When multiple projects exist, `audit` covers all of them with no scoping. P-27's `pm check --deep` is similarly un-scopable.
- **Expected:** Both `audit` and `check` should accept `--project <prefix>` to filter results.
- **Fix:** Add `--project` option to `audit` and `check` commands, pass it through to the underlying queries.
- **Test bench evidence:** P-02, P-27

---

### O-112: Singular/plural command surface inconsistency across PM CLI

- **Severity:** friction
- **Where:** `brain pm tasks`, `brain pm workstreams`, `brain pm task list`, `brain pm workstream list`
- **What happened:** Top-level commands use plurals (`waves`, `next`, `briefing`) but entity commands require singular noun + verb subcommand (`task list`, `workstream list`). `brain pm tasks` fails; `brain pm waves` succeeds. Every agent session saw 2-5 failed guesses before finding the right form. Hit in P-04, P-06, P-12, P-15, P-17, P-18, P-20, P-22, P-25.
- **Expected:** Either alias plurals (`tasks → task list`, `workstreams → workstream list`) or adopt a consistent pattern throughout.
- **Fix:** Add aliases for `brain pm tasks → brain pm task list` and `brain pm workstreams → brain pm workstream list`. The error message should include the corrected form.
- **Test bench evidence:** P-04, P-06, P-12, P-15, P-17, P-18, P-20, P-22, P-25

---

### O-113: `brain pm waves --json` omits `depends_on` from task objects

- **Severity:** friction
- **Where:** `brain pm waves --json`
- **What happened:** P-15 used `waves --json` to explain wave membership but found it doesn't include `depends_on` arrays. A second `task list --json` call was needed to explain *why* tasks land in specific waves. The waves output is the ideal place for this since it's specifically about dependency ordering.
- **Expected:** `waves --json` task objects should include `depends_on` arrays and upstream task titles.
- **Fix:** Extend the wave query to join dependency data and include it in the task objects within the wave response.
- **Test bench evidence:** P-15

---

### O-114: `brain pm briefing` and `brain pm status` report inconsistent task counts

- **Severity:** friction
- **Where:** `brain pm briefing` vs `brain pm status`
- **What happened:** P-13 found `brain pm briefing` reported 1 done task while `brain pm status` showed 0 done tasks for the same project. These should query the same source.
- **Expected:** Consistent counts across all PM commands that report task totals.
- **Fix:** Audit the query paths for both commands — ensure they use the same status filtering logic.
- **Test bench evidence:** P-13

---

### O-115: `--status done/blocked` filter returns ambiguous empty results — silent flag discard vs genuine zero count

- **Severity:** friction
- **Where:** `brain pm task list --status done`, `--status blocked`
- **What happened:** P-07, P-12 found that `--status done` and `--status blocked` return "No tasks found" with no indication of whether (a) the flag was accepted and the status genuinely has zero tasks, or (b) the flag was silently ignored/rejected. Agents spent 5+ calls trying to distinguish these cases.
- **Expected:** If the flag is accepted, output should confirm: "No tasks found with status 'done'". If the flag is invalid or `blocked` is a virtual state not valid here, return an error.
- **Fix:** Add a diagnostic note to empty results: "0 tasks matched filters: status=done". This disambiguates accepted-filter-empty from silent-failure.
- **Test bench evidence:** P-07, P-12

---

### O-116: No temporal planning horizon — tasks have no due dates, sprints, or quarters

- **Severity:** observation
- **Where:** entire PM data model
- **What happened:** P-20 ("feature work for next quarter") and P-11 ("ship Android MVP") could not be answered from PM data. Tasks have wave-based dependency ordering but no calendar dimension. The PM module cannot answer "Q2 plan", "this sprint", or "by April 1st".
- **Expected:** Optional due date or sprint/milestone assignment on tasks.
- **Fix:** Add optional `due_date` and `milestone` fields to task schema. The `waves` command could be complemented by a `sprint` concept or date-range filter.
- **Test bench evidence:** P-11, P-20

---

### O-117: No fuzzy or name-based workstream/task lookup — wrong names fail silently

- **Severity:** friction
- **Where:** `brain pm workstream show`, `brain pm task add --workstream`, `brain pm task show`
- **What happened:** P-05, P-14, P-24, P-25 all failed because: (a) workstream lookup by name (`'Mobile App'`) is not supported — only numeric or display IDs work; (b) `task add --workstream` accepts only an integer, requiring a prior `workstream list` call; (c) abbreviated prefixes (`VLT` vs `VOLT`) give NOT_FOUND with no suggestion.
- **Expected:** Accept names/partial matches where unambiguous. At minimum, error messages should suggest the closest match or the lookup command.
- **Fix:** Add name resolution to workstream commands. In `task add --workstream`, accept display IDs (`VOLT-06`) and resolve them. In NOT_FOUND errors, include a "Did you mean?" based on prefix similarity.
- **Test bench evidence:** P-05, P-14, P-23, P-24, P-25

---

### O-118: `brain context <path>` and `brain context <id>` fail for PM module notes

- **Severity:** friction
- **Where:** `brain context <note-slug-or-path>`
- **What happened:** P-03, P-09, P-12, P-19 all tried `brain context` with various forms of note references (absolute path, relative path, note slug from search results) and got "note not found" or "No context found." The slug format required is opaque — search results show file paths but `context` requires internal slugs that differ from paths. No CLI command reveals the correct slug.
- **Expected:** `brain context` should accept the path format shown in search results (e.g., `modules/pm/VOLT/docs/architecture.md`) and resolve it to the internal slug automatically.
- **Fix:** Add path-to-slug resolution in the context command. Alternatively, make `brain search` output include the slug form alongside the file path.
- **Test bench evidence:** P-03, P-09, P-12, P-19

---

### O-119: `brain search` cross-contaminates project results with brain's own dev docs

- **Severity:** friction
- **Where:** `brain search "..." --project VOLT` (doesn't exist) vs unqualified search
- **What happened:** P-03, P-11, P-27 found that searching for project content also returns brain PM design docs (`pm-onboard-design.md`, `00-overview.md`, `01-brain-module-system.md`) because they are indexed with `module: pm, project: VOLT`. A query for "voltras architecture" returns documents about brain's own architecture.
- **Root cause:** The data audit confirms 14 brain design docs are indexed under `module: pm, project: VOLT` — the same namespace as voltras project content.
- **Expected:** `brain search` should support `--module` or `--project` scoping to isolate voltras content from brain dev docs.
- **Fix:** (a) Remove brain dev docs from the VOLT project namespace. (b) Add `--project` flag to `brain search` to scope by module instance.
- **Test bench evidence:** P-03, P-11, P-27

---

### O-120: No full document retrieval via CLI — search returns snippets only

- **Severity:** friction
- **Where:** `brain search`, `brain context`
- **What happened:** P-09 ("BLE SDK architecture") needed the full content of `bluetooth-protocol.md` and `platform-adapters.md` but search returns 200-500 char snippets per chunk. Getting the full content required 8-10 targeted queries to piece together from snippets. No `brain read <note-slug>` or `brain search --full` command exists.
- **Expected:** `brain read <slug>` or `brain search --full` returns the complete note body for the top N results.
- **Fix:** Add `brain notes read <slug>` or `brain notes show <slug>` command that returns the full note content. Alternative: `brain search --full --limit 1` returns full content of top result.
- **Test bench evidence:** P-09, P-12

---

### O-121: `brain search --memories` flag has no visible effect

- **Severity:** friction
- **Where:** `brain search "analytics" --memories`
- **What happened:** P-30 found that results with and without `--memories` are identical. Either memories are always included in search (flag is redundant but undocumented) or the flag is silently ignored. With 0 memories extracted in the VOLT project, this may be "no memories to show" but the output should say that.
- **Expected:** If memories are always searched, remove the flag or document that it's a no-op. If it adds memories, the output should visually separate memory results from note results.
- **Fix:** Either remove `--memories` from the help text (as it's now always-on), or add a "Memories (0 found)" section when no memories match.
- **Test bench evidence:** P-30

---

### O-122: Note search and task search return duplicate results — no unified de-duplicated view

- **Severity:** friction
- **Where:** `brain search "analytics"` + `brain pm task list --search "analytics"`
- **What happened:** P-30 found both commands return the same underlying PM task markdown files. The same VOLT-03.06 task note appears in both `brain search` (as a KB note) and `brain pm task list --search` (as a PM task). No de-duplication or unified cross-domain search view exists.
- **Expected:** A unified search that returns each document once with its type (note/task/decision/workstream) labeled. `brain search "analytics" --include-tasks` should de-duplicate.
- **Fix:** O-72's `--include-tasks` flag should de-duplicate when tasks and notes are the same file. Or the search result type label should make the overlap obvious.
- **Test bench evidence:** P-30

---

### O-123: Brain dev docs indexed under VOLT project namespace — pollute all project-scoped searches

- **Severity:** friction
- **Where:** data-audit.md findings, confirmed by P-03, P-27
- **What happened:** 14 brain internal design docs (00-overview.md, 01-brain-module-system.md, 02-pm-module-design.md, and 11 dated session docs from 2026-02-xx) are stored in `~/brain/modules/pm/VOLT/docs/` and indexed with `module: pm, project: VOLT`. They appear as VOLT project knowledge in semantic search alongside voltras codebase content.
- **Root cause:** The doc scanner picks up files from prior brain PM work sessions that happened to be stored in the same directory as voltras docs.
- **Fix:** The doc scanner should skip files that already carry `module: pm` and belong to a different project, or they should be stored under `module: pm, project: BRAIN` (not VOLT). Add origin tagging to distinguish external ingest from brain dev docs.
- **Test bench evidence:** P-03, P-11, P-27, data-audit.md

---

### O-124: Auto-created Triage workstream (VOLT-01) empty, unlabeled, and noisy

- **Severity:** friction
- **Where:** `brain pm onboard` — auto-creates VOLT-01 as a triage workstream
- **What happened:** VOLT-01 was created with description "Default workstream for unassigned tasks during onboarding." No tasks were assigned to it. It appears in all workstream listings, adds confusion ("what's in Triage?"), and causes P-08, P-21, P-24 agents to waste 5+ calls diagnosing whether VOLT-01.01 exists at all vs is an empty workstream.
- **Expected:** Only create a Triage workstream if there are actually unassigned tasks to put there. If all tasks are categorized at creation, skip VOLT-01.
- **Fix:** In the onboard synthesis agent prompt, instruct: "Only create a Triage workstream if you have tasks that don't fit existing workstreams." Alternatively, auto-delete VOLT-01 at the end of onboarding if it has zero tasks.
- **Test bench evidence:** session-audit.md, data-audit.md, P-08, P-21, P-24

---

### O-125: Non-sequential task numbering — gaps from mid-session deletions

- **Severity:** friction
- **Where:** task IDs across VOLT-03, VOLT-04, VOLT-05, VOLT-07
- **What happened:** 12 task numbers are missing (gaps at VOLT-03.02–04, 03.08; VOLT-04.01; VOLT-05.02–03, 05.06; VOLT-07.04). These gaps indicate tasks were created and then deleted during the onboarding session. P-25 agents noted the gaps as confusing — they tried to find VOLT-03.02 assuming it existed.
- **Fix:** Either document that IDs are not recycled (expected behavior), or display gaps explicitly in `task list` output: "VOLT-03.01 ... [3 removed] ... VOLT-03.05". A `pm history` or audit command showing deleted task records would make this auditable.
- **Test bench evidence:** data-audit.md, P-25

---

### O-126: Project note body is empty — just `# voltras` heading

- **Severity:** friction
- **Where:** `~/brain/modules/pm/VOLT/project.md`
- **What happened:** The project root note body contains only the title heading. P-03 ("new joiner context") found no high-level project description accessible from the PM CLI. `brain context volt-project` returns "No context found." The project note is the first thing a bootstrapping agent should read, but it has no content.
- **Expected:** `brain pm init` or `brain pm onboard` should populate the project note with: project purpose, current state, key constraints, primary repos, links to reference docs.
- **Fix:** The onboarding synthesis agent should write a substantive project note body: purpose sentence, tech stack summary, current state (e.g., "pre-v1, BLE protocol partially validated"), key constraints, and links to architecture docs.
- **Test bench evidence:** data-audit.md, P-03

---

### O-127: Task body quality shallow — bodies exist but lack acceptance criteria

- **Severity:** friction
- **Where:** all 43 VOLT task notes
- **What happened:** V5 is the first cycle where 100% of tasks have body content (O-90 resolved). However, the bodies are uniformly shallow: one descriptive paragraph, 228–500 chars, no acceptance criteria, no technical implementation notes, no file references, no definition of done. An agent dispatched to implement a task must still do substantial additional research.
- **Expected:** Task bodies should include: (a) what specifically needs to change, (b) which files are likely involved, (c) 1-3 concrete acceptance criteria, (d) reference to relevant spec/doc if one exists.
- **Fix:** Onboarding synthesis agent prompt should require: "For each task, include: context sentence, specific deliverable, and 2-3 acceptance criteria. Reference the source doc by name."
- **Test bench evidence:** data-audit.md, P-08, P-11, P-29

---

### O-128: No `brain pm onboard status` / manifest inspect command — agents must `cat` files

- **Severity:** friction
- **Where:** post-onboard inspection
- **What happened:** After `brain pm onboard` runs, the agent needed to inspect the manifest (components detected, docs ingested). The only way was `cat ~/brain/modules/pm/VOLT/volt-onboard-manifest.md` — a raw file read at a hardcoded path. No CLI command exposes the manifest. This produced 2 non-brain filesystem calls and relies on knowing internal file paths.
- **Expected:** `brain pm onboard status VOLT` or `brain pm manifest VOLT` should print: detected components, docs ingested per component, dates, and any coverage warnings.
- **Fix:** Add a `brain pm onboard status <prefix>` command that reads and formats the onboard manifest note.
- **Test bench evidence:** session-audit.md

---

### O-129: `--max-docs N` cap hit silently — no warning when doc coverage is truncated

- **Severity:** friction
- **Where:** `brain pm onboard ... --max-docs 20`
- **What happened:** The agent set `--max-docs 20` and the cap was hit (20 docs ingested from the first component scanned). No warning was printed. The agent didn't know coverage was truncated and didn't adjust the limit or do per-component passes.
- **Expected:** When the `--max-docs` limit is reached, print: "⚠ Doc limit reached (20/20). Some components may have reduced coverage. Re-run with --max-docs 50 or --per-component for full ingestion."
- **Fix:** Add a post-scan warning when `--max-docs` is hit, listing which components were fully vs partially covered.
- **Test bench evidence:** session-audit.md

---

### O-130: `docs/pm-module/architecture.md` and `onboarding-observations.md` not indexed

- **Severity:** friction
- **Where:** gap-analysis.md findings
- **What happened:** `architecture.md` (357 lines — state machine, routing table, claim token protocol, virtual states) and `onboarding-observations.md` (1102 lines — all accumulated cross-session findings) are not indexed. Agents asking about state transitions or known bugs get no results from brain search.
- **Impact:** `architecture.md` absence causes agents to misunderstand virtual states, claim tokens, and routing (confirmed by test bench P-07, P-16 friction). `onboarding-observations.md` absence means every session rediscovers known failure patterns.
- **Fix:** `brain ingest docs/pm-module/architecture.md` and `brain ingest docs/pm-module/onboarding-observations.md`. Add to a "must index" list that runs as part of the dev setup.
- **Test bench evidence:** gap-analysis.md, P-07, P-16

---

### O-131: No documentation coverage tracking — no way to audit which docs are indexed

- **Severity:** friction
- **Where:** brain system — `brain status`, `brain doctor`
- **What happened:** gap-analysis.md identified 35% coverage of brain's own docs (17 of ~49 files indexed). There is no command to ask "which files in ./docs/ are indexed?" The gaps were only discovered by manually cross-referencing the filesystem and search index.
- **Expected:** `brain doctor --coverage ./docs` reports: N files found, M indexed, K not indexed. `brain status` could include a coverage line for known doc directories.
- **Fix:** Add a `brain ingest --report <dir>` mode that shows new vs already-indexed files. Or add a `--coverage` subcheck to `brain doctor`.
- **Test bench evidence:** gap-analysis.md

---

### O-132: V5 quality regression — avg 3.5/5 down from v3's 4.6/5 and v4's 3.7/5

- **Severity:** observation
- **Where:** test bench aggregate
- **What happened:** Despite the onboard command providing richer project data (43 tasks with bodies, 7 categories, 9 dependency edges), test bench quality dropped from 4.6/5 (v3) to 3.5/5 (v5). Prompts at ≤3/5 increased from 9 to 14. The regressions in O-101 (claim token) and O-102 (dispatch) directly account for P-16, P-24, P-25 dropping to 2/5.
- **Root cause analysis:** The `commands.md` gap (O-103) caused command confusion across 13+ prompts. The claim token regression (O-101) made agent workflow prompts fail. The dispatch regression (O-102) made agent command prompts fail. Fixing O-101, O-102, and O-103 would likely restore the v3 quality level.
- **Test bench evidence:** aggregate scorecard

---

### O-133: Onboard improved data quality dramatically — first cycle with non-empty task bodies, category diversity, and partial dependencies (positive)

- **Severity:** observation
- **Where:** data-audit.md vs V3 data audit
- **What happened:** V5 is the first cycle with: 100% body completeness (vs 0% in V3), 7 distinct categories (vs 1 in V3), 21% dependency coverage (vs 0% in V3), and a healthy priority pyramid (7% critical, 37% high, 35% medium, 21% low). The `brain pm onboard` command resolved O-26, O-87, O-90, and partially addressed O-16 in one shot.
- **Test bench evidence:** data-audit.md

---

## Confirmed Observations

Existing observations confirmed as still present by v5 evidence:

| Observation | Evidence | Notes |
|-------------|----------|-------|
| O-25 | 7 prompts (P-02, P-08, P-09, P-19, P-26, P-27, P-29) | Most frequent gap; no relations between notes |
| O-16 | 6 prompts (P-07, P-11, P-12, P-15, P-23, P-29) | No dep wiring; 9/43 tasks with deps is improvement but insufficient |
| O-49 | 3 prompts (P-26, P-27, P-30) | PM task notes unsearchable via plain `brain search` |
| O-23 | 3 prompts (P-06, P-12, P-13) | Category filtering still insufficient; --category works but --search is title-only |
| O-54 | 3 prompts (P-02, P-05, P-29) | `workstream show` and `context` still sparse |
| O-09 | 2 prompts (P-05, P-14) | `--project` still required in some commands |
| O-33 | 2 prompts (P-09, P-10) | Workspace-root docs (game-plan.md) still not read |
| O-20 | 2 prompts (P-16, P-20) | CLI commands still surfaced to users |
| O-71 | P-27 | `pm check --deep sourceDocuments` still returns 0 despite 28 research notes |
| O-74 | P-26, P-28 | Task list JSON returns workstream as integer, not label |
| O-60 | P-07, P-19, P-22 | **Upgraded to O-107** — bug confirmed (display ID silently broken) |

---

## Resolved Observations

Observations that appear fixed based on v5 cycle evidence:

| Observation | Prior Status | V5 Evidence |
|-------------|-------------|-------------|
| O-26 / O-90 | confirmed V3 | 43/43 task bodies now populated (100%) — **resolved by onboard command**. Quality is shallow (O-127) but empty-body issue is resolved. |
| O-87 | V3 regression | 7 distinct categories used (testing, implementation, research, documentation, design, infrastructure, bug) — **resolved by onboard synthesis agent** |

---

## Punch List Updates

Recommended status changes based on v5 evidence:

| ID | Severity | Recommended Status | Reason |
|----|----------|--------------------|--------|
| O-26 | suggestion | **resolved** | Task bodies now 100% populated by onboard |
| O-87 | friction | **resolved** | Category diversity achieved (7 types) |
| O-90 | friction | **resolved** | Same as O-26 — bodies exist now |
| O-57 | blocker | **regression** | Claim token missing from plain text — see O-101 |
| O-51 | friction | **regression** | Dispatch identical to context — see O-102 |
| O-60 | friction | **bug confirmed** | Display ID filter silently returns empty — upgraded to O-107 |
| O-101 | blocker | new | Claim token regression |
| O-102 | friction | new | Dispatch regression |
| O-103 | blocker | **v6-fixed** | commands.md not indexed — session hook cheat sheet + onboard reference doc ingestion |
| O-104 | blocker | **v6-fixed** | Onboard working directory sensitivity — added `--cwd` flag |
| O-105 | friction | **v6-fixed** | task list --json missing virtualStates/depends_on — now included |
| O-106 | friction | **v6-fixed** | Virtual states not queryable via --status — `blocked/ready/eligible` now work |
| O-107 | bug | **v6-fixed** | --workstream display-id silently broken — now resolves display IDs |
| O-108 | friction | **v6-fixed** | NOT_FOUND gives no recovery guidance — now shows known prefixes |
| O-109 | friction | new | No unified project show command |
| O-110 | friction | **v6-fixed** | Workstream descriptions inaccessible — now in getWorkstream/listWorkstreams |
| O-111 | friction | new | audit has no --project flag |
| O-112 | friction | **v6-fixed** | Singular/plural command inconsistency — added `tasks`/`workstreams` aliases |
| O-113 | friction | new | waves --json missing depends_on |
| O-114 | friction | new | briefing/status count inconsistency |
| O-115 | friction | **v6-fixed** | --status empty result ambiguous — now shows applied filters |
| O-116 | observation | new | No temporal planning horizon |
| O-117 | friction | new | No fuzzy/name-based workstream lookup |
| O-118 | friction | new | brain context path resolution broken |
| O-119 | friction | new | brain search contaminates with brain dev docs |
| O-120 | friction | new | No full document retrieval |
| O-121 | friction | new | --memories flag no visible effect |
| O-122 | friction | new | Note/task search duplicate results |
| O-123 | friction | **v6-fixed** | Brain dev docs in VOLT namespace — doc scanner skips `module:` frontmatter |
| O-124 | friction | **v6-fixed** | Auto-created Triage workstream empty/noisy — removed from onboard |
| O-125 | friction | new | Non-sequential task numbering |
| O-126 | friction | new | Project note body empty |
| O-127 | friction | new | Task body quality shallow |
| O-128 | friction | new | No onboard status/manifest command |
| O-129 | friction | new | --max-docs cap silent |
| O-130 | friction | **v6-partial** | architecture.md and onboarding-observations.md not indexed — onboard now ingests commands.md + architecture.md |
| O-131 | friction | new | No doc coverage tracking |
| O-132 | observation | new | V5 quality regression |
| O-133 | observation | new | Onboard quality improvement (positive) |
