# PM Module Observations Registry v3 (Canonical)

**Supersedes:** `onboarding-observations-v2.md` (O-01 through O-129)
**Last updated:** 2026-03-02
**Covers:** O-01 through O-212
**Total observations:** 212

This is the single source of truth for all PM module observations. V12 definitions are canonical for O-130+. V10-only and V11-only observations that are unique and still relevant are assigned IDs O-161+.

---

## Versioning History

| Range | Source | Cycle |
|-------|--------|-------|
| O-01 -- O-74 | `onboarding-observations.md` | Original + V2 test bench |
| O-75 -- O-107 | `diagnostic/v8/observations.md` | V8 diagnostic cycle |
| O-108 -- O-129 | `diagnostic/v9/observations.md` | V9 diagnostic cycle |
| O-130 -- O-160 | `diagnostic/v12/observations.md` | V12 diagnostic cycle (canonical for 130+) |
| O-161 -- O-194 | `diagnostic/v10/observations.md` | V10-unique observations reassigned |
| O-195 -- O-212 | `diagnostic/v11/observations.md` | V11-unique observations reassigned |

**ID conflict note:** O-130+ were independently defined in V10, V11, and V12 diagnostics with different meanings. This registry resolves the conflict by using V12 as canonical and reassigning unique V10/V11 observations to O-161+. See the ID Mapping section at the end of this file.

---

## Resolved Observations

| ID | Severity | Resolved In | Summary |
|----|----------|-------------|---------|
| O-03 | blocker | v1-fix | PM module not loaded from npm install |
| O-04 | suggestion | v1-fix | No way to reset brain |
| O-05 | friction | v2-verified | `pm init` output shows project name correctly |
| O-09 | blocker | v2-verified | `pm use` makes `--project` optional |
| O-11 | friction | v2-verified | `pm init` auto-sets active project |
| O-17 | friction | v2-verified | Task/workstream list shows names/titles |
| O-18 | friction | v1-fix | Briefing capped at top 5; `--verbose` added |
| O-19 | suggestion | v1-fix | `briefing --verbose` provides comprehensive summary |
| O-36 | blocker | v2-verified | Title field added to metadata interfaces |
| O-39 | friction | v3-fixed | `workstream add` output shows name |
| O-40 | friction | v3-fixed | `pm status` shows workstream count, task counts |
| O-50 | blocker | v3-fixed | `pm context` returns rich output |
| O-51 | friction | v3-fixed | `pm dispatch` returns full agent prompt |
| O-52 | bug | v3-fixed | `pm verify` crash fixed |
| O-54 | friction | v3-fixed | `task show` returns structured metadata |
| O-55 | friction | v3-fixed | `task list` has filter flags |
| O-57 | friction | v3-fixed | Claim output shows token (regression: see O-166) |
| O-58 | friction | v3-fixed | `--start` flag on claim |
| O-59 | friction | v3-fixed | `release` works from in-progress |
| O-61 | blocker | v3-fixed | State machine errors list valid transitions |
| O-62 | friction | v3-fixed | `pm complete` auto-walks state machine |
| O-63 | friction | v3-fixed | `pm next` sorts by priority (regression: see O-130) |
| O-64 | blocker | v3-fixed | `pm context` text output enriched |
| O-65 | friction | v3-fixed | Context hash removed from human output |
| O-66 | friction | v3-fixed | `pm audit` has `--task` filter |
| O-67 | blocker | v3-fixed | `orchestrate render` auto-generates instructions |
| O-68 | blocker | v3-fixed | `--include-tasks` flag on `brain search` |
| O-70 | friction | v3-fixed | `brain notes list` command added |
| O-73 | friction | v3-fixed | `task list` has `--search` keyword filter |
| O-75 | friction | v9-verified | `brain pm context VW` works |
| O-76 | friction | v9-verified | `brain pm project show/list` works |
| O-79 | friction | v9-verified | Briefing shows top eligible tasks |
| O-80 | suggestion | v9-verified | `brain pm ls` alias works |
| O-83 | friction | v9-verified | `--full` flag working (regression: see O-188) |
| O-85 | friction | v9-verified | did-you-mean suggestions work |
| O-88 | friction | v9-verified | `brain pm project list` works |
| O-91 | friction | v9-verified | `task add --workstream` accepts display IDs |
| O-97 | friction | v9-verified | `brain pm tasks --json` works |
| O-102 | blocker | v9-verified | Component-aware slug generation |
| O-103 | friction | v9-verified | Project note body populated (regression: see O-165) |
| O-113 | blocker | v12-verified | Task list text formatter fixed -- display IDs show correctly |
| O-129 | docs | v2-registry | Observations backfilled into v2 registry |

