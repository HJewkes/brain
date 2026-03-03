# PM Module Test Bench Results — V6

**Date:** 2026-02-28
**Agent model:** claude-sonnet-4-6
**Prompts run:** 30 of 30

---

## Aggregate Metrics

| Metric | v5 (30p) | v6 (30p) | Delta |
|--------|----------|----------|-------|
| Total tool calls | 464 | **510** | **+9.9%** |
| Avg calls per prompt | 15.5 | **17.0** | **+1.5** |
| Brain CLI % | 95% | **94%** | **-1.0pp** |
| Direct file reads | 0 | **0** | flat |
| Non-brain calls | 32 | **42** | **+10.0** |
| Avg quality | 3.5/5 | **3.5/5** | **-0.1** |
| Prompts at 5/5 | 5/30 | **4/30** | **-1.0** |
| Prompts at <=3/5 | 14/30 | **15/30** | **+1.0** |

---

## Full Scorecard

| Prompt | Category | v5 Calls | v6 Calls | v5 Brain% | v6 Brain% | v5 Reads | v6 Reads | v5 Q | v6 Q |
|--------|----------|----------|----------|-----------|-----------|----------|----------|------|------|
| P-01 | Discovery | 8 | **7** | 100% | **100%** | 0 | **0** | 4/5 | **5/5** |
| P-02 | Discovery | 23 | **20** | 96% | **90%** | 0 | **0** | 4/5 | **4/5** |
| P-03 | Discovery | 39 | **26** | 100% | **92%** | 0 | **0** | 3/5 | **3/5** |
| P-04 | Navigation | 8 | **12** | 100% | **100%** | 0 | **0** | 5/5 | **4/5** |
| P-05 | Navigation | 15 | **17** | 93% | **100%** | 0 | **0** | 2/5 | **3/5** |
| P-06 | Navigation | 12 | **8** | 92% | **75%** | 0 | **0** | 5/5 | **4/5** |
| P-07 | Navigation | 13 | **5** | 85% | **100%** | 0 | **0** | 4/5 | **5/5** |
| P-08 | Context | 27 | **22** | 100% | **91%** | 0 | **0** | 2/5 | **2/5** |
| P-09 | Context | 14 | **13** | 100% | **100%** | 0 | **0** | 4/5 | **4/5** |
| P-10 | Context | 23 | **50** | 100% | **94%** | 0 | **0** | 2/5 | **2/5** |
| P-11 | Planning | 18 | **22** | 94% | **100%** | 0 | **0** | 3/5 | **3/5** |
| P-12 | Planning | 19 | **24** | 100% | **100%** | 0 | **0** | 3/5 | **3/5** |
| P-13 | Planning | 18 | **21** | 89% | **95%** | 0 | **0** | 4/5 | **4/5** |
| P-14 | Capabilities | 9 | **11** | 100% | **100%** | 0 | **0** | 3/5 | **4/5** |
| P-15 | Capabilities | 8 | **5** | 88% | **80%** | 0 | **0** | 4/5 | **5/5** |
| P-16 | Capabilities | 19 | **28** | 100% | **96%** | 0 | **0** | 4/5 | **4/5** |
| P-17 | Gap Exercise | 5 | **4** | 100% | **100%** | 0 | **0** | 5/5 | **5/5** |
| P-18 | Gap Exercise | 3 | **8** | 100% | **100%** | 0 | **0** | 5/5 | **4/5** |
| P-19 | Gap Exercise | 24 | **24** | 96% | **96%** | 0 | **0** | 3/5 | **3/5** |
| P-20 | Gap Exercise | 14 | **21** | 93% | **90%** | 0 | **0** | 3/5 | **3/5** |
| P-21 | Write Ops | 15 | **14** | 93% | **93%** | 0 | **0** | 4/5 | **2/5** |
| P-22 | Write Ops | 9 | **9** | 100% | **89%** | 0 | **0** | 4/5 | **4/5** |
| P-23 | Write Ops | 12 | **15** | 100% | **100%** | 0 | **0** | 3/5 | **3/5** |
| P-24 | Agent Cmds | 21 | **10** | 86% | **100%** | 0 | **0** | 2/5 | **3/5** |
| P-25 | Agent Cmds | 19 | **21** | 95% | **90%** | 0 | **0** | 2/5 | **2/5** |
| P-26 | Cross-System | 25 | **20** | 88% | **95%** | 0 | **0** | 3/5 | **3/5** |
| P-27 | Cross-System | 16 | **32** | 88% | **84%** | 0 | **0** | 3/5 | **2/5** |
| P-28 | Filtering | 5 | **5** | 80% | **100%** | 0 | **0** | 5/5 | **4/5** |
| P-29 | Filtering | 14 | **22** | 100% | **91%** | 0 | **0** | 4/5 | **3/5** |
| P-30 | Filtering | 9 | **14** | 100% | **86%** | 0 | **0** | 4/5 | **4/5** |

---

## Per-Prompt Analysis


### Discovery

#### P-01: "What projects am I tracking?"

| Metric | Previous | Current |
|--------|----------|---------|
| Total calls | 8 | **7** |
| Brain CLI | 8 | **7** |
| Non-brain | 0 | **0** |
| File reads | 0 | **0** |
| Quality | 4/5 | **5/5** |

**Commands:** `brain pm tasks list` → `brain pm --help` → `brain pm list` → `brain pm status` → `brain pm status VOLTR` → `brain pm workstream list --project VOLTR` → `brain pm task list --project VOLTR`

**What worked:** brain pm list gave a clean one-line summary per project. brain pm status VOLTR gave a nice aggregate (workstreams, task counts, priority breakdown). brain pm workstream list and brain pm task list provided full detail with virtual state flags (+READY, +ELIGIBLE, +BLOCKED) inline.

**Friction:** brain pm status with no args failed with INVALID_INPUT despite 'brain pm list' showing VOLTR as (active) — the active context isn't being respected by the status command. Also 'brain pm tasks list' (alias) failed with 'too many arguments' before discovering the correct syntax 'brain pm task list'.

**Known gaps confirmed:** O-05, O-17

**New issues:**
- [medium] Active project context set by 'brain pm list' output (shows 'active') is not honoured by 'brain pm status' — requires explicit prefix argument
- [low] 'brain pm tasks list' alias rejects arguments ('too many arguments') but 'brain pm task list' works — alias and canonical command have inconsistent argument handling

---

#### P-02: "Give me an overview of the Voltras project — what's being tracked, how is it organized, and what's the current state?"

| Metric | Previous | Current |
|--------|----------|---------|
| Total calls | 23 | **20** |
| Brain CLI | 22 | **18** |
| Non-brain | 1 | **2** |
| File reads | 0 | **0** |
| Quality | 4/5 | **4/5** |

**Commands:** `brain pm tasks --project voltras` → `brain search "Voltras" --limit 10` → `brain pm tasks --project VOLTR` → `brain pm tasks` → `brain search "VOLTR project.md" --limit 3` → `brain pm tasks --project VOLTR --status blocked` → `brain pm tasks --project VOLTR --status in_progress` → `brain pm tasks --project VOLTR --status done` → `brain pm tasks --project VOLTR --status skipped` → `brain pm tasks --project VOLTR --status cancelled` → `brain search "VOLTR workstream wave" --limit 5` → `brain pm waves --project VOLTR` → `brain context "/Users/hjewkes/brain/modules/pm/VOLTR/project.md"` → `brain search "VOLTR project overview goals" --limit 3` → `brain pm tasks --project VOLTR --workstream WS-01` → `brain pm tasks --project VOLTR --workstream WS-02` → `brain pm tasks --project VOLTR (piped to python3 stats)` → `brain search "Voltras BeyondPower SDK architecture" --limit 3` → `brain search "VOLTR workstream description protocol" --limit 5` → `brain pm tasks --project VOLTR (piped to python3 per-ws summary)` → `brain pm audit --project VOLTR` → `brain pm use VOLTR` → `brain pm audit summary` → `brain search "VOLTR components packages monorepo" --limit 4` → `brain search "voltras workspace onboard components detect" --limit 3` → `brain pm tasks --project VOLTR | wc -l`

**What worked:** `brain pm tasks --project VOLTR` was the single most useful command — returned all 41 tasks with status, priority, wave tags (+READY/+BLOCKED) in one shot,`brain pm waves --project VOLTR` cleanly showed the two-wave dependency structure without needing to parse task IDs manually,`brain search` with module-scoped results surfaced the onboard manifest (components table) and ingested docs (changelog, VBT spec, protocol overview) which filled in context the task list couldn't provide,The `--status blocked` filter on tasks quickly isolated the 9 Wave 1 blockers

**Friction:** No `brain pm project show VOLTR` or equivalent — there is no direct way to get a project-level description, goals, or summary. Had to infer product domain from task names + search results,No `brain pm workstream list --project VOLTR` command — workstream names/themes must be inferred by grouping task titles. The WS-0X numbering scheme carries no embedded label,The `--filter` flag does not exist on `brain pm tasks`; had to use `--status` instead (discovered via trial and error),`brain context` only works on slugs/IDs from the index, not raw file paths — returned 'note not found' for the project.md path from search results,`brain pm audit` requires the active project to be set via `brain pm use` first — `--project` flag is not supported on the audit subcommand,No `brain pm status` or dashboard command — assembling a current-state picture required 5+ separate commands and Python post-processing

**Known gaps confirmed:** O-17, O-18, O-19, O-16

**New issues:**
- [low] `brain pm tasks` accepts `--status` but not `--filter` — the option name is undiscoverable without reading help, and the help text does not list valid status values
- [medium] `brain context <path>` fails with 'note not found' when given a raw filesystem path returned by `brain search` — forces a two-step lookup (search → get slug → context) that is not obvious
- [medium] `brain pm audit` silently ignores `--project` flag and requires `brain pm use` to set active project first — inconsistent with other pm subcommands that accept `--project` directly

---

#### P-03: "I just joined this project. What's the most important context I need to get started?"

| Metric | Previous | Current |
|--------|----------|---------|
| Total calls | 39 | **26** |
| Brain CLI | 39 | **24** |
| Non-brain | 0 | **2** |
| File reads | 0 | **0** |
| Quality | 3/5 | **3/5** |

**Commands:** `brain profile` → `brain status` → `brain search "project overview getting started architecture" --memories` → `brain pm tasks --status open` → `brain pm --help` → `brain search "onboarding setup development workflow"` → `brain pm list` → `brain pm briefing` → `brain pm status VOLTR` → `brain pm waves` → `brain pm workstream list` → `brain pm next` → `brain pm task show VOLTR-01` → `brain search "VOLTR voltras what is this project" --container VOLTR` → `brain pm task show VOLTR-01.02` → `brain search "BeyondPower Voltra SDK architecture overview"` → `brain pm context VOLTR-01.02` → `brain pm task show VOLTR-01.02 --full` → `brain search "architecture components overview BLE SDK"` → `brain pm task --help` → `brain pm task show VOLTR-01.02 --detail` → `brain pm task show VOLTR-03.01` → `brain pm task show VOLTR-04.01` → `brain pm task show VOLTR-05.01` → `brain pm task show VOLTR-01.02 --json` → `brain pm task list --json | python3 (filter critical tasks)` → `brain search "monorepo repo structure packages"` → `brain pm project --help` → `brain search "Voltra device what does it do fitness"` → `brain pm task list --json | python3 (group by workstream)`

**What worked:** `brain pm briefing` gave the fastest project state snapshot (task counts, eligible, recommended next),`brain pm waves` showed all work organized by dependency layer — ideal for understanding what can start now,`brain pm workstream list` + `brain pm next` together gave a clear map of the 7 workstreams and their open work,`brain search` with topic queries found useful architecture/onboarding docs from ingested references,`brain pm task list --json | python3` enabled flexible filtering (critical tasks, grouping by workstream),`brain pm status VOLTR` gave a quick priority breakdown (5 critical, 22 high, 13 medium, 1 low)

