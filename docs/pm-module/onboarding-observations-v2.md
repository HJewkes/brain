# PM Module Observations Registry (Superseded)

> **Superseded by `onboarding-observations-v3.md`** — This file covers O-01 through O-129 only.
> The v3 registry is the canonical source of truth for all observation IDs (O-01 through O-212).

**Replaces:** `docs/pm-module/onboarding-observations.md` (archived — do not modify)
**Last updated:** 2026-03-01
**Covers:** O-01 through O-129

This file is the single source of truth for all open PM module observations. The original file
(`onboarding-observations.md`) is preserved as an archive through O-74. V8 diagnostic (2026-03-01)
added O-75 through O-107. V9 diagnostic (2026-03-01) added O-108 through O-129.

---

## Versioning History

| Range | Source | Cycle |
|-------|--------|-------|
| O-01 – O-74 | `docs/pm-module/onboarding-observations.md` | Original + V2 test bench |
| O-75 – O-107 | `docs/pm-module/diagnostic/v8/observations.md` | V8 diagnostic cycle |
| O-108 – O-129 | `docs/pm-module/diagnostic/v9/observations.md` | V9 diagnostic cycle |

---

## Resolved Observations

History of all closed observations. Full detail remains in the originating source file.

| ID | Severity | Resolved In | Summary |
|----|----------|-------------|---------|
| O-03 | blocker | v1-fix | PM module not loaded from npm install (static import in cli.ts) |
| O-04 | suggestion | v1-fix | No way to reset brain (`brain reset --confirm` added) |
| O-05 | friction | v2-verified | `pm init` output now shows project name correctly |
| O-09 | blocker | v2-verified | `pm use` now makes `--project` optional — all commands fall back to active project |
| O-11 | friction | v2-verified | `pm init` auto-sets active project; subsequent commands work without explicit `--project` |
| O-17 | friction | v2-verified | Task and workstream list output now shows names/titles |
| O-18 | friction | v1-fix | Briefing capped at top 5 eligible + "and N more"; `--verbose` added |
| O-19 | suggestion | v1-fix | `brain pm briefing --verbose` provides comprehensive project summary |
| O-36 | blocker | v2-verified | Title field added to all metadata interfaces and formatters |
| O-39 | friction | v3-fixed | `workstream add` output now shows workstream name, not sequence number |
| O-40 | friction | v3-fixed | `pm status` now shows workstream count, task counts by status, priority breakdown |
| O-50 | blocker | v3-fixed | `pm context` now returns rich output: body, workstream info, related notes, deps |
| O-51 | friction | v3-fixed | `pm dispatch` returns full agent prompt with acceptance criteria and file refs |
| O-52 | bug | v3-fixed | `pm verify` crash ("plan.steps is not iterable") fixed; graceful fallback added |
| O-54 | friction | v3-fixed | `task show` now returns structured metadata + body text |
| O-55 | friction | v3-fixed | `task list` now has `--priority`, `--category`, `--status`, `--search` filter flags |
| O-57 | friction | v3-fixed | `claim` output now shows token needed by `start` |
| O-58 | friction | v3-fixed | `--start` flag on `claim` enables atomic claim+start |
| O-59 | friction | v3-fixed | `release` now works from `in-progress` state |
| O-61 | blocker | v3-fixed | State machine errors now list valid transitions with contextual hints |
| O-62 | friction | v3-fixed | `pm complete` auto-walks pending→claimed→in-progress→done |
| O-63 | friction | v3-fixed | `pm next` sorts by priority, groups by workstream, supports `--limit` |
| O-64 | blocker | v3-fixed | `pm context` text output enriched (was 4 lines) |
| O-65 | friction | v3-fixed | Context hash removed from human output |
| O-66 | friction | v3-fixed | `pm audit executions` now has `--task` filter; `pm check` outputs human-readable by default |
| O-67 | blocker | v3-fixed | `orchestrate render` auto-generates instructions when no prompt is authored |
| O-68 | blocker | v3-fixed | Cross-system search added: `--include-tasks` flag on `brain search` |
| O-70 | friction | v3-fixed | `brain notes list` command added with `--module`, `--type`, `--tier`, `--limit`, `--json` |
| O-73 | friction | v3-fixed | `task list` now has `--search` keyword filter |
| O-75 | friction | v9-verified | `brain pm context VW` now works; returns project briefing |
| O-76 | friction | v9-verified | `brain pm project show` and `brain pm project list` (singular) work |
| O-79 | friction | v9-verified | Briefing `nextActions` now shows top eligible tasks with workstream context |
| O-80 | suggestion | v9-verified | `brain pm ls` now aliases to `brain pm list` |
| O-83 | friction | v9-verified | `task list --json` includes 500-char description by default; `--full` flag confirmed working |
| O-85 | friction | v9-verified | did-you-mean suggestions work on context and task errors |
| O-88 | friction | v9-verified | `brain pm project list` works (singular form) |
| O-91 | friction | v9-verified | `task add --workstream` now accepts display IDs (VOLT-04 form) |
| O-97 | friction | v9-verified | `brain pm tasks --json` works as shorthand |
| O-102 | blocker | v9-verified | Component-aware slug generation prevents README collisions; 30 docs correctly ingested |
| O-103 | friction | v9-verified | Project note body populated by synthesis agent with overview and component links |

---

## Open Observations

Organized by theme. Severity tagged per item: `blocker` `friction` `suggestion` `docs`

---

### Onboarding & Discovery

#### O-06: No Claude-assisted onboarding path exists `friction`
- **Where:** Overall onboarding flow
- **What happened:** The quickstart assumes a user will manually run CLI commands in sequence. In practice, users are in Claude Code and want to say "set up brain PM for this project." No skill, CLAUDE.md guidance, or workflow enables Claude to research the project and interactively set up workstreams and tasks.
- **Expected:** A `/pm-onboard` skill or equivalent that reads the project's CLAUDE.md/README, asks clarifying questions, creates the project structure, and explains what it did.
- **Fix:** Create an onboarding skill that wraps the CLI commands with project-aware intelligence. The CLI stays as the low-level API; the skill is the recommended entry point.

---

#### O-07: Agent spends many tool calls building context that could be provided directly `friction`
- **Where:** Claude session — agent reads CLAUDE.md, README, docs, workspace files to understand project and brain PM
- **What happened:** Agent made ~10+ tool calls just to understand the workspace and brain PM before its first productive command. Confirmed again in v8 at 14 non-brain calls before first productive pm command.
- **Expected:** A skill or command that assembles relevant context efficiently — workspace structure, brain PM capabilities/syntax, example outputs — so the agent doesn't have to explore from scratch every time.
- **Fix:** Onboarding skill that pre-loads project context + PM usage examples; or `brain pm help onboard` command that dumps a context bundle.
- **V8 confirmation:** P-03, session-audit

---

#### O-22: Onboarding should ask about external docs and project structure preferences `suggestion`
- **Where:** Before backlog generation
- **What happened:** Agents only looked at what's in repos. Real projects have context in Google Docs/Notion/Confluence, Slack threads, Figma files, issue trackers.
- **Fix:** Add an interview phase to the onboarding skill between structure setup and discovery.

