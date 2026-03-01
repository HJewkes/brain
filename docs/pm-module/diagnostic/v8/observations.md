# PM Module Diagnostic V8 — Observations

**Date:** 2026-03-01
**Inputs:** test-bench-results.md, session-audit.md, data-audit.md, gap-analysis.md
**Reference:** docs/pm-module/onboarding-observations.md (O-01 through O-74)

---

## New Observations

### O-75: No project-level context command
- **Severity:** friction
- **Where:** `brain pm context`
- **What happened:** `brain pm context VW` returns NOT_FOUND. The `context` command only accepts leaf task IDs (e.g. `VW-01.01`). There is no way to get a project-level context bundle via CLI — goals, description, workstream summary, and critical tasks in one call.
- **Expected:** `brain pm context VW` returns project overview: description, workstream list with task counts, critical in-progress tasks, and top eligible tasks.
- **Fix:** Add project-prefix handling to `assembleContext()`. If the ID resolves to a project, return a project-scoped briefing rather than NOT_FOUND.
- **Test bench evidence:** P-01, P-02, P-03

---

### O-76: `brain pm project` missing read commands
- **Severity:** friction
- **Where:** `brain pm project` subcommand
- **What happened:** `brain pm project --help` shows only `update` and `delete` subcommands. No `show`, `describe`, or `list` subcommand exists. Listing projects requires `brain pm list` at the top level, which is not discoverable from `brain pm project --help`. Project metadata (goals, description) cannot be read programmatically.
- **Expected:** `brain pm project show VW` returns project title, description, workstream count, and task count. `brain pm project list` lists all projects.
- **Fix:** Add `show` and `list` subcommands to the `project` command group. `show` reads the project note body and summary stats.
- **Test bench evidence:** P-02, P-11, P-18, P-25, P-28

---

### O-77: `brain pm workstream show` returns sparse one-line output
- **Severity:** friction
- **Where:** `brain pm workstream show <id>`
- **What happened:** `brain pm workstream show VW-01` returns one line: the workstream display ID and status. No description, task count, priority breakdown, or mission narrative. O-54 fixed `task show` enrichment in v3 but workstream show was not fully addressed.
- **Expected:** Workstream show should include: title, description, status, task counts by status and priority, and top eligible tasks — equivalent to what `task show` now provides for tasks.
- **Fix:** Enrich `workstream show` output: read workstream note body, query task aggregate stats, format as structured human output with `--json` flag.
- **Test bench evidence:** P-02, P-03

---

### O-78: `brain pm audit` not filterable by project
- **Severity:** friction
- **Where:** `brain pm audit`
- **What happened:** `brain pm audit --project VW` fails — `--project` is not an accepted flag. Audit reports (execution logs, performance metrics) are global-only.
- **Expected:** `brain pm audit --project VW` returns activity and cost data for the VW project only.
- **Fix:** Add `--project` filter to audit queries. Route to project-scoped SQL in the audit data layer.
- **Test bench evidence:** P-02

---

### O-79: `brain pm briefing nextActions` surfaces only one eligible task
- **Severity:** friction
- **Where:** `brain pm briefing` — `nextActions` field
- **What happened:** Regardless of how many eligible tasks exist, `nextActions` returns only "Pick up eligible task: VW-01.01" — the single highest-priority eligible task. Agents coordinating parallel work get no workstream differentiation or priority spread.
- **Expected:** `nextActions` lists 3–5 top eligible tasks, grouped by workstream, with priority labels.
- **Fix:** Expand `nextActions` assembly to return top N (configurable, default 5) eligible tasks sorted by priority with workstream context.
- **Test bench evidence:** P-03

---

### O-80: `brain pm ls` not aliased to `brain pm list`
- **Severity:** suggestion
- **Where:** `brain pm ls`
- **What happened:** `brain pm ls` fires a did-you-mean suggestion for `list` but still exits with code 1.
- **Expected:** `brain pm ls` works as an alias for `brain pm list`.
- **Fix:** Register `ls` as a Commander alias for `list` in the pm command group.
- **Test bench evidence:** P-04, P-18

---