**Friction:** `brain pm tasks --status open` failed with 'no active project' — requires `brain pm use <prefix>` first, but there's no hint of this in the error,`brain profile` was useless: '0 memories' extracted means no semantic profile was available — the richest onboarding signal was absent,`brain pm task show` text mode shows almost nothing (status/priority/category only) — no body, no description, no acceptance criteria,`--full` and `--detail` flags on `brain pm task show` don't exist — had to fall back to `--json` to discover body is empty,`brain pm task show VOLTR-01` (workstream-level ID) returns NOT_FOUND — need to use task-level IDs like `VOLTR-01.02`,Search returned design system docs prominently for generic queries like 'architecture overview' — PM workstream notes scored lower than SDK reference docs

**Known gaps confirmed:** O-25, O-07

**New issues:**
- [high] Task body/description field is empty for all tasks inspected (VOLTR-01.02 JSON shows `"body": ""`). Task titles are the only description available — insufficient for a new contributor to understand scope or acceptance criteria.
- [low] `brain pm tasks` (without subcommand) is not a valid command — the right command is `brain pm task list`. The plural form gives a cryptic error about active project rather than a usage hint.
- [medium] `brain pm context <id>` output is nearly identical to `brain pm task show <id>` — shows only status/priority/workstream with no body context assembled. Does not pull in related docs, architecture context, or linked notes.

---


### Navigation

#### P-04: "What are the critical priority tasks across all workstreams?"

| Metric | Previous | Current |
|--------|----------|---------|
| Total calls | 8 | **12** |
| Brain CLI | 8 | **12** |
| Non-brain | 1 | **0** |
| File reads | 0 | **0** |
| Quality | 5/5 | **4/5** |

**Commands:** `brain pm tasks --priority critical` → `brain pm list` → `brain pm use VOLTR && brain pm tasks --priority critical` → `brain pm workstreams` → `brain pm tasks --priority critical --all-workstreams` → `brain pm tasks --help` → `brain pm task list --help` → `brain pm task list --priority critical --json` → `brain pm task list --priority critical --status in-progress --json` → `brain pm task list --priority critical --status done --json` → `brain pm task show VOLTR-01.06` → `brain pm task show VOLTR-02.01`

**What worked:** brain pm task list --priority critical --json gave a clean, complete result in one call. The virtual states (+READY, +BLOCKED, +ELIGIBLE) were immediately useful for understanding actionability. Status filtering (--status) allowed quick verification that none were in-progress or done.

**Friction:** The active project was already set (VOLTR) but the first command failed with 'no active project' — this inconsistency required an extra `brain pm use VOLTR` step even though `brain pm list` showed it as active. Also had to discover --all-workstreams didn't exist before using --workstream-less task list, which added an extra call.

**Known gaps confirmed:** O-17

**New issues:**
- [medium] Active project shown in `brain pm list` as '(active)' but `brain pm tasks --priority critical` still errored with 'no active project set' — active project state not being respected on first invocation of the session
- [low] No cross-project critical task view — `--priority critical` only works within the active project; no way to query all projects at once without iterating manually

---

#### P-05: "What should I work on next in the Mobile App workstream?"

| Metric | Previous | Current |
|--------|----------|---------|
| Total calls | 15 | **17** |
| Brain CLI | 14 | **17** |
| Non-brain | 1 | **0** |
| File reads | 0 | **0** |
| Quality | 2/5 | **3/5** |

**Commands:** `brain pm --help` → `brain pm list` → `brain pm workstreams` → `brain pm workstream list` → `brain pm next --help` → `brain pm next --json` → `brain pm status` → `brain pm tasks --json | python3 (filter mobile/app tasks)` → `brain pm task list --json | python3 (WS6 detail)` → `brain pm context VOLTR-06.01` → `brain pm context VOLTR-06.01` → `brain pm briefing --json` → `brain pm next --json | python3 (WS6 in next, critical tasks)` → `brain pm next --json --limit 50 | python3 (WS6 eligible)` → `brain pm waves --json | python3 (WS6 wave placement)` → `brain pm task list --json | python3 (all WS6 full detail)` → `brain pm task list --json | python3 (check VOLTR-04.04 blocker)`

**What worked:** brain pm next --limit 50 with python pipe filtering by workstream number was effective for isolating WS6 eligible tasks. brain pm waves gave clear dependency ordering. brain pm task list --json provided complete task data including virtualStates and depends_on fields.

**Friction:** 1. No 'Mobile App' workstream exists — required inferring VOLTR-06 (Cross-platform Quality) as the intended target, which may be wrong. 2. brain pm next has a default limit of 10 that excluded all WS6 tasks; --limit 50 was needed. 3. brain pm context returned almost no useful content (just 3 lines: task title, status/priority, workstream name) — no description, no acceptance criteria, no related notes. 4. No workstream-scoped filter on brain pm next or brain pm task list commands.

**Known gaps confirmed:** O-16, O-09, O-26

**New issues:**
- [medium] brain pm next default limit of 10 silently excludes lower-priority workstreams. Users navigating to a specific workstream must know to pass --limit <large-number> and then filter manually. No --workstream filter flag exists.
- [high] brain pm context returns near-empty output (3 lines) for tasks — no description body, acceptance criteria, or linked notes. The command exists but provides no actionable context beyond what brain pm task list already shows.
- [medium] Workstream name mismatch: user asked for 'Mobile App' workstream but no such name exists. The CLI has no fuzzy/semantic workstream lookup — users must know the exact workstream name or ID.

---

#### P-06: "Show me all the testing-related tasks across the project"

| Metric | Previous | Current |
|--------|----------|---------|
| Total calls | 12 | **8** |
| Brain CLI | 11 | **6** |
| Non-brain | 4 | **2** |
| File reads | 0 | **0** |
| Quality | 5/5 | **4/5** |

**Commands:** `brain pm tasks list --filter '{"search":"test"}' 2>/dev/null | head -100` → `brain pm tasks list 2>/dev/null | head -100` → `brain pm tasks list --help 2>&1 | head -60` → `brain pm task list --help 2>&1 | head -60` → `brain pm task list --search "test" --json 2>/dev/null` → `brain pm task list --category "testing" --json 2>/dev/null` → `brain pm task list --category "testing" --json 2>/dev/null | python3 -c "...group by workstream..."` → `brain pm task list --category "testing" --json 2>/dev/null | python3 -c "...count blocked vs ready..."`

**What worked:** --category testing filter cleanly isolated all testing tasks in a single call. --json output made downstream analysis easy with python3 piped parsing. --search 'test' also worked but missed category-tagged tasks without 'test' in the title (e.g. 'Validate', 'Verify', 'Raise coverage') — category filter was more comprehensive.

**Friction:** Initial attempt used `brain pm tasks list --filter '{...}'` (plural 'tasks') which silently produced no output and no error, requiring a help lookup to discover the correct subcommand shape (`brain pm task list`). Two wasted calls before finding the right invocation.

**Known gaps confirmed:** O-23

**New issues:**
- [low] `brain pm tasks list` (plural alias) accepts flags silently but produces no output instead of delegating to `task list` or showing an error. Makes discovery harder.
- [medium] --search filter matches only title substrings, so testing tasks with titles like 'Validate', 'Verify', or 'Raise coverage' are missed unless you use --category. No cross-field search (title + category + tags).

---

#### P-07: "What tasks are blocked and what's blocking them?"

| Metric | Previous | Current |
|--------|----------|---------|
| Total calls | 13 | **5** |
| Brain CLI | 11 | **5** |
| Non-brain | 2 | **2** |
| File reads | 0 | **0** |
| Quality | 4/5 | **5/5** |

**Commands:** `brain pm tasks --filter blocked` → `brain pm tasks --help` → `brain pm task list --help` → `brain pm task list --status blocked --json` → `brain pm task list --json`

**What worked:** `brain pm task list --status blocked --json` was the key command — it correctly returned all tasks with the +BLOCKED virtual state in a single call. The `depends_on` array on each result immediately identified the blockers. A second full task list call with python3 inline parsing let me look up each blocker's title and status without any file reads.

**Friction:** 1. `brain pm tasks --filter blocked` failed with 'unknown option' — discovered the correct interface is `brain pm task list --status blocked`. 2. F-string escaping of `!r` in a shell-quoted python3 -c string caused a syntax error; had to use string concatenation instead.

**Known gaps confirmed:** O-16

**New issues:**
- [medium] `brain pm tasks` (alias) doesn't pass through any options to `task list` — only `--help` works. Options like `--status`, `--json`, `--project` all fail with 'unknown option'. The alias is a dead end for any filtered query.

---


### Context Assembly

#### P-08: "Brief me on task VOLT-01.01 — what needs to happen, what's the context, and what files are involved?"

| Metric | Previous | Current |
|--------|----------|---------|
| Total calls | 27 | **22** |
| Brain CLI | 27 | **20** |
| Non-brain | 3 | **4** |
| File reads | 0 | **0** |
| Quality | 2/5 | **2/5** |

**Commands:** `brain pm tasks --id VOLT-01.01` → `brain pm tasks list` → `brain pm tasks --help` → `brain pm task --help` → `brain pm task show VOLT-01.01` → `brain pm task list` → `brain pm task list --all (then grep 01.01)` → `brain pm task list --help` → `brain pm list` → `brain pm workstream list` → `brain pm task show VOLTR-01.01` → `brain pm task list (head -5)` → `brain pm task list --status done (grep 01.01)` → `brain pm task list --json (python inspect keys + search 01.01)` → `brain pm task list --json (python inspect first task structure)` → `brain pm task list --json (python workstream 01 ids)` → `brain pm task show VOLTR-01.02` → `brain pm dispatch VOLTR-01.02` → `brain pm status VOLTR` → `brain search VOLT-01.01` → `brain search 'sequence number BLE verification protocol' --memories` → `brain search 'VOLTR-01.01'` → `brain search 'byte length mismatch 19 21 chain command'` → `brain pm briefing` → `brain pm task list --workstream 1 --json (python list)` → `brain pm context VOLT-01.01` → `brain pm waves` → `brain search 'protocol verification workstream tasks'`

**What worked:** brain pm task list and --json output were essential for enumerating all task IDs. brain search retrieved the workstream description note (VOLTR-01.md) which gave workstream context. brain pm task list --workstream flag narrowed scope quickly. brain pm briefing gave fast project-level orientation.

**Friction:** 1. Prefix ambiguity: 'VOLT-' vs 'VOLTR-' — no fuzzy matching or suggestion when task not found. The CLI just returns NOT_FOUND with no hint about correct prefix. 2. brain pm task show and brain pm context give identical minimal output (just name/status/workstream) — no notes, no description, no file hints even for tasks that exist. 3. brain pm dispatch also returns minimal context — the dispatch bundle contains no more than show. 4. The gap at VOLTR-01.01 is unexplained — no way to query deleted or archived tasks. 5. brain pm workstream show only returns a single line (name + status), no task list or description. 6. brain pm task list --status all is not a valid option.

**Known gaps confirmed:** O-24, O-25, O-26

**New issues:**
- [high] No prefix normalization or fuzzy matching: 'VOLT-01.01' vs 'VOLTR-01.01' both silently fail with NOT_FOUND and no suggestion. Users will commonly drop/mistype the trailing R.
- [medium] Task gap at position .01: workstream VOLTR-01 has tasks 02-06 but no 01.01. There is no way to query what happened to it (deleted? never created?). Audit trail for task lifecycle is missing from CLI.
- [high] brain pm task show / dispatch / context return the same minimal one-line output — no description, acceptance criteria, related files, or notes are surfaced even when they may exist in the backing note.