---

#### O-28: Discovery agents did code-first, not doc-first — missed key planning artifacts `friction`
- **Where:** Sub-agent discovery phase
- **What happened:** Discovery agents read source code before (or instead of) documentation. Missed the 76KB ROADMAP.md, CLAUDE.md files, cross-repo coordination docs, investigation docs. No temporal planning artifacts were ingested.
- **Expected:** Agents should do a doc-first scan pass: glob for `**/*.md`, `**/docs/**`, `**/.github/**`, `**/CLAUDE.md` and ingest documentation before reading source code.
- **V8 confirmation:** P-20

---

#### O-30: No doc manifest presented to user before discovery `suggestion`
- **Where:** Pre-discovery phase
- **What happened:** Agents launched directly into repos without first surveying what documentation exists. User had no chance to say "the roadmap is the most important file" or "ignore the investigation docs, they're stale."
- **Fix:** Add a "doc survey" step to the onboarding skill between structure setup and agent dispatch.

---

#### O-31: Task backlog has zero feature work — entirely tech debt and maintenance `friction`
- **Where:** All generated tasks
- **What happened:** Because agents only read source code, all tasks are fix-broken-tests, add-missing-tests, fix-CI, add-documentation, fix-stale-imports. Zero tasks reference product features, roadmap phases, or user-facing improvements. V9: still 75%+ non-feature in observed sessions.
- **Expected:** A balanced backlog should include feature work (from roadmap/specs), tech debt (from code analysis), and infrastructure (from CI/config).
- **Fix:** Discovery agents should produce tasks from two sources: (1) existing planning docs for feature/milestone tasks, (2) code analysis for tech debt/maintenance tasks.

---

#### O-32: Open questions and investigation docs should generate research tasks, not implementation tasks `suggestion`
- **Where:** voltra-private/docs/investigation/
- **What happened:** Investigation directories contain open questions that should map to `category: research` tasks. They were missed entirely.
- **Fix:** Agent prompts should include: "Look for investigation docs, open questions, or TODO files. Create these as `category: research` tasks."

---

#### O-33: Cross-repo coordination docs not ingested — dependency context lost `friction`
- **Where:** Workspace root — `CLAUDE.md`, `game-plan.md`
- **What happened:** The workspace-level `CLAUDE.md` describes how repos relate to each other. No agent read it. This is exactly the context needed to wire cross-workstream dependencies. Confirmed again in v8.
- **Expected:** Workspace-level docs read first by coordinator before dispatching per-repo agents.
- **Fix:** Coordinator agent reads workspace-root docs before dispatching sub-agents, passes relevant cross-repo context into each agent's prompt.
- **V8 confirmation:** P-10

---

#### O-47: voltra-private repo only 33% doc coverage — investigation and tooling docs missed `friction`
- **Where:** Sub-agent discovery — voltra-private repo
- **What happened:** Only README and protocol-reference ingested from voltra-private. Missed: `remaining-investigations.md` (open BLE research gaps), `bluetooth-logging.md` (BLE capture setup), `pklg-analysis.md` (packet analysis methodology).
- **Expected:** Investigation and tooling docs should be high-priority ingestion targets — they contain irreplaceable domain knowledge.
- **Fix:** Ensure discovery agent prompts include `docs/investigation/` and `docs/tooling/` directories.

---

#### O-48: `docs/plans/` subdirectories not scanned — active planning artifacts missed `suggestion`
- **Where:** Gap analysis — `voltras/mobile/docs/plans/2026-02-23-android-mvp-design.md`
- **What happened:** A 4-day-old Android MVP design plan existed in `mobile/docs/plans/` but was not found by the mobile agent.
- **Fix:** Lead agent's doc survey should flag recent files in `**/plans/` or `**/decisions/` directories.

---

#### O-104: Brain project not self-ingested — 0% documentation coverage `friction`
- **Where:** Brain knowledge base — `~/brain/`
- **What happened:** The brain project's own documentation (README, CLAUDE.md, PM architecture/commands/guide, all diagnostic results, all test-bench prompts, onboarding-observations.md) has never been ingested. Agents debugging PM behavior cannot search for "how does dispatch work" or find O-XX observations. Zero self-coverage confirmed across 9 diagnostic cycles.
- **Expected:** Core brain docs are searchable via `brain search`.
- **Fix:** One-time ingest of brain project docs. Add a post-diagnostic re-index step to the diagnostic workflow. Fix ingestion verification to use path-based confirmation, not topical search rank.
- **V9 confirmation:** gap-analysis

---

#### O-105: `brain pm onboard --path` option doesn't exist `friction`
- **Where:** `brain pm onboard` — option naming
- **What happened:** The setup agent passed `--path ~/Documents/projects/voltras-workspace` and received `unknown option '--path'. Did you mean --db-path?`. The actual flag is `--db-path`, which implies a database path rather than a workspace path.
- **Expected:** The workspace path flag is named `--workspace` or `--path`.
- **Fix:** Rename `--db-path` to `--workspace` or add `--workspace` as an alias. Update `--help` to lead with path flag.
- **Test bench evidence:** session-audit (v8)

---

#### O-106: `brain pm onboard` lacks `--dry-run` mode `suggestion`
- **Where:** `brain pm onboard`
- **What happened:** The setup agent made 10 exploratory calls before invoking `brain pm onboard`, rather than trusting it to discover the workspace. Without a dry-run preview, agents over-explore before committing.
- **Expected:** `brain pm onboard --dry-run` prints a plan: which docs it would ingest, what slugs they'd get, estimated task count — without writing anything.
- **Fix:** Add `--dry-run` flag that runs discovery and synthesis phases but skips all writes.
- **Test bench evidence:** session-audit (v8)

---

#### O-119: `brain pm onboard` misses repos in subdirectories `friction`
- **Where:** `brain pm onboard` — component detection phase
- **What happened:** The workspace has 5 repos but the onboard command detected only 4 — it missed `voltras/mobile` because it is a subdirectory of `voltras/` rather than a top-level directory. The primary app repo's architecture, BLE integration docs, and iOS/Android guides were not ingested.
- **Expected:** Component detection handles nested app directories.
- **Fix:** Add a `--components <path>...` flag to allow users to explicitly specify additional component paths. Alternatively, deepen the component detection scan to recognize common patterns like `*/app/`, `*/mobile/`, or repos nested one level inside a subdirectory.
- **Test bench evidence:** session-audit (v9)

---

#### O-125: Empty task subdirectories created at onboarding `suggestion`
- **Where:** `~/brain/modules/pm/VOLT/VOLT-XX.YY/` — all 47 task directories
- **What happened:** Each task note has a corresponding empty subdirectory created at onboarding. These directories create filesystem noise and inflate the directory listing.
- **Expected:** Task subdirectories are created lazily — only when a file is actually written to them.
- **Fix:** Change task creation to not pre-create the subdirectory. Create the directory on-demand in commands that write to it (`complete`, `dispatch`, artifact attachment).
- **Test bench evidence:** data-audit (v9)