### O-81: Stale project prefix in workstream filter error template
- **Severity:** friction
- **Where:** `brain pm next --workstream` error message
- **What happened:** When an invalid `--workstream` value is supplied, the error message references `VOLT-06` — a hardcoded prefix from a prior test project that is not the active project.
- **Expected:** Error message references only the active project's prefixes. No hardcoded project-specific strings in error templates.
- **Fix:** Audit all error strings in workstream, task, and next commands for hardcoded project prefixes. Replace with dynamic active-project substitution.
- **Test bench evidence:** P-05

---

### O-82: `--search` on task list matches titles only
- **Severity:** friction
- **Where:** `brain pm tasks --search`, `brain pm task list --search`
- **What happened:** `--search testing` returns only tasks with "testing" in the title. Tasks categorized as `bug` or `infrastructure` that involve testing work are invisible. Acceptance criteria containing test-related terms are also not searched.
- **Expected:** `--search` matches against task title, description/body, category, and acceptance criteria.
- **Fix:** Expand the task search query to include FTS over the task note body in addition to the title column.
- **Test bench evidence:** P-06, P-27

---

### O-83: `task list --json` omits description and acceptance criteria
- **Severity:** friction
- **Where:** `brain pm task list --json`
- **What happened:** JSON output includes display_id, status, priority, category, mode, and virtual states — but not task description or acceptance criteria. Getting body content for N tasks requires N separate `task show` calls.
- **Expected:** `task list --json` includes a `description` field and optionally `acceptance_criteria` as an array. A `--full` flag includes complete body text.
- **Fix:** Extend the task list query to join the note body. Populate `description` in the JSON mapper. Add `--full` flag for complete body text.
- **Test bench evidence:** P-06, P-07, P-20, P-29

---

### O-84: Task JSON schema omits dependency fields
- **Severity:** friction
- **Where:** `brain pm task list --json`, `brain pm tasks --json`
- **What happened:** Task JSON output has no `depends_on`, `blocked_by`, or `dependency_count` fields. Even when dependencies are defined, they are invisible in structured output.
- **Expected:** Task JSON includes `depends_on: string[]` and `blocked_by: string[]` arrays (empty arrays when no deps exist).
- **Fix:** Add dependency fields to the task JSON mapper. Query the dependency table during task list and include results.
- **Test bench evidence:** P-07, P-11

---

### O-85: `brain pm context <WRONG-ID>` gives no recovery hint
- **Severity:** friction
- **Where:** `brain pm context` error path for unknown task IDs
- **What happened:** `brain pm context VOLT-01.01` returns `Error: NOT_FOUND` with no suggestion of similar IDs or available project prefixes. This occurs even though did-you-mean logic was added to some commands in the v7 fix pass — the `context` command path was not covered.
- **Expected:** `brain pm context VOLT-01.01` responds: `Task 'VOLT-01.01' not found. Available projects: VW. Did you mean 'VW-01.01'?`
- **Fix:** Apply the did-you-mean prefix-matching logic to the `pm context` command. Check if the numeric portion of the submitted ID resolves under any available project.
- **Test bench evidence:** P-08, P-24, P-25

---

### O-86: `brain context` rejects PM note paths
- **Severity:** friction
- **Where:** `brain context` command — path-based lookup
- **What happened:** `brain context /Users/hjewkes/brain/modules/pm/VW/docs/architecture.md` returns "note not found". Relative module paths also fail. PM notes appear in search results with their paths but are not addressable by those paths via `context`.
- **Expected:** If a note is returned by `brain search`, its path or slug should work in `brain context`.
- **Fix:** Add path-to-slug resolution in the `context` command handler. When an absolute path is supplied, normalize it to a slug. When a relative module path is given, resolve via the module registry.
- **Test bench evidence:** P-09, P-10, P-19

---