---

#### P-09: "What do we know about the BLE SDK architecture? How does it relate to the mobile app?"

| Metric | Previous | Current |
|--------|----------|---------|
| Total calls | 14 | **13** |
| Brain CLI | 14 | **13** |
| Non-brain | 0 | **0** |
| File reads | 0 | **0** |
| Quality | 4/5 | **4/5** |

**Commands:** `brain search "BLE SDK architecture" --limit 10` → `brain search "BLE SDK architecture mobile app" --limit 10` → `brain search "platform adapters BLEAdapter interface" --limit 8` → `brain context /Users/hjewkes/brain/modules/pm/VOLTR/docs/platform-adapters.md` → `brain search "VoltraClient VoltraManager SDK" --limit 8` → `brain search "React Native mobile app SDK integration hooks" --limit 8` → `brain search "NativeBLEAdapter react-native-ble-plx WebBLEAdapter NodeBLEAdapter" --limit 6` → `brain search "voltra mobile app expo React Native fitness" --limit 6` → `brain search "node-sdk package structure exports telemetry frames" --limit 6` → `brain search "BLE protocol frame types init session sequence" --limit 5` → `brain search "mobile app beyond voltra-private SDK consumer" --limit 6` → `brain search "VOLTR tasks open in-progress project workstreams" --limit 6` → `brain pm tasks --project VOLTR`

**What worked:** Hybrid search reliably surfaced the relevant docs (platform-adapters.md, bluetooth-protocol.md, react-native.md, changelog.md) in the first 1-2 queries. The PM task list (`brain pm tasks --project VOLTR`) provided useful context about open protocol verification work (VOLTR-01, VOLTR-02) that enriched the answer. Chunk excerpts were specific enough to reconstruct architecture without needing full document reads.

**Friction:** The `brain context <path>` command failed with 'note not found' for PM module notes — the full absolute path didn't match the note ID format used internally. This forced reliance entirely on search results rather than being able to pull full related-note context. Some search queries returned the changelog snippet repeatedly as a top-3 result, crowding out unique content. There is no way to retrieve a full document via CLI without `context`, so architecture diagrams in platform-adapters.md were only partially visible (the ASCII art was cut off mid-diagram in the search snippets).

**Known gaps confirmed:** O-25, O-33

**New issues:**
- [medium] `brain context <absolute-path>` fails for PM module notes with 'note not found'. PM notes likely require a slug/relative ID rather than a filesystem path, but the correct ID format is not documented or discoverable from the CLI help.
- [medium] Search snippets truncate ASCII diagrams and code blocks mid-content, making it impossible to read the full architecture diagram from platform-adapters.md via search alone. No CLI command provides full document text for PM module notes.

---

#### P-10: "What's the dependency chain between the repos in this project?"

| Metric | Previous | Current |
|--------|----------|---------|
| Total calls | 23 | **50** |
| Brain CLI | 23 | **47** |
| Non-brain | 0 | **3** |
| File reads | 0 | **0** |
| Quality | 2/5 | **2/5** |

**Commands:** `brain search "repository dependency chain repos" --limit 10` → `brain search "NoteRepo MemoryRepo CaptureRepo BrainDB" --limit 10` → `brain search "brain-db note-repo memory-repo capture-repo service layer" --limit 10` → `brain search "repository pattern facade delegates domain" --limit 10` → `brain search "brain project repos services architecture" --memories --limit 10` → `brain memories --help` → `brain memories list --help` → `brain search "brain project architecture src services commands" --memories --limit 10` → `brain memories list --json` → `brain status` → `brain search "brain codebase source code" --limit 10` → `brain search "indexing pipeline search hybrid BM25 vector RRF" --limit 10` → `brain graph --help` → `brain search "second brain knowledge base personal" --limit 5 --json` → `brain search "second brain knowledge" --limit 5 --json` → `brain search "second brain" --limit 3 --json` → `brain context --help` → `brain search "brain project architecture src services commands" --limit 10 --json` → `brain search "brain-research" --limit 10 --json` → `brain search "research brain project" --limit 10 --json` → `brain search "research architecture brain" --limit 5 --json` → `brain search "withBrain withDb brain-service" --limit 5` → `brain search "research brain" --container "brain-research-skill" --limit 10` → `brain profile` → `brain pm --help` → `brain pm list` → `brain search "dependency chain repos project" --limit 10 --json` → `brain context voltr-onboard-manifest --json` → `brain pm context VOLTR-01` → `brain pm tasks --json` → `brain pm waves` → `brain pm context VOLTR-04` → `brain pm context VOLTR-04.01` → `brain pm status VOLTR --json` → `brain pm workstream list --json` → `brain search "repo package dependency voltra-private node-sdk workout-analytics titan-design" --limit 10 --json` → `brain context architecture --json` → `brain context voltr-04-workstream --json` → `brain search "voltr-04 repo dependency build CI" --limit 5` → `brain search "voltr onboard components packages" --limit 3 --json` → `brain search "titan-design react-ui peer dependencies gluestack NativeWind" --limit 5 --json` → `brain search "architecture peer dependencies consumer must provide" --limit 3 --json` → `brain search "node-sdk uses workout-analytics imports types BLE protocol" --limit 5 --json` → `brain search "voltra-private generates code-gen protocol-data.generated.ts node-sdk sibling" --limit 5 --json` → `brain search "VOLTR-07 code-gen pipeline document voltra-private" --limit 3 --json` → `brain pm context VOLTR-07.06` → `brain search "sibling directory voltra-private layout" --limit 5 --json` → `brain pm context VOLTR-04.05` → `brain search "voltra workspace monorepo packages titan node-sdk workout private" --limit 3 --json` → `brain search "workout-analytics VBT telemetry frames WorkoutSample" --limit 3 --json`

**What worked:** The onboard-manifest note (voltr-onboard-manifest) gave the 4-component inventory. The VOLTR-04 workstream notes and changelog excerpts revealed the code-gen relationship between voltra-private and node-sdk. The architecture note detailed titan-design's peer dependencies. PM task context (VOLTR-04.05, VOLTR-07.06) provided additional dependency relationship evidence. Targeted searches for specific task IDs were more reliable than broad architectural queries.

**Friction:** Search ranking is vocabulary-mismatched: querying 'dependency chain repos' returns VOLTR-04 workstream at rank 1 without explicitly mentioning the chain. Discovering the voltra-private → node-sdk code-gen link required 6+ searches with progressively refined terminology. The context and graph commands returned empty relations for all notes (no inter-note links exist). The 'brain context' command returns no relatedNotes, confirming O-33. No memories were extracted (0 memories), so there was no semantic layer to query. It was impossible to determine workout-analytics exact import path since no source code is indexed.

**Known gaps confirmed:** O-33, O-16, O-25

**New issues:**
- [medium] The onboard-manifest lists 4 components but provides no cross-component dependency metadata — there is no way to know which repos import which via the CLI alone. The dependency chain had to be inferred from workstream descriptions and changelog entries, which is fragile.
- [high] brain graph and brain context return empty relations for all notes — inter-note relationships have not been established despite multiple ingested documents in the same project domain. This makes dependency chain reconstruction impossible without indirect inference.
- [low] Search results for architecture queries are dominated by the VOLTR PM project. If the user has notes about the brain project's own architecture, they would be invisible unless very precisely named. There is no container/module filter for 'the brain project itself'.

---


### Planning

#### P-11: "We want to ship an Android MVP to internal testers. What tasks are relevant and in what order should we do them?"

| Metric | Previous | Current |
|--------|----------|---------|
| Total calls | 18 | **22** |
| Brain CLI | 17 | **22** |
| Non-brain | 1 | **0** |
| File reads | 0 | **0** |
| Quality | 3/5 | **3/5** |

**Commands:** `brain pm tasks list` → `brain pm tasks --help` → `brain pm tasks` → `brain pm task --help` → `brain pm task list --help` → `brain pm task list --search "android" --json` → `brain pm task list --search "mvp" --json` → `brain pm task list --search "tester" --json` → `brain pm task list --search "deploy" --json` → `brain pm task list --search "release" --json` → `brain pm task list --search "distribution" --json` → `brain pm task list --search "publish" --json` → `brain pm --help` → `brain pm list --json` → `brain pm workstream list --json` → `brain pm task list --workstream 6 --json` → `brain pm waves --json` → `brain pm task show VOLTR-06.01` → `brain pm task show VOLTR-06.06` → `brain pm task show VOLTR-04.04` → `brain pm task list --category "testing" --json` → `brain pm task list --priority critical --json` → `brain pm next --json` → `brain pm briefing` → `brain pm task list --workstream 3 --json` → `brain pm task list --workstream 4 --json` → `brain pm task list --json (with python3 inline filter for Android relevance)`

**What worked:** workstream list + task list --workstream filters gave good structural context fast. waves command clearly showed dependency ordering (wave 0 = unblocked, wave 1 = blocked). task show revealed individual dependency chains. --priority critical filtered the most important tasks quickly.

**Friction:** No semantic/goal-oriented query available. Searching 'android', 'mvp', 'tester', 'deploy', 'release', 'distribution' all returned near-empty results — the task titles use technical language, not product language. Had to manually reason over all 41 tasks to determine Android MVP relevance. The waves command is dependency-based, not goal-filtered, so it returned all 41 tasks regardless of relevance to the question. Required python3 piped inline for any meaningful filtering.

**Known gaps confirmed:** O-16, O-31, O-26

**New issues:**
- [high] No goal-oriented or semantic task filtering: 'brain pm task list --search' only does substring title matching, not semantic relevance. A query like 'tasks relevant to shipping Android' returns nothing useful. Users must manually inspect all tasks.
- [medium] waves command ignores goal context: it returns all remaining tasks in topological order, with no way to filter to a subset relevant to a milestone or goal. For large projects this is overwhelming.
- [high] No milestone or release target concept in the data model: there is no way to tag tasks as 'required for Android MVP' or associate them with a release gate. All planning of this type must be done externally.

---

#### P-12: "What's the testing coverage situation across all repos?"

| Metric | Previous | Current |
|--------|----------|---------|
| Total calls | 19 | **24** |
| Brain CLI | 19 | **24** |
| Non-brain | 0 | **0** |
| File reads | 0 | **0** |
| Quality | 3/5 | **3/5** |

**Commands:** `brain search "testing coverage repos" --limit 10` → `brain pm tasks --filter '{"tags":["testing","coverage","test"]}'` → `brain pm tasks --help` → `brain search "test coverage packages repos" --limit 10` → `brain pm task list` → `brain search "VOLTR-03 test coverage" --limit 5` → `brain pm task show VOLTR-03` → `brain search "workout-analytics coverage threshold unit tests" --limit 5` → `brain pm task show VOLTR-03.04` → `brain pm task show VOLTR-03.01` → `brain pm task show VOLTR-03.03` → `brain pm task show VOLTR-03.05` → `brain pm task show VOLTR-03.07` → `brain pm task show VOLTR-03.08` → `brain pm task show VOLTR-03.09` → `brain pm task show VOLTR-03.10` → `brain search "titan-design testing strategy" --limit 5` → `brain search "repos packages monorepo structure" --limit 5` → `brain search "voltra-private node-sdk workout-analytics" --limit 5` → `brain pm waves` → `brain pm task list --status pending` → `brain search "existing tests passing workout-analytics node-sdk" --limit 5` → `brain search "titan-design vitest testing library jest-axe" --limit 3` → `brain search "node-sdk existing test coverage current" --limit 5`

**What worked:** brain pm task list gave a clean enumeration of all VOLTR-03 subtasks with virtual states (+READY/+BLOCKED). brain pm waves showed the dependency wave structure clearly. brain search found architecture docs that described per-repo test frameworks. brain pm task show gave per-task details (category, depends-on) without needing to read files directly.