---

#### O-128: No `--body/--description` flag on `brain pm task add` `friction`
- **Where:** `brain pm task add` — creation flags
- **What happened:** `brain pm task add "Task title" --workstream VOLT-06 --priority high` creates a task with an empty body. Body content can only be added post-creation via `task update`, which is not mentioned in `task add --help`. Agents creating tasks with rich body content require two sequential commands.
- **Expected:** `brain pm task add "Title" --body "Detailed description here" --workstream VOLT-06` creates the task with body content in a single command.
- **Fix:** Add `--body <text>` flag to `task add`. Write the body content to the task's `.md` note file during creation. Also consider `--acceptance-criteria <text>` as a multi-value flag.
- **Test bench evidence:** P-14 (v9)

---

### Task Management

#### O-16: No dependencies created — all tasks in Wave 0, waves engine provides no signal `friction`
- **Where:** `brain pm waves`, `brain pm briefing`
- **What happened:** V9 created 8 intra-workstream deps, so this is now partially resolved. However, cross-workstream dependency wiring is still not happening during onboarding. Wave engine still places all tasks in Wave 0 due to O-108.
- **Expected:** Even within a single workstream, tasks have natural ordering. Cross-workstream deps should exist.
- **Fix:** Post-generation dependency pass after all tasks exist (coordinator agent with full visibility), plus intra-workstream dep wiring during agent creation. O-108 is the wave computation bug that must also be fixed.
- **Status:** Partial — intra-workstream deps created; wave computation broken (see O-108)
- **V9 confirmation:** P-11, P-15, data-audit

---

#### O-21: Dependency wiring should happen during creation, not as a separate pass `suggestion`
- **Where:** Backlog generation phase
- **What happened:** Sub-agents created tasks in isolation, no dependencies. A post-hoc coordinator pass works but agents with code context have already exited.
- **Fix:** Two-phase approach: (1) agent prompts include instruction to use `--depends-on` for obvious ordering within their workstream; (2) after all agents complete, coordinator gets all task IDs + titles + descriptions and adds cross-workstream edges.

---

#### O-24: All tasks are mode=auto — orchestration can't differentiate `friction`
- **Where:** Database — all tasks have `mode: auto`
- **What happened:** No tasks were set to `agent`, `human`, `assisted`, or `review`. The orchestration engine can't tell what should be automated vs manual.
- **Fix:** Agent prompts should specify: `mode=agent` for fully automatable tasks, `mode=human` for tasks requiring physical device testing, `mode=review` for code review tasks.

---

#### O-27: Zero activities recorded during onboarding `friction`
- **Where:** Activities table — 0 rows after full onboarding
- **What happened:** Sub-agents used `brain add` and `brain pm task add` but no activities were recorded. The audit trail is empty. Activities are only written by `brain pm complete` and the orchestration layer.
- **Fix:** Record activity for bulk task creation, project init, and discovery phases — not just task completion.

---

#### O-43: Category chaos — no shared vocabulary across tasks `friction`
- **Where:** Database — task category field
- **What happened:** Sub-agents invented their own category vocabularies. V2: 9 distinct categories across 41 tasks. V9: improved with 7-category taxonomy but still observed inconsistency without coaching.
- **Expected:** A defined category taxonomy enforced by the CLI or documented in agent prompts.
- **Fix:** Either validate categories in `task add` against an allowed set, or document the canonical categories in the orchestrator skill so agents use consistent values.
- **V8 note:** V8 dataset used proper 7-category taxonomy without coaching — improvement but not fully stable.

---

#### O-44: `task update --depends-on` doesn't exist — dependency wiring blocked `friction`
- **Where:** `brain pm task update` — missing flag
- **What happened:** `--depends-on` is only accepted on `task add`, not `task update`. Agents creating tasks independently then trying to wire dependencies post-creation cannot do so.
- **Expected:** Either `task update` accepts `--depends-on` to add dependencies post-creation, or a separate `brain pm task link` command exists for wiring dependencies between existing tasks.
- **Fix:** Add `--depends-on` support to `task update`, or add a `brain pm dep add <from> <to>` command.

---

#### O-49: PM task notes not indexed — unsearchable via `brain search` `friction`
- **Where:** PM task notes — zero chunks in database
- **What happened:** After `brain index`, knowledge notes are chunked and embedded, but all PM task notes have no chunks. `brain search "analytics"` won't find task VOLT-01.03 "Implement analytics dashboard" — only PM-specific commands can find tasks. Private-visibility leakage concern also observed.
- **Expected:** Task notes should be searchable via `brain search` so agents can discover relevant tasks when researching a topic.
- **Fix:** Either index PM notes during `brain index` (respecting visibility), or add a `--include-pm` flag to `brain search`. Relations (O-25) would also help by linking searchable knowledge notes to tasks.
- **V9 confirmation:** P-27, P-30

---

#### O-74: Workstream names not embedded in task JSON `friction`
- **Where:** `brain pm task list --json` — workstream field
- **What happened:** Task JSON's `workstream` field is a bare integer, not the display_id or name. Agents grouping tasks by workstream from JSON output must do a secondary lookup. Confirmed in v9.
- **Expected:** Task JSON includes `workstream_id` (integer), `workstream_display_id` (e.g., `"VOLT-01"`), and optionally `workstream_name`.
- **Fix:** Add `workstream_display_id` and `workstream_name` to the task JSON mapper.
- **V9 confirmation:** P-04, P-28

---

#### O-82: `--search` on task list matches titles only `friction`
- **Where:** `brain pm tasks --search`, `brain pm task list --search`
- **What happened:** `--search testing` returns only tasks with "testing" in the title. Tasks categorized as `bug` or `infrastructure` that involve testing work are invisible. Acceptance criteria containing test-related terms are not searched. Confirmed again in v9.
- **Expected:** `--search` matches against task title, description/body, category, and acceptance criteria.
- **Fix:** Expand the task search query to include FTS over the task note body in addition to the title column.
- **V9 confirmation:** P-06

---

#### O-84: Task JSON schema omits dependency fields `friction`
- **Where:** `brain pm task list --json`, `brain pm tasks --json`
- **What happened:** Task JSON output has no `depends_on`, `blocked_by`, or `dependency_count` fields. Even when dependencies are defined, they are invisible in structured output. In v9: `blocked_by` field is empty in JSON; actual blockers are in `depends_on` but the `blocked_by` field is not populated.
- **Expected:** Task JSON includes `depends_on: string[]` and `blocked_by: string[]` arrays (empty arrays when no deps exist).
- **Fix:** Add dependency fields to the task JSON mapper. Query the dependency table during task list and include results. Fix the `blocked_by` vs `depends_on` field population inconsistency.
- **V9 confirmation:** P-07, data-audit

---