### O-87: `brain pm context <workstream-id>` returns NOT_FOUND
- **Severity:** friction
- **Where:** `brain pm context <workstream-id>` (e.g. `VW-01`, `VW-02`)
- **What happened:** Workstream IDs like `VW-01` are valid PM entities but `brain pm context VW-01` returns NOT_FOUND with no message explaining that context only accepts task-level IDs.
- **Expected:** `brain pm context VW-01` returns workstream description, task summary, and related notes. Or the error message redirects: "VW-01 is a workstream — use 'brain pm workstream show VW-01'."
- **Fix:** Handle workstream IDs in the context command, or add a contextual redirect error.
- **Test bench evidence:** P-02, P-05, P-10, P-12, P-19, P-26

---

### O-88: `brain pm project` has no `list` subcommand
- **Severity:** friction
- **Where:** `brain pm project` command tree
- **What happened:** `brain pm project list` returns an error. `brain pm project --help` shows only `update` and `delete`. The actual listing command is `brain pm list` at the top level — not discoverable from the `project` subcommand.
- **Expected:** `brain pm project list` works and is documented in `brain pm project --help`.
- **Fix:** Add `list` as a subcommand alias under `brain pm project`, or add a help text note pointing to `brain pm list`.
- **Test bench evidence:** P-11, P-18, P-25, P-28

---

### O-89: No planning or task-sequencing command
- **Severity:** friction
- **Where:** PM module — planning capability
- **What happened:** When asked "what order should we do things in to ship an Android MVP?", the PM module has no command that synthesizes cross-workstream task ordering toward a stated goal.
- **Expected:** `brain pm plan --goal "Ship Android MVP"` returns a filtered, ordered task list with dependency rationale and critical-path analysis.
- **Fix:** New `brain pm plan` command: accepts `--goal <text>`, runs semantic search over tasks for relevance, applies dependency/priority ordering, returns an ordered list with workstream grouping.
- **Test bench evidence:** P-11, P-20

---

### O-90: `brain context <display_id>` fails silently with no suggestion
- **Severity:** friction
- **Where:** `brain context` (base command) — called with PM task display IDs
- **What happened:** `brain context VW-05.03` returns "note not found" with no hint to use `brain pm context VW-05.03`.
- **Expected:** When `brain context` receives a string matching a PM task ID pattern, it delegates to `brain pm context` or emits: "Did you mean `brain pm context VW-05.03`?"
- **Fix:** In the base `context` command, detect PM task ID patterns and delegate or emit a clear redirect error.
- **Test bench evidence:** P-08, P-12, P-13

---

### O-91: Workstream list `--json` `display_id` vs `task add --workstream` integer mismatch
- **Severity:** friction
- **Where:** `brain pm workstream list --json` output vs `brain pm task add --workstream` flag
- **What happened:** `workstream list --json` returns objects with `display_id` (e.g. `"VW-01"`). `task add --workstream` requires an integer (e.g. `1`). The mismatch is undocumented in either command's `--help`.
- **Expected:** `task add --workstream` accepts display IDs (`VW-01`), or workstream JSON includes both the integer and display_id, or `--help` explicitly documents the integer requirement.
- **Fix:** Add display_id acceptance to `--workstream` flag parsing: parse `VW-01` → extract sequence number `1`. Also addresses O-60 in part.
- **Test bench evidence:** P-14

---

### O-92: `brain pm waves` missing summary line and workstream labels
- **Severity:** suggestion
- **Where:** `brain pm waves` text output
- **What happened:** Plain-text output groups tasks by wave but shows no summary line (total task count, total wave count). Workstream membership is not shown alongside task IDs.
- **Expected:** Footer line: `5 waves · 47 tasks`. Each wave group shows workstream label for homogeneous groups.
- **Fix:** Add a summary footer to `renderWaves()`. Group tasks by workstream within each wave, showing workstream title for homogeneous groups.
- **Test bench evidence:** P-15

---

### O-93: `brain pm verify` generates generic steps, ignores acceptance criteria
- **Severity:** friction
- **Where:** `brain pm verify <task-id>`
- **What happened:** `brain pm verify VW-01.01` produces category-generic verification steps ("Run tests, Check for errors, Review code"). The task has specific acceptance criteria stored in its body, which are ignored. The O-52 crash fix added a fallback but the fallback is generic rather than acceptance-criteria-driven.
- **Expected:** Verify output is derived from the task's actual acceptance criteria. For VW-01.01: "1. Verify `checksum.test.ts` imports resolve. 2. `npm test` passes. 3. No TypeScript errors in modified files."
- **Fix:** In `suggestVerificationSteps()`, parse the task body's acceptance criteria section and convert each bullet to a verification step. Use generic fallback only when no acceptance criteria exist.
- **Test bench evidence:** P-16