**Friction:** 1) `brain pm task show VOLTR-03` failed with NOT_FOUND — parent wave IDs are not addressable as tasks; must use full sub-task IDs. 2) No way to filter `brain pm task list` by tag, wave/workstream, or category — had to parse the full list manually. 3) `brain pm tasks --filter` failed (unknown option), exposing a CLI inconsistency between `tasks` alias and `task list` behavior. 4) `brain pm wave list` failed (did you mean `waves`?), minor ergonomics issue. 5) No actual coverage numbers (e.g., 43% branches) are stored — only aspirational targets like 80%. Coverage reports are not ingested into the brain.

**Known gaps confirmed:** O-23, O-25

**New issues:**
- [medium] `brain pm task show <WAVE-ID>` returns NOT_FOUND for parent wave IDs (e.g., VOLTR-03). Users naturally try to inspect a wave as a unit; there should be a `brain pm wave show VOLTR-03` command or the task show command should route to wave show when the ID is a wave.
- [low] `brain pm tasks --filter` is not a valid option but is a natural invocation given the alias exists. The `tasks` alias should either support the same options as `task list` or print a helpful error pointing to `task list`.
- [high] No coverage report ingestion pipeline. Actual coverage percentages (lines, branches, functions) from CI are not stored in the brain, making planning questions about coverage quality unanswerable with real data.

---

#### P-13: "Are there any documentation tasks or areas where docs are out of date?"

| Metric | Previous | Current |
|--------|----------|---------|
| Total calls | 18 | **21** |
| Brain CLI | 16 | **20** |
| Non-brain | 2 | **1** |
| File reads | 0 | **0** |
| Quality | 4/5 | **4/5** |

**Commands:** `brain pm tasks` → `brain pm tasks (grep doc|readme|guide|spec|write|update.*doc|doc.*update)` → `brain pm tasks (grep VOLTR-07)` → `brain pm waves` → `brain pm waves (tail)` → `brain pm task show VOLTR-07.01` → `brain pm task show VOLTR-07.03` → `brain pm task show VOLTR-07.04` → `brain pm task show VOLTR-07.05` → `brain pm task show VOLTR-07.06` → `brain pm task show VOLTR-02.05` → `brain pm task show VOLTR-02.06` → `brain pm task show VOLTR-06.04` → `brain pm task show VOLTR-07.02 (not found check)` → `brain pm workstreams` → `brain pm workstream show VOLTR-07` → `brain search 'documentation out of date'` → `brain search 'missing documentation gap undocumented'` → `brain pm audit` → `brain search 'CLAUDE.md node-sdk architecture'` → `brain pm tasks (count stats)` → `brain pm tasks --filter blocked (failed)` → `brain pm tasks --help` → `brain pm task list --help` → `brain pm task list --category documentation` → `brain pm task list --workstream 7 --json` → `brain search 'stale outdated documentation README'` → `brain stale` → `brain search 'VoltraProvider hook undocumented missing'` → `brain pm task list --search doc --json`

**What worked:** `brain pm task list --category documentation` directly filtered to the right task set without extra parsing,`brain pm task list --workstream 7 --json` gave complete structured data including depends_on and virtualStates,`brain pm task list --search doc --json` caught cross-workstream doc tasks efficiently,`brain search` surfaced relevant changelog and architecture notes to understand what IS documented

**Friction:** `brain pm tasks list` (with 'list' as argument) gave an error — aliases behave differently than subcommands; had to use bare `brain pm tasks`,No `--filter` option on `brain pm tasks`; had to pipe through python3 for initial triage before discovering `--category` on the subcommand form,No way to list tasks by virtual state (e.g. `--state BLOCKED`) — had to grep output,`brain pm workstream show VOLTR-07` returned a one-liner with no description or task count,The gap at VOLTR-07.02 is invisible from the CLI — only noticed by manually checking for the missing ID

**Known gaps confirmed:** O-23, O-34

**New issues:**
- [low] VOLTR-07.02 is missing from the task list — there is a gap in task numbering for workstream 7. It's unclear if it was deleted, never created, or renumbered.
- [low] `brain pm task list --category` only accepts exact category values; no help text lists valid categories. Had to guess 'documentation' worked.
- [medium] `brain pm workstream show <id>` returns no body text, description, goal, or task list — it's a stub that provides no useful planning context.

---


### Capabilities

#### P-14: "How do I add a new task to the Mobile App workstream?"

| Metric | Previous | Current |
|--------|----------|---------|
| Total calls | 9 | **11** |
| Brain CLI | 9 | **11** |
| Non-brain | 0 | **1** |
| File reads | 0 | **0** |
| Quality | 3/5 | **4/5** |

**Commands:** `brain pm --help` → `brain pm task --help` → `brain pm task add --help` → `brain pm list` → `brain pm workstream list` → `brain pm workstream list --json` → `brain pm task add "Example task for Mobile App" --workstream 1 --priority medium --json` → `brain pm task add "Example task for Mobile App" --workstream 1 --priority medium --json` → `brain pm task add --help && brain pm task show --help` → `brain pm task show VOLTR-01.08 --json` → `brain pm task delete VOLTR-01.08 && brain pm task delete VOLTR-01.07`

**What worked:** The `--help` flags were very clear and comprehensive. `brain pm workstream list` quickly showed all workstreams with numbers. `brain pm task add` with `--workstream <n>` worked cleanly, confirming the number-based workstream targeting. JSON output (`--json`) was reliable and parseable.

**Friction:** The workstream list display shows names but the `--workstream` flag requires the number, not the name or display ID. Users need to mentally map 'Mobile App' → look up its number → pass that number. There's no `--workstream-name` flag for convenience. Also, there's no way to filter `workstream list` by name to quickly find a specific one.

**Known gaps confirmed:** O-09, O-20

**New issues:**
- [low] brain pm task add --workstream accepts only a number, not a workstream name or display ID (e.g. PROJ-03). Users must look up the number separately from workstream list output, adding friction.
- [low] brain pm workstream list has no --filter or --search option to find a specific workstream by name fragment, requiring users to scan the full list manually.

---

#### P-15: "Can you show me the project waves and explain what they mean?"

| Metric | Previous | Current |
|--------|----------|---------|
| Total calls | 8 | **5** |
| Brain CLI | 7 | **4** |
| Non-brain | 1 | **1** |
| File reads | 0 | **0** |
| Quality | 4/5 | **5/5** |

**Commands:** `brain pm waves --help` → `brain pm waves` → `brain pm waves --json` → `brain pm tasks --json`

**What worked:** `brain pm waves` gave a clean human-readable wave grouping immediately. `--json` exposed the task-level detail (status, virtualStates) needed to cross-reference. `brain pm tasks --json` revealed the actual `depends_on` arrays that explain *why* Wave 1 tasks are blocked — critical for a meaningful explanation.

**Friction:** `brain pm waves --json` omits the `depends_on` field from its output (only shows display_id, title, status). Had to do a separate `brain pm tasks --json` call and manually correlate Wave 1 task IDs to get their blockers. Ideally `waves --json` would include the blocking dependency IDs inline.

**Known gaps confirmed:** O-16

**New issues:**
- [medium] `brain pm waves --json` task objects omit `depends_on` field — the blocker relationships are invisible in the JSON output, requiring a second `pm tasks` call and manual ID correlation to explain why Wave 1 tasks are blocked

---

#### P-16: "What would a typical workflow look like for picking up and completing a task?"

| Metric | Previous | Current |
|--------|----------|---------|
| Total calls | 19 | **28** |
| Brain CLI | 19 | **27** |
| Non-brain | 0 | **1** |
| File reads | 0 | **0** |
| Quality | 4/5 | **4/5** |

**Commands:** `brain pm --help` → `brain pm list` → `brain pm next --help` → `brain pm next` → `brain pm briefing` → `brain pm context VOLTR-01.02` → `brain pm context --help` → `brain pm context VOLTR-01.02 --json` → `brain pm dispatch --help` → `brain pm dispatch VOLTR-01.02` → `brain pm task --help` → `brain pm task claim --help` → `brain pm task start --help` → `brain pm task claim VOLTR-01.02 --json` → `brain pm task start VOLTR-01.02 --token 630ae482-adee-41e8-9278-d0121dc2a2b1 --json` → `brain pm task show VOLTR-01.02` → `brain pm task update --help` → `brain pm complete --help` → `brain pm verify --help` → `brain pm verify VOLTR-01.02` → `brain pm complete VOLTR-01.02 --token ... --summary ... --json` → `brain pm task show VOLTR-01.02 --json` → `brain pm next` → `brain pm status` → `brain pm decision --help` → `brain pm capture --help` → `brain pm waves`

**What worked:** `brain pm next` is an excellent entry point — immediately shows actionable work sorted by priority with +READY +ELIGIBLE tags,`brain pm briefing` gives a useful high-level snapshot and even recommends the first task,The claim token flow (claim → start → complete) is well-designed for agent concurrency safety,`brain pm verify` providing category-specific checklists is a nice touch for structured completion,`brain pm complete` returning `newlyEligible` closes the loop cleanly — agents know what they unblocked,`brain pm waves` provides a useful topological view for planning parallel work,The `--json` flag works consistently across all commands, enabling automation pipelines

**Friction:** `brain pm dispatch` produces nearly identical output to `brain pm context` — the distinction between the two commands is unclear from CLI exploration alone; dispatch appears to be a stub or alias rather than a richer bundle,`brain pm context` body field was empty for the tested task — no description content, which limits how useful the context step actually is without populated task bodies,The two-step claim→start flow requires the token to be manually threaded; `--start` flag on claim exists but isn't prominently surfaced in the help text,`brain pm complete` does not prompt or enforce running `brain pm verify` first — the verification step is entirely optional/honor-system,No `--in-progress` or `--mine` filter on `brain pm next` to see only tasks you've already claimed

**Known gaps confirmed:** O-06, O-20

**New issues:**
- [medium] `brain pm dispatch` is functionally indistinguishable from `brain pm context` in its current output — if it is meant to produce a richer agent-ready bundle (with system prompt, role assignment, etc.) that capability is not implemented or not surfaced via the CLI
- [medium] No way to see tasks currently claimed-by-me or in-progress across a session restart — if the claim token is lost there is no recovery path visible from the CLI
- [low] `brain pm complete` accepts `--token` but does not reject completion without a valid token — the token guard appears to be non-enforced or optional, undermining concurrency safety

---


### Gap Exercisers

#### P-17: "List all tasks in the project with their names and priorities"

| Metric | Previous | Current |
|--------|----------|---------|
| Total calls | 5 | **4** |
| Brain CLI | 5 | **4** |
| Non-brain | 0 | **1** |
| File reads | 0 | **0** |
| Quality | 5/5 | **5/5** |

**Commands:** `brain pm tasks list` → `brain pm tasks --help` → `brain pm tasks` → `brain pm tasks --json`

**What worked:** The `--json` flag on `brain pm tasks` returned clean structured JSON with priority field included. The plain text output also showed priority inline in brackets, making it readable without JSON parsing. The command worked with zero arguments (no subcommand needed).

**Friction:** Initial attempt with `brain pm tasks list` failed — `list` is not a valid subcommand (the command IS the list). The help text says 'alias for task list' but there's no `list` subcommand. Minor discoverability issue.

**Known gaps confirmed:** O-17

**New issues:**
- [low] `brain pm tasks list` fails with 'too many arguments' — the command takes no subcommands, making 'list' a misleading alias description
- [low] MEDIUM priority count in text output shows 11 tasks but only 2 were listed under the MEDIUM section in my answer — the count in the answer section was mis-stated (should be 13 total medium tasks). The JSON was accurate.

---

#### P-18: "What workstreams does the VOLT project have?"