#### O-89: No planning or task-sequencing command `friction`
- **Where:** PM module — planning capability
- **What happened:** When asked "what order should we do things in to ship an Android MVP?", the PM module has no command that synthesizes cross-workstream task ordering toward a stated goal.
- **Expected:** `brain pm plan --goal "Ship Android MVP"` returns a filtered, ordered task list with dependency rationale and critical-path analysis.
- **Fix:** New `brain pm plan` command: accepts `--goal <text>`, runs semantic search over tasks for relevance, applies dependency/priority ordering, returns an ordered list with workstream grouping.
- **Test bench evidence:** P-11, P-20 (v8)

---

#### O-94: `brain pm complete` doesn't surface newly unblocked tasks `friction`
- **Where:** `brain pm complete <task-id>` output
- **What happened:** After completing a task, the output confirms completion but does not show which downstream tasks became newly eligible. The impact analysis runs internally but results are discarded. Confirmed still broken in v9 — see O-114 for the specific regression.
- **Expected:** `brain pm complete VW-01.01` includes: "Newly unblocked: VW-02.06 (CI setup) is now ELIGIBLE."
- **Fix:** Capture the list of newly-ELIGIBLE tasks from the impact analysis and include them in the completion output. (The specific bug is documented in O-114.)
- **V9 confirmation:** P-16

---

#### O-94b (from O-94): `brain pm complete` should surface newly unblocked tasks `suggestion`
- **Note:** The fix suggestion is tracked in O-94. The specific regression (always returning `[]`) is O-114.

---

#### O-95: `brain pm task block` has no `--reason` option `friction`
- **Where:** `brain pm task block <task-id>`
- **What happened:** `block` transitions a task to blocked status but accepts no `--reason` argument. Blocking reason cannot be recorded inline.
- **Expected:** `brain pm task block VW-02.06 --reason "CI credentials not provisioned yet"` records the reason in the task record and activity log.
- **Fix:** Add `--reason <text>` to the `block` subcommand. Store in the task's activity log entry. Surface in `task show` and `tasks --status blocked` output.
- **Test bench evidence:** P-16 (v8)

---

#### O-99: No temporal dimension in PM data model `friction`
- **Where:** PM data model — task and project schema
- **What happened:** Tasks have priority, category, and status but no due date, sprint assignment, milestone, or quarter target. Time-bounded planning queries are unanswerable from PM data alone. V9 design targeted this but it was not implemented.
- **Expected:** Optional `due_date` (ISO 8601) and `milestone` string fields on tasks. `--due <date>` on `task add` and `task update`. `--due-before` and `--milestone` filter flags on `task list`.
- **Fix:** Add optional `due_date` and `milestone` fields to task frontmatter schema and database. Support as query filters.
- **V9 confirmation:** P-20

---

#### O-100: `brain pm tasks --search` defaults to pending-only `friction`
- **Where:** `brain pm tasks --search <query>` and `brain pm task list --search`
- **What happened:** `brain pm tasks --search "analytics"` silently excludes done, in-progress, and blocked tasks. Completed work is invisible unless the user queries each status explicitly. No `--all-statuses` flag exists.
- **Expected:** `--search` queries all statuses by default, or a documented `--all-statuses` flag exists.
- **Fix:** Default search to all statuses. Make `--status pending` the explicit scoping flag. Update `--help`.
- **Test bench evidence:** P-30 (v8)

---

#### O-107: `brain search` has no note type or category filter `friction`
- **Where:** `brain search` — filter options
- **What happened:** `brain search "architecture" --type research` treats `--type` as an unknown option. Results mix task notes, workstream summaries, documentation notes, and research notes indiscriminately. Confirmed again in v9.
- **Expected:** `brain search "architecture" --type research` returns only notes with `type: research`. `--module pm` scopes to PM module notes.
- **Fix:** Add `--type`, `--module`, and `--tier` filter flags to `brain search`. These filter the note metadata layer before FTS/vector scoring.
- **V9 confirmation:** P-26, P-27

---

#### O-108: Wave computation ignores declared dependencies — all tasks remain in Wave 0 `blocker`
- **Where:** `brain pm waves`, `brain pm briefing`, `brain pm next`
- **What happened:** 8 of 47 tasks have `depends_on` set and are correctly marked `+BLOCKED`. Yet `brain pm waves` places all 47 tasks in Wave 0. A 4-level dependency chain (VOLT-06.05→06.06→06.07→06.08) should produce waves 0–3 but all appear in Wave 0. The topological sort algorithm is not stratifying tasks based on `depends_on` relations.
- **Expected:** Tasks with all dependencies satisfied appear in Wave 0. Tasks blocked by Wave 0 tasks appear in Wave 1, etc.
- **Fix:** Debug `waves` command topological sort. It appears to ignore the `depends_on` field in task frontmatter (or the field is not being read from the database correctly). Verify that `depends_on` values are read and that the graph traversal algorithm correctly computes reachable strata.
- **Note:** Distinct from O-16 ("no dependencies created"). O-16 is now partially resolved — v9 creates intra-workstream deps. The bug here is that even when deps exist, wave stratification doesn't compute correctly.
- **Test bench evidence:** P-11, P-15 (v9)

---

#### O-110: `brain pm tasks --workstream <N>` filter non-functional `blocker`
- **Where:** `brain pm tasks --workstream <N>` (numeric filter form)
- **What happened:** Passing `--workstream 1` (numeric ID) returns all 47 tasks across all workstreams instead of only the tasks in workstream 1. The filter is silently ignored. The display ID form (`--workstream VOLT-01`) appears to work. The numeric form does not.
- **Expected:** `brain pm tasks --workstream 1` returns only the 8 tasks in VOLT-01.
- **Fix:** Check the `listTasks()` filter implementation for the `workstream` parameter. If it accepts display IDs but not integer IDs (or vice versa), normalize both forms before the database query.
- **Test bench evidence:** P-03 (v9)

---

#### O-113: Task list text formatter uses camelCase `displayId`, shows `?` for all task IDs `blocker`
- **Where:** `brain pm tasks` / `brain pm task list` — plain-text output
- **What happened:** Plain-text output shows `? - [status][priority][mode]` for every task instead of the display ID. Root cause: the text formatter reads `t.displayId` (camelCase) but the JSON schema and database mapper use `display_id` (snake_case). The camelCase field is undefined, so the formatter falls back to `?`.
- **Expected:** `VOLT-01.01 - Set up EAS build [high] pending (auto)`
- **Fix:** In the task list text formatter, change all `t.displayId` references to `t.display_id`. Audit all other formatters for the same camelCase/snake_case inconsistency. Also affects workstream and project formatters.
- **Test bench evidence:** P-02, P-05, P-06, P-23 (v9)

---

