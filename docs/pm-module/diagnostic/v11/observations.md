<!-- NOTE: O-130 through O-153 in this file were reassigned in the v3 canonical registry.
     V11 IDs do NOT match the canonical IDs. See the ID Mapping table in
     docs/pm-module/onboarding-observations-v3.md for the V11-to-V3 mapping. -->

# PM Module Observations — V11 Diagnostic Cycle

**Date:** 2026-03-02
**Source cycle:** V11 (30 prompts, claude-sonnet-4-6)
**Prior registry:** `docs/pm-module/onboarding-observations-v2.md` (O-01 through O-129)
**Next observation ID:** O-130

---

## New Observations

---

### Filtering & Query

#### O-130: `--workstream` display_id filter non-functional — both ID forms now broken
- **Severity:** blocker
- **Where:** `brain pm tasks --workstream`, `brain pm task list --workstream`
- **What happened:** `brain pm tasks --workstream VOLT-01`, `--workstream VOLT-02`, `--workstream VOLT-04` all return 0 results despite tasks clearly belonging to those workstreams. O-110 (v9) reported that the numeric integer form was broken but the display_id form worked. V11 shows the display_id form is also broken — the entire workstream filter is non-functional regardless of ID format.
- **Expected:** `brain pm tasks --workstream VOLT-04` returns only the tasks in workstream VOLT-04.
- **Fix:** Fix the `listTasks()` workstream filter to accept and resolve both integer and display_id formats. Verify against the actual database column used for workstream lookup.
- **Test bench evidence:** P-02, P-05, P-12

---

#### O-131: `--status blocked` matches stored status field, not computed virtual state
- **Severity:** blocker
- **Where:** `brain pm tasks --status blocked`
- **What happened:** Tasks with `+BLOCKED` virtual state have stored `status: pending`. Running `brain pm tasks --status blocked` returns 0 results because the filter checks the stored status field, not the computed virtual state. This is the primary navigation path for discovering blocked tasks and it silently fails every time.
- **Expected:** `brain pm tasks --status blocked` returns all tasks whose computed virtual state includes `+BLOCKED`, regardless of stored status value.
- **Fix:** Either (a) map the `blocked` status filter to a virtual state query instead of a raw status column query, or (b) expose a separate `--virtual-state blocked` filter. Update `--help` to explain the virtual state system.
- **Test bench evidence:** P-07

---

#### O-132: `--status all --json` returns empty array while human output works
- **Severity:** blocker
- **Where:** `brain pm tasks --status all --json`
- **What happened:** `brain pm tasks --project VOLT --status all --json` returns `[]` even though the same command without `--json` correctly lists all 26 tasks. The `--status all` special value breaks JSON mode output.
- **Expected:** `--status all --json` returns the same tasks as `--status all` in human-readable mode.
- **Fix:** Check the task list command's JSON serialization path for the `--status all` case. The `all` value likely passes through to a SQL query incompatible with the JSON output path.
- **Test bench evidence:** P-12

---

#### O-133: `brain pm tasks --search` does not match on task display_id strings
- **Severity:** friction
- **Where:** `brain pm tasks --search`, `brain pm task list --search`
- **What happened:** Searching for `'VOLT-01.01'` returns empty results even though that is a valid, existing task display ID. The `--search` filter is limited to title substring matching; it does not index the display_id field. A task ID is the most natural briefing key for workflows where the caller already knows which task to work on.
- **Expected:** `brain pm tasks --search 'VOLT-01.01'` returns the matching task. Display IDs are included in the searchable text.
- **Fix:** Include the `display_id` column in the task title search query. This eliminates a painful round-trip (enumerate all tasks → python filter → find by ID).
- **Test bench evidence:** P-08

---

### Output & JSON Schema

#### O-134: `displayId` null in task list JSON without `--full` flag
- **Severity:** friction
- **Where:** `brain pm task list --json` (without `--full`)
- **What happened:** The `display_id` field returns `null` in standard task list JSON output. It is only populated when `--full` is also passed. Agents consuming the standard task list for task lookup or display cannot use display IDs without adding `--full`, which is a heavier response.
- **Expected:** `display_id` is always populated in task JSON output regardless of `--full` flag. `--full` should only expand the description body, not gatekeep identifier fields.
- **Fix:** Move `display_id` from the `--full` schema to the base task schema.
- **Test bench evidence:** P-11

---