---

## Open Observations

### Navigation & Output

| ID | Sev | First | Last | Title |
|----|-----|-------|------|-------|
| O-02 | friction | orig | v2 | `brain init` output is technical, not welcoming |
| O-77 | friction | v8 | v9 | `workstream show` sparse output or 'too many arguments' |
| O-78 | friction | v8 | v8 | `brain pm audit` not filterable by project |
| O-81 | friction | v8 | v8 | Stale project prefix in workstream filter error template |
| O-92 | friction | v8 | v10 | `brain pm waves` missing summary line and workstream labels |
| O-93 | friction | v8 | v8 | `brain pm verify` generates generic steps, ignores ACs |
| O-96 | friction | v8 | v12 | `brain pm tasks` alias covers `list` only |
| O-98 | friction | v8 | v12 | Project name-substring lookup not supported |
| O-109 | friction | v9 | v12 | `brain pm briefing` renders blocked tasks as `[object Object]` |
| O-111 | friction | v9 | v9 | `brain notes list` silent truncation at 50 |
| O-116 | friction | v9 | v9 | `brain search --json` empty metadata for PM notes |
| O-118 | friction | v9 | v9 | `brain index` runs silently with no output |
| O-126 | friction | v9 | v9 | `brain memories` errors without subcommand |
| O-127 | friction | v9 | v11 | Inconsistent token enforcement across state transitions |
| O-130 | friction | v12 | v12 | `brain pm next` truncates with no `--all` flag |
| O-131 | friction | v12 | v12 | `brain pm show <id>` command doesn't exist |
| O-133 | friction | v12 | v12 | `brain pm task <id>` shorthand fails without `show` |
| O-134 | friction | v12 | v12 | `brain pm waves` lacks `--workstream` filter |
| O-135 | friction | v12 | v12 | No single command for top task in a workstream |
| O-137 | friction | v12 | v12 | `--format json` silently fails with misleading error |
| O-138 | friction | v12 | v12 | No bulk blocker lookup -- N+1 calls for blocked status |
| O-139 | friction | v12 | v12 | `task show VOLT-01` says NOT_FOUND without workstream hint |
| O-141 | friction | v12 | v12 | Search snippet truncation destroys ASCII diagrams |
| O-142 | friction | v12 | v12 | `brain pm waves VOLT` silently exits with code 1 |
| O-143 | friction | v12 | v12 | `brain pm claim` not at top level (inconsistent with `complete`) |
| O-145 | friction | v12 | v12 | `brain pm waves list --workstream` returns empty exit 0 |
| O-150 | friction | v12 | v12 | No `--group-by workstream` option on tasks |
| O-151 | friction | v12 | v12 | `brain pm context` returns own note as top related result |
| O-154 | friction | v12 | v12 | `brain context` returns empty output for PM notes |

**V10-unique (reassigned):**

| ID | Sev | First | Title |
|----|-----|-------|-------|
| O-161 | blocker | v10 | `brain memories` crashes with stack overflow |
| O-162 | blocker | v10 | `brain pm waves --json` returns empty/broken output |
| O-163 | blocker | v10 | `virtualStates` shows +ELIGIBLE for tasks with unmet deps |
| O-164 | blocker | v10 | `brain pm onboard` ingests brain-repo docs into target project |
| O-165 | friction | v10 | Project note stale/wrong after multi-phase onboard (O-103 regression) |
| O-166 | friction | v10 | Claim token not shown in human-readable output (O-57 regression) |
| O-167 | friction | v10 | `brain pm tasks --project` is case-sensitive |
| O-168 | friction | v10 | Onboard manifest stores bare names, not workspace-relative paths |
| O-169 | friction | v10 | `--search` full body match causes high false-positive rate |
| O-170 | friction | v10 | `brain memories --container` returns empty for PM projects |
| O-171 | friction | v10 | `task done` vs `complete` overlapping/unclear responsibilities |
| O-172 | friction | v10 | Task JSON identifier field is `display_id`, not `id` |
| O-173 | friction | v10 | No `brain pm task reopen` command |
| O-174 | friction | v10 | `brain pm status` has no `--project` flag |
| O-175 | friction | v10 | VOLT-03 circular/paradoxical dependency graph |
| O-176 | friction | v10 | `blocked_by` field semantics are inverted |
| O-177 | friction | v10 | 3 PM tasks not indexed via `brain search --include-tasks` |
| O-178 | friction | v10 | `blocked_by` in task JSON not reflected in `brain pm context` deps |
| O-179 | friction | v10 | `brain ingest` has no `--recursive` flag |
| O-180 | friction | v10 | `brain pm task add` produces no output without `--json` |
| O-181 | friction | v10 | `dispatch` and `context` produce near-identical output |
| O-182 | friction | v10 | Task `Ref:` field lists directory paths, not files |
| O-183 | friction | v10 | `--deps` flag on `brain pm context` accepted but has no effect |
| O-184 | friction | v10 | `brain pm dispatch` has no `--json` output mode |
| O-185 | friction | v10 | Near-duplicate docs indexed without graph relations |
| O-186 | friction | v10 | Wave output stale after task status changes in session |
| O-187 | friction | v10 | `brain notes --module` only works on `notes list` subcommand |
| O-188 | friction | v10 | `brain pm task list --full` has no visible effect (O-83 regression) |
| O-189 | friction | v10 | `brain pm context` did-you-mean still exits 1 |
| O-190 | friction | v10 | PM task notes appear in default `brain search` (O-72 cont.) |
| O-191 | friction | v10 | `brain pm projects list` (plural) fails |
| O-192 | friction | v10 | Wave 0 tasks appear unlabeled |

