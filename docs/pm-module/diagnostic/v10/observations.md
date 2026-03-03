<!-- NOTE: O-130 through O-166 in this file were reassigned in the v3 canonical registry.
     V10 IDs do NOT match the canonical IDs. See the ID Mapping table in
     docs/pm-module/onboarding-observations-v3.md for the V10-to-V3 mapping. -->

# PM Module Observations — V10 Diagnostic Cycle

**Date:** 2026-03-01
**Source files:**
- `diagnostic/v10/test-bench-results.md` — 30 prompts, per-prompt analysis
- `diagnostic/v10/session-audit.md` — onboard session JSONL analysis
- `diagnostic/v10/data-audit.md` — VOLT project data quality
- `diagnostic/v10/gap-analysis.md` — documentation coverage gaps

**Next observation ID:** O-130 (this cycle adds O-130 through O-166)

---

## New Observations

### Blockers

#### O-130: `brain memories` command crashes with stack overflow `blocker`
- **Where:** `brain memories` — all invocation forms (`--search`, `--limit`, no flags)
- **What happened:** Every invocation of `brain memories` throws `RangeError: Maximum call stack size exceeded`. The command is entirely non-functional. Two independent prompts hit this in the same test run.
- **Expected:** `brain memories list` returns the stored memory entries.
- **Fix:** Find and fix the circular call or deeply recursive function in the memories command handler. Add a regression test that invokes `brain memories` and verifies exit code 0.
- **Test bench evidence:** P-10, P-27

---

#### O-131: `brain pm waves --json` returns empty or broken output `blocker`
- **Where:** `brain pm waves --json`
- **What happened:** Two independent prompts found this broken in different ways: P-23 reports `waves --json` returns completely empty/non-JSON output (plain-text rendering works). P-12 reports waves JSON output has `null` wave number and title fields, making it unparseable. The `depends_on` array in waves JSON is always `[]` even for tasks in Wave 1+.
- **Expected:** `brain pm waves --json` returns a valid JSON array of wave objects with `waveNumber`, `title`, and populated `tasks` array.
- **Fix:** Debug the JSON serializer for the waves command. Likely the JSON formatter is missing or the wave model fields are not mapped to the JSON output. Also fix the `depends_on` population (related to O-108).
- **Test bench evidence:** P-11, P-12, P-15, P-23

---

#### O-132: `virtualStates` shows `+ELIGIBLE` for tasks that have unmet `blocked_by` dependencies `blocker`
- **Where:** `brain pm tasks --json` — `virtualStates` field; `brain pm next`
- **What happened:** Tasks with populated `blocked_by` arrays (tasks waiting on unfinished prerequisites) show `+READY` and `+ELIGIBLE` in their `virtualStates` field. `brain pm tasks --status blocked` returns 0 results because 'blocked' is computed from virtualStates, which is wrong. The briefing and `next` command surface tasks that cannot actually be started.
- **Expected:** Tasks with unsatisfied `blocked_by` entries compute as `+BLOCKED` (not `+ELIGIBLE`). `brain pm tasks --status blocked` returns those tasks.
- **Fix:** The virtual state computation must check the `blocked_by` list: if any entry refers to a non-done task, the task should be `+BLOCKED`. Note: distinct from O-108 (wave stratification) — this is the eligibility computation inside the state machine.
- **Test bench evidence:** P-07, P-11

---