#### O-135: `brain pm list --json` returns null for project `name` field
- **Severity:** friction
- **Where:** `brain pm list --json`
- **What happened:** Project JSON objects have `name: null` even when the project has a name. This makes programmatic project discovery harder — agents must fall back to human-readable output or run a separate project show command.
- **Expected:** Project JSON includes a populated `name` field matching the project title visible in human output.
- **Fix:** Investigate the project list JSON mapper. The `name` field is either not being read from the database or the column name differs.
- **Test bench evidence:** P-15

---

#### O-136: Waves JSON uses `display_id` as task key, inconsistent with tasks JSON
- **Severity:** friction
- **Where:** `brain pm waves --json` — task object schema
- **What happened:** Task objects in waves JSON use `display_id` as the identifying key. Task objects in `brain pm tasks --json` use both `id` (integer) and `display_id`. Code written to process one JSON format fails on the other with a `KeyError`.
- **Expected:** Waves JSON task objects include both `id` and `display_id` fields, consistent with the tasks JSON schema.
- **Fix:** Add `id` to the waves task serializer to match the tasks schema.
- **Test bench evidence:** P-08

---

#### O-137: `brain pm context relatedNotes` objects have no `noteId` field
- **Severity:** friction
- **Where:** `brain pm context <task-id> --json` — `relatedNotes` array
- **What happened:** `relatedNotes` entries contain heading text and excerpt but no `noteId` field. Agents cannot programmatically match related note excerpts back to note objects from `brain search` or `brain notes list`, making note-to-task correspondence dependent on fuzzy title matching.
- **Expected:** Each `relatedNotes` entry includes a `noteId` field matching the note's canonical ID from the notes table.
- **Fix:** Add `noteId` (and optionally `slug`, `filePath`) to the relatedNotes serializer in `assembleContext()`.
- **Test bench evidence:** P-27

---

#### O-138: `workstreamDescription` empty string in `brain pm context --json`
- **Severity:** friction
- **Where:** `brain pm context <task-id> --json` — `workstreamDescription` field
- **What happened:** The `workstreamDescription` field in context JSON is always an empty string even when the workstream has a description visible in human-readable context output.
- **Expected:** `workstreamDescription` matches the description shown in human output.
- **Fix:** Check the context JSON serializer — the workstream description field may be set after the JSON object is constructed, or uses a different field name internally.
- **Test bench evidence:** P-24

---

#### O-139: `brain pm tasks --full --json` body field empty for some tasks
- **Severity:** friction
- **Where:** `brain pm task list --full --json` — `body` field
- **What happened:** Some tasks (VOLT-01.x series) return an empty `body` field despite having dedicated markdown note files with 150–180 words of content. Other tasks return body content correctly. The inconsistency is task-dependent and not predictable from the task ID.
- **Expected:** Every task with a note file returns its full body text in `--full --json` output.
- **Fix:** Investigate why the body read path fails silently for some tasks. Possible cause: note file path resolution differs for tasks created via the dependency update path vs. direct `task add`.
- **Test bench evidence:** P-13

---

#### O-140: `modified` field uses date string in dependency update path vs ISO timestamp in create path
- **Severity:** friction
- **Where:** Task records updated via `--depends-on` flag
- **What happened:** Tasks created normally have `modified: "2026-03-02T00:00:00.000Z"` (ISO 8601). Tasks updated via a subsequent `--depends-on` operation have `modified: "2026-03-02"` (bare date string). Six such tasks observed in v11 dataset. Makes timestamp comparison and sorting unreliable.
- **Expected:** All `modified` timestamps use ISO 8601 format regardless of which command path writes them.
- **Fix:** Normalize the `modified` timestamp to ISO 8601 in the task update path that sets `depends_on`. Audit all write paths for consistent timestamp formatting.
- **Test bench evidence:** data-audit

---

### Active Project & Project Scope

#### O-141: `brain pm briefing` defaults to most-recently-created project, not active project
- **Severity:** friction
- **Where:** `brain pm briefing` (no `--project` flag)
- **What happened:** With VOLT (26 tasks) and VOLTR (0 tasks) both active, `brain pm briefing` defaulted to VOLTR — the most recently created project. New users running briefing after onboarding get an empty briefing with no explanation. There is no signal in the output indicating that a different project exists with all the actual work.
- **Expected:** When no `--project` is specified, briefing defaults to the active project set via `brain pm use`, or if none is set, to the project with the most tasks, or prompts the user to specify.
- **Fix:** Respect the active project set by `brain pm use`. If no active project is set, require `--project` or default to the project with the highest task count with a note explaining the choice.
- **Test bench evidence:** P-03

---