**V11-unique (reassigned):**

| ID | Sev | First | Title |
|----|-----|-------|-------|
| O-195 | blocker | v11 | `--status blocked` matches stored status, not virtual state |
| O-196 | blocker | v11 | `--status all --json` returns empty array |
| O-197 | friction | v11 | `displayId` null in task list JSON without `--full` |
| O-198 | friction | v11 | Project `name` field null in `brain pm list --json` |
| O-199 | friction | v11 | Waves JSON schema inconsistent with tasks JSON |
| O-200 | friction | v11 | `relatedNotes` objects have no `noteId` field |
| O-201 | friction | v11 | `workstreamDescription` empty in context JSON |
| O-202 | friction | v11 | `--full --json` body field empty for some tasks |
| O-203 | friction | v11 | `modified` timestamp format inconsistency (ISO vs date string) |
| O-204 | friction | v11 | `briefing` defaults to most-recently-created project, not active |
| O-205 | friction | v11 | `workstream list` ignores active project |
| O-206 | friction | v11 | Ghost project from failed onboard with no cleanup path |
| O-207 | friction | v11 | Projects with identical display names, no disambiguation |
| O-208 | friction | v11 | `brain graph` doesn't follow incoming edges |
| O-209 | friction | v11 | Workstream-level `brain pm context` returns zero relatedNotes |
| O-210 | friction | v11 | `acceptance_criteria` structured field always empty |

### Context & Relations

| ID | Sev | First | Last | Title |
|----|-----|-------|------|-------|
| O-25 | friction | orig | v12 | Architecture notes orphaned -- no relations to PM tasks |
| O-45 | friction | orig | orig | Notes with zero relations -- no cross-repo cross-references |
| O-56 | friction | v2 | v12 | `brain graph` returns no edges for any note |
| O-86 | friction | v8 | v12 | `brain context` rejects PM note paths |
| O-87 | friction | v8 | v12 | `brain pm context <workstream-id>` returns NOT_FOUND |
| O-90 | friction | v8 | v12 | `brain context <display_id>` fails silently |
| O-101 | friction | v8 | v8 | `brain pm context` has no `--json` output mode |
| O-122 | suggestion | v9 | v12 | No command to surface architecture notes for a workstream |
| O-123 | friction | v9 | v12 | `brain context` no semantic fallback for unlinked notes |
| O-146 | blocker | v12 | v12 | `brain pm context` Related Notes uses semantic similarity only, not relation graph |
| O-147 | friction | v12 | v12 | No inverse doc-to-tasks query |

### Task Management