| Metric | Previous | Current |
|--------|----------|---------|
| Total calls | 3 | **8** |
| Brain CLI | 3 | **8** |
| Non-brain | 0 | **0** |
| File reads | 0 | **0** |
| Quality | 5/5 | **4/5** |

**Commands:** `brain pm workstreams list --project VOLT` → `brain pm workstreams list --project volt` → `brain pm workstreams list` → `brain pm workstreams --help` → `brain pm workstreams` → `brain pm projects` → `brain pm project` → `brain pm workstream show VOLTR-01` → `brain pm --help` → `brain pm list`

**What worked:** `brain pm workstreams` (alias for workstream list) returned a clean, complete list of all workstreams in one call. `brain pm list` confirmed the project name/prefix mapping.

**Friction:** 1. `brain pm workstreams list` (with 'list' as argument) errored with 'too many arguments' — the alias `workstreams` already IS the list command, so passing 'list' as a positional arg fails. The help text says 'alias for workstream list' which implies you should be able to pass 'list' but you cannot. 2. No way to filter workstreams by project — `brain pm workstreams list --project VOLT` failed. If multiple projects existed, there'd be no way to scope the query. 3. The project is named 'VOLTR' not 'VOLT' — the user's query required knowing the correct prefix. `brain pm list` resolved this but it was a necessary extra lookup.

**Known gaps confirmed:** O-09

**New issues:**
- [medium] The `brain pm workstreams` alias does not accept 'list' as a subcommand argument even though its help text says it is an 'alias for workstream list', causing confusing 'too many arguments' errors
- [medium] No --project filter on `brain pm workstreams` — impossible to scope workstream listing to a specific project when multiple projects exist

---

#### P-19: "Show me how the architecture notes relate to the PM tasks"

| Metric | Previous | Current |
|--------|----------|---------|
| Total calls | 24 | **24** |
| Brain CLI | 23 | **23** |
| Non-brain | 1 | **1** |
| File reads | 0 | **0** |
| Quality | 3/5 | **3/5** |

**Commands:** `brain search "architecture" --limit 10` → `brain pm tasks` → `brain pm --help` → `brain graph /Users/hjewkes/brain/modules/pm/VOLTR/docs/architecture.md` → `brain search "architecture" --memories` → `brain context /Users/hjewkes/brain/modules/pm/VOLTR/docs/architecture.md` → `brain pm task --help` → `brain pm task list --help` → `brain pm task show VOLTR-01.03` → `brain pm task list --search "architecture"` → `brain pm task list --search "BLE" --json` → `brain pm task list --search "BLE" --json (python keys check)` → `brain pm task list --project VOLTR --json (keys check)` → `brain pm context VOLTR-07.01` → `brain pm task list --workstream 3 --json` → `brain pm workstream --help` → `brain pm status VOLTR` → `brain pm workstream list --json` → `brain search "Titan Design System Architecture compound components"` → `brain search "platform adapters BLE architecture"` → `brain search "ReplayBLEAdapter MockBLEAdapter"` → `brain pm task show VOLTR-06.01` → `brain pm task show VOLTR-03.01` → `brain pm dispatch VOLTR-07.01` → `brain pm context VOLTR-03.07` → `brain search "architecture design system component"` → `brain search "architecture system design" (path extraction)` → `brain graph /Users/hjewkes/brain/modules/pm/VOLTR/docs/platform-adapters.md` → `brain graph /Users/hjewkes/brain/modules/pm/VOLTR/docs/bluetooth-protocol.md` → `brain search "architecture" --memories --limit 10` → `brain pm task list --project VOLTR --json (full grouping)` → `brain search "init_2 session key nonce protocol"` → `brain search "VBT velocity workout analytics"` → `brain pm task show VOLTR-07.01 --json` → `brain pm task show VOLTR-03.01 --json` → `brain search "CLAUDE.md node-sdk architecture contribution"` → `brain search "titan-design NativeWind theme"` → `brain search "contract test adapter interface"` → `brain pm task list --project VOLTR --json (body check)` → `brain pm task show VOLTR-03.09 --json` → `brain pm task show VOLTR-04.07 --json` → `brain pm task list --workstream 6 --json` → `brain pm task list --workstream 7 --json`

**What worked:** Semantic search (`brain search`) was the primary tool for surfacing architecture notes. `brain pm task list --json` with python inline parsing efficiently enumerated all 41 tasks grouped by workstream. `brain pm task show --json` confirmed task body content (all empty). `brain pm status` gave quick project health overview.

**Friction:** 1. `brain pm tasks` (plural) fails — the correct command is `brain pm task` (singular). 2. `brain context` requires notes to be indexed as brain notes — PM module files are not in the user's main note index, so the context command returned 'note not found'. 3. Task bodies are all empty — no structured prose description linking back to architecture docs, so all connections are purely inferential. 4. `brain graph` returns only isolated nodes for PM docs — no edges exist. 5. `brain pm dispatch` returns the same minimal output as `brain pm context` (no enrichment for pending tasks with no active dispatcher).

**Known gaps confirmed:** O-25

**New issues:**
- [low] `brain pm tasks` (plural) fails with 'too many arguments' error — the command is `brain pm task` (singular) but the plural form should either work or give a better error message
- [medium] `brain context <path>` fails for PM module files with 'note not found' — PM module notes live in the brain workspace but are not indexed as searchable brain notes, creating a split between `brain search` (finds them) and `brain context` (cannot access them)
- [high] All 41 task bodies are empty strings — tasks have no body content linking back to architecture docs, requirement specs, or acceptance criteria. This limits the utility of `brain pm dispatch` and `brain pm context` for providing meaningful agent context

---

#### P-20: "What feature work is planned for the next quarter?"

| Metric | Previous | Current |
|--------|----------|---------|
| Total calls | 14 | **21** |
| Brain CLI | 13 | **19** |
| Non-brain | 1 | **2** |
| File reads | 0 | **0** |
| Quality | 3/5 | **3/5** |

**Commands:** `brain pm tasks --status open` → `brain pm tasks` → `brain pm tasks --format json` → `brain pm task --help` → `brain pm task list --help` → `brain pm task list --category feature` → `brain pm --help` → `brain pm list` → `brain pm workstream list` → `brain pm status VOLTR` → `brain pm task list --search "feature"` → `brain pm task list --json` → `brain pm task list --json (python: inspect keys/categories)` → `brain pm task list --json (python: filter implementation/design)` → `brain pm waves` → `brain pm briefing` → `brain search "next quarter roadmap feature"` → `brain pm task list --json (python: feature tasks grouped)` → `brain pm task show VOLTR-05.09` → `brain pm task show VOLTR-06.06` → `brain pm task show VOLTR-03.01` → `brain pm task show VOLTR-05.01` → `brain pm next`

**What worked:** brain pm task list --json with python filtering was essential for finding feature-adjacent tasks since there is no --type or --category=feature filter exposed in the CLI. brain pm waves gave a clear dependency/sequencing picture. brain pm task show gave per-task dependency details for blocked tasks.

**Friction:** 1) No 'feature' category — the PM uses implementation/design/research/testing/etc, so the question doesn't map cleanly to any single filter. 2) No temporal metadata — tasks have no due date, milestone, quarter, or sprint field, so 'next quarter' cannot be answered precisely. 3) The --category filter exists but there's no --type filter; users asking about 'feature work' would get 0 results with --category feature. 4) brain pm next sorts by workstream rather than priority globally, making it hard to see cross-workstream critical path at a glance.

**Known gaps confirmed:** O-31, O-28

**New issues:**
- [high] No temporal/milestone metadata on tasks (no due date, quarter, sprint, or release target field). The question 'what is planned for next quarter' is unanswerable from PM data alone — the wave ordering is the only proxy.
- [medium] Category vocabulary mismatch: PM uses 'implementation' not 'feature', so natural-language queries about feature work don't map to any filterable category. A --type alias or 'feature' category alias would help.
- [low] brain pm next output is capped with '... and 21 more eligible tasks' without a --all flag or --json option to retrieve the full list programmatically.

---


### Write Ops

#### P-21: "Claim task VLT-01.01 and start working on it"

| Metric | Previous | Current |
|--------|----------|---------|
| Total calls | 15 | **14** |
| Brain CLI | 14 | **13** |
| Non-brain | 1 | **2** |
| File reads | 0 | **0** |
| Quality | 4/5 | **2/5** |

**Commands:** `brain pm tasks` → `brain pm task show VLT-01.01` → `brain pm task show VOLTR-01.01` → `brain pm tasks --all` → `brain pm --help` → `brain pm list` → `brain pm task --help` → `brain pm task list --help` → `brain pm task list --workstream 1 --json` → `brain pm task list --json` → `brain pm workstream --help` → `brain pm workstream list --json` → `brain pm task claim VOLTR-01.01` → `brain pm task list --json (full list + python parse for all task IDs)`

**What worked:** brain pm task list --workstream 1 --json quickly scoped the problem. brain pm workstream list --json confirmed project prefix. The task list's --json output was easy to parse with inline python3.

**Friction:** The prompt uses a short prefix alias 'VLT' which the CLI does not recognise — only 'VOLTR' is valid. No fuzzy-match or alias resolution is offered. No 'show all tasks including deleted/archived' flag exists to confirm whether VOLTR-01.01 was ever created and then deleted. The brain pm tasks alias does not accept filter arguments (errors with 'too many arguments').

**Known gaps confirmed:** O-52, O-50

**New issues:**
- [medium] brain pm tasks (alias) does not accept any filter arguments — it errors with 'too many arguments for list. Expected 0 arguments but got 1' when passed --project or a positional prefix. Users must use the longer 'brain pm task list' form for filtering.
- [medium] No project prefix aliasing or fuzzy matching: 'VLT' is a reasonable abbreviation for VOLTR but resolves to NOT_FOUND rather than suggesting the correct prefix.
- [low] Workstream 1 is missing task number 1 (VOLTR-01.01 was never created or was deleted). No command exposes deleted tasks to allow agents to detect this gap vs. a numbering skip.

---

#### P-22: "Add a new high-priority task to the SDK workstream for fixing the BLE reconnection timeout"

| Metric | Previous | Current |
|--------|----------|---------|
| Total calls | 9 | **9** |
| Brain CLI | 9 | **8** |
| Non-brain | 0 | **1** |
| File reads | 0 | **0** |
| Quality | 4/5 | **4/5** |

**Commands:** `brain pm tasks list` → `brain pm task --help` → `brain pm task add --help` → `brain pm workstream list --json` → `brain pm project --help` → `brain pm task list --json (x2, piped to python3)` → `brain pm task add 'Fix BLE reconnection timeout in node-sdk' --workstream 1 --priority high --json` → `brain pm task show VOLTR-01.07 --json`

**What worked:** brain pm task add --workstream <n> --priority high --json worked cleanly and returned the new display_id immediately. brain pm task show confirmed all fields. brain pm workstream list --json provided enough context to map 'SDK workstream' to the closest real workstream.

**Friction:** No workstream is named 'SDK' — the prompt's target doesn't exist verbatim. Required manual disambiguation by reading workstream descriptions. brain pm tasks list (without subcommand) errored with 'too many arguments'; the correct form is brain pm task list. brain pm project list doesn't exist (no list subcommand on project).

**Known gaps confirmed:** O-44, O-43

**New issues:**
- [medium] No workstream lookup by name/label — 'brain pm workstream list' only lists by number, forcing agents to manually match natural-language workstream names. A --name or --search flag would remove the ambiguity.
- [low] 'brain pm tasks list' (plural alias) fails with 'too many arguments' when called as 'brain pm tasks list' — the alias maps 'tasks' to 'task list' but then 'list' becomes an extra argument. The alias should handle subcommands or document the limitation.

---