#### O-142: `brain pm workstream list` ignores active project — requires explicit `--project`
- **Severity:** friction
- **Where:** `brain pm workstream list` (no arguments)
- **What happened:** `brain pm workstream list` without `--project` returns 'No workstreams found' even when an active project with workstreams exists. Unlike `brain pm task list` and other commands that respect the active project context, workstream list does not read the active project setting.
- **Expected:** `brain pm workstream list` uses the active project (set via `brain pm use`) when `--project` is not supplied, consistent with other pm commands.
- **Fix:** In the workstream list command handler, read the active project from config when no `--project` flag is supplied — the same fallback pattern used by `brain pm task list`.
- **Test bench evidence:** P-05, P-14

---

#### O-143: `brain pm next` silently truncates at default limit with no indicator
- **Severity:** friction
- **Where:** `brain pm next` — default output
- **What happened:** `brain pm next` has a default limit of 10. When more eligible tasks exist, output is truncated with no indication that more results exist — no footer, no `--limit` hint. Agents using the default output may miss newly unblocked tasks.
- **Expected:** When results are truncated, output includes: `Showing 10 of 19 eligible tasks. Use --limit N to see more.`
- **Fix:** After rendering the default-limited task list, print a truncation indicator when the full eligible count exceeds the applied limit.
- **Test bench evidence:** P-02, P-16

---

#### O-144: `brain pm status` does not accept `--project` flag — positional-only
- **Severity:** friction
- **Where:** `brain pm status` — argument style
- **What happened:** `brain pm status --project VOLT` fails with unknown option. The project must be passed positionally (`brain pm status VOLT`). This is inconsistent with all other `brain pm` commands that accept `--project <prefix>`. Agents following the consistent pattern fail on first attempt.
- **Expected:** `brain pm status --project VOLT` works, consistent with all other pm commands.
- **Fix:** Add `--project <prefix>` as an option alias for the positional argument in the status command.
- **Test bench evidence:** P-16

---

#### O-145: `brain pm waves` returns 'No active tasks' without `--project` — no guidance
- **Severity:** friction
- **Where:** `brain pm waves` (no `--project` flag)
- **What happened:** `brain pm waves` without `--project` returns 'No active tasks' with no explanation that a `--project` flag is required. New users cannot distinguish "project has no tasks" from "command needs a scope argument."
- **Expected:** Error message says: `No active project set. Run 'brain pm list' to see available projects, then use --project <prefix>.`
- **Fix:** Detect the missing-project case and emit a guided error instead of the generic 'No active tasks' message.
- **Test bench evidence:** P-15

---

### Ghost Projects & Data Quality

#### O-146: Ghost project from failed onboard with no cleanup path
- **Severity:** friction
- **Where:** `brain pm onboard` — recovery from partial failure
- **What happened:** A first onboard run detected the wrong component set (brain source tree instead of voltras repos) and created project VOLT with incorrect metadata. A corrected second run created VOLTR with correct components but zero tasks. All 26 tasks were created under VOLT (the incorrect shell). Final state: VOLT = wrong metadata + all tasks, VOLTR = correct metadata + no tasks. No `brain pm project delete` command exists to resolve this.
- **Expected:** Either onboard is idempotent and fully replaces on `--reset`, or a `brain pm project delete <prefix>` command exists to remove ghost projects.
- **Fix:** Add `brain pm project delete <prefix>` command. Alternatively, make `--reset` on onboard fully replace all project metadata rather than creating a second project record.
- **Test bench evidence:** data-audit, session-audit

---

#### O-147: Projects with identical display names cause persistent navigation confusion
- **Severity:** friction
- **Where:** `brain pm list`, `brain pm status` — project disambiguation
- **What happened:** VOLT and VOLTR both have the display name "Project voltras-workspace". No column in `brain pm list` output distinguishes them by name. Users and agents cannot identify the canonical project without inspecting task counts or reading project notes. This cross-prompt impact was the highest of any v11 finding — appearing in P-01, P-02, P-03, P-04, P-19, data-audit.
- **Expected:** `brain pm list` output includes a description or task count column, and creation of a project with a duplicate name triggers a warning.
- **Fix:** (1) Add a project description field, show it in list output. (2) Warn on `pm init`/`pm onboard` when a project with the same name already exists. (3) Show task count as a disambiguation signal in list output (already in status, not in list).
- **Test bench evidence:** P-01, P-02, P-03, P-04, P-19

---

### Relations & Graph