#### O-114: `brain pm complete` returns `newlyEligible: []` despite known downstream dependents `friction`
- **Where:** `brain pm complete <task-id>` — `newlyEligible` field in JSON output
- **What happened:** Completing VOLT-01.02 returned `newlyEligible: []`, but VOLT-01.03 (which depends on VOLT-01.02) became eligible after the completion. The impact analysis is not detecting the cascaded eligibility change. O-94 was supposed to fix this in the v8 cycle — either the fix was incomplete or there is a regression.
- **Expected:** `newlyEligible: ["VOLT-01.03"]` after completing VOLT-01.02.
- **Fix:** The impact analysis in `complete` needs to re-evaluate the `+BLOCKED`/`+ELIGIBLE` virtual state of all tasks that have the completed task in their `depends_on` array.
- **Test bench evidence:** P-16 (v9)

---

#### O-115: Invalid filter values silently return empty results `friction`
- **Where:** `brain pm tasks --priority <value>`, `brain pm tasks --status <value>`
- **What happened:** `brain pm tasks --priority critical` returns `[]` with no indication that `critical` is not a valid priority value (schema uses `high/medium/low`). `brain pm tasks --status planned` similarly returns `[]` with no error (status schema uses `pending/claimed/in-progress/done`).
- **Expected:** `Error: Invalid priority 'critical'. Valid values: low, medium, high` or a warning with the valid options listed.
- **Fix:** Validate `--priority` and `--status` flags against their enum values before executing the query. Return a clear error with the allowed values when an invalid value is provided.
- **Test bench evidence:** P-04, P-20, P-28 (v9)

---

#### O-120: `brain pm tasks --search` provides no relevance scores `friction`
- **Where:** `brain pm task list --search <query>` — JSON output
- **What happened:** Unlike `brain search --json` which returns results with similarity scores (`score: 0.73`), `brain pm tasks --search` returns matching tasks in list form with no relevance ranking.
- **Expected:** `brain pm tasks --search` returns results ranked by relevance, or includes a `matchScore` field in the JSON output.
- **Fix:** Add relevance scoring to the task search path. The FTS query can return a rank score; expose it in the JSON output as `matchScore`. Use it as a secondary sort after priority.
- **Test bench evidence:** P-30 (v9)

---

#### O-121: Workstream JSON objects missing `display_id` and `slug` fields `friction`
- **Where:** `brain pm workstream list --json`
- **What happened:** Workstream JSON objects have `display_id: null` and no `slug` field. Agents must use `brain pm workstream list` (plain text) to discover display IDs, then cannot use them programmatically.
- **Expected:** Workstream JSON includes `display_id` (e.g., `"VOLT-01"`), `slug` (e.g., `"volt-01"`), and `taskCount` fields.
- **Fix:** Ensure the workstream JSON mapper reads and includes `display_id` from the workstream record. Verify the display_id is being written to the database correctly when workstreams are created.
- **Test bench evidence:** P-04, P-28 (v9)

---

### Context & Relations

#### O-25: Architecture notes are orphaned — no relations to PM project or tasks `friction`
- **Where:** Database — 0 research-to-task relations; parent hierarchy edges working but research-to-task links are zero
- **What happened:** Architecture notes created as plain `brain add` notes are not linked to the PM project or any tasks. They're searchable by content but have no structural connection. `brain pm context` won't surface them when assembling task context. V9 created 53 parent hierarchy edges but zero research-to-task cross-links remain.
- **Expected:** Research notes linked to relevant tasks/workstreams via the relations table.
- **Fix:** Either vector-threshold auto-linking at `brain index` time, or explicit `brain pm relate` calls from a post-onboard synthesis step.
- **V9 confirmation:** P-03, P-09, P-19, P-27, data-audit

---

#### O-45: Notes with zero relations — no cross-references between repos `friction`
- **Where:** Database — relations table
- **What happened:** Notes that clearly relate (Mobile VBT notes ↔ Analytics VBT spec, SDK platform adapters ↔ Mobile BLE protocol) have no structural connections. Agents still don't create relations.
- **Fix:** Agent prompts should instruct cross-referencing. Could also add a post-creation relation-wiring pass, similar to the dependency coordinator concept.

---

#### O-56: `brain graph` returns no edges for any note — graph commands non-functional `friction`
- **Where:** `brain graph` command
- **What happened:** `brain graph` returns zero edges for all notes. Confirmed in v9 across all note types.
- **Expected:** Graph should at minimum show co-occurrence relationships even without explicit wikilinks.
- **Fix:** Consider auto-generating "mentioned-in" relations during indexing when note A contains text matching note B's title/slug.
- **V9 confirmation:** P-19

---

#### O-86: `brain context` rejects PM note paths `friction`
- **Where:** `brain context` command — path-based lookup
- **What happened:** `brain context /Users/hjewkes/brain/modules/pm/VW/docs/architecture.md` returns "note not found". PM notes appear in search results with their paths but are not addressable by those paths via `context`. Confirmed again in v9.
- **Expected:** If a note is returned by `brain search`, its path or slug should work in `brain context`.
- **Fix:** Add path-to-slug resolution in the `context` command handler. When an absolute path is supplied, normalize it to a slug.
- **V9 confirmation:** P-03, P-09, P-12, P-19

---

#### O-87: `brain pm context <workstream-id>` returns NOT_FOUND `friction`
- **Where:** `brain pm context <workstream-id>` (e.g. `VW-01`, `VW-02`)
- **What happened:** Workstream IDs like `VW-01` are valid PM entities but `brain pm context VW-01` returns NOT_FOUND with no message explaining that context only accepts task-level IDs.
- **Expected:** `brain pm context VW-01` returns workstream description, task summary, and related notes. Or the error message redirects: "VW-01 is a workstream — use 'brain pm workstream show VW-01'."
- **Fix:** Handle workstream IDs in the context command, or add a contextual redirect error.
- **Test bench evidence:** P-02, P-05, P-10, P-12, P-19, P-26 (v8)

---

#### O-90: `brain context <display_id>` fails silently with no suggestion `friction`
- **Where:** `brain context` (base command) — called with PM task display IDs
- **What happened:** `brain context VW-05.03` returns "note not found" with no hint to use `brain pm context VW-05.03`. Confirmed again in v9.
- **Expected:** When `brain context` receives a string matching a PM task ID pattern, it delegates to `brain pm context` or emits: "Did you mean `brain pm context VW-05.03`?"
- **Fix:** In the base `context` command, detect PM task ID patterns and delegate or emit a clear redirect error.
- **V9 confirmation:** P-03, P-09, P-12

---

#### O-101: `brain pm context` has no `--json` output mode `friction`
- **Where:** `brain pm context <task-id>`
- **What happened:** `brain pm context` outputs human-readable text only. The related notes section (with relevance scores, slugs, titles) cannot be parsed programmatically.
- **Expected:** `brain pm context VW-01.01 --json` returns a structured object with `task`, `related_notes[]`, `decisions[]`, `dependencies[]` arrays.
- **Fix:** Add `--json` flag to `context` command. Return the structured object already assembled internally by `assembleContext()`.
- **Test bench evidence:** P-09, P-29 (v8)

---