| ID | Sev | First | Last | Title |
|----|-----|-------|------|-------|
| O-16 | friction | orig | v12 | No cross-workstream deps -- waves engine gives no signal (partial fix) |
| O-21 | suggestion | orig | orig | Dependency wiring should happen during creation |
| O-24 | friction | orig | orig | All tasks mode=auto -- orchestration can't differentiate |
| O-27 | friction | orig | v12 | Zero activities recorded during onboarding |
| O-43 | friction | orig | v8 | Category chaos -- no shared vocabulary across tasks |
| O-44 | friction | orig | orig | `task update --depends-on` doesn't exist |
| O-49 | friction | orig | v12 | PM task notes not indexed -- unsearchable via `brain search` |
| O-74 | friction | orig | v12 | Workstream names not embedded in task JSON |
| O-82 | friction | v8 | v12 | `--search` doesn't match acceptance criteria (body now searched) |
| O-84 | friction | v8 | v12 | Task JSON schema omits dependency fields |
| O-89 | friction | v8 | v12 | No planning or task-sequencing command |
| O-94 | friction | v8 | v12 | `brain pm complete` doesn't surface newly unblocked tasks |
| O-95 | friction | v8 | v8 | `brain pm task block` has no `--reason` option |
| O-99 | friction | v8 | v12 | No temporal dimension in PM data model |
| O-100 | friction | v8 | v12 | `--search` defaults to pending-only |
| O-108 | blocker | v9 | v12 | Wave computation ignores declared dependencies |
| O-110 | friction | v9 | v12 | `--workstream` filter non-functional (numeric; display_id partially fixed) |
| O-114 | friction | v9 | v12 | `brain pm complete` returns `newlyEligible: []` |
| O-115 | friction | v9 | v12 | Invalid filter values silently return empty |
| O-120 | friction | v9 | v9 | Task search provides no relevance scores |
| O-121 | friction | v9 | v9 | Workstream JSON missing `display_id` and `slug` |
| O-128 | friction | v9 | v9 | No `--body` flag on `task add` |
| O-136 | friction | v12 | v12 | `--search` only searches active project |
| O-148 | friction | v12 | v12 | No CLI command to query notes without PM task links |
| O-149 | friction | v12 | v12 | `brain pm check` reports "No issues" despite zero doc-task links |
| O-152 | docs | v12 | v12 | `--search` help says title-only but behavior searches body |
| O-159 | blocker | v12 | v12 | `brain pm complete` doesn't create activity notes |

### Onboarding & Discovery

| ID | Sev | First | Last | Title |
|----|-----|-------|------|-------|
| O-06 | friction | orig | orig | No Claude-assisted onboarding path exists |
| O-07 | friction | orig | v8 | Agent spends many tool calls building context |
| O-22 | suggestion | orig | orig | Onboarding should ask about external docs |
| O-28 | friction | orig | v12 | Discovery agents code-first, not doc-first |
| O-30 | suggestion | orig | orig | No doc manifest presented before discovery |
| O-31 | friction | orig | v12 | Task backlog has zero feature work |
| O-32 | suggestion | orig | orig | Investigation docs should generate research tasks |
| O-33 | friction | orig | v12 | Cross-repo coordination docs not ingested |
| O-47 | friction | orig | orig | voltra-private only 33% doc coverage |
| O-48 | suggestion | orig | orig | `docs/plans/` subdirectories not scanned |
| O-104 | friction | v8 | v12 | Brain project not self-ingested -- 0% doc coverage |
| O-105 | friction | v8 | v8 | `brain pm onboard --path` option doesn't exist |
| O-106 | suggestion | v8 | v8 | `brain pm onboard` lacks `--dry-run` mode |
| O-119 | friction | v9 | v9 | `brain pm onboard` misses repos in subdirectories |
| O-125 | suggestion | v9 | v9 | Empty task subdirectories created at onboarding |
| O-132 | friction | v12 | v12 | `brain profile` with 0 memories returns near-empty result |

### Search

| ID | Sev | First | Last | Title |
|----|-----|-------|------|-------|
| O-53 | friction | orig | v12 | Search-loop inflation -- agents run many searches for context |
| O-69 | friction | orig | v9 | No workstream-scoped search |
| O-72 | friction | orig | v12 | No unified cross-domain search -- PM/KB partially siloed |
| O-107 | friction | v8 | v12 | `brain search` has no note type filter |
| O-112 | friction | v9 | v9 | `brain search --memories` changes JSON schema |

### Agent Experience

| ID | Sev | First | Last | Title |
|----|-----|-------|------|-------|
| O-08 | suggestion | orig | orig | Agent wanted demo project before real one |
| O-12 | suggestion | orig | orig | Workstream-per-repo vs workstream-per-feature gap |
| O-15 | suggestion | orig | orig | Sub-agent-per-repo pattern -- codify as standard |
| O-20 | friction | orig | v8 | Agent surfaces CLI commands user won't run |
| O-34 | suggestion | orig | orig | Doc-first discovery should detect doc drift |
| O-35 | friction | orig | orig | Brain skill never triggered -- agents default to CLI |
| O-41 | friction | orig | orig | 33% of CLI calls are `--help` exploration |
| O-42 | suggestion | orig | orig | Briefing never exercised during onboarding |
| O-46 | suggestion | orig | orig | Strategic planning doc never surfaced to any agent |
| O-60 | friction | orig | v9 | `--workstream` takes integer, not name or display_id |