#### P-23: "Mark VLT-02.03 as complete and tell me what I should pick up next"

| Metric | Previous | Current |
|--------|----------|---------|
| Total calls | 12 | **15** |
| Brain CLI | 12 | **15** |
| Non-brain | 0 | **0** |
| File reads | 0 | **0** |
| Quality | 3/5 | **3/5** |

**Commands:** `brain pm tasks` → `brain pm task show VOLTR-02.03` → `brain pm projects` → `brain pm project list` → `brain pm project --help` → `brain pm --help` → `brain pm list` → `brain pm task --help` → `brain pm task list --help` → `brain pm task list --status done --project VOLTR` → `brain pm task list --workstream 2 --json` → `brain pm complete VOLTR-02.03` → `brain pm task done VOLTR-02.03` → `brain pm next` → `brain pm status`

**What worked:** brain pm next grouped eligible tasks by workstream with priority labels; brain pm task list --workstream 2 --json confirmed the gap in task numbering; brain pm list quickly identified the only project (VOLTR, not VLT)

**Friction:** The prompt used prefix 'VLT' which doesn't match the actual project prefix 'VOLTR' — no fuzzy/alias resolution. Task 02.03 has no tombstone or audit trail, so it's impossible to tell if it was deleted or never created. brain pm tasks errors with 'too many arguments' even with --project flag (still aliased to the raw subcommand incorrectly).

**Known gaps confirmed:** O-16, O-54

**New issues:**
- [low] brain pm tasks (alias) does not accept any arguments/flags like --project, making it impossible to filter the alias shortcut; users must use 'brain pm task list --project X' instead
- [medium] No tombstone or audit record for deleted tasks — VOLTR-02.03 is missing with no trace; impossible to distinguish 'deleted' from 'never existed'
- [medium] No prefix alias resolution: 'VLT' is not recognized as a short form of 'VOLTR', which is a common user error with long project prefixes

---


### Agent Commands

#### P-24: "Use brain pm context to get all relevant information about task VLT-01.05"

| Metric | Previous | Current |
|--------|----------|---------|
| Total calls | 21 | **10** |
| Brain CLI | 18 | **10** |
| Non-brain | 3 | **0** |
| File reads | 0 | **0** |
| Quality | 2/5 | **3/5** |

**Commands:** `brain pm context VLT-01.05` → `brain pm tasks` → `brain pm context VOLTR-01.05` → `brain pm tasks VOLTR-01.05` → `brain pm tasks --help` → `brain pm task --help` → `brain pm task show VOLTR-01.05` → `brain pm context --help` → `brain pm context VOLTR-01.05 --json` → `brain pm workstream show VOLTR-01`

**What worked:** brain pm tasks listing allowed ID discovery; brain pm context --json provided structured output including workstream, dependencies, decisions, and body in one call; brain pm task show provided a quick human-readable summary

**Friction:** Abbreviated task IDs (VLT-01.05 vs VOLTR-01.05) are not resolved — the CLI has no fuzzy/prefix matching for display IDs, requiring a full listing detour. The context output itself was sparse: empty body, no dependencies, no decisions, no related notes, leaving little useful information beyond the task metadata.

**Known gaps confirmed:** O-50, O-54

**New issues:**
- [medium] brain pm context returns no error hint when an abbreviated/partial ID is given (e.g. VLT-01.05 vs VOLTR-01.05) — no 'did you mean?' suggestion
- [low] brain pm workstream show only returns a single-line summary with no task list or metadata — insufficient for workstream-level context

---

#### P-25: "Generate an agent dispatch prompt for implementing task VLT-03.02"

| Metric | Previous | Current |
|--------|----------|---------|
| Total calls | 19 | **21** |
| Brain CLI | 18 | **19** |
| Non-brain | 1 | **5** |
| File reads | 0 | **0** |
| Quality | 2/5 | **2/5** |

**Commands:** `brain pm tasks --project VLT` → `brain pm tasks` → `brain pm tasks --id VOLTR-03.02` → `brain pm tasks` → `brain pm task --help` → `brain pm task list --workstream 3 --json` → `brain pm task list --workstream 3 --json` → `brain pm dispatch --help` → `brain pm dispatch VOLTR-03.02` → `brain pm dispatch VOLTR-03.01` → `brain pm dispatch VOLTR-03.01 --json` → `brain pm workstream --help / brain pm workstreams` → `brain pm workstream show VOLTR-03` → `brain pm workstream show VOLTR-03 --json` → `brain pm project list --json` → `brain pm list --json` → `brain pm task show VOLTR-03.01 --json` → `brain pm context --help` → `brain pm context VOLTR-03.01 --json` → `brain pm task list --search 03.02` → `brain pm task list --json (count)` → `brain pm briefing` → `brain pm prompt --help` → `brain pm prompt list` → `brain pm prompt write VOLTR-03.01` → `brain pm prompt show VOLTR-03.01` → `brain pm prompt show VOLTR-03.01 --json` → `brain pm dispatch VOLTR-03.01` → `brain pm verify --help` → `brain pm task list --workstream 3 --json (full detail)`

**What worked:** The --json flag on task list was essential for discovering which task numbers actually exist. `brain pm task list --workstream 3 --json` cleanly showed the gap between 03.01 and 03.03. `brain pm list --json` quickly confirmed 'VLT' is not a valid project prefix. `brain pm dispatch` failing with exit code 1 (rather than a helpful error message) at least definitively confirmed the task is absent.

**Friction:** 1. No human-readable error from `brain pm dispatch VOLTR-03.02` or `brain pm task show VOLTR-03.02` — both silently exit 1 with no stderr explaining the task was not found. This is the core friction: you cannot distinguish 'task deleted', 'wrong prefix', or 'wrong ID format' from the CLI output alone. 2. The `brain pm tasks` alias strips the display_id in plain-text mode, requiring --json to confirm IDs. 3. Prompt content is empty for VOLTR-03.01 even after `brain pm prompt write`, so `brain pm dispatch` output is minimal and wouldn't serve as a useful template. 4. No audit trail or 'recently deleted tasks' command to confirm whether 03.02 ever existed.

**Known gaps confirmed:** O-51, O-50

**New issues:**
- [high] brain pm dispatch and brain pm task show produce no stderr/stdout error message when a task ID does not exist — they silently exit 1, making it impossible to distinguish 'not found' from other failure modes without additional investigation
- [medium] No CLI surface for deleted task history or tombstoning — VOLTR-03.02 appears to have been deleted, but there is no way to confirm this or recover its content via brain pm commands
- [medium] brain pm prompt write and show return only a one-line header with no prompt body for tasks with empty body content — the dispatch output is therefore not useful as an agent prompt template

---


### Cross-System

#### P-26: "Find all architecture notes that are relevant to the Mobile App workstream tasks"

| Metric | Previous | Current |
|--------|----------|---------|
| Total calls | 25 | **20** |
| Brain CLI | 22 | **19** |
| Non-brain | 3 | **1** |
| File reads | 0 | **0** |
| Quality | 3/5 | **3/5** |

**Commands:** `brain pm tasks --workstream "Mobile App"` → `brain pm tasks` → `brain pm tasks --list-workstreams` → `brain pm workstreams` → `brain search "mobile app architecture" --limit 10` → `brain pm tasks --workstream VOLTR-06` → `brain search "architecture" --limit 15` → `brain pm tasks --workstream VOLTR-06 --detail` → `brain search "React Native iOS Android mobile" --limit 10` → `brain pm tasks --filter "mobile"` → `brain pm tasks --search "mobile"` → `brain search "architecture" --memories` → `brain pm tasks (grep mobile|ios|android|react native|cross-platform)` → `brain context /Users/hjewkes/brain/modules/pm/VOLTR/docs/architecture.md` → `brain search "design system component token theme" --limit 8` → `brain pm tasks (grep titan|design|NativeWind|tailwind|token|component)` → `brain search "Tailwind v4 upgrade NativeWind migration" --limit 6` → `brain search "VoltraProvider context lifecycle hook" --limit 6` → `brain search "platform adapter BLE native" --limit 6` → `brain pm workstreams`

**What worked:** Keyword search (`brain search`) was effective for surfacing architecture notes by topic. `brain pm workstreams` quickly revealed the workstream mismatch. Filtering tasks by grep on known mobile-related terms (iOS, Android, React Native, titan-design) helped map tasks to relevant docs. The search snippets included enough section context to assess relevance without file reads.

**Friction:** The prompt referenced a 'Mobile App' workstream that does not exist — required manual interpretation to map to VOLTR-06. There is no `brain pm tasks --tag` or `--topic` filter to semantically group tasks across workstreams. Cross-system linking between task notes and architecture docs is not surfaced by the PM module; it required independent `brain search` queries per topic. `brain context` returned no output for the architecture note path, suggesting it may not be indexed as a note with relations.

**Known gaps confirmed:** O-25, O-49, O-56

**New issues:**
- [medium] `brain context <path>` returned no output for a PM module doc path (architecture.md). The command silently failed rather than returning an error or noting the note was not indexed. This makes it impossible to discover related notes via the graph.
- [medium] No mechanism to search tasks by semantic topic (e.g., 'mobile', 'iOS') — `brain pm tasks --search mobile` returns 0 results even though multiple tasks are iOS/Android focused, because task titles don't contain the keyword 'mobile'.
- [low] Cross-system prompt ('Mobile App workstream') silently returns empty rather than suggesting the closest matching workstream. Users get no helpful disambiguation.

---

#### P-27: "What knowledge base notes don't have any corresponding PM tasks yet?"

| Metric | Previous | Current |
|--------|----------|---------|
| Total calls | 16 | **32** |
| Brain CLI | 14 | **27** |
| Non-brain | 5 | **5** |
| File reads | 0 | **0** |
| Quality | 3/5 | **2/5** |

**Commands:** `brain search "" --limit 100` → `brain pm tasks list` → `brain pm tasks --help` → `brain search "brain" --limit 50` → `brain pm tasks` → `brain status` → `brain pm tasks --json` → `brain search "brain research" --limit 20` → `brain graph --help` → `brain search "second brain" --limit 10` → `brain memories --help` → `brain search "." --limit 100` → `brain pm --help` → `brain search "RAG hybrid" --limit 5` → `brain pm status` → `brain search "embedding" --limit 5` → `brain pm check` → `brain search "personal knowledge management" --limit 5` → `brain pm context VOLTR-01.02` → `brain inbox` → `brain stale` → `brain search "knowledge" --limit 10` → `brain memories list --limit 20` → `brain pm workstream --help` → `brain context --help` → `brain context "docs/bluetooth-protocol" --json` → `brain pm workstream list --json` → `brain search "changelog migration" --limit 5` → `brain pm task --help` → `brain pm tasks --json (grouped by workstream)` → `brain pm tasks --json (all fields check)`

**What worked:** brain status gave exact note type breakdown (research=11, task=42, etc.),brain pm tasks --json exposed full task schema — confirmed no notes/docs field exists,brain pm workstream list --json showed 7 workstreams with titles and descriptions,brain search snippets surfaced doc filenames and content for topic matching,Grouping tasks by workstream + topic-matching against docs enabled qualitative coverage map

**Friction:** brain search always returns PM module notes, never surfaces research-type KB notes via keyword queries,No brain CLI command to list notes by type (e.g., --type research) — brain status gives counts only,brain pm tasks --json has no notes/docs/references field — cross-reference is impossible via API,brain context requires exact note ID but no command exists to enumerate note IDs,brain pm check returned 'No issues found' — does not detect doc-task coverage gaps,Had to infer doc-task links entirely from workstream descriptions and task titles (fragile)

**Known gaps confirmed:** O-25, O-49