---

### O-94: `brain pm complete` doesn't surface newly unblocked tasks
- **Severity:** suggestion
- **Where:** `brain pm complete <task-id>` output
- **What happened:** After completing a task, the output confirms completion but does not show which downstream tasks became newly eligible. The impact analysis runs internally but results are discarded.
- **Expected:** `brain pm complete VW-01.01` includes: "Newly unblocked: VW-02.06 (CI setup) is now ELIGIBLE."
- **Fix:** Capture the list of newly-ELIGIBLE tasks from the impact analysis and include them in the completion output.
- **Test bench evidence:** P-16

---

### O-95: `brain pm task block` has no `--reason` option
- **Severity:** friction
- **Where:** `brain pm task block <task-id>`
- **What happened:** `block` transitions a task to blocked status but accepts no `--reason` argument. Blocking reason cannot be recorded inline.
- **Expected:** `brain pm task block VW-02.06 --reason "CI credentials not provisioned yet"` records the reason in the task record and activity log.
- **Fix:** Add `--reason <text>` to the `block` subcommand. Store in the task's activity log entry. Surface in `task show` and `tasks --status blocked` output.
- **Test bench evidence:** P-16

---

### O-96: `brain pm tasks` alias covers `list` only — not other task subcommands
- **Severity:** friction
- **Where:** `brain pm tasks` (plural alias)
- **What happened:** `brain pm tasks done VLT-02.03` fails with "too many arguments for list". The `tasks` alias only delegates to `task list`. It does not forward to `task done`, `task claim`, or other subcommands.
- **Expected:** Either `brain pm tasks` is a true namespace alias for the entire `task` subcommand group, or the error message says: "Did you mean `brain pm task done VLT-02.03`?"
- **Fix:** Make `tasks` a full Commander alias for the `task` subcommand group, or emit a redirect error that identifies the correct path.
- **Test bench evidence:** P-17, P-23

---

### O-97: No `--json` flag on `brain pm tasks` shorthand
- **Severity:** friction
- **Where:** `brain pm tasks` (plural form)
- **What happened:** `brain pm tasks --json` fails. Only `brain pm task list --json` works. Agents discovering `brain pm tasks` as the listing command cannot use structured output without switching to the longer form.
- **Expected:** `brain pm tasks --json` works, passing through to `task list --json`.
- **Fix:** Ensure the `tasks` alias forwards all flags to `task list`, including `--json`, `--priority`, `--category`, `--search`, and `--status`.
- **Test bench evidence:** P-17

---

### O-98: Project name-substring lookup not supported
- **Severity:** friction
- **Where:** All PM commands that accept `--project` or project prefix arguments
- **What happened:** Using prefix `VLT` (intuited from "voltras") produces: `Project 'VLT' not found. Available: VW`. The error shows only the prefix, not the full project name. The agent still doesn't know if `VW` is the Voltras project without running `brain pm list`.
- **Expected:** NOT_FOUND error includes project name: `Available: VW (voltras-workspace)`. Ideally: `Did you mean VW (voltras-workspace)?`
- **Fix:** Include project name in all project-not-found error messages. Optionally add prefix-overlap fuzzy matching to suggest close matches.
- **Test bench evidence:** P-08, P-18, P-21, P-24, P-25

---

### O-99: No temporal dimension in PM data model
- **Severity:** friction
- **Where:** PM data model — task and project schema
- **What happened:** Tasks have priority, category, and status but no due date, sprint assignment, milestone, or quarter target. Time-bounded planning queries ("what is planned for next quarter?") are unanswerable from PM data alone.
- **Expected:** Optional `due_date` (ISO 8601) and `milestone` string fields on tasks. `--due <date>` on `task add` and `task update`. `--due-before` and `--milestone` filter flags on `task list`.
- **Fix:** Add optional `due_date` and `milestone` fields to task frontmatter schema and database. Support as query filters.
- **Test bench evidence:** P-20