#### O-148: `brain graph` does not follow incoming or undirected edges — returns root node only
- **Severity:** friction
- **Where:** `brain graph <note-id>` — traversal direction
- **What happened:** `brain graph titan-design-architecture --depth 3` returns only the root node with zero edges, despite `brain context titan-design-architecture` showing explicit `related` relations from this note to others. The graph traversal appears to follow only outgoing directed edges; incoming or undirected `related` links are not traversed.
- **Expected:** `brain graph <note-id>` returns all relations involving that note regardless of edge direction.
- **Fix:** In the graph traversal query, use an undirected edge condition (`WHERE note_id = ? OR related_note_id = ?`) rather than a directed condition.
- **Test bench evidence:** P-19

---

#### O-149: Workstream-level `brain pm context` returns zero relatedNotes
- **Severity:** friction
- **Where:** `brain pm context <workstream-id>` (e.g., `brain pm context VOLT-05`)
- **What happened:** When called with a workstream ID, `brain pm context` succeeds and returns workstream metadata, but the `relatedNotes` array is always empty. Task-level context runs semantic search and returns useful related notes. The semantic search is not triggered at the workstream level.
- **Expected:** `brain pm context VOLT-05` returns the top N notes semantically related to the workstream's description and tasks.
- **Fix:** In the workstream context path, assemble a combined query from the workstream title + all task titles/descriptions and run the same semantic search that task-level context uses.
- **Test bench evidence:** P-19

---

#### O-150: `brain graph <path>` rejects absolute paths obtained from `brain search` output
- **Severity:** friction
- **Where:** `brain graph` — note identifier resolution
- **What happened:** `brain search` results include a `filePath` field (e.g., `/Users/hjewkes/brain/modules/pm/VOLTR/docs/titan-design-architecture.md`). Passing this path to `brain graph` returns "note not found". The graph command expects a slug or note ID; `brain search` output does not provide either, forcing a separate lookup step.
- **Expected:** `brain graph` accepts absolute file paths from `brain search` results, consistent with the path-resolution behavior users expect after a search.
- **Fix:** Add path-to-slug resolution in the graph command handler — the same fix proposed for O-86 (`brain context` path resolution). Both commands should normalize absolute paths to slugs.
- **Test bench evidence:** P-26

---

### Data Integrity

#### O-151: `acceptance_criteria` structured DB field always empty — criteria in body text only
- **Severity:** friction
- **Where:** Task database — `acceptance_criteria` column; `brain pm dispatch`, `brain pm verify`
- **What happened:** All 26 tasks have `acceptance_criteria: []` in the database. Acceptance criteria exist as numbered bullet points in the task body text (written by the synthesis agent during onboarding) but were never parsed into the structured field. `brain pm dispatch` returns `acceptanceCriteria: []` and `brain pm verify` falls back to generic category-based steps (O-93) because the structured field is always empty.
- **Expected:** `acceptance_criteria` contains a parsed array from the task body text. `brain pm dispatch` and `brain pm verify` consume these structured criteria.
- **Fix:** (1) Add post-creation extraction in `brain pm task add` that parses numbered acceptance criteria from the `--description` text into the structured field. (2) Or add a `brain pm task ac parse VOLT-XX.YY` command that extracts and writes criteria from existing body. (3) Update the synthesis agent prompt to pass `--acceptance-criteria` as a separate flag.
- **Test bench evidence:** data-audit

---

### Session & Onboarding

#### O-152: No `brain pm docs list` command — agents search manually for onboard manifest
- **Severity:** suggestion
- **Where:** Post-onboard verification workflow
- **What happened:** After onboarding, agents run `brain search "volt-onboard-manifest"` to find what was ingested. No direct command exists to list documentation notes for a project. This workaround pattern appeared in both v9 and v11 sessions.
- **Expected:** `brain pm docs list --project VOLT` returns the list of ingested doc notes with source paths and ingestion dates.
- **Fix:** Add a `brain pm docs list --project <prefix>` command that queries notes with `module = pm` and the project prefix in their metadata. Also expose the onboard manifest path directly in onboard output.
- **Test bench evidence:** session-audit

---

#### O-153: No bulk task/workstream import — 38+ sequential CLI calls for large backlogs
- **Severity:** suggestion
- **Where:** `brain pm task add`, `brain pm workstream add` — bulk creation
- **What happened:** The synthesis agent issued 5 `workstream add` + 33 `task add` calls sequentially, ~1 second each. The synthesis agent already assembled all data as structured JSON internally — it just had no way to submit it atomically.
- **Expected:** `brain pm import --project VOLT < plan.json` accepts a JSON payload with `workstreams[]` and `tasks[]` arrays and creates all records in a single transaction.
- **Fix:** Add a `brain pm import` command that reads a JSON plan file and bulk-inserts workstreams and tasks.
- **Test bench evidence:** session-audit

---

## Confirmed Observations

Existing observations confirmed as still open by v11 evidence:

| O-ID | Confirmed by | Evidence |
|------|-------------|---------|
| O-16 | P-05, P-07, P-11, P-15, P-16 | Wave computation not stratifying; workstream filters broken |
| O-23 | P-04, P-06, P-07, P-12 | Global task queries without `--project` consistently return empty |
| O-25 | P-10, P-19, P-27 | Graph auto-linking from feat/v9-relations-context does NOT create cross-module (KB→task) edges; zero edges exist between any research note and any task note |
| O-49 | P-11, P-27, P-30 | PM tasks unsearchable via `brain search`; cross-domain wiring still incomplete |
| O-56 | P-10, P-19, P-26 | `brain graph` returns root-only with no edges across all tested notes |
| O-82 | P-06, P-08, P-30 | `--search` on tasks is title-only; does not search description, category, or body |
| O-84 | P-07, P-11 | `dependencies` field always `[]` even when `blocked_by` is populated |
| O-86 | P-12, P-13, P-29 | `brain context <path>` fails with "note not found" for PM note paths |
| O-90 | P-29 | `brain context <pm-display-id>` fails with no suggestion to use `brain pm context` |
| O-98 | P-21, P-23, P-25 | Short/incorrect prefix aliases return nothing; NOT_FOUND error lacks project name |
| O-99 | P-20 | No due dates, milestones, or temporal scope in PM data model |
| O-104 | gap-analysis | Brain project docs not self-indexed; 0% coverage of diagnostic history, commands.md, skill definitions |
| O-107 | P-10, P-26 | `brain search --type <value>` returns no results; frontmatter type filtering non-functional |
| O-110 | P-02, P-05, P-12 | **Scope update:** Both integer AND display_id forms of `--workstream` filter are now confirmed broken (v9 said display_id form worked; v11 shows it does not) |
| O-115 | P-06, P-13, P-20 | Invalid filter values silently return empty or INVALID_INPUT with no guidance |
| O-127 | P-16 | Token enforcement inconsistent: `task start` requires `--token`, other state transitions do not |

---

## Resolved Observations

No observations were definitively confirmed resolved in this cycle. Two are candidates based on positive signals but require explicit regression tests before closing:

- **O-113** (camelCase displayId text formatter shows `?`): P-17, P-18, P-22 show task listing at 5/5 quality with correct display IDs in human output. However, O-134 (new) shows `display_id: null` in JSON without `--full`, which may be related. Cannot confirm resolved without a direct test of the formatted text output.
- **O-114** (`brain pm complete newlyEligible: []`): P-16 noted `newlyEligible` correctly listed VOLT-02.03 after VOLT-02.01 completion. May be fixed. Needs explicit regression test before marking resolved.

---

## Punch List Updates

Recommended status changes for the master registry:

| O-ID | Current Status | Recommended | Reason |
|------|---------------|-------------|--------|
| O-110 | open | update scope | v11 confirms display_id form also broken; observation text needs updating to reflect full breakage |
| O-113 | open | candidate-resolved | P-17, P-22 show 5/5 quality with correct IDs; confirm with explicit test |
| O-114 | open | candidate-resolved | P-16 shows correct newlyEligible behavior; confirm with explicit test |
| O-130 | new | open | workstream filter broken for display_id form |
| O-131 | new | open | --status blocked vs virtual state |
| O-132 | new | open | --status all --json returns empty |
| O-133 | new | open | --search doesn't match display_id strings |
| O-134 | new | open | displayId null without --full in JSON |
| O-135 | new | open | project name null in list JSON |
| O-136 | new | open | waves JSON display_id field inconsistency |
| O-137 | new | open | relatedNotes no noteId field |
| O-138 | new | open | workstreamDescription empty in JSON |
| O-139 | new | open | --full --json body empty for some tasks |
| O-140 | new | open | modified timestamp format inconsistency |
| O-141 | new | open | briefing defaults to wrong project |
| O-142 | new | open | workstream list ignores active project |
| O-143 | new | open | next silently truncates |
| O-144 | new | open | pm status missing --project flag |
| O-145 | new | open | waves no-project returns unhelpful error |
| O-146 | new | open | ghost project from failed onboard, no cleanup |
| O-147 | new | open | duplicate project names, no disambiguation |
| O-148 | new | open | graph doesn't follow incoming edges |
| O-149 | new | open | workstream-level context returns zero relatedNotes |
| O-150 | new | open | brain graph rejects search-output paths |
| O-151 | new | open | acceptance_criteria structured field always empty |
| O-152 | new | suggestion | no pm docs list command |
| O-153 | new | suggestion | no bulk task/workstream import |