**New issues:**
- [high] brain search never returns research-type KB notes — they are outscored by PM notes on all queries, making them practically unreachable via search
- [medium] No brain CLI command to list notes filtered by type (--type research). brain status shows counts but no way to enumerate notes by type.
- [high] PM task schema has no notes/docs/references field — ingested reference docs have no formal link to tasks, making coverage gaps invisible to the system
- [medium] brain pm check does not detect doc-task coverage gaps — consistency check is limited to internal PM data integrity only

---


### Filtering

#### P-28: "Show me all critical tasks that are still pending, grouped by workstream"

| Metric | Previous | Current |
|--------|----------|---------|
| Total calls | 5 | **5** |
| Brain CLI | 4 | **5** |
| Non-brain | 1 | **1** |
| File reads | 0 | **0** |
| Quality | 5/5 | **4/5** |

**Commands:** `brain pm tasks list --priority critical --status pending --format json` → `brain pm task list --help` → `brain pm task list --priority critical --status pending --json` → `brain pm task list --priority critical --status pending --json (piped to python3 grouping)` → `brain pm workstream list --json`

**What worked:** The --priority and --status filters composed cleanly on `brain pm task list`. The --json flag gave structured output ideal for python3 grouping. `brain pm workstream list --json` provided human-readable titles to enrich the workstream labels. virtualStates in the JSON payload made BLOCKED detection trivial.

**Friction:** The plural alias `brain pm tasks list` does not support filter flags (it just maps to the help-only alias). Had to discover the canonical `brain pm task list` form via --help. No native --group-by flag exists, so grouping required a python3 pipe. Workstream names are not embedded in the task objects, requiring a second CLI call to join.

**Known gaps confirmed:** O-55, O-54

**New issues:**
- [medium] The `brain pm tasks list` alias (plural) silently ignores filter options like --priority and --status instead of forwarding them to the underlying command, causing silent no-ops that appear to succeed with no output.
- [low] Task list JSON does not include workstream title — only workstream number and project prefix — requiring a separate `workstream list` call to resolve human-readable names for display.

---

#### P-29: "Give me the full details of the 3 highest priority tasks including any related notes"

| Metric | Previous | Current |
|--------|----------|---------|
| Total calls | 14 | **22** |
| Brain CLI | 14 | **20** |
| Non-brain | 0 | **2** |
| File reads | 0 | **0** |
| Quality | 4/5 | **3/5** |

**Commands:** `brain pm tasks --sort priority --limit 3` → `brain pm tasks --help` → `brain pm task list --help` → `brain pm task list --priority critical --json` → `brain pm task show VOLTR-03.01 --json` → `brain pm task show VOLTR-04.01 --json` → `brain pm task show VOLTR-05.01 --json` → `brain pm task show VOLTR-03.01` → `brain pm task show VOLTR-04.01` → `brain pm task show VOLTR-05.01` → `brain pm task notes VOLTR-03.01` → `brain pm task notes VOLTR-04.01` → `brain pm task notes VOLTR-05.01` → `brain pm --help` → `brain search 'VOLTR-03.01 ReplayBLEAdapter' --json` → `brain pm context VOLTR-03.01` → `brain pm context VOLTR-04.01` → `brain pm context VOLTR-05.01` → `brain search 'VOLTR-04.01 CI pipeline code-gen' --json` → `brain search 'VOLTR-05.01 exercise catalog strength' --json` → `brain pm workstream show VOLTR-03` → `brain pm workstream show VOLTR-04` → `brain pm workstream show VOLTR-05` → `brain pm task list --workstream VOLTR-03 --json` → `brain pm task list --workstream VOLTR-04 --json` → `brain pm task list --workstream VOLTR-05 --json` → `brain search 'ReplayBLEAdapter session replay testing' --json` → `brain search 'exercise catalog strength entries voltra' --json` → `brain pm notes VOLTR-03` → `brain pm notes VOLTR-04` → `brain pm notes VOLTR-05` → `brain pm dispatch VOLTR-03.01` → `brain pm dispatch VOLTR-04.01` → `brain pm dispatch VOLTR-05.01` → `brain pm prompt list --project VOLTR` → `brain pm prompt show VOLTR-P01` → `brain pm prompt --help` → `brain pm prompt show VOLTR-03.01` → `brain pm workstream show VOLTR-03 --json` → `brain pm workstream show VOLTR-04 --json` → `brain pm workstream show VOLTR-05 --json`

**What worked:** `brain pm task list --priority critical --json` cleanly filtered to all critical tasks,`brain pm task show <id> --json` gave structured task data quickly,`brain pm workstream show <id> --json` provided workstream descriptions which served as the main 'related notes' context,`brain pm task list --workstream <id>` revealed upstream/downstream dependency relationships,`brain search` found relevant ingested docs linked to task subjects (platform-adapters.md, VOLTR-03.md, VOLTR-05.md)

**Friction:** No `--sort priority` flag on task list — had to use `--priority <level>` filter instead, which requires knowing the priority level names,No `--limit` flag to get top N tasks across all priority levels without filtering,`brain pm task notes <id>` doesn't exist — no direct way to retrieve notes linked to a specific task; had to use `brain search` and `brain pm context` as workarounds,Task `body` field is empty for all three tasks — detailed specs live in workstream/project docs, not in the task record itself, making 'full details' require stitching from multiple sources,`brain pm prompt show VOLTR-P01` failed (NOT_FOUND) even though prompt list reported VOLTR-P01 as current — prompt show only accepts task IDs, not prompt IDs (confusing CLI inconsistency),`brain pm dispatch` returned minimal info and did not include related docs despite being designed for context assembly,No way to determine ordering among equal-priority tasks — ambiguous which 3 of the 5 critical tasks are 'highest priority'

**Known gaps confirmed:** O-54, O-53, O-50

**New issues:**
- [low] `brain pm prompt show <prompt-id>` returns NOT_FOUND even when the prompt ID is valid — only task IDs are accepted, but error message doesn't indicate this distinction
- [medium] No sorting mechanism for task list — `--sort priority` fails with 'unknown option'; no way to get tasks ordered by priority level without knowing the exact level name to filter by
- [medium] No `--limit` flag on task list — cannot request 'top N tasks' without manually truncating output
- [medium] Task body is empty for all critical tasks; specs live in workstream/project docs. There's no structured link from task → related notes, requiring search workarounds to find related context

---

#### P-30: "Search for everything related to 'analytics' across both notes and tasks"

| Metric | Previous | Current |
|--------|----------|---------|
| Total calls | 9 | **14** |
| Brain CLI | 9 | **12** |
| Non-brain | 0 | **2** |
| File reads | 0 | **0** |
| Quality | 4/5 | **4/5** |

**Commands:** `brain search "analytics"` → `brain pm tasks list --search "analytics"` → `brain pm tasks list` → `brain search "analytics" --memories` → `brain pm tasks list --help` → `brain pm tasks --help` → `brain pm task --help` → `brain pm task list --help` → `brain pm task list --search "analytics" --json` → `brain pm task list --json` → `brain search "analytics" --json` → `brain pm task show VOLTR-05 --json` → `brain pm task list --project VOLTR --json` → `brain pm task list --workstream 5 --json`

**What worked:** brain search --json gave well-structured results with scores and file paths. brain pm task list --search enabled direct title-based task filtering. Combining both commands gave complete coverage across the two data domains.

**Friction:** 1) No single unified command to search both notes and tasks — required two separate invocations. 2) The `brain pm tasks list` alias (plural) rejected the --search flag with 'too many arguments', forcing use of the singular `brain pm task list --search`. 3) `brain search` returns PM module notes (private visibility) mixed with user notes, making it hard to distinguish PM context from personal knowledge. 4) The task search only matches on title, not on workstream description or body content — VOLTR-05 workstream tasks didn't surface via --search 'analytics' even though the workstream is literally named 'Analytics Accuracy and Completeness'.

**Known gaps confirmed:** O-49, O-55

**New issues:**
- [medium] brain pm tasks list (plural alias) rejects --search flag with 'too many arguments' — the alias does not forward flags to the underlying task list command, making it unusable for filtered queries
- [medium] Task --search only matches task titles, not workstream descriptions — VOLTR-05 (Analytics Accuracy workstream) tasks do not appear in --search 'analytics' results even though the parent workstream is about analytics; users must know the workstream number to find related tasks
- [low] brain search returns private PM module notes (visibility: private) in general search results — notes from modules/pm/ mix with user personal notes, potentially polluting knowledge base search with project management content

---


## Cross-Cutting Findings

### Quality by Category

| Category | Avg Quality | Avg Calls |
|----------|-------------|-----------|
| Discovery | 4.0/5 | 17.7 |
| Navigation | 4.0/5 | 10.5 |
| Context Assembly | 2.7/5 | 28.3 |
| Planning | 3.3/5 | 22.3 |
| Capabilities | 4.3/5 | 14.7 |
| Gap Exercisers | 3.8/5 | 14.3 |
| Write Ops | 3.0/5 | 12.7 |
| Agent Commands | 2.5/5 | 15.5 |
| Cross-System | 2.5/5 | 26.0 |
| Filtering | 3.7/5 | 13.7 |

### Most Frequent Gaps Hit

| Observation | Prompts Affected |
|-------------|-----------------|
| O-25 | 8 |
| O-16 | 7 |
| O-17 | 4 |
| O-50 | 4 |
| O-54 | 4 |
| O-09 | 3 |
| O-26 | 3 |
| O-23 | 3 |
| O-49 | 3 |
| O-33 | 2 |

### New Issues Discovered