#### O-122: No command to surface architecture notes relevant to a workstream `suggestion`
- **Where:** PM module — cross-system navigation
- **What happened:** Answering "which architecture notes are relevant to the Mobile App workstream?" required 8+ targeted semantic search queries with manually extracted keywords from task titles. No `brain pm docs VOLT-06` or `brain pm context VOLT-06 --notes` command exists.
- **Expected:** `brain pm docs VOLT-06` returns the top N knowledge base notes semantically related to the workstream's tasks and description.
- **Fix:** Add a `brain pm docs <workstream-id>` command that runs `brain search` using the workstream title + task descriptions as the query, scoped to knowledge notes.
- **Test bench evidence:** P-26 (v9)

---

#### O-123: `brain context` has no semantic similarity fallback for notes without indexed relations `friction`
- **Where:** `brain context <note-slug>` — notes with zero graph edges
- **What happened:** `brain context node-sdk-platform-adapters` returns no context even though this note is architecturally central. The context command only returns results from the graph relations table. When a note has no explicit relation edges (O-25), context is always empty.
- **Expected:** When a note has no indexed relations, `brain context` falls back to semantic similarity search using the note's content as the query. Results are labeled `(semantic match, not linked)`.
- **Fix:** In the `context` command handler, after the graph relation query returns empty, run a vector similarity search using the note's embedding. Return top N results as `relatedNotes` with a `source: "semantic"` label.
- **Test bench evidence:** P-09 (v9)

---

### Navigation & Output

#### O-02: `brain init` output is technical, not welcoming `friction`
- **Where:** `brain init` command output
- **What happened:** Output shows paths, model names, and feature flags. User said "it doesn't feel like a success" and wanted human-readable confirmation of what happened and what's next.
- **Expected:** A warm confirmation that things worked, plain-language summary, and clear next steps. Technical details available via `--verbose` or `brain status` but not the default.
- **Fix:** Rework default `init` output to lead with success message, hide paths/model names behind `--verbose`, add "Next steps" section.

---

#### O-77: `brain pm workstream show` returns sparse one-line output or fails with 'too many arguments' `friction`
- **Where:** `brain pm workstream show <id>`
- **What happened:** `brain pm workstream show VW-01` returns one line (display ID and status only, no description or task counts). `brain pm workstream show VOLT-06` fails with 'too many arguments'. O-54 fixed `task show` enrichment in v3 but workstream show was not fully addressed. Confirmed again in v9.
- **Expected:** Workstream show should include: title, description, status, task counts by status and priority, and top eligible tasks.
- **Fix:** Enrich `workstream show` output: read workstream note body, query task aggregate stats, format as structured human output with `--json` flag. Fix the 'too many arguments' parsing error.
- **V9 confirmation:** P-05, P-08

---

#### O-78: `brain pm audit` not filterable by project `friction`
- **Where:** `brain pm audit`
- **What happened:** `brain pm audit --project VW` fails — `--project` is not an accepted flag. Audit reports are global-only.
- **Expected:** `brain pm audit --project VW` returns activity and cost data for the VW project only.
- **Fix:** Add `--project` filter to audit queries. Route to project-scoped SQL in the audit data layer.
- **Test bench evidence:** P-02 (v8)

---

#### O-81: Stale project prefix in workstream filter error template `friction`
- **Where:** `brain pm next --workstream` error message
- **What happened:** When an invalid `--workstream` value is supplied, the error message references `VOLT-06` — a hardcoded prefix from a prior test project that is not the active project.
- **Expected:** Error message references only the active project's prefixes. No hardcoded project-specific strings in error templates.
- **Fix:** Audit all error strings in workstream, task, and next commands for hardcoded project prefixes. Replace with dynamic active-project substitution.
- **Test bench evidence:** P-05 (v8)

---

#### O-92: `brain pm waves` missing summary line and workstream labels `friction`
- **Where:** `brain pm waves` text output
- **What happened:** Plain-text output groups tasks by wave but shows no summary line (total task count, total wave count). Workstream membership is not shown alongside task IDs.
- **Expected:** Footer line: `5 waves · 47 tasks`. Each wave group shows workstream label for homogeneous groups.
- **Fix:** Add a summary footer to `renderWaves()`. Group tasks by workstream within each wave, showing workstream title for homogeneous groups.
- **Test bench evidence:** P-15 (v8)

---

#### O-93: `brain pm verify` generates generic steps, ignores acceptance criteria `friction`
- **Where:** `brain pm verify <task-id>`
- **What happened:** `brain pm verify VW-01.01` produces category-generic verification steps ("Run tests, Check for errors, Review code"). The task has specific acceptance criteria stored in its body, which are ignored. The O-52 crash fix added a fallback but the fallback is generic rather than acceptance-criteria-driven.
- **Expected:** Verify output is derived from the task's actual acceptance criteria.
- **Fix:** In `suggestVerificationSteps()`, parse the task body's acceptance criteria section and convert each bullet to a verification step. Use generic fallback only when no acceptance criteria exist.
- **Test bench evidence:** P-16 (v8)

---

#### O-96: `brain pm tasks` alias covers `list` only — not other task subcommands `friction`
- **Where:** `brain pm tasks` (plural alias)
- **What happened:** `brain pm tasks done VLT-02.03` fails with "too many arguments for list". The `tasks` alias only delegates to `task list`. It does not forward to `task done`, `task claim`, or other subcommands. Confirmed as still broken in v9 (`brain pm tasks list` plural fails).
- **Expected:** Either `brain pm tasks` is a true namespace alias for the entire `task` subcommand group, or the error message says: "Did you mean `brain pm task done VLT-02.03`?"
- **Fix:** Make `tasks` a full Commander alias for the `task` subcommand group, or emit a redirect error that identifies the correct path.
- **V9 confirmation:** P-03, P-06, P-18, P-23, P-25

---

#### O-98: Project name-substring lookup not supported `friction`
- **Where:** All PM commands that accept `--project` or project prefix arguments
- **What happened:** Using prefix `VLT` (intuited from "voltras") produces: `Project 'VLT' not found. Available: VW`. The error shows only the prefix, not the full project name. The agent still doesn't know if `VW` is the Voltras project without running `brain pm list`.
- **Expected:** NOT_FOUND error includes project name: `Available: VW (voltras-workspace)`. Ideally: `Did you mean VW (voltras-workspace)?`
- **Fix:** Include project name in all project-not-found error messages. Optionally add prefix-overlap fuzzy matching to suggest close matches.
- **Test bench evidence:** P-08, P-18, P-21, P-24, P-25 (v8)

---

#### O-109: `brain pm briefing` renders blocked tasks as `[object Object]` `friction`
- **Where:** `brain pm briefing` — blocked task section
- **What happened:** The briefing output includes `Blocked: 8 ([object Object], [object Object], ...)`. The blocked task dependency references are serialized as JavaScript objects rather than their display IDs. The JSON output is correct; only the human text formatter is broken.
- **Expected:** `Blocked: 8 (VOLT-02.03, VOLT-04.01, ...)` or a count only, with display IDs for referenced blockers.
- **Fix:** In the briefing text formatter, unwrap blocked task objects to their `display_id` field before interpolating. The `depends_on` array likely contains objects `{ display_id: 'VOLT-02.03', ... }` rather than bare strings.
- **Test bench evidence:** P-11, P-16, session-audit (v9)