---

### O-100: `brain pm tasks --search` defaults to pending-only
- **Severity:** friction
- **Where:** `brain pm tasks --search <query>` and `brain pm task list --search`
- **What happened:** `brain pm tasks --search "analytics"` silently excludes done, in-progress, and blocked tasks. Completed work is invisible unless the user queries each status explicitly. No `--all-statuses` flag exists.
- **Expected:** `--search` queries all statuses by default, or a documented `--all-statuses` flag exists. The current default-pending behavior should be prominent in `--help`.
- **Fix:** Default search to all statuses. Make `--status pending` the explicit scoping flag. Update `--help`.
- **Test bench evidence:** P-30

---

### O-101: `brain pm context` has no `--json` output mode
- **Severity:** friction
- **Where:** `brain pm context <task-id>`
- **What happened:** `brain pm context` outputs human-readable text only. The related notes section (with relevance scores, slugs, titles) cannot be parsed programmatically.
- **Expected:** `brain pm context VW-01.01 --json` returns a structured object with `task`, `related_notes[]`, `decisions[]`, `dependencies[]` arrays.
- **Fix:** Add `--json` flag to `context` command. Return the structured object already assembled internally by `assembleContext()`.
- **Test bench evidence:** P-09, P-29

---

### O-102: README slug collision during onboarding loses 9 of 10 ingested READMEs
- **Severity:** blocker
- **Where:** `brain pm onboard` — doc ingestion phase
- **What happened:** 10 README.md files from different repos were all assigned the slug `readme`. Each write overwrote the previous. Only the titan-design README survived. The onboard manifest records "20 docs ingested" but only 11 research notes exist in the DB. The node-sdk, voltra-private, and workout-analytics READMEs were silently lost.
- **Expected:** Each ingested doc gets a unique slug derived from its source path (e.g., `node-sdk-readme`, `voltra-private-readme`). Slug collisions either error or auto-namespace.
- **Fix:** Derive slugs from component name + base filename during onboard ingestion. Detect collisions before write and auto-suffix or use full path-derived slug. Log a warning when collision is detected.
- **Test bench evidence:** data-audit.md

---

### O-103: Project note body is empty after onboarding
- **Severity:** friction
- **Where:** `brain pm project.md` after `brain pm onboard`
- **What happened:** The project note contains only the frontmatter and a bare `# voltras-workspace` heading with no body text. No project description, goals, tech stack summary, or repo inventory. Context assembly for the project is severely limited as a result.
- **Expected:** Onboarding populates the project note body with a synthesized summary: what the project does, the repos involved, top-level goals, and links to workstreams.
- **Fix:** Add a project-note synthesis step to the `onboard` workflow. After workstreams and tasks are created, generate a summary and write it to the project note body.
- **Test bench evidence:** P-01, P-02, P-03, data-audit.md

---

### O-104: Brain project not self-ingested — 0% documentation coverage
- **Severity:** friction
- **Where:** Brain knowledge base — `~/brain/`
- **What happened:** The brain project's own documentation (README, CLAUDE.md, PM architecture/commands/guide, all 27 prior diagnostic results, all 30 test-bench prompts, onboarding-observations.md) has never been ingested. All 65 indexed notes are VW project data. Agents debugging PM behavior cannot search for "how does dispatch work" or "what is O-57". The v7 gap analysis incorrectly reported 35% coverage — hits returned VW project docs with similar names.
- **Expected:** Core brain docs are searchable via `brain search`. Ingestion verification uses path-based slug checks, not topical search rank.
- **Fix:** One-time ingest of brain project docs (see gap-analysis.md R-1). Add a post-diagnostic re-index step to the diagnostic workflow (R-2). Fix ingestion verification to use path-based confirmation (R-3).
- **Test bench evidence:** gap-analysis.md

---