### Docs & Process

| ID | Sev | First | Last | Title |
|----|-----|-------|------|-------|
| O-01 | docs | orig | orig | Docs don't clarify where to run commands from |
| O-10 | docs | orig | orig | `brain list` doesn't exist -- agent expected it |
| O-38 | docs | orig | orig | `brain reset` doesn't clean up PM hooks/skills |
| O-71 | friction | orig | orig | `pm check --deep sourceDocuments` is a stub |
| O-117 | docs | v9 | v10 | `briefing --full` in skill doc doesn't exist |
| O-124 | docs | v9 | v9 | `depends_on` direction anomaly in VOLT-02 |

### Suggestions (V12)

| ID | Sev | First | Last | Title |
|----|-----|-------|------|-------|
| O-140 | suggestion | v12 | v12 | No structured `files` field on tasks |
| O-144 | suggestion | v12 | v12 | `brain pm dispatch` requires mandatory id -- no autonomous mode |
| O-155 | friction | v12 | v12 | No aggregate PM health stats in CLI |
| O-156 | suggestion | v12 | v12 | No `brain pm project rm` command |
| O-157 | suggestion | v12 | v12 | PM notes have zero tags |
| O-158 | suggestion | v12 | v12 | Task notes single-chunk -- ACs not separately searchable |
| O-160 | suggestion | v12 | v12 | No `brain pm init --scaffold` for starter structure |

### Suggestions (V10-unique, reassigned)

| ID | Sev | First | Title |
|----|-----|-------|-------|
| O-193 | suggestion | v10 | `brain pm onboard --self` mode for brain's own docs |
| O-194 | suggestion | v10 | Component analysis prompt uses fragile `cat` fallback |

### Suggestions (V11-unique, reassigned)

| ID | Sev | First | Title |
|----|-----|-------|-------|
| O-211 | suggestion | v11 | No `brain pm docs list` command |
| O-212 | suggestion | v11 | No bulk task/workstream import |

---

## Deferred Observations

None currently deferred. All open observations are active.

---

## Potential Duplicates

These observation pairs describe overlapping or closely related issues:

| Pair | Relationship |
|------|-------------|
| O-94 / O-114 | Both cover `newlyEligible: []` -- O-94 is the original, O-114 is the specific regression |
| O-72 / O-190 | O-72 is cross-domain search isolation; O-190 is specific leakage of PM notes |
| O-57 / O-166 | O-57 resolved then regressed; O-166 tracks the regression |
| O-63 / O-130 | O-63 resolved then regressed; O-130 tracks the regression |
| O-83 / O-188 | O-83 resolved then regressed; O-188 tracks the regression |
| O-103 / O-165 | O-103 resolved then regressed; O-165 tracks the regression |
| O-86 / O-208 | Both involve graph/context path resolution failures |
| O-174 / v11-O-144 | Both cover `pm status` missing `--project` flag (consolidated into O-174) |
| O-146 / O-122 / O-123 | All three relate to how related notes are surfaced (graph vs semantic) |
| O-163 / O-195 | Both cover virtual state / blocked status computation errors |
| O-156 / O-206 | Both cover project deletion/cleanup -- O-156 is the feature request, O-206 is the scenario |
| O-131 / O-133 | Both cover missing navigation shortcuts (`pm show`, `pm task <id>`) |

---

## ID Mapping

Maps V10 and V11 local IDs to their canonical V3 IDs. Use this table to interpret references in old diagnostic files.

### V10 ID Mapping