---

#### O-111: `brain notes list` defaults to 50 results with no truncation indicator `friction`
- **Where:** `brain notes list`
- **What happened:** With 85 notes indexed, `brain notes list` returns 50 results with no message indicating the output is truncated. A user or agent may believe there are only 50 notes.
- **Expected:** The output footer shows `Showing 50 of 85 notes (use --limit to see more)` or similar.
- **Fix:** Add a truncation notice to `brain notes list` output when the result count equals the limit. Consider raising the default limit.
- **Test bench evidence:** P-10 (v9)

---

#### O-116: `brain search --json` returns empty metadata for PM module notes `friction`
- **Where:** `brain search --json` — search result objects for PM module notes
- **What happened:** Search results for PM module notes return objects with empty string `title`, `slug`, and `note_id` fields (shows as `?` in some contexts). The note body excerpt is present but metadata fields are missing. Regular knowledge base notes return correct metadata.
- **Expected:** All search result objects have `note_id`, `title`, and `slug` populated regardless of whether the note is a PM module note or a regular knowledge note.
- **Fix:** Investigate the search result mapper for PM module notes. PM notes may be using a different table join path or metadata field names that don't map correctly to the search result schema.
- **Test bench evidence:** P-13, data-audit (v9)

---

#### O-118: `brain index` runs silently with no output `friction`
- **Where:** `brain index` command
- **What happened:** `brain index` exits with no output (empty string result). Agents cannot tell whether indexing succeeded, how many notes were indexed, or whether any errors occurred.
- **Expected:** At minimum: `Indexed 85 notes (634 chunks, 0 errors)`. With `--verbose`: per-note progress.
- **Fix:** Add a completion summary to `brain index` output: total notes processed, chunks created, time elapsed, and any errors.
- **Test bench evidence:** session-audit (v9)

---

#### O-126: `brain memories` (no subcommand) errors instead of defaulting to `list` `friction`
- **Where:** `brain memories` — default behavior without subcommand
- **What happened:** `brain memories` (without a subcommand) returns an error. The correct command is `brain memories list`. Other brain commands that have a natural default action (e.g., `brain search`) work without subcommands.
- **Expected:** `brain memories` delegates to `brain memories list` (the only sensible default).
- **Fix:** Add a default action to the `memories` command group that runs `list` when no subcommand is provided.
- **Test bench evidence:** P-30 (v9)

---

#### O-127: Inconsistent token enforcement: `task start` requires `--token`, `task done` does not `friction`
- **Where:** PM task state machine — `task start` and `task done` commands
- **What happened:** The claim→start→done workflow requires a token for `task start` but not for `task done`. It is unclear to agents whether the token is a security check, an idempotency key, or a mere correlation ID — especially since `task done` doesn't require it.
- **Expected:** Token enforcement is consistent: either both `start` and `done` require the token, or neither does, or the purpose is clearly documented.
- **Fix:** Either add token validation to `task done` (consistent enforcement), or remove it from `task start` and document that the token is optional/for agent correlation only. Update `--help` to explain the token's purpose.
- **Test bench evidence:** P-23 (v9)

---

### Search

#### O-53: Search-loop inflation — agents run 5-10x more searches instead of reading full content `friction`
- **Where:** Test bench — agents run 20-50 search queries to assemble context from excerpts
- **What happened:** `brain search` returns chunked excerpts (~200-500 chars). Agents constrained from reading files directly run many queries to get equivalent content to reading one full note. Total call counts didn't decrease V1→V2.
- **Expected:** Agents should be able to get full document content when they need depth.
- **Fix:** Add `brain search --full` or `brain read <note-slug>` to return complete note content for the top N results. Confirmed again in v8 (agents still run 5-10 searches to reconstruct context; no `--full` flag).
- **V8 confirmation:** P-03, P-09, P-29

---

#### O-69: No workstream-scoped search `friction`
- **Where:** `brain search` — filter options
- **What happened:** No native `--workstream` flag on `brain search`. Scoping search to tasks or notes within a specific workstream requires post-processing. Confirmed again in v9.
- **Fix:** Add `--workstream` filter flag to `brain search` and to `brain pm tasks --search`.
- **V9 confirmation:** P-26

---

#### O-72: No unified cross-domain search — PM and knowledge base still partially siloed `friction`
- **Where:** `brain search` — `--include-tasks` flag
- **What happened:** `--include-tasks` was added (O-68 fix) but is not fully wired. PM notes are visible in search via `--include-tasks` but private-visibility leakage observed.
- **Fix:** Complete the cross-domain search wiring. Ensure visibility constraints are respected (private PM notes not leaked to unintended contexts).

---

#### O-112: `brain search --memories` changes JSON response schema undocumented `friction`
- **Where:** `brain search --memories --json`
- **What happened:** `brain search "query" --json` returns an array. `brain search "query" --memories --json` returns `{ notes: [...], memories: [...] }`. The flag silently changes the response envelope from array to object. Agents expecting an array receive an object and fail silently or throw a parse error.
- **Expected:** Both forms return the same envelope (e.g., always an object with `notes` and optionally `memories`).
- **Fix:** Normalize JSON output to always return `{ notes: [...], memories: [...] }` regardless of whether `--memories` is set.
- **Test bench evidence:** P-10 (v9)

---

### Agent Experience

#### O-08: Agent wanted to create a demo project before the real one `suggestion`
- **Where:** Claude session — agent asked "Should I create a demo project first?"
- **What happened:** Agent likely wants to understand CLI behavior before committing to real commands. Docs already have full command/output examples (demo.md, quickstart.md, e2e tests) — if these were in the agent's context, it wouldn't need a sandbox.
- **Fix:** Ensure the onboarding skill includes representative command/output pairs. Could also add `brain pm demo --dry-run` that shows what a sample project looks like without creating anything.

---

#### O-12: Workstream-per-repo vs workstream-per-feature — object model gap `suggestion`
- **Where:** Conceptual — workstream design
- **What happened:** Repo-based workstreams align with code isolation. Feature-based workstreams align with how work is actually planned. Brain's model currently has only project → workstream → task, with tasks belonging to exactly one workstream. Many PM tools separate the organizational container (epic/project/cycle) from the code area (component/team/label).
- **Fix:** Add a "component" or "area" concept orthogonal to workstreams, or use labels/tags on tasks for the cross-cutting dimension.

---

#### O-15: Sub-agent-per-repo exploration worked well — codify as standard pattern `suggestion`
- **Where:** Backlog discovery phase
- **What happened:** 5 Sonnet agents explored repos in parallel, each creating brain notes for architecture and generating tasks with real findings. Total ~58 tasks, significant efficiency and quality.
- **Fix:** Codify as a `brain pm discover` or onboarding skill phase that spawns one agent per workstream/repo, each doing: read code → create brain note → generate tasks → return summary.

---