### O-105: `brain pm onboard --path` option doesn't exist
- **Severity:** friction
- **Where:** `brain pm onboard` — option naming
- **What happened:** The setup agent passed `--path ~/Documents/projects/voltras-workspace` and received `unknown option '--path'. Did you mean --db-path?`. The intuitive flag name is `--path` or `--workspace`; the actual flag is `--db-path`, which implies a database path rather than a workspace path.
- **Expected:** The workspace path flag is named `--workspace` or `--path`. Or the `--help` output leads with the path flag as the most important argument.
- **Fix:** Rename `--db-path` to `--workspace` or add `--workspace` as an alias. Update `--help` to lead with path flag.
- **Test bench evidence:** session-audit.md

---

### O-106: `brain pm onboard` lacks `--dry-run` mode
- **Severity:** suggestion
- **Where:** `brain pm onboard`
- **What happened:** The setup agent made 10 exploratory calls (ls, cat, find) before invoking `brain pm onboard`, rather than trusting it to discover the workspace. Without a dry-run preview, agents over-explore before committing.
- **Expected:** `brain pm onboard --dry-run` prints a plan: which docs it would ingest, what slugs they'd get, estimated task count — without writing anything.
- **Fix:** Add `--dry-run` flag that runs discovery and synthesis phases but skips all writes. Output: "Would ingest N docs, create M tasks across K workstreams."
- **Test bench evidence:** session-audit.md

---

### O-107: `brain search` has no note type or category filter
- **Severity:** friction
- **Where:** `brain search` — filter options
- **What happened:** `brain search "architecture" --type research` treats `--type` as an unknown option. The `type:research` syntax in the query string is treated as a literal search term. Results mix task notes, workstream summaries, documentation notes, and research notes indiscriminately.
- **Expected:** `brain search "architecture" --type research` returns only notes with `type: research`. `--module pm` scopes to PM module notes.
- **Fix:** Add `--type`, `--module`, and `--tier` filter flags to `brain search`. These filter the note metadata layer before FTS/vector scoring.
- **Test bench evidence:** P-26, P-27

---

## Confirmed Observations

Existing O-XX observations validated by v8 evidence:

| O-ID | Where Confirmed | Evidence |
|------|----------------|----------|
| O-07 | P-03, session-audit | Setup agent made 14 non-brain calls before first productive pm command |
| O-16 | P-01, P-02, P-07, P-10, P-11, P-15, data-audit | All 47 tasks in Wave 0; 0 dependencies; wave engine provides no useful signal |
| O-20 | P-14, P-16 | Agents explain CLI commands to users instead of acting on their behalf |
| O-25 | P-03, P-09, P-10, P-12, P-19, P-26, P-27, data-audit | 0 relations in DB; research notes not linked to tasks or workstreams |
| O-28 | P-20 | No quarter/timeline data; planning prompts lack temporal dimension |
| O-31 | P-11, P-20 | Feature/roadmap planning not natively supported |
| O-33 | P-10 | Workspace-level cross-repo context not in KB |
| O-49 | P-26, P-27, P-30 | PM notes visible in search via `--include-tasks` but private-visibility leakage observed (P-30) |
| O-53 | P-03, P-09, P-29 | Agents still run 5–10 searches to reconstruct chunk-excerpt context; no `--full` flag |
| O-56 | P-10 | `brain graph` requires pre-known note ID; no note enumeration command makes traversal impractical |
| O-60 | P-05, P-14 | `--workstream` takes integer, not name or display_id |
| O-69 | P-05 | Workstream-scoped search still not supported as a native flag |
| O-74 | P-26 | Task JSON missing `workstream_id` field for programmatic grouping |

---

## Resolved Observations

Observations that appear fixed or substantially improved based on v8 evidence:

| O-ID | Evidence | Notes |
|------|----------|-------|
| O-17 | P-04, P-17, data-audit | Task list output includes titles; all 47 tasks in v8 dataset have `title` populated |
| O-23 | data-audit | V8 dataset uses proper 7-category taxonomy without coaching. Category chaos no longer observed. |
| O-26 | data-audit | All 47 v8 tasks have substantive body (avg 806 bytes), acceptance criteria, and Ref: lines. Zero empty task shells. |
| O-50 | P-08, P-16, P-24 | `brain pm context <task-id>` returns rich output: description, acceptance criteria, related notes, workstream info. Confirmed working. |
| O-51 | P-16, P-25 | `brain pm dispatch` returns description, acceptance criteria, file refs, peer tasks, and ranked related notes. Confirmed working. |
| O-54 | P-06, P-13, P-16 | `brain pm task show` returns structured metadata + body. Workstream show (O-77 above) is the remaining gap. |
| O-55 | P-04, P-06, P-28 | `brain pm task list --priority`, `--category`, `--status` filters confirmed working. |
| O-63 | P-04, P-29 | `brain pm next` sorts by priority, groups by workstream, respects `--limit`. Confirmed working. |

---

## Punch List Updates

Recommended status changes to the O-XX master list:

| O-ID | Current Status | Recommended | Rationale |
|------|---------------|-------------|-----------|
| O-17 | v2-verified | **resolved** | V8: titles in all output, 100% title coverage in dataset |
| O-23 | improved | **resolved** | V8: proper taxonomy used without coaching |
| O-26 | confirmed | **resolved** | V8: 100% task body completeness, acceptance criteria present |
| O-50 | v3-fixed | **resolved** | V8 P-08, P-16, P-24 confirm rich context output |
| O-51 | v3-fixed | **resolved** | V8 P-16, P-25 confirm dispatch output quality |
| O-54 | v3-fixed | **resolved (partial)** | Task show fixed; workstream show still sparse — see O-77 |
| O-55 | v3-fixed | **resolved** | V8 P-04, P-06, P-28 confirm filter flags work |
| O-63 | v3-fixed | **resolved** | V8 P-04, P-29 confirm priority sorting + limit |
| O-75 | — | **new** | No project-level context command |
| O-76 | — | **new** | `brain pm project` missing read commands |
| O-77 | — | **new** | Workstream show still sparse (O-54 incomplete for workstreams) |
| O-78 | — | **new** | Audit not project-filterable |
| O-79 | — | **new** | Briefing nextActions shows only 1 eligible task |
| O-80 | — | **new** | `brain pm ls` not aliased |
| O-81 | — | **new** | Stale prefix in error template |
| O-82 | — | **new** | `--search` is title-only |
| O-83 | — | **new** | task list JSON missing body fields |
| O-84 | — | **new** | Task JSON missing dependency fields |
| O-85 | — | **new** | `brain pm context <WRONG-ID>` no recovery hint |
| O-86 | — | **new** | `brain context` rejects PM note paths |
| O-87 | — | **new** | Workstream IDs not accepted by `brain pm context` |
| O-88 | — | **new** | `brain pm project` missing list subcommand |
| O-89 | — | **new** | No planning/sequencing command |
| O-90 | — | **new** | `brain context <display_id>` silent failure |
| O-91 | — | **new** | workstream JSON display_id vs task add integer mismatch |
| O-92 | — | **new** | `brain pm waves` missing summary footer |
| O-93 | — | **new** | `brain pm verify` ignores acceptance criteria |
| O-94 | — | **new** | `brain pm complete` doesn't surface unblocked tasks |
| O-95 | — | **new** | `brain pm task block` missing `--reason` |
| O-96 | — | **new** | `brain pm tasks` alias incomplete |
| O-97 | — | **new** | No `--json` on `brain pm tasks` shorthand |
| O-98 | — | **new** | Project name-substring lookup not supported |
| O-99 | — | **new** | No temporal dimension in PM model |
| O-100 | — | **new** | `brain pm tasks --search` defaults to pending-only |
| O-101 | — | **new** | `brain pm context` missing `--json` flag |
| O-102 | — | **new (blocker)** | README slug collision during onboarding |
| O-103 | — | **new** | Project note body empty after onboarding |
| O-104 | — | **new** | Brain project not self-ingested |
| O-105 | — | **new** | `brain pm onboard --path` option confusion |
| O-106 | — | **new** | `brain pm onboard` lacks `--dry-run` |
| O-107 | — | **new** | `brain search` has no note type filter |