| Source | Severity | Description |
|--------|----------|-------------|
| P-01 | medium | Active project context set by 'brain pm list' output (shows 'active') is not honoured by 'brain pm status' — requires explicit prefix argument |
| P-01 | low | 'brain pm tasks list' alias rejects arguments ('too many arguments') but 'brain pm task list' works — alias and canonical command have inconsistent argument handling |
| P-02 | low | `brain pm tasks` accepts `--status` but not `--filter` — the option name is undiscoverable without reading help, and the help text does not list valid status values |
| P-02 | medium | `brain context <path>` fails with 'note not found' when given a raw filesystem path returned by `brain search` — forces a two-step lookup (search → get slug → context) that is not obvious |
| P-02 | medium | `brain pm audit` silently ignores `--project` flag and requires `brain pm use` to set active project first — inconsistent with other pm subcommands that accept `--project` directly |
| P-03 | high | Task body/description field is empty for all tasks inspected (VOLTR-01.02 JSON shows `"body": ""`). Task titles are the only description available — insufficient for a new contributor to understand scope or acceptance criteria. |
| P-03 | low | `brain pm tasks` (without subcommand) is not a valid command — the right command is `brain pm task list`. The plural form gives a cryptic error about active project rather than a usage hint. |
| P-03 | medium | `brain pm context <id>` output is nearly identical to `brain pm task show <id>` — shows only status/priority/workstream with no body context assembled. Does not pull in related docs, architecture context, or linked notes. |
| P-04 | medium | Active project shown in `brain pm list` as '(active)' but `brain pm tasks --priority critical` still errored with 'no active project set' — active project state not being respected on first invocation of the session |
| P-04 | low | No cross-project critical task view — `--priority critical` only works within the active project; no way to query all projects at once without iterating manually |
| P-05 | medium | brain pm next default limit of 10 silently excludes lower-priority workstreams. Users navigating to a specific workstream must know to pass --limit <large-number> and then filter manually. No --workstream filter flag exists. |
| P-05 | high | brain pm context returns near-empty output (3 lines) for tasks — no description body, acceptance criteria, or linked notes. The command exists but provides no actionable context beyond what brain pm task list already shows. |
| P-05 | medium | Workstream name mismatch: user asked for 'Mobile App' workstream but no such name exists. The CLI has no fuzzy/semantic workstream lookup — users must know the exact workstream name or ID. |
| P-06 | low | `brain pm tasks list` (plural alias) accepts flags silently but produces no output instead of delegating to `task list` or showing an error. Makes discovery harder. |
| P-06 | medium | --search filter matches only title substrings, so testing tasks with titles like 'Validate', 'Verify', or 'Raise coverage' are missed unless you use --category. No cross-field search (title + category + tags). |
| P-07 | medium | `brain pm tasks` (alias) doesn't pass through any options to `task list` — only `--help` works. Options like `--status`, `--json`, `--project` all fail with 'unknown option'. The alias is a dead end for any filtered query. |
| P-08 | high | No prefix normalization or fuzzy matching: 'VOLT-01.01' vs 'VOLTR-01.01' both silently fail with NOT_FOUND and no suggestion. Users will commonly drop/mistype the trailing R. |
| P-08 | medium | Task gap at position .01: workstream VOLTR-01 has tasks 02-06 but no 01.01. There is no way to query what happened to it (deleted? never created?). Audit trail for task lifecycle is missing from CLI. |
| P-08 | high | brain pm task show / dispatch / context return the same minimal one-line output — no description, acceptance criteria, related files, or notes are surfaced even when they may exist in the backing note. |
| P-09 | medium | `brain context <absolute-path>` fails for PM module notes with 'note not found'. PM notes likely require a slug/relative ID rather than a filesystem path, but the correct ID format is not documented or discoverable from the CLI help. |
| P-09 | medium | Search snippets truncate ASCII diagrams and code blocks mid-content, making it impossible to read the full architecture diagram from platform-adapters.md via search alone. No CLI command provides full document text for PM module notes. |
| P-10 | medium | The onboard-manifest lists 4 components but provides no cross-component dependency metadata — there is no way to know which repos import which via the CLI alone. The dependency chain had to be inferred from workstream descriptions and changelog entries, which is fragile. |
| P-10 | high | brain graph and brain context return empty relations for all notes — inter-note relationships have not been established despite multiple ingested documents in the same project domain. This makes dependency chain reconstruction impossible without indirect inference. |
| P-10 | low | Search results for architecture queries are dominated by the VOLTR PM project. If the user has notes about the brain project's own architecture, they would be invisible unless very precisely named. There is no container/module filter for 'the brain project itself'. |
| P-11 | high | No goal-oriented or semantic task filtering: 'brain pm task list --search' only does substring title matching, not semantic relevance. A query like 'tasks relevant to shipping Android' returns nothing useful. Users must manually inspect all tasks. |
| P-11 | medium | waves command ignores goal context: it returns all remaining tasks in topological order, with no way to filter to a subset relevant to a milestone or goal. For large projects this is overwhelming. |
| P-11 | high | No milestone or release target concept in the data model: there is no way to tag tasks as 'required for Android MVP' or associate them with a release gate. All planning of this type must be done externally. |
| P-12 | medium | `brain pm task show <WAVE-ID>` returns NOT_FOUND for parent wave IDs (e.g., VOLTR-03). Users naturally try to inspect a wave as a unit; there should be a `brain pm wave show VOLTR-03` command or the task show command should route to wave show when the ID is a wave. |
| P-12 | low | `brain pm tasks --filter` is not a valid option but is a natural invocation given the alias exists. The `tasks` alias should either support the same options as `task list` or print a helpful error pointing to `task list`. |
| P-12 | high | No coverage report ingestion pipeline. Actual coverage percentages (lines, branches, functions) from CI are not stored in the brain, making planning questions about coverage quality unanswerable with real data. |
| P-13 | low | VOLTR-07.02 is missing from the task list — there is a gap in task numbering for workstream 7. It's unclear if it was deleted, never created, or renumbered. |
| P-13 | low | `brain pm task list --category` only accepts exact category values; no help text lists valid categories. Had to guess 'documentation' worked. |
| P-13 | medium | `brain pm workstream show <id>` returns no body text, description, goal, or task list — it's a stub that provides no useful planning context. |
| P-14 | low | brain pm task add --workstream accepts only a number, not a workstream name or display ID (e.g. PROJ-03). Users must look up the number separately from workstream list output, adding friction. |
| P-14 | low | brain pm workstream list has no --filter or --search option to find a specific workstream by name fragment, requiring users to scan the full list manually. |
| P-15 | medium | `brain pm waves --json` task objects omit `depends_on` field — the blocker relationships are invisible in the JSON output, requiring a second `pm tasks` call and manual ID correlation to explain why Wave 1 tasks are blocked |
| P-16 | medium | `brain pm dispatch` is functionally indistinguishable from `brain pm context` in its current output — if it is meant to produce a richer agent-ready bundle (with system prompt, role assignment, etc.) that capability is not implemented or not surfaced via the CLI |
| P-16 | medium | No way to see tasks currently claimed-by-me or in-progress across a session restart — if the claim token is lost there is no recovery path visible from the CLI |
| P-16 | low | `brain pm complete` accepts `--token` but does not reject completion without a valid token — the token guard appears to be non-enforced or optional, undermining concurrency safety |
| P-17 | low | `brain pm tasks list` fails with 'too many arguments' — the command takes no subcommands, making 'list' a misleading alias description |
| P-17 | low | MEDIUM priority count in text output shows 11 tasks but only 2 were listed under the MEDIUM section in my answer — the count in the answer section was mis-stated (should be 13 total medium tasks). The JSON was accurate. |
| P-18 | medium | The `brain pm workstreams` alias does not accept 'list' as a subcommand argument even though its help text says it is an 'alias for workstream list', causing confusing 'too many arguments' errors |
| P-18 | medium | No --project filter on `brain pm workstreams` — impossible to scope workstream listing to a specific project when multiple projects exist |
| P-19 | low | `brain pm tasks` (plural) fails with 'too many arguments' error — the command is `brain pm task` (singular) but the plural form should either work or give a better error message |
| P-19 | medium | `brain context <path>` fails for PM module files with 'note not found' — PM module notes live in the brain workspace but are not indexed as searchable brain notes, creating a split between `brain search` (finds them) and `brain context` (cannot access them) |
| P-19 | high | All 41 task bodies are empty strings — tasks have no body content linking back to architecture docs, requirement specs, or acceptance criteria. This limits the utility of `brain pm dispatch` and `brain pm context` for providing meaningful agent context |
| P-20 | high | No temporal/milestone metadata on tasks (no due date, quarter, sprint, or release target field). The question 'what is planned for next quarter' is unanswerable from PM data alone — the wave ordering is the only proxy. |
| P-20 | medium | Category vocabulary mismatch: PM uses 'implementation' not 'feature', so natural-language queries about feature work don't map to any filterable category. A --type alias or 'feature' category alias would help. |
| P-20 | low | brain pm next output is capped with '... and 21 more eligible tasks' without a --all flag or --json option to retrieve the full list programmatically. |
| P-21 | medium | brain pm tasks (alias) does not accept any filter arguments — it errors with 'too many arguments for list. Expected 0 arguments but got 1' when passed --project or a positional prefix. Users must use the longer 'brain pm task list' form for filtering. |
| P-21 | medium | No project prefix aliasing or fuzzy matching: 'VLT' is a reasonable abbreviation for VOLTR but resolves to NOT_FOUND rather than suggesting the correct prefix. |
| P-21 | low | Workstream 1 is missing task number 1 (VOLTR-01.01 was never created or was deleted). No command exposes deleted tasks to allow agents to detect this gap vs. a numbering skip. |
| P-22 | medium | No workstream lookup by name/label — 'brain pm workstream list' only lists by number, forcing agents to manually match natural-language workstream names. A --name or --search flag would remove the ambiguity. |
| P-22 | low | 'brain pm tasks list' (plural alias) fails with 'too many arguments' when called as 'brain pm tasks list' — the alias maps 'tasks' to 'task list' but then 'list' becomes an extra argument. The alias should handle subcommands or document the limitation. |
| P-23 | low | brain pm tasks (alias) does not accept any arguments/flags like --project, making it impossible to filter the alias shortcut; users must use 'brain pm task list --project X' instead |
| P-23 | medium | No tombstone or audit record for deleted tasks — VOLTR-02.03 is missing with no trace; impossible to distinguish 'deleted' from 'never existed' |
| P-23 | medium | No prefix alias resolution: 'VLT' is not recognized as a short form of 'VOLTR', which is a common user error with long project prefixes |
| P-24 | medium | brain pm context returns no error hint when an abbreviated/partial ID is given (e.g. VLT-01.05 vs VOLTR-01.05) — no 'did you mean?' suggestion |
| P-24 | low | brain pm workstream show only returns a single-line summary with no task list or metadata — insufficient for workstream-level context |
| P-25 | high | brain pm dispatch and brain pm task show produce no stderr/stdout error message when a task ID does not exist — they silently exit 1, making it impossible to distinguish 'not found' from other failure modes without additional investigation |
| P-25 | medium | No CLI surface for deleted task history or tombstoning — VOLTR-03.02 appears to have been deleted, but there is no way to confirm this or recover its content via brain pm commands |
| P-25 | medium | brain pm prompt write and show return only a one-line header with no prompt body for tasks with empty body content — the dispatch output is therefore not useful as an agent prompt template |
| P-26 | medium | `brain context <path>` returned no output for a PM module doc path (architecture.md). The command silently failed rather than returning an error or noting the note was not indexed. This makes it impossible to discover related notes via the graph. |
| P-26 | medium | No mechanism to search tasks by semantic topic (e.g., 'mobile', 'iOS') — `brain pm tasks --search mobile` returns 0 results even though multiple tasks are iOS/Android focused, because task titles don't contain the keyword 'mobile'. |
| P-26 | low | Cross-system prompt ('Mobile App workstream') silently returns empty rather than suggesting the closest matching workstream. Users get no helpful disambiguation. |
| P-27 | high | brain search never returns research-type KB notes — they are outscored by PM notes on all queries, making them practically unreachable via search |
| P-27 | medium | No brain CLI command to list notes filtered by type (--type research). brain status shows counts but no way to enumerate notes by type. |
| P-27 | high | PM task schema has no notes/docs/references field — ingested reference docs have no formal link to tasks, making coverage gaps invisible to the system |
| P-27 | medium | brain pm check does not detect doc-task coverage gaps — consistency check is limited to internal PM data integrity only |
| P-28 | medium | The `brain pm tasks list` alias (plural) silently ignores filter options like --priority and --status instead of forwarding them to the underlying command, causing silent no-ops that appear to succeed with no output. |
| P-28 | low | Task list JSON does not include workstream title — only workstream number and project prefix — requiring a separate `workstream list` call to resolve human-readable names for display. |
| P-29 | low | `brain pm prompt show <prompt-id>` returns NOT_FOUND even when the prompt ID is valid — only task IDs are accepted, but error message doesn't indicate this distinction |
| P-29 | medium | No sorting mechanism for task list — `--sort priority` fails with 'unknown option'; no way to get tasks ordered by priority level without knowing the exact level name to filter by |
| P-29 | medium | No `--limit` flag on task list — cannot request 'top N tasks' without manually truncating output |
| P-29 | medium | Task body is empty for all critical tasks; specs live in workstream/project docs. There's no structured link from task → related notes, requiring search workarounds to find related context |
| P-30 | medium | brain pm tasks list (plural alias) rejects --search flag with 'too many arguments' — the alias does not forward flags to the underlying task list command, making it unusable for filtered queries |
| P-30 | medium | Task --search only matches task titles, not workstream descriptions — VOLTR-05 (Analytics Accuracy workstream) tasks do not appear in --search 'analytics' results even though the parent workstream is about analytics; users must know the workstream number to find related tasks |
| P-30 | low | brain search returns private PM module notes (visibility: private) in general search results — notes from modules/pm/ mix with user personal notes, potentially polluting knowledge base search with project management content |