| V10 ID | V3 ID | Disposition |
|--------|-------|-------------|
| v10-O-130 | **O-161** | Reassigned (memories stack overflow) |
| v10-O-131 | **O-162** | Reassigned (waves --json broken) |
| v10-O-132 | **O-163** | Reassigned (virtualStates +ELIGIBLE for blocked tasks) |
| v10-O-133 | **O-164** | Reassigned (onboard ingests brain-repo docs) |
| v10-O-134 | **O-165** | Reassigned (project note stale after onboard) |
| v10-O-135 | O-142 | Duplicate of V12 (waves project arg fails) |
| v10-O-136 | **O-166** | Reassigned (claim token not in text output) |
| v10-O-137 | O-130 | Duplicate of V12 (pm next truncates) |
| v10-O-138 | **O-167** | Reassigned (--project case-sensitive) |
| v10-O-139 | **O-168** | Reassigned (onboard manifest bare names) |
| v10-O-140 | **O-169** | Reassigned (--search false positives) |
| v10-O-141 | **O-170** | Reassigned (memories --container empty) |
| v10-O-142 | **O-171** | Reassigned (task done vs complete ambiguity) |
| v10-O-143 | **O-172** | Reassigned (task JSON id field) |
| v10-O-144 | **O-173** | Reassigned (no task reopen) |
| v10-O-145 | **O-174** | Reassigned (pm status no --project) |
| v10-O-146 | **O-175** | Reassigned (VOLT-03 circular deps) |
| v10-O-147 | **O-176** | Reassigned (blocked_by semantics inverted) |
| v10-O-148 | **O-177** | Reassigned (3 tasks not indexed) |
| v10-O-149 | **O-178** | Reassigned (blocked_by not in context deps) |
| v10-O-150 | O-133 | Duplicate of V12 (task shorthand lookup) |
| v10-O-151 | **O-179** | Reassigned (ingest no --recursive) |
| v10-O-152 | **O-180** | Reassigned (task add silent) |
| v10-O-153 | **O-181** | Reassigned (dispatch vs context identical) |
| v10-O-154 | **O-182** | Reassigned (Ref field uses directories) |
| v10-O-155 | **O-183** | Reassigned (--deps flag no effect) |
| v10-O-156 | **O-184** | Reassigned (dispatch no --json) |
| v10-O-157 | **O-185** | Reassigned (near-duplicate docs no relations) |
| v10-O-158 | **O-186** | Reassigned (wave output stale) |
| v10-O-159 | **O-187** | Reassigned (notes --module subcommand only) |
| v10-O-160 | **O-188** | Reassigned (--full flag no effect) |
| v10-O-161 | **O-189** | Reassigned (did-you-mean still exits 1) |
| v10-O-162 | **O-190** | Reassigned (PM notes in default search) |
| v10-O-163 | **O-191** | Reassigned (projects plural fails) |
| v10-O-164 | **O-192** | Reassigned (Wave 0 unlabeled) |
| v10-O-165 | **O-193** | Reassigned (onboard --self suggestion) |
| v10-O-166 | **O-194** | Reassigned (component analysis prompt fragile) |

### V11 ID Mapping

| V11 ID | V3 ID | Disposition |
|--------|-------|-------------|
| v11-O-130 | O-110 | Merged (extends workstream filter scope to display_id form) |
| v11-O-131 | **O-195** | Reassigned (--status blocked vs virtual state) |
| v11-O-132 | **O-196** | Reassigned (--status all --json empty) |
| v11-O-133 | O-133 | Duplicate of V12 (task shorthand / display_id search) |
| v11-O-134 | **O-197** | Reassigned (displayId null without --full) |
| v11-O-135 | **O-198** | Reassigned (project name null in list JSON) |
| v11-O-136 | **O-199** | Reassigned (waves JSON schema inconsistent) |
| v11-O-137 | **O-200** | Reassigned (relatedNotes no noteId) |
| v11-O-138 | **O-201** | Reassigned (workstreamDescription empty) |
| v11-O-139 | **O-202** | Reassigned (--full --json body empty some tasks) |
| v11-O-140 | **O-203** | Reassigned (modified timestamp format) |
| v11-O-141 | **O-204** | Reassigned (briefing defaults wrong project) |
| v11-O-142 | **O-205** | Reassigned (workstream list ignores active project) |
| v11-O-143 | O-130 | Duplicate of V12 (next silently truncates) |
| v11-O-144 | O-174 | Duplicate of V10 (pm status no --project) |
| v11-O-145 | O-142 | Duplicate of V12 (waves no-project error) |
| v11-O-146 | **O-206** | Reassigned (ghost project, no cleanup) |
| v11-O-147 | **O-207** | Reassigned (duplicate project names) |
| v11-O-148 | **O-208** | Reassigned (graph no incoming edges) |
| v11-O-149 | **O-209** | Reassigned (workstream context zero relatedNotes) |
| v11-O-150 | O-86 | Duplicate (graph rejects search paths -- same as O-86) |
| v11-O-151 | **O-210** | Reassigned (acceptance_criteria always empty) |
| v11-O-152 | **O-211** | Reassigned (no pm docs list command) |
| v11-O-153 | **O-212** | Reassigned (no bulk import) |