#### O-20: Agent surfaces CLI commands the user won't run in Claude Code `friction`
- **Where:** Agent's final message — suggests `brain pm briefing`, `brain pm next`, `brain pm waves`
- **What happened:** Agent tells the user they can run these commands. But in a Claude Code session, the user won't — they'll ask Claude to do things, and Claude should use these commands behind the scenes. Exposing the CLI is leaking implementation details. Confirmed again in v8.
- **Expected:** The skill should teach Claude how to use the CLI internally, but present results to the user in natural language.
- **Fix:** Onboarding/orchestrator skill should explicitly instruct Claude: "Use these commands to gather data. Present findings conversationally. Don't tell the user to run CLI commands unless they ask."
- **V8 confirmation:** P-14, P-16

---

#### O-34: Doc-first discovery should detect doc drift and propose correction tasks `suggestion`
- **Where:** Discovery phase — doc ingestion + code review
- **What happened:** Docs drift from code over time. Ingesting stale docs without validation propagates misinformation.
- **Fix:** Two-pass discovery model: (1) Doc pass: ingest all docs as brain notes. (2) Code pass: when discrepancies are found (doc says X, code does Y), create a `supersedes` or `contradicts` relation and a `category: documentation` correction task.

---

#### O-35: Brain skill never triggered — agents default to CLI exploration `friction`
- **Where:** Test bench — agents go to `brain --help` instead of invoking the brain skill
- **What happened:** Every agent went straight to `brain --help` via Bash instead of invoking the brain skill. 0/8 agents used it in V2. Without the skill, every agent spends 3-5 tool calls on `--help` exploration before useful work.
- **Fix:** Ensure the brain skill is registered and visible in agent tool lists; skill description should match natural PM queries ("projects", "tasks", "backlog").

---

#### O-41: 33% of brain CLI calls are `--help` exploration `friction`
- **Where:** Onboarding sessions — agents spend many calls on help before useful work
- **What happened:** Agent called `brain --help`, `pm --help`, `pm setup --help`, `pm init --help`, `pm workstream --help`, etc. before doing useful work. The orchestrator skill was installed but never triggered.
- **Fix:** The orchestrator skill must either be auto-triggered by the session hook or be discoverable enough that agents use it before resorting to `--help` chains. Related to O-35.

---

#### O-42: Briefing never exercised during onboarding — agent recommends but doesn't run it `suggestion`
- **Where:** Onboarding session — agent's final step
- **What happened:** After creating tasks, agents raw-list tasks and recommend `brain pm briefing` to the user without running it themselves. The `--verbose` flag added by O-19 fix is never tested.
- **Fix:** The orchestrator skill should instruct agents to use `briefing --verbose` for project summaries. Could also have the session hook auto-run briefing when a project exists.

---

#### O-46: Strategic planning doc never surfaced to any agent `suggestion`
- **Where:** `voltras-workspace/game-plan.md` (25KB)
- **What happened:** The workspace root contains a strategic planning document that no agent was directed to read and no agent independently discovered.
- **Fix:** The onboarding workflow should survey workspace-root docs and include relevant strategic context in sub-agent prompts. Related to O-33.

---

#### O-60: `--workstream` takes integer, not name or display_id `friction`
- **Where:** `brain pm task add --workstream`, `brain pm tasks --workstream`
- **What happened:** `--workstream` requires an integer ID. Workstream display IDs (`VOLT-01`) and names are not accepted. Confirmed again in v9 — name-based lookup still not supported. (Note: `task add --workstream` now accepts display IDs per O-91 fix, but other commands still require integer.)
- **Fix:** Add display_id and name-based acceptance to all `--workstream` flag parsing across all commands.
- **V9 confirmation:** P-14, P-26

---

### Docs & Process

#### O-01: Docs don't clarify where to run commands from `docs`
- **Where:** quickstart.md prerequisites
- **What happened:** User's first question was "should I be in the project directory?" Docs don't clarify that brain is a global tool with a single database — commands work from any directory, unlike git.
- **Fix:** Add a note in prerequisites or step 1 clarifying this.

---

#### O-10: `brain list` doesn't exist — agent expected it `docs`
- **Where:** Agent tried `brain list` (should be `brain pm list`)
- **What happened:** `error: unknown command 'list'`. The agent's mental model was that top-level brain commands would include project listing.
- **Fix:** The skill/docs should make the `pm` namespace obvious. Not worth adding an alias.

---

#### O-38: `brain reset` doesn't clean up PM hooks, skills, or settings.json entries `docs`
- **Where:** `src/commands/reset.ts`
- **What happened:** After `brain reset --confirm`, the 3 hook scripts (`~/.claude/hooks/brain-pm-*.sh`), the orchestrator skill, and hook entries in `~/.claude/settings.json` all persist. Stale hooks point at a non-existent database.
- **Fix:** Option 1: Add PM cleanup to `reset`. Option 2: New `brain pm teardown` command. Option 3: Hooks check for brain init state before executing.

---

#### O-71: `pm check --deep sourceDocuments` is a stub `friction`
- **Where:** `brain pm check --deep sourceDocuments`
- **What happened:** The command runs but returns no actionable output. The deep source document check is not implemented.
- **Fix:** Implement the source document integrity check or remove the option from `--help` until implemented.

---

#### O-117: `brain pm briefing --full` referenced in pm-onboard skill document but flag doesn't exist `docs`
- **Where:** pm-onboard skill — final step instruction
- **What happened:** The pm-onboard skill SKILL.md instructs agents to run `brain pm briefing --full` as the final onboarding step. The `--full` flag does not exist on the briefing command (exit code 1). Agents fall back to `brain pm briefing` and succeed, but the skill document is incorrect.
- **Fix:** Option 1 (preferred): alias `--full` to `--verbose` in the briefing command. Option 2: update the skill document to use `brain pm briefing --verbose`.
- **Test bench evidence:** session-audit (v9)

---

#### O-124: `depends_on` direction anomaly — VOLT-02.04 depends on VOLT-02.07 `docs`
- **Where:** data-audit — VOLT-02 workstream dependency data
- **What happened:** Task VOLT-02.04 has `depends_on: ['VOLT-02.07']`, meaning a lower-numbered task depends on a higher-numbered task. This is a back-reference that may be intentional (exploration engine depends on profile fitting API) but warrants review.
- **Fix:** Verify the intended dependency direction for VOLT-02.04 and VOLT-02.07. Consider adding a `brain pm check --deps` validation that flags back-references as warnings for human review.
- **Test bench evidence:** data-audit (v9)

---

#### O-129: Observations registry ends at O-74 — O-75 through O-107 not in canonical file `docs`
- **Where:** `docs/pm-module/onboarding-observations.md` — master punch list
- **What happened:** The observations registry ends at O-74. The v8 diagnostic produced 33 new observations (O-75 through O-107) documented in `diagnostic/v8/observations.md` but never backfilled into the canonical registry.
- **Fix:** This file (`onboarding-observations-v2.md`) resolves O-129 by serving as the new canonical registry for all observations O-01 through O-129+.
- **Test bench evidence:** gap-analysis (v9)