#### O-133: `brain pm onboard` ingests brain-repo docs into the target project's knowledge base `blocker`
- **Where:** `brain pm onboard` — doc discovery and indexing phase
- **What happened:** VOLT/docs/ contains 40 files: 20 voltras docs (expected) and 20 brain-project docs (unexpected — brain's own README, architecture, design docs, CLAUDE.md). All 20 brain docs are indexed as `module: pm, project: VOLT` research notes and appear in search results for VOLT tasks. The onboard manifest correctly shows only 20 docs, but the file-level indexer ingested everything in the directory.
- **Expected:** `brain pm onboard` scopes doc discovery strictly to the target workspace path. Brain's own source tree is never indexed under a user project.
- **Fix:** Add path scoping validation to the doc discovery phase: any file not under the `--cwd` target path is excluded. Add a post-onboard check that warns if indexed docs have paths outside the target workspace.
- **Test bench evidence:** data-audit (v10)

---

### High Priority

#### O-134: Project note has stale/wrong content after multi-phase onboard `friction`
- **Where:** `brain pm project show <id>` — project note body
- **What happened:** The VOLT project note body reads "1 component (brain), 20 docs" and lists brain as the component — content written during early initialization, before all phases completed. The actual project has 4 components (node-sdk, private, titan-design, workout-analytics). O-103 was resolved ("Project note body populated by synthesis agent") but v10 shows the content reflects the first pass, not the final state.
- **Expected:** The project note is written (or updated) at the end of the onboard workflow with accurate component and doc counts.
- **Fix:** Move the project note write to the final synthesis step. Alternatively, add a `brain pm project refresh` command that updates the project note after onboarding completes.
- **Test bench evidence:** data-audit (v10)

---

#### O-135: `brain pm waves` has no `--project` flag `friction`
- **Where:** `brain pm waves`
- **What happened:** In the current single-project workspace, `brain pm waves` works because all tasks belong to VOLT. In a multi-project workspace, output would mix all projects' tasks with no way to scope to one project. `brain pm waves --project VOLT` fails with unknown option.
- **Expected:** `brain pm waves --project <slug>` scopes wave output to the named project.
- **Fix:** Add `--project` flag to the waves command and filter the topological sort to tasks within the project.
- **Test bench evidence:** P-02, P-11

---

#### O-136: Claim token not shown in human-readable `brain pm task claim` output `friction`
- **Where:** `brain pm task claim <task-id>` — default (non-JSON) output
- **What happened:** The claim token required by `brain pm task start --token` is only visible in `brain pm task claim --json` output. An agent or user not using `--json` has no way to retrieve the token. O-57 was resolved in v3 ("claim output now shows token needed by start"), suggesting this is a regression.
- **Expected:** Human-readable claim output shows: `Claim token: abc-123  (required for brain pm task start --token)`.
- **Fix:** Add the claim token to the default human-readable formatter for `task claim`. Include a usage hint.
- **Test bench evidence:** P-16

---

#### O-137: `brain pm next` truncates eligible tasks with no `--all` or `--limit` flag `friction`
- **Where:** `brain pm next` — truncation behavior
- **What happened:** `brain pm next` shows a short list and appends "and 24 more eligible tasks" with no way to retrieve the full list. O-63 was resolved ("pm next supports --limit") in v3, suggesting this is a regression — the `--limit` flag may have been removed or stopped working.
- **Expected:** `brain pm next --all` or `brain pm next --limit 50` shows the full eligible task list.
- **Fix:** Restore the `--limit` and/or `--all` flags to the `next` command. Verify the truncation threshold is configurable.
- **Test bench evidence:** P-03

---

### Medium Priority

#### O-138: `brain pm tasks --project <slug>` is case-sensitive `friction`
- **Where:** `brain pm tasks --project <slug>`
- **What happened:** `brain pm tasks --project voltras` returns NOT_FOUND but `brain pm tasks --project VOLT` succeeds. Natural user input may use lowercase or mixed case; there is no hint the lookup is case-sensitive.
- **Expected:** Project slug lookup is case-insensitive, or the error says "Project not found. Did you mean 'VOLT'?"
- **Fix:** Normalize `--project` input to uppercase before lookup, or add a case-insensitive query path.
- **Test bench evidence:** P-02

---

#### O-139: Onboard manifest stores bare component names, not workspace-relative paths `friction`
- **Where:** `brain pm onboard` — component detection output; onboard manifest
- **What happened:** The manifest lists component names as bare identifiers (`voltra-node-sdk`, `titan-design`) rather than actual workspace-relative paths (`packages/node-sdk`, `apps/titan-design`). Agents reading the manifest to navigate source code cannot resolve a component name to a directory.
- **Expected:** Manifest records both `name` and `path`: `{ name: "voltra-node-sdk", path: "packages/node-sdk" }`.
- **Fix:** During component detection, record the actual resolved path alongside the inferred name. Write both to the manifest.
- **Test bench evidence:** P-03, session-audit

---

#### O-140: `brain pm tasks --search` matches full task body causing high false-positive rate `friction`
- **Where:** `brain pm tasks --search <query>` and `brain pm task list --search`
- **What happened:** Searching `test` returned 26 results, of which only 15 were genuinely testing-related — the other 11 matched body text incidentally. Note: O-82 (resolved) tracked the opposite problem ("--search matches titles only"). The fix expanded to full-body search but created a new false-positive problem for common terms.
- **Expected:** Title matches outrank body-only matches. Alternatively, a `--title` flag filters to title-only search.
- **Fix:** Add relevance weighting: title match → higher score, body match → lower score. Show title-matched results first. Consider `--title` flag as alias for title-only search.
- **Test bench evidence:** P-06

---

#### O-141: `brain memories --container <project>` returns empty for PM projects `friction`
- **Where:** `brain memories list --container <project>`
- **What happened:** `brain memories --container VOLT` returns no memories even though the VOLT project has 44 tasks, 40 indexed research docs, and a full onboarding run. Either memories are not extracted for PM module notes, or the container scoping doesn't match how PM project data is stored.
- **Expected:** `brain memories --container VOLT` returns memories associated with the VOLT project's notes.
- **Fix:** Verify that the `container` field on memories is populated for PM module notes. If memories are not extracted from PM notes by design, document this in the memories help text.
- **Test bench evidence:** P-13

---

#### O-142: `brain pm task done` and `brain pm complete` have overlapping/unclear responsibilities `friction`
- **Where:** `brain pm task done` vs `brain pm complete <task-id>`
- **What happened:** Both commands mark a task as done, but `complete` additionally runs an impact analysis and records activity. The difference is not surfaced in `task --help`. Agents default to `task done` and miss the impact analysis.
- **Expected:** Either the commands are merged, or `task done` is clearly marked as a lower-level alias in its `--help` text.
- **Fix:** Mark `task done` as `[low-level]` in help output. Add: "Use brain pm complete for full impact tracking." to `task done --help`.
- **Test bench evidence:** P-16

---

#### O-143: Task JSON identifier field is `display_id`, not `id` `friction`
- **Where:** `brain pm task list --json`, `brain pm tasks --json`
- **What happened:** Task JSON has `id: null` and `display_id: "VOLT-01.01"`. REST convention uses `id` as the primary identifier. Agents accessing `task.id` get null silently. Note: O-84 covers missing dependency fields, O-113 covers text formatter camelCase — this is specifically the identifier field naming inconsistency in JSON.
- **Expected:** `id` contains the display ID (e.g., `"VOLT-01.01"`) with a `numeric_id` field for the internal integer.
- **Fix:** Populate `id` with the display ID value in the task JSON mapper. Keep `display_id` as an alias for backwards compatibility.
- **Test bench evidence:** P-17, P-24, P-29

---

#### O-144: No `brain pm task reopen` or `task reset` command `friction`
- **Where:** PM task state machine — terminal states
- **What happened:** Once a task reaches `done`, there is no CLI command to transition it back to `pending`. Erroneously-completed tasks can only be reset via direct database intervention. `task start` and `task update` both fail on done tasks.
- **Expected:** `brain pm task reopen <task-id>` transitions a `done` task back to `pending`.
- **Fix:** Add a `reopen` subcommand. Add the `done → pending` transition to the state machine.
- **Test bench evidence:** P-21

---

#### O-145: `brain pm status` has no `--project` flag `friction`
- **Where:** `brain pm status`
- **What happened:** `brain pm status --project VOLT` fails with unknown option. Status shows all projects globally only. In a multi-project workspace there is no way to scope the view to one project.
- **Expected:** `brain pm status --project VOLT` shows summary for VOLT only.
- **Fix:** Add `--project` filter to `brain pm status`. Scope all aggregate queries to the specified project.
- **Test bench evidence:** P-02

---

#### O-146: VOLT-03 has a circular/paradoxical dependency graph `friction`
- **Where:** VOLT-03 workstream — dependency data; `brain pm tasks --json`
- **What happened:** VOLT-03.01 is `blocked_by: [VOLT-03.02, VOLT-03.03]` — meaning .01 depends on .02 and .03. But VOLT-03.02 is itself blocked by other tasks. If .01 is the workstream entry point but depends on tasks further in the sequence, the dependency direction may be inverted.
- **Expected:** Dependencies flow from prerequisites to dependents with no cycles. A cycle validator reports this at creation time.
- **Fix:** Add cycle detection to `brain pm check --deps`. Fix VOLT-03 data by reviewing intended sequencing. Report cycles as errors in `task add --depends-on`.
- **Test bench evidence:** P-07, data-audit

---

#### O-147: `blocked_by` field semantics are inverted `friction`
- **Where:** `brain pm task list --json` — `blocked_by` field
- **What happened:** `VOLT-02.01: blocked_by: ['VOLT-02.03']` means "VOLT-02.01 must complete before VOLT-02.03 can start" — i.e., VOLT-02.01 is a **prerequisite of** VOLT-02.03. But `blocked_by` conventionally means "I am blocked by X". This inverted naming confuses any agent trying to build a dependency graph from JSON.
- **Expected:** `blocked_by: ['VOLT-02.03']` means "this task is waiting on VOLT-02.03". If the field currently means "this task blocks these tasks", rename it to `blocks` or `prerequisite_for`.
- **Fix:** Either rename the field to match its actual semantics, or fix the population logic to fill it with actual upstream blockers. Align with the data model documentation.
- **Test bench evidence:** P-15

---

#### O-148: 3 PM tasks not indexed/searchable via `brain search --include-tasks` `friction`
- **Where:** `brain search --include-tasks` — indexing coverage
- **What happened:** VOLT-01.09, VOLT-05.06, and VOLT-05.08 exist in `brain pm tasks` output but are absent from `brain search --include-tasks` results. These tasks were created during onboarding but not picked up by the indexer.
- **Expected:** All tasks returned by `brain pm tasks` are also discoverable via `brain search --include-tasks`.
- **Fix:** Check whether `brain index` ran after these tasks were created. If indexing is required post-creation, add auto-indexing to `brain pm task add`. Add a `brain pm check --index` health check that reports unindexed PM notes.
- **Test bench evidence:** P-27

---

#### O-149: `blocked_by` in task list JSON not reflected in `brain pm context` dependencies array `friction`
- **Where:** `brain pm context <task-id>` `dependencies[]` vs `brain pm task list --json` `blocked_by`
- **What happened:** `brain pm task list --json` returns VOLT-03.01 with `blocked_by: ['VOLT-03.02', 'VOLT-03.03']`. But `brain pm context VOLT-03.01 --json` returns `dependencies: []`. The two endpoints return inconsistent dependency data for the same task.
- **Expected:** `brain pm context` includes the same dependency information as the task list endpoint.
- **Fix:** Fix the `assembleContext()` function to read and include dependency data in the context response, using the same query path as `task list`.
- **Test bench evidence:** P-29

---

#### O-150: No `--id` flag on `brain pm tasks` for single-task lookup by display ID `friction`
- **Where:** `brain pm tasks` — filtering options
- **What happened:** `brain pm tasks --id VOLT-01.02` fails with unknown option. There is no single-command way to retrieve one task by display ID from the list endpoint. Users must filter by workstream and scan results, or use the separate `brain pm task show` subcommand.
- **Expected:** `brain pm tasks --id VOLT-01.02 --json` returns a single-element array with full task detail.
- **Fix:** Add `--id <display_id>` filter flag to `brain pm tasks`.
- **Test bench evidence:** P-04, P-28

---

#### O-151: `brain ingest` has no `--recursive` flag for directory tree ingestion `friction`
- **Where:** `brain ingest` command
- **What happened:** Ingesting a directory tree (e.g., `docs/pm-module/diagnostic/`) requires one `brain ingest` call per subdirectory. 80 diagnostic files across 10+ subdirectories would require 10+ invocations.
- **Expected:** `brain ingest docs/pm-module/diagnostic/ --recursive` ingests all markdown files in the tree.
- **Fix:** Add `--recursive` (or `-r`) flag to `brain ingest`. Walk the directory tree and enqueue all matching files.
- **Test bench evidence:** gap-analysis (v10)

---

### Low Priority

#### O-152: `brain pm task add` produces no output without `--json` flag `friction`
- **Where:** `brain pm task add` — default output
- **What happened:** `brain pm task add "Title" --workstream VOLT-04` exits 0 with empty output. No confirmation, no display ID, no status.
- **Expected:** Default output: `Created task VOLT-04.08: Title [medium] pending`
- **Fix:** Add a human-readable success line to `task add` default output.
- **Test bench evidence:** P-14

---

#### O-153: `brain pm dispatch` and `brain pm context` produce nearly identical output with no documented distinction `friction`
- **Where:** `brain pm dispatch <task-id>` vs `brain pm context <task-id>`
- **What happened:** Both commands return nearly the same content for a given task. The conceptual distinction (dispatch = agent prompt generation; context = human-facing briefing) is not surfaced in `--help`.
- **Expected:** Each command's `--help` explains what makes it distinct. Or: `dispatch` → structured JSON agent prompt; `context` → human narrative.
- **Fix:** Differentiate output formats and update `--help` descriptions.
- **Test bench evidence:** P-16

---

#### O-154: Task `Ref:` field lists directory paths rather than specific files `friction`
- **Where:** Task note body — `Ref:` section
- **What happened:** `Ref: voltra-private/src/` specifies a directory. Agents cannot identify which files to edit without further exploration.
- **Expected:** `Ref:` lists specific files or globs: `Ref: voltra-private/src/protocol/crc.ts`
- **Fix:** Update the synthesis agent prompt to require file-level refs. Add validation hint in the task creation workflow.
- **Test bench evidence:** P-08

---

#### O-155: `--deps` flag on `brain pm context` is accepted but produces no visible difference `friction`
- **Where:** `brain pm context <task-id> --deps`
- **What happened:** `brain pm context VOLT-01.05 --deps` completes without error but output is identical to the base command. The flag is recognized but not implemented.
- **Expected:** `--deps` adds an upstream/downstream dependency chain section to the context output.
- **Fix:** Implement the `--deps` flag: query the dependency table, resolve each dep's title and status, include a "Dependencies" section.
- **Test bench evidence:** P-24

---

#### O-156: `brain pm dispatch` has no machine-readable output mode `friction`
- **Where:** `brain pm dispatch <task-id>`
- **What happened:** Dispatch output is human-readable text only. Automated dispatch pipelines must parse free-form text to extract task ID, acceptance criteria, file refs, and token.
- **Expected:** `brain pm dispatch <task-id> --json` returns a structured object.
- **Fix:** Add `--json` flag to `brain pm dispatch`. Return the structured context object already assembled internally.
- **Test bench evidence:** P-25

---

#### O-157: Near-duplicate docs indexed without graph relations between them `friction`
- **Where:** Brain knowledge base — `brain-readme.md`, `brain-readme-2.md`, `brain-claude.md`
- **What happened:** Multiple near-identical brain documentation files are indexed with no `derived-from` or `related` edges between them. Search returns redundant chunks from all copies.
- **Expected:** High-similarity document clusters are connected with `related` or `derived-from` edges.
- **Fix:** Add a post-index deduplication pass that detects high-similarity documents (cosine > 0.95) and creates `related` edges automatically.
- **Test bench evidence:** P-10

---

#### O-158: Wave output does not reflect task status changes made in the current session `friction`
- **Where:** `brain pm waves` — output freshness
- **What happened:** After marking VOLT-02.03 as done, `brain pm waves` still shows it in Wave 1. Wave computation appears not to re-evaluate after status changes in the same session.
- **Expected:** `brain pm waves` always reflects current task status. Completed tasks are filtered from wave output (or shown with ✓).
- **Fix:** Ensure wave computation reads fresh status data on each invocation.
- **Test bench evidence:** P-23

---

#### O-159: `brain notes --module` flag only works on `notes list` subcommand, not top-level `notes` command `friction`
- **Where:** `brain notes --module pm` vs `brain notes list --module pm`
- **What happened:** `brain notes --module pm` returns "unknown option '--module'". The error provides no correction hint.
- **Expected:** Either `brain notes --module` works as shorthand for `brain notes list --module`, or the error says "Did you mean: brain notes list --module pm?"
- **Fix:** Add `--module` as a pass-through on the `notes` parent command delegating to `list`. Or improve the error message.
- **Test bench evidence:** P-03

---

#### O-160: `brain pm task list --full` flag has no visible effect `friction`
- **Where:** `brain pm task list --full` (also `brain pm tasks --full`)
- **What happened:** `--full` produces output identical to default. O-83 was resolved ("--full flag confirmed working") but v10 finds no visible difference. Possible regression.
- **Expected:** `--full` removes the 500-char description truncation and returns the complete task body.
- **Fix:** Verify `listMode` is set to `'full'` when `--full` is passed. Test with tasks whose descriptions exceed 500 chars.
- **Test bench evidence:** P-30

---

#### O-161: `brain pm context` shows "Did you mean X?" but still exits 1 `friction`
- **Where:** `brain pm context <typo'd-id>` error handling
- **What happened:** `brain pm context VLT-01.05` shows "Did you mean: VOLT-01.05?" but exits 1. User must re-run the corrected command. O-85 was resolved ("did-you-mean suggestions work") but auto-correction was not implemented.
- **Expected:** When a single unambiguous correction exists, the command auto-corrects, logs the correction, and proceeds.
- **Fix:** After emitting the did-you-mean suggestion, if there is exactly one match, re-run with the corrected ID. Log: "Corrected VLT-01.05 → VOLT-01.05".
- **Test bench evidence:** P-24

---

#### O-162: PM task notes appear in default `brain search` without `--include-tasks` flag `friction`
- **Where:** `brain search` — default behavior
- **What happened:** Task notes (volt-*-task slugs) appear in default `brain search` results without the `--include-tasks` flag. This makes the flag's purpose unclear and breaks knowledge-base isolation. O-72 noted "private-visibility leakage observed"; this confirms it persists in v10.
- **Expected:** PM task notes (visibility: private) are excluded from default `brain search`. Only `brain search --include-tasks` surfaces them.
- **Fix:** Enforce the visibility: private filter in the default search path.
- **Test bench evidence:** P-27

---

#### O-163: `brain pm projects list` (plural) fails with unhelpful error `friction`
- **Where:** `brain pm projects list` — command routing
- **What happened:** `brain pm projects list` (plural) returns "unknown command 'projects'. Did you mean project?" Natural English plural is not accepted.
- **Expected:** `brain pm projects` routes to `brain pm project` (plural alias).
- **Fix:** Register `brain pm projects` as an alias for `brain pm project`. One-line change.
- **Test bench evidence:** P-01

---

#### O-164: Wave 0 tasks appear in an unlabeled block in `brain pm waves` output `friction`
- **Where:** `brain pm waves` — text output
- **What happened:** Tasks with no dependencies appear above the "Wave 1" header with no "Wave 0" label. It is ambiguous whether these are Wave 0 or unassigned. Related to O-92 (missing summary line and workstream labels).
- **Expected:** Tasks with no dependencies appear under a "Wave 0 (independent)" header.
- **Fix:** Add a "Wave 0" label in `renderWaves()` for tasks with no upstream dependencies.
- **Test bench evidence:** P-05

---

### Suggestions

#### O-165: `brain pm onboard --self` mode for ingesting brain's own documentation `suggestion`
- **Where:** `brain pm onboard` — self-documentation coverage
- **What happened:** Brain has 87% of its own documentation un-indexed (134 files, 17 ingested, 13% coverage). The onboard command targets external codebases; there is no path for making brain's own docs searchable. O-104 tracks the problem; this tracks the missing CLI solution.
- **Expected:** `brain pm onboard --self` scans brain's own `docs/`, `skill/`, and `templates/` directories and ingests them.
- **Fix:** Add `--self` flag that auto-resolves to the brain repo path and runs the doc discovery pipeline on brain's own docs.
- **Test bench evidence:** gap-analysis (v10)

---

#### O-166: Component analysis prompt retrieved via fragile `cat || brain search` fallback `suggestion`
- **Where:** `pm-onboard` skill — component analysis phase
- **What happened:** The session agent used `cat /path/to/component-analysis.md 2>/dev/null || brain search "component analysis prompt"` to locate the prompt template. The search fallback returned a completely unrelated design doc. If the path changes, the skill silently uses garbage context.
- **Expected:** The pm-onboard skill either inlines the component analysis prompt or references it via a stable config-relative path.
- **Fix:** Embed the component analysis prompt inline in the skill's SKILL.md, or reference it as `${BRAIN_SKILLS_DIR}/pm-onboard/prompts/component-analysis.md` with a loud failure (not silent fallback) if not found.
- **Test bench evidence:** session-audit (v10)

---

## Confirmed Observations

Existing observations confirmed by v10 evidence:

| ID | What confirmed it |
|----|-------------------|
| O-16 | Cross-workstream deps still absent; wave bug O-108 still present (P-11, P-15, data-audit) |
| O-25 | Zero research-to-task relations; brain pm context empty for architecture notes (P-08, P-19, P-26) |
| O-33 | Cross-repo docs missed; brain context cannot resolve note paths (P-09) |
| O-49 | PM task notes partially mixed into default search and missing from --include-tasks (P-27, P-30) |
| O-56 | brain graph returns zero edges for all note types including workstream notes (P-19, P-26) |
| O-60 | --workstream requires exact display ID; name-based lookup not supported (P-05, P-14, P-26) |
| O-72 | Private-visibility leakage: PM task notes appear in default brain search (P-27) |
| O-86 | brain context rejects filesystem paths, requires slugs (P-09) |
| O-87 | brain pm context <workstream-id> returns NOT_FOUND (P-03) |
| O-89 | No planning/sequencing command exists (P-11, P-20) |
| O-92 | brain pm waves missing summary line and workstream labels (P-05, P-15) |
| O-99 | No temporal dimension: tasks have no due dates, milestones (P-20) |
| O-104 | Brain repo docs 87% un-indexed; diagnostic history 0% coverage (gap-analysis) |
| O-107 | brain search --type filter non-functional (P-26, P-27) |
| O-108 | Wave computation ignores depends_on; all tasks in Wave 0 despite deps (P-11, P-15, P-23) |
| O-113 | Task list text formatter camelCase issues (P-02, P-05) |
| O-115 | Invalid filter values silently return empty results (P-01, P-07, P-13, P-20) |
| O-117 | brain pm briefing --full flag doesn't exist (session-audit) |

---

## Resolved Observations

No observations can be confirmed as fully resolved from v10 evidence. The following previously-resolved observations show regressions and are re-opened as new entries:

| Formerly Resolved | Regression Tracked As | Evidence |
|-------------------|----------------------|---------|
| O-57 (claim token shown in output) | O-136 | P-16: token not shown in human-readable mode |
| O-63 (pm next supports --limit) | O-137 | P-03: no --all or --limit flag on pm next |
| O-83 (task list --full flag working) | O-160 | P-30: --full has no visible effect |
| O-103 (project note populated by synthesis) | O-134 | data-audit: project note has wrong/stale content |

---

## Punch List Updates

Recommended status changes for the observations registry:

| ID | Status | Severity | Summary |
|----|--------|----------|---------|
| O-130 | new | blocker | brain memories crashes with stack overflow |
| O-131 | new | blocker | brain pm waves --json returns empty/broken output |
| O-132 | new | blocker | virtualStates shows +ELIGIBLE for tasks with unmet dependencies |
| O-133 | new | blocker | brain pm onboard ingests brain-repo docs into target project |
| O-134 | new | friction | project note stale/wrong after multi-phase onboard (regression from O-103) |
| O-135 | new | friction | brain pm waves has no --project flag |
| O-136 | new | friction | claim token not shown in human-readable output (regression from O-57) |
| O-137 | new | friction | brain pm next truncates with no --all/--limit (regression from O-63) |
| O-138 | new | friction | brain pm tasks --project slug case-sensitive |
| O-139 | new | friction | onboard manifest stores bare component names not paths |
| O-140 | new | friction | --search full body match causes false positives |
| O-141 | new | friction | brain memories --container returns empty for PM projects |
| O-142 | new | friction | brain pm task done vs complete ambiguity |
| O-143 | new | friction | task JSON uses display_id not id as primary identifier |
| O-144 | new | friction | no brain pm task reopen command |
| O-145 | new | friction | brain pm status has no --project flag |
| O-146 | new | friction | VOLT-03 dependency graph is circular/malformed |
| O-147 | new | friction | blocked_by field semantics are inverted |
| O-148 | new | friction | 3 PM tasks not indexed via brain search --include-tasks |
| O-149 | new | friction | blocked_by in task list JSON not in brain pm context dependencies |
| O-150 | new | friction | no --id flag on brain pm tasks for single-task lookup |
| O-151 | new | friction | brain ingest has no --recursive flag |
| O-152 | new | friction | brain pm task add silent without --json |
| O-153 | new | friction | brain pm dispatch vs context produce identical output, no documented distinction |
| O-154 | new | friction | task Ref field uses directory paths not specific files |
| O-155 | new | friction | --deps flag on brain pm context accepted but has no effect |
| O-156 | new | friction | brain pm dispatch has no --json output mode |
| O-157 | new | friction | near-duplicate docs indexed without graph relations |
| O-158 | new | friction | wave output stale after task status changes in same session |
| O-159 | new | friction | brain notes --module only works on notes list subcommand |
| O-160 | new | friction | brain pm task list --full flag no visible effect (regression from O-83) |
| O-161 | new | friction | brain pm context Did You Mean suggestion still exits 1 |
| O-162 | new | friction | PM task notes appear in default brain search (O-72 continuation) |
| O-163 | new | friction | brain pm projects list (plural) unknown command |
| O-164 | new | friction | Wave 0 tasks appear unlabeled in brain pm waves output |
| O-165 | new | suggestion | brain pm onboard --self mode for ingesting brain's own docs |
| O-166 | new | suggestion | component analysis prompt uses fragile cat fallback |
| O-57 | resolved → re-open | friction | regression: claim token not in human-readable output |
| O-63 | resolved → re-open | friction | regression: pm next --limit missing |
| O-83 | resolved → re-open | friction | regression: --full flag no visible effect |
| O-103 | resolved → re-open | friction | regression: project note has stale/wrong content |
