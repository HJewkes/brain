# PM Module Onboarding Observations

**Date:** 2026-02-27
**Test project:** voltras-workspace (prefix: VLT)
**Tester:** Real user walkthrough in clean Claude Code session
**Brain version:** 0.4.0

## Setup

- Following quickstart.md → guide.md flow
- voltras-workspace has 5 repos: voltra-private, voltra-node-sdk, voltras/mobile, workout-analytics, titan-design
- Cross-repo dependency chain documented in workspace CLAUDE.md

## Observations

### O-01: Docs don't clarify where to run commands from
- **Severity:** docs
- **Where:** quickstart.md prerequisites
- **What happened:** User's first question was "should I be in the project directory?"
- **Expected:** Docs should state that brain is a global tool with a single database — commands work from any directory. Unlike git, it's not workspace-scoped.
- **Fix:** Add a note in prerequisites or step 1 clarifying this. Also consider whether PM *should* be workspace-aware in the future (e.g., auto-detecting project from CWD).

### O-02: `brain init` output is technical, not welcoming
- **Severity:** friction
- **Where:** `brain init` command output
- **What happened:** Output shows paths, model names, and feature flags. User said "it doesn't feel like a success" and wanted human-readable confirmation of what happened and what's next.
- **Expected:** A warm confirmation that things worked, plain-language summary, and clear next steps. Technical details should be available (e.g., via `--verbose` or `brain status`) but not the default. Something like:
  ```
  Brain initialized successfully!

  Your notes live in ~/brain
  Search: ready (hybrid BM25 + vector)
  Memory extraction: ready

  Next steps:
    brain index          Index your existing notes
    brain quick "idea"   Capture a thought
    brain pm init        Set up project management
  ```
- **Fix:** Rework default `init` output to lead with success message, hide paths/model names behind `--verbose`, add "Next steps" section.

### O-03: `brain pm` command not found — PM module not loaded from npm install
- **Severity:** blocker
- **Where:** `brain pm init` — first PM command
- **What happened:** `error: unknown command 'pm'`. The module loader's `getBuiltinModulesDir()` resolves to a path outside the package (`dist/../../modules`). The npm package ships a single bundled `dist/cli.js` via tsup — there are no separate module files on disk to discover.
- **Expected:** PM commands available after `npm install -g`
- **Root cause:** `loader.ts:getBuiltinModulesDir()` uses a path-based discovery pattern that assumes unbundled source files. tsup bundles everything into one file, so there's nothing to discover at runtime.
- **Fix options:**
  1. **Static registration** — import PM module directly in `cli.ts` instead of dynamic discovery. Simple, works with bundling, but loses the "discover plugins on disk" extensibility.
  2. **tsup entry points** — configure tsup to emit each module as a separate chunk/entry, keeping the discovery pattern. More complex build config.
  3. **Hybrid** — statically register built-in modules (PM), keep dynamic discovery for user-installed plugins in a known directory (e.g., `~/.config/brain/modules/`).
- **Recommendation:** Option 3 (hybrid). Built-in modules should never rely on filesystem discovery from within a bundle. Reserve dynamic loading for future user plugins.

### O-04: No way to reset brain to a clean state
- **Severity:** suggestion
- **Where:** general CLI
- **What happened:** When testing onboarding repeatedly, need to wipe everything and start fresh. No `brain reset` or `brain uninstall` command exists. Have to manually delete 3 locations: `~/Library/Application Support/brain/brain.db`, `~/Library/Preferences/brain/config.json`, `~/brain/`.
- **Expected:** A `brain reset` or `brain doctor --reset` command that wipes state cleanly. Should require `--confirm` flag.
- **Fix:** Add a reset command, or at minimum document the manual cleanup paths.

### O-06: No Claude-assisted onboarding path exists
- **Severity:** friction
- **Where:** overall onboarding flow
- **What happened:** The quickstart assumes a user will manually run CLI commands in sequence. In practice, users will be in Claude Code and want to say "set up brain PM for this project." There's no skill, CLAUDE.md guidance, or workflow that lets Claude research the project and interactively set up workstreams/tasks.
- **Expected:** After `brain pm install-hooks` (or as part of first-run), a `/pm-onboard` skill or similar that: reads the project's CLAUDE.md/README, asks clarifying questions about workstreams and tracks, creates the project structure, and explains what it did.
- **Fix:** Create an onboarding skill that wraps the CLI commands with project-aware intelligence. The CLI stays as the low-level API; the skill is the recommended entry point.

### O-07: Agent spends many tool calls building context that could be provided directly
- **Severity:** friction
- **Where:** Claude session — agent reads CLAUDE.md, README, docs, workspace files to understand both the project and how brain PM works
- **What happened:** Agent made ~10+ tool calls just to understand the workspace and brain PM before asking its first question. This context could be standardized.
- **Expected:** A skill or command that assembles relevant context efficiently — workspace structure, brain PM capabilities/syntax, example outputs — so the agent doesn't have to explore from scratch every time.
- **Fix options:**
  1. Onboarding skill that pre-loads project context + PM usage examples
  2. `brain pm help onboard` command that dumps a context bundle (quickstart examples, CLI syntax, sample output)
  3. Existing docs (demo.md, quickstart.md) surfaced via the skill rather than requiring file discovery

### O-08: Agent wanted to create a demo project before the real one
- **Severity:** suggestion
- **Where:** Claude session — agent asked "Should I create a demo project first?"
- **What happened:** Agent likely wants to understand CLI behavior before committing to real commands. This is the agent building its own context on how the system works.
- **Expected:** Agent shouldn't need to experiment. Docs already have full command/output examples (demo.md, quickstart.md, e2e tests). If these were in the agent's context, it wouldn't need a sandbox.
- **Fix:** Ensure the onboarding skill or orchestrator skill includes representative command/output pairs. Could also add `brain pm demo --dry-run` that shows what a sample project looks like without creating anything.

### O-05: `pm init` output is redundant and doesn't show project name
- **Severity:** friction
- **Where:** `brain pm init "Voltras" --prefix VLT`
- **What happened:** Output is `VLT - VLT (active)`. The project name "Voltras" is nowhere in the output. Both fields show the prefix, making it look like a bug.
- **Expected:** Something like `Created project "Voltras" (VLT) — active` or at minimum show the name the user provided.
- **Fix:** Update the display format in project.ts to include the project name.

### O-12: Workstream-per-repo vs workstream-per-feature — object model gap
- **Severity:** suggestion
- **Where:** conceptual — workstream design
- **What happened:** Agent created workstreams per repo/domain (Mobile, SDK, Analytics, Design System, Infra). This makes sense for worktree isolation and parallelization. But the user's mental model was feature-driven workstreams like "Mid Exercise Coaching" that cut across all repos — review telemetry data, extend analytics, add design elements, integrate in app.
- **The tension:** Repo-based workstreams align with code isolation. Feature-based workstreams align with how work is actually planned and prioritized. Tasks in a feature workstream would touch multiple repos.
- **Possible missing concept:** "Components" or "areas" as a separate dimension from workstreams. Many PM tools (Jira, Linear, Shortcut) separate the organizational container (epic/project/cycle) from the code area (component/team/label). Brain's model currently has only project → workstream → task, with tasks belonging to exactly one workstream.
- **Research needed:** Review object models of Jira (project/component/epic/sprint), Linear (project/team/cycle/label), Shortcut (epic/iteration/team/label), GitHub Projects (views/fields), and Asana (project/section/portfolio) to identify what dimensions we're missing. This could be a brain research task itself.
- **Fix options:**
  1. Add a "component" or "area" concept orthogonal to workstreams (task belongs to 1 workstream + N components)
  2. Use labels/tags on tasks for the cross-cutting dimension
  3. Keep workstreams feature-based and use a different mechanism for code-area isolation
  4. Support both patterns and let the user choose

### O-13: Post-init experience doesn't guide toward backlog discovery
- **Severity:** friction
- **Where:** after workstream setup, agent presented generic next steps
- **What happened:** After creating the project and workstreams, the agent suggested broad generic actions. The user actually wanted: build brain's context on the project (read existing code, docs, issues, READMEs across repos) and use that understanding to identify and populate a real backlog.
- **Expected:** The natural next step after init should be "let me understand your project deeply and help you identify what needs to be done" — not "here are some things you could do." This is the highest-value part of the PM tool: turning project understanding into structured work.
- **Fix:** The onboarding skill should have a "backlog discovery" phase after structure setup: read project docs/code/issues → propose tasks with dependencies → user approves/edits → bulk create. Could also integrate with `brain index` to build searchable project context first.

### O-14: User had to prompt for backlog discovery — agent didn't suggest it
- **Severity:** friction
- **Where:** post-init flow
- **What happened:** User prompted: "It would be great to work through the project architecture and documents to get them into the brain first, then transition to building out the backlog. Shall we deploy a sub-agent per workstream so that it can use the context dump it creates as the basis for generating those tasks?" — this is exactly the right workflow but the user had to design it themselves.
- **Expected:** After structure setup, the onboarding flow should naturally transition to "let me explore your codebase and identify work items." The user even had to suggest the parallelization strategy.
- **Fix:** Build this into the onboarding skill as a standard phase: structure → discovery → backlog generation → review/approve.

### O-15: Sub-agent-per-repo exploration worked well — could be a standard pattern
- **Severity:** suggestion (positive)
- **Where:** backlog discovery phase
- **What happened:** 5 Sonnet agents explored repos in parallel, each creating brain notes for architecture and generating ~10-15 PM tasks with real findings (broken CI, stale imports, missing tests). Total ~58 tasks.
- **This worked because:** Each agent had a clear scope (one repo), used brain's CLI to create notes and tasks, and returned structured summaries. The parent agent aggregated results.
- **Codify as:** A `brain pm discover` or onboarding skill phase that spawns one agent per workstream/repo, each doing: read code → create brain note → generate tasks → return summary. This is the "backlog bootstrap" pattern.

### O-16: No dependencies created — all 67 tasks in Wave 0
- **Severity:** friction
- **Where:** `brain pm waves`, `brain pm briefing`
- **What happened:** All 67 tasks are in Wave 0 with zero dependencies. The wave engine, briefing, and `next` commands are all useless — everything is "eligible." The sub-agents created tasks independently per repo and didn't establish any cross-task or cross-workstream dependencies.
- **Expected:** Even within a single workstream, tasks have natural ordering (e.g., "fix broken test" before "add CI coverage"). Cross-workstream deps should also exist (e.g., SDK publish before mobile upgrade).
- **Root cause:** The sub-agent prompts didn't instruct agents to declare `--depends-on` relationships. Dependencies are hard to do per-agent since agents don't know what other agents created.
- **Fix options:**
  1. **Post-generation dependency pass** — after all tasks exist, a coordinator agent (or command) reviews the full list and adds dependencies. This is a second pass that has full visibility.
  2. **Intra-workstream deps in agent prompts** — instruct each agent to at least set dependencies within its own workstream (it knows its own task IDs).
  3. **`brain pm auto-deps`** — a command that analyzes task descriptions/categories and suggests dependency edges. Could be LLM-assisted.
- **Recommendation:** Option 1 (coordinator pass) for cross-workstream, option 2 for within-workstream. Both should be part of the onboarding flow.

### O-17: Task list output lacks task names — just IDs and metadata
- **Severity:** friction
- **Where:** `brain pm task list --project VOLT`
- **What happened:** Output shows `VOLT-01.01 - pending [critical] (auto)` for 67 tasks. No task names/descriptions visible. The list is meaningless without running `task show` on each one individually.
- **Expected:** Task list should show at minimum the task name: `VOLT-01.01 - Set up EAS build for Google Play [critical] pending`
- **Fix:** Update task list output format to include the task title.

### O-18: Briefing lists all 67 task IDs inline — unreadable
- **Severity:** friction
- **Where:** `brain pm briefing`
- **What happened:** The "Eligible" line dumps all 67 task IDs in a comma-separated list. The briefing is supposed to be a quick overview but it's a wall of IDs.
- **Expected:** Briefing should summarize: "Eligible: 67 (3 critical, 19 high, 25 medium, 20 low)" or show top 5 by priority. Full list available via `brain pm next`.
- **Fix:** Cap the inline ID list (e.g., top 5 by priority + "and 62 more"), add priority breakdown to the summary.

### O-19: Final summary readout is great — should be a built-in command
- **Severity:** suggestion
- **Where:** agent's final summary after all sub-agents completed
- **What happened:** The agent produced a well-structured summary: knowledge base stats, task breakdown by workstream/priority, critical items, notable bugs. This is exactly what you want after onboarding or at session start. But it cost tokens to generate and isn't reproducible.
- **Expected:** `brain pm briefing` or a dedicated `brain pm summary` should produce this quality of readout natively — task counts by workstream and priority, critical items listed, bugs flagged. No LLM needed for structured data aggregation.
- **Fix:** Enhance `brain pm briefing` to include workstream-level breakdown and priority matrix. Check if existing briefing structure already has the data but just formats it poorly.

### O-20: Agent surfaces CLI commands the user won't run in Claude Code
- **Severity:** friction
- **Where:** agent's final message suggests `brain pm briefing`, `brain pm next`, `brain pm waves`
- **What happened:** Agent tells the user they can run these commands. But in a Claude Code session, the user won't — they'll ask Claude to do things, and Claude should use these commands behind the scenes. Exposing the CLI is leaking implementation details.
- **Expected:** The skill should teach Claude how to use the CLI internally, but present results to the user in natural language. The CLI is the API for the agent, not the user's interface.
- **Fix:** Onboarding/orchestrator skill should explicitly instruct Claude: "Use these commands to gather data. Present findings conversationally. Don't tell the user to run CLI commands unless they ask."

### O-21: Dependency wiring should happen during creation, not as a separate pass
- **Severity:** suggestion
- **Where:** backlog generation phase
- **What happened:** Sub-agents created tasks in isolation, no dependencies. A post-hoc coordinator pass would work but starts from scratch — the agents that understood the code have already exited.
- **Expected:** Each agent should declare intra-workstream dependencies during creation (it knows its own task IDs). Cross-workstream deps need coordination but can be seeded: the coordinator prompt should include each agent's task list + descriptions so it has context without re-reading code.
- **Fix:** Two-phase approach:
  1. Agent prompts include instruction to use `--depends-on` for obvious ordering within their workstream
  2. After all agents complete, coordinator gets all task IDs + titles + descriptions (not code) and adds cross-workstream edges
  This preserves agent context while giving the coordinator enough to wire cross-cutting deps.

### O-22: Onboarding should ask about external docs and project structure preferences
- **Severity:** suggestion
- **Where:** before backlog generation
- **What happened:** Agents only looked at what's in the repos. But real projects have context elsewhere — design docs in Google Docs/Notion/Confluence, Slack threads, Figma files, issue trackers, product briefs. The onboarding also didn't ask the user how they think about the project structure (feature-based vs domain-based workstreams, what the actual priorities are, what phase the project is in).
- **Expected:** Before launching discovery agents, the onboarding skill should ask:
  1. "Are there docs outside the repo I should know about?" (URLs, files, descriptions)
  2. "How do you think about the work? By feature area, by repo, by team?" (informs workstream structure)
  3. "What's the current priority / what are you trying to ship next?" (informs task priorities)
  4. "Any existing issue tracker or backlog I should pull from?" (GitHub Issues, Jira, Linear)
- **Fix:** Add an interview phase to the onboarding skill between structure setup and discovery. Answers get passed as context to discovery agents.

### O-23: All tasks are category=implementation — agents didn't use the full taxonomy
- **Severity:** friction
- **Where:** database — all 67 tasks have `category: implementation`
- **What happened:** Despite tasks like "Write unit tests for...", "Fix broken CI workflow", "Add JSDoc documentation", every task got `implementation`. The agents either didn't know about other categories or defaulted.
- **Impact:** Routing engine treats every task identically (opus model, worktree isolation, verification). Testing tasks should route to haiku, documentation to sonnet, etc.
- **Fix:** Agent prompts must include the category taxonomy with examples. Could also add validation — a task with "test" in the title and category=implementation should warn.

### O-24: All tasks are mode=auto — orchestration can't differentiate
- **Severity:** friction
- **Where:** database — all 67 tasks have `mode: auto`
- **What happened:** No tasks were set to `agent`, `human`, `assisted`, or `review`. The orchestration engine can't tell what should be automated vs manual.
- **Fix:** Agent prompts should specify: set mode=agent for tasks that can be fully automated, mode=human for tasks requiring physical device testing, mode=review for code review tasks.

### O-25: Architecture notes are orphaned — no relations to PM project or tasks
- **Severity:** friction
- **Where:** database — 0 relations, 7 architecture notes have no module association
- **What happened:** Architecture notes were created as plain `brain add` notes, not linked to the VOLT project or any tasks. They're searchable by content but there's no structural connection. The `brain pm context` command won't surface them when assembling task context.
- **Fix options:**
  1. Architecture notes should have `module: pm` + `module_instance: VOLT` in frontmatter
  2. Relations should connect architecture notes to relevant tasks (e.g., SDK architecture → all VOLT-02 tasks)
  3. The discovery agents should create these relations as part of their workflow

### O-26: Task notes have no body content
- **Severity:** suggestion
- **Where:** task .md files — each has only `# Title` after frontmatter
- **What happened:** Tasks have descriptive titles but empty bodies. An agent dispatched to work on a task gets no additional context from the task note itself — acceptance criteria, approach hints, relevant files, etc.
- **Fix:** Discovery agents should write 2-3 lines of body content per task: what specifically needs to change, which files are involved, what "done" looks like. This is the prompt seed for when the task gets dispatched.

### O-27: Zero activities recorded during onboarding
- **Severity:** friction
- **Where:** activities table — 0 rows
- **What happened:** The sub-agents used `brain add` and `brain pm task add` but no activities were recorded. The audit trail is empty.
- **Root cause:** Activities are only written by `brain pm complete` and the orchestration layer. The onboarding workflow didn't use those codepaths.
- **Fix:** Consider recording activity for bulk task creation, project init, and discovery phases — not just task completion.

### O-28: Discovery agents did code-first, not doc-first — missed key planning artifacts
- **Severity:** friction
- **Where:** sub-agent discovery phase
- **What happened:** All 5 discovery agents read source code (package.json, tsconfig, src/) to understand each repo. They did NOT prioritize existing documentation files. As a result, they missed:
  - **`voltras/docs/ROADMAP.md`** (76KB) — the actual 9-phase product roadmap. This is the single most important planning artifact in the workspace and should have been the primary source for task generation.
  - **`voltra-node-sdk/CHANGELOG.md`** — version history showing what's been done and what broke
  - **`voltra-node-sdk/MIGRATION.md`** — migration guides relevant to mobile app upgrade tasks
  - **`voltra-node-sdk/docs/roadmap/`** — SDK-specific planned features
  - **`voltra-node-sdk/docs/troubleshooting.md`** — known issues that could generate fix tasks
  - **`voltra-node-sdk/docs/guides/`** and `examples/` — reveal documentation gaps
  - **`voltra-private/docs/protocol-reference.md`** — single source of truth for protocol
  - **`voltra-private/docs/investigation/`** — open questions that should become research tasks
  - **`workout-analytics/voltra_vbt_autoregulation_spec.md`** — VBT algorithm design spec
  - **`titan-design/CLAUDE.md`** — development conventions and patterns
  - **`titan-design/docs/ARCHITECTURE.md`** — official architecture doc (agent wrote its own from code)
  - **`voltras-workspace/CLAUDE.md`** — cross-repo coordination guide
  - **`.github/workflows/`** across all repos — CI/CD pipeline definitions
- **Impact:** The task backlog is 100% implementation/maintenance work extracted from code. Zero feature work, zero research tasks, zero tasks derived from roadmap phases. The most valuable planning document was completely ignored.
- **Fix:** Discovery agents should do a doc-first scan pass: glob for `**/*.md`, `**/docs/**`, `**/.github/**`, `**/CLAUDE.md` and ingest documentation before reading source code. Docs are highest signal-to-noise.

### O-29: Agents reinvented existing documentation instead of referencing it
- **Severity:** friction
- **Where:** architecture note creation
- **What happened:** The titan-design agent wrote a full architecture note by reading source code, when `titan-design/docs/ARCHITECTURE.md` already existed as an official doc. The SDK agent did the same when `voltra-node-sdk/README.md` already has comprehensive architecture coverage. This duplicates effort and risks inconsistency between the agent's interpretation and the canonical docs.
- **Expected:** When a repo already has quality architecture docs, the agent should reference/link them (or ingest them directly as brain notes) rather than writing a competing version from scratch.
- **Fix:** Agent prompts should instruct: "Check for existing docs first (`README.md`, `docs/`, `ARCHITECTURE.md`). If quality docs exist, ingest them as brain notes. Only write new architecture notes for undocumented areas."

### O-30: No manifest of available docs presented to user before discovery
- **Severity:** suggestion
- **Where:** pre-discovery phase
- **What happened:** Agents were launched directly into repos without first surveying what documentation exists. The user had no chance to say "the roadmap is the most important file" or "ignore the investigation docs, they're stale."
- **Expected:** Before launching discovery agents, scan all repos for documentation files and present the user with a manifest: "I found these docs across your workspace — which should I prioritize? Are any of these stale?" This prevents agents from making their own (wrong) judgment about what matters.
- **Fix:** Add a "doc survey" step to the onboarding skill between structure setup and agent dispatch. Quick glob across all repos, present findings, get user input on priorities.

### O-31: Task backlog has zero feature work — entirely tech debt and maintenance
- **Severity:** friction
- **Where:** all 67 generated tasks
- **What happened:** Because agents only read source code, all tasks are: fix broken tests, add missing tests, fix CI, add documentation, fix stale imports, publish packages. Zero tasks reference product features, roadmap phases, or user-facing improvements.
- **Expected:** A balanced backlog should include feature work (from roadmap/specs), tech debt (from code analysis), and infrastructure (from CI/config). The current backlog is ~100% the latter two categories.
- **Root cause:** Direct consequence of O-28 — agents never read the roadmap or design specs.
- **Fix:** Discovery agents should produce tasks from two sources: (1) existing planning docs (roadmap, specs, design docs) for feature/milestone tasks, (2) code analysis for tech debt/maintenance tasks. The prompt should explicitly request both categories.

### O-32: Open questions and investigation docs should generate research tasks, not implementation tasks
- **Severity:** suggestion
- **Where:** voltra-private/docs/investigation/
- **What happened:** The investigation directory contains open questions about the hardware protocol (unknowns, undocumented behaviors). These should map to `category: research` tasks, not implementation. They were missed entirely.
- **Expected:** Files in `docs/investigation/` or similar "open questions" directories should generate research tasks with `mode: human` or `mode: assisted` — they require experimentation and analysis, not just code changes.
- **Fix:** Agent prompts should include: "Look for investigation docs, open questions, or TODO files. Create these as `category: research` tasks."

### O-33: Cross-repo coordination docs not ingested — dependency context lost
- **Severity:** friction
- **Where:** workspace root — `CLAUDE.md`, `game-plan.md`
- **What happened:** The workspace-level `CLAUDE.md` describes how repos relate to each other (dependency chain, publish flow, coordination patterns). No agent read it. This is exactly the context needed to wire cross-workstream dependencies.
- **Expected:** Workspace-level docs should be read first by the coordinator before dispatching per-repo agents. They provide the "how repos relate" context that individual repo scans miss.
- **Fix:** The coordinator agent should read workspace-root docs before dispatching sub-agents, and pass relevant cross-repo context into each agent's prompt.

### O-34: Doc-first discovery should detect doc drift and propose correction tasks
- **Severity:** suggestion
- **Where:** discovery phase — doc ingestion + code review
- **What happened:** The doc-first approach (O-28) assumes docs are accurate. In practice, repo docs drift — READMEs describe removed features, architecture docs show old patterns, roadmaps list completed items as planned. Ingesting stale docs without validation propagates misinformation into the brain and generates tasks based on outdated context.
- **Expected:** A two-pass discovery model:
  1. **Doc pass**: Ingest all docs as brain notes. These become the initial context and planning baseline.
  2. **Code pass**: Agents read source code with the ingested docs as context. When they find discrepancies (doc says X, code does Y), they should:
     - Create a `supersedes` or `contradicts` relation between the code-derived finding and the doc-derived note
     - Mark the doc-derived note's `status: stale` or add a `confidence: low` annotation
     - Create a `category: documentation` task to update the specific doc section
- **Why this matters:** Docs are the best starting point precisely because they capture intent and design rationale that code can't. But code is ground truth for current behavior. The tension between the two is itself a valuable signal — it reveals where the project has drifted from its plans, where docs need maintenance, and where decisions were made but not recorded.
- **Brain primitives that support this:**
  - `relations` with type `supersedes` or `contradicts` — already in the schema
  - Note `status: stale` / `confidence` fields — frontmatter supports this
  - `category: documentation` tasks — the taxonomy supports it but agents didn't use it (O-23)
  - Activities — could record "drift detected" events for audit trail
- **Implementation approach:**
  1. Agent prompt for code pass includes: "You have access to doc-derived notes. Compare what docs claim vs what code does. Flag discrepancies."
  2. For each discrepancy: create a relation (`code-note --contradicts--> doc-note`), create a documentation task ("Update README section X to reflect current behavior Y")
  3. The `brain pm briefing` or a `brain pm health` command could surface drift stats: "5 doc notes marked stale, 3 documentation tasks pending"
- **Broader pattern:** This is essentially a continuous doc health system. Not just for onboarding — every time an agent modifies code, it could check whether related docs need updating. The brain's relation graph makes this queryable.

### O-09: `brain pm use` doesn't actually make `--project` optional
- **Severity:** blocker
- **Where:** `workstream add`, `task add`, `decision add`, `prompt list`, `capture`
- **What happened:** Agent ran `brain pm use VOLT`, then `workstream add "Mobile App" --description "..."` without `--project`. Got `error: required option '--project <prefix>' not specified`. Had to retry all 5 workstream creates with explicit `--project VOLT`.
- **Expected:** After `brain pm use VOLT`, commands should read the active project as a fallback when `--project` is omitted. This is the entire purpose of the `use` command.
- **Root cause verified:** `pm use VOLT` succeeds ("Active project set to VOLT") but the next command fails with "--project is required". The `use` command writes the active project but `requiredOption('--project')` in Commander rejects before any code can read it back. Confirmed with direct testing: `brain pm use VOLT && brain pm workstream list` → error.
- **Affected commands:** `workstream.ts:39`, `task.ts:54`, `decision.ts:39`, `prompt.ts:34`, `capture.ts:79`
- **Fix:** Change all 5 from `requiredOption` to `option`, add a shared `resolveProject(explicit, active)` helper that throws a clear error if neither is set.
- **Test bench note:** 0/20 agents hit this organically — they all read `--help` and saw `--project` was required, so they always passed it explicitly. The bug is invisible to agents but painful for humans who read the docs about `pm use`.

### O-10: `brain list` doesn't exist — agent expected it
- **Severity:** docs
- **Where:** agent tried `brain list` (should be `brain pm list`)
- **What happened:** `error: unknown command 'list'`. The agent's mental model was that top-level brain commands would include project listing.
- **Expected:** Either add `brain list` as an alias, or ensure the help text makes the `pm` namespace clear.
- **Fix:** Minor — the skill/docs should make the command namespace obvious. Not worth adding an alias.

### O-11: `brain pm status` without active project gives opaque error
- **Severity:** friction
- **Where:** `brain pm status` before `brain pm use`
- **What happened:** Agent ran `pm init` then immediately `pm status` without `pm use`. Got `Error [INVALID_INPUT]: No project specified and no active project set.`
- **Expected:** If there's only one project, `pm status` should default to it. Or `pm init` should auto-set it as active (it says "(active)" in the output but apparently doesn't persist).
- **Fix:** Check if `pm init` actually sets the active project. If not, it should — the output already claims it does.

## V2 Observations

### O-38: `brain reset` doesn't clean up PM hooks, skills, or settings.json entries
- **Severity:** docs
- **Where:** `src/commands/reset.ts`
- **What happened:** After `brain reset --confirm`, the 3 hook scripts (`~/.claude/hooks/brain-pm-*.sh`), the orchestrator skill (`~/.claude/skills/orchestrator/SKILL.md`), and the hook entries in `~/.claude/settings.json` all persist. A user doing a clean re-test has stale hooks pointing at a non-existent database.
- **Expected:** Either `reset` cleans up module artifacts, a `brain pm uninstall` command exists, or hooks gracefully no-op when brain isn't initialized.
- **Fix:** Option 1: Add PM cleanup to `reset`. Option 2: New `brain pm teardown` command. Option 3: Hooks check for brain init state before executing.

### O-39: `workstream add` output shows sequence number, not workstream name
- **Severity:** friction
- **Where:** `brain pm workstream add "Mobile" --description "..."`
- **What happened:** Output is `VLT-01 - #1 (active)`. The name "Mobile" doesn't appear — only the sequence number. The title fix (O-36) was applied to `formatWorkstreamLine` in `workstream list` but the `add` command's response doesn't pass the title through.
- **Expected:** `VLT-01 - Mobile (active)` — same format as `workstream list`.
- **Fix:** Ensure `createWorkstream` returns the title in its result, and the `add` action handler includes it in the output.

### O-40: `pm status` output is a single line with no summary data
- **Severity:** friction
- **Where:** `brain pm status`, `brain pm status VLT`
- **What happened:** After creating 4 workstreams and 41 tasks, `pm status` returns only `VLT - Voltras (active)`. No task counts, no workstream breakdown, no priority distribution, no phase information.
- **Expected:** Status should include at minimum: workstream count, task count by status, and active phase. Something like:
  ```
  VLT - Voltras (active)
    Workstreams: 4 (all active)
    Tasks: 41 (41 pending, 0 in-progress, 0 done)
    Wave: 0 (no dependencies set)
  ```
- **Fix:** Enhance `pm status` to query and display summary stats. Could reuse briefing data assembly.

### O-41: 33% of brain CLI calls are --help exploration
- **Severity:** friction
- **Where:** V2 onboarding session — 8 of 24 brain CLI calls were `--help`
- **What happened:** Agent called `brain --help`, `pm --help`, `pm setup --help`, `pm init --help`, `pm workstream --help`, `pm workstream add --help`, `pm task add --help`, `brain add --help` before doing useful work. The orchestrator skill was installed but never triggered — agents default to CLI exploration.
- **Expected:** The orchestrator skill should front-load PM context so agents already know command syntax. 0-2 help calls would be normal with skill context loaded.
- **Fix:** Related to O-35 (skill discoverability). The skill must either be auto-triggered by the session hook or be discoverable enough that agents use it before resorting to `--help` chains.

### O-42: Briefing never exercised during V2 onboarding
- **Severity:** suggestion
- **Where:** V2 onboarding session — agent mentioned `brain pm briefing` as a recommended next step but never ran it
- **What happened:** After creating 41 tasks, the agent ran `brain pm task list` (raw list) and `brain status` (note counts) to verify. It recommended `briefing`, `next`, and `waves` to the user but didn't run them itself. The `--verbose` flag (O-19 fix) was never tested.
- **Expected:** The agent should proactively run `brain pm briefing` after backlog creation to validate the project state and present a structured summary rather than a raw task list.
- **Fix:** The orchestrator skill should instruct agents to use `briefing --verbose` for project summaries. Could also have the session hook auto-run briefing when a project exists.

## Punch List

| ID | Severity | Status | Summary |
|----|----------|--------|---------|
| O-01 | docs | deferred | Docs don't clarify where to run commands from |
| O-02 | friction | deferred | `brain init` output is technical, not welcoming |
| O-03 | blocker | **fixed** | PM module not loaded from npm install (static import in cli.ts) |
| O-04 | suggestion | **fixed** | No way to reset brain (`brain reset --confirm` added) |
| O-05 | friction | deferred | `pm init` output is redundant, doesn't show project name |
| O-06 | friction | deferred | No Claude-assisted onboarding path — users expected to run raw CLI |
| O-07 | friction | deferred | Agent spends many tool calls building context that could be provided |
| O-08 | suggestion | deferred | Agent wanted demo project — needs CLI examples in context instead |
| O-09 | blocker | deferred | `pm use` doesn't make `--project` optional — 5 commands require it anyway |
| O-10 | docs | deferred | Agent tried `brain list` (doesn't exist, it's `brain pm list`) |
| O-11 | friction | **v2-verified** | `pm init` auto-sets active project, subsequent commands work |
| O-12 | suggestion | deferred | Workstream-per-repo vs workstream-per-feature — object model gap |
| O-13 | friction | deferred | Post-init doesn't guide toward backlog discovery |
| O-14 | friction | deferred | User had to prompt for backlog discovery — agent didn't suggest it |
| O-15 | suggestion | deferred | Sub-agent-per-repo exploration worked well — codify as standard pattern |
| O-16 | friction | deferred | No dependencies created — all 67 tasks in Wave 0, waves useless |
| O-17 | friction | deferred | Task list shows no task names — just IDs and metadata |
| O-18 | friction | **fixed** | Briefing dumps all 67 task IDs inline — unreadable at scale |
| O-19 | suggestion | deferred | Final summary readout is great — should be a built-in command |
| O-20 | friction | deferred | Agent surfaces CLI commands user won't run in Claude Code |
| O-21 | suggestion | deferred | Dep wiring should happen during creation, not separate pass |
| O-22 | suggestion | deferred | Onboarding should ask about external docs and structure prefs |
| O-23 | friction | improved | V2: 9 categories used (was 1), but chaotic — see O-43 |
| O-24 | friction | confirmed | V2: still 0/41 tasks with explicit mode — all defaulted |
| O-25 | friction | deferred | Architecture notes not linked to PM project or tasks (no relations) |
| O-26 | suggestion | deferred | Task notes have no body content — just title as heading |
| O-27 | friction | deferred | Zero activities recorded — no audit trail from onboarding |
| O-28 | friction | deferred | Discovery agents did code-first not doc-first — missed roadmap + key docs |
| O-29 | friction | improved | V2: 3 synthesized notes (titan-design), but 57/66 docs ingested from source |
| O-30 | suggestion | deferred | No doc manifest presented to user before discovery agents launched |
| O-31 | friction | improved | V2: 10 feature tasks from roadmap (was 0), but still 75% non-feature |
| O-32 | suggestion | confirmed | V2: voltra-private investigation docs still missed (33% repo coverage) |
| O-33 | friction | confirmed | V2: workspace root docs (game-plan.md, situation-assessment.md) still not read |
| O-34 | suggestion | deferred | Doc-first discovery should detect drift and create correction tasks |

### O-35: Brain skill never triggered — agents default to CLI exploration
- **Severity:** friction
- **Where:** test bench — 0/8 agents used the brain skill
- **What happened:** Every agent went straight to `brain --help` via Bash instead of invoking the brain skill. This means the skill is either not discoverable, not relevant to the prompt framing, or agents naturally prefer CLI exploration over skill invocation.
- **Impact:** Without the skill, every agent spends 3-5 tool calls on `--help` exploration before doing useful work. The skill should front-load brain context and eliminate this overhead.
- **Fix options:**
  1. Ensure the brain skill is registered and visible in agent tool lists
  2. The skill description should match natural PM queries ("projects", "tasks", "backlog")
  3. Consider whether the prompt framing ("brain CLI tool") biased agents toward bash — V2 prompts should be more natural

### O-36: `formatTaskLine` never includes the task title
- **Severity:** blocker
- **Where:** `src/modules/pm/commands/task.ts:38-45`
- **What happened:** P-17 agent discovered task names are missing from all CLI output. Root cause verified in code:
  - `task-ops.ts:48` writes `input.name` into the `title:` frontmatter field correctly
  - Task .md files have `title:` populated (no `name:` field exists at all — not a mismatch, just one field)
  - `formatTaskLine()` at `task.ts:44` outputs `${t.display_id} - ${t.status}${priority}${mode}${virtualStates}` — **it never references `title` at all**
- **Root cause:** The display function was never written to show the title. Not a field mismatch — the formatter simply omits it.
- **Impact:** Root cause of O-17 (no names in any output format). Every test bench prompt (20/20) that touched tasks had to read .md files to get names.
- **Fix:** Add `t.title` to `formatTaskLine()`. Also check `formatWorkstreamLine` (same issue observed for workstreams). Update JSON output to include `title` field.

### O-37: 42% of agent tool calls bypass brain CLI
- **Severity:** friction
- **Where:** test bench aggregate — 103/245 tool calls were non-brain (ls, cat, for loops, sqlite3, Read)
- **What happened:** Agents resort to reading .md files directly, running shell loops to extract frontmatter, and even querying sqlite3 directly because CLI output is insufficient.
- **Expected:** Brain CLI should be the single source of truth. Agents should need <10% non-brain calls.
- **Root cause:** Primarily O-17 (no names in output) and O-19 (no summary command). If CLI output included task/workstream names and a comprehensive briefing, agents wouldn't need to read files.
- **Fix:** Priority chain: fix O-36 (title/name mismatch) → O-17 resolves → O-37 improves dramatically. Then add `brain pm briefing --verbose` for the comprehensive summary (O-19).

## Test Bench Findings (V1 Baseline)

Full results: `docs/pm-module/test-bench-results-v1.md`

### Summary

| Metric | V1 Value |
|--------|----------|
| Prompts run | 8/20 |
| Avg answer quality | 4.5/5 |
| Avg tool calls | 30.6 |
| Avg time | 81s |
| Brain CLI calls | 58% of tool calls |
| Direct file reads | 26% of tool calls |
| Skill triggered | 0/8 |

### Priority Action Items (derived from test bench)

**P0 — Fix immediately (unblocks everything else):**
1. **O-36: Fix title/name field mismatch** — root cause of O-17. Audit task creation + display code, align field names. This single fix likely resolves the #1 pain point.
2. **O-17: Include names in all CLI output** — task list, task show, workstream list, workstream show, briefing. Both plain text and JSON formats. Once O-36 is fixed, wire the field into all formatters.

**P1 — High impact on agent efficiency:**
3. **O-19: `brain pm briefing --verbose`** — comprehensive project summary (workstream breakdown, priority matrix, critical items, knowledge base stats). The P-02 and P-03 agents manually built this output.
4. **O-09: Fix `requiredOption` → `option` for `--project`** — 5 commands fail unnecessarily. Simple fix.
5. **O-05: Fix `pm list` / `pm init` output** — show project name, not just prefix twice.

**P2 — Structural improvements for V2 onboarding:**
6. **O-25: Link architecture notes to PM project** — add `module: pm` + `module_instance: VOLT` to architecture notes, create relations to workstreams.
7. **O-35: Brain skill discoverability** — ensure skill triggers for PM-related queries.
8. **O-16: Dependency wiring** — either during onboarding (O-21) or via `brain pm auto-deps` command.

**P3 — Onboarding flow redesign (requires all above):**
9. **O-28/O-30: Doc-first discovery** — scan for docs, present manifest, ingest before code analysis.
10. **O-34: Drift detection** — code pass compares against doc-derived notes.
11. **O-06/O-13/O-14: Onboarding skill** — wraps the full flow: init → interview → doc survey → discovery → dependency wiring → briefing.

### O-43: Category chaos — 9 different categories across 41 tasks, no shared vocabulary
- **Severity:** friction
- **Where:** V2 sub-agent task creation
- **What happened:** Each sub-agent invented its own category vocabulary: Mobile used `foundation`/`feature`/`research`, SDK used `development`/`testing`/`documentation`/`infrastructure`, Analytics used `implementation`/`testing`, Design used `feature`/`infrastructure`/`testing`/`documentation`/`quality`. Total: 9 distinct categories across 41 tasks.
- **V1 comparison:** V1 had the opposite problem — all 67 tasks were `implementation`. V2 improved by having agents think about categories, but without a shared taxonomy the data is still unusable for filtering/routing.
- **Expected:** A defined category taxonomy (e.g., `implementation`, `testing`, `documentation`, `research`, `infrastructure`) enforced by the CLI or documented in agent prompts.
- **Fix:** Either validate categories in `task add` against an allowed set, or document the canonical categories in the orchestrator skill so agents use consistent values.

### O-44: `task update --depends-on` doesn't exist — dependency wiring blocked
- **Severity:** friction
- **Where:** Mobile sub-agent attempted `brain pm task update VLT-01.XX --depends-on VLT-01.YY`
- **What happened:** Mobile agent created 13 tasks, then attempted 6 `task update --depends-on` calls to wire dependencies after the fact. All 6 failed because `--depends-on` is only accepted on `task add`, not `task update`. The agent noted the limitation but couldn't work around it.
- **Expected:** Either `task update` should accept `--depends-on` to add dependencies post-creation, or a separate `brain pm task link` command should exist for wiring dependencies between existing tasks.
- **Fix:** Add `--depends-on` support to `task update`, or add a `brain pm dep add <from> <to>` command. This also affects O-16 — dependencies are hard to create even when agents try.

### O-45: 42 notes with zero relations — no cross-references between repos
- **Severity:** friction
- **Where:** V2 sub-agent note creation
- **What happened:** 42 notes created across 4 repos with zero `brain relation` calls. Notes that clearly relate (e.g., Mobile VBT notes ↔ Analytics VBT spec, SDK platform adapters ↔ Mobile BLE protocol) have no structural connections.
- **V1 comparison:** Same as V1 (O-25). No improvement — agents still don't create relations.
- **Fix:** Agent prompts should instruct cross-referencing. Could also add a post-creation relation-wiring pass, similar to the dependency coordinator concept (O-16/O-21).

### O-46: Strategic planning doc never surfaced to any agent
- **Severity:** suggestion
- **Where:** `voltras-workspace/game-plan.md` (25KB)
- **What happened:** The workspace root contains a strategic planning document that no agent was directed to read and no agent independently discovered. The lead agent's workspace exploration (`ls`, `find`) found markdown files but the doc was not included in any sub-agent prompt.
- **Expected:** Workspace-level planning docs should be read by the coordinator before dispatching sub-agents, providing strategic context for task prioritization. Related to O-33 (cross-repo coordination docs not read).
- **Fix:** The onboarding workflow should survey workspace-root docs and include relevant strategic context in sub-agent prompts.

### O-47: voltra-private repo only 33% doc coverage — investigation and tooling docs missed
- **Severity:** friction
- **Where:** V2 sub-agent discovery — voltra-private repo
- **What happened:** Only 2 of 6 docs ingested from voltra-private (README and protocol-reference). Missed: `remaining-investigations.md` (9KB, open BLE research gaps), `bluetooth-logging.md` (2.6KB, BLE capture setup), `pklg-analysis.md` (2.9KB, packet analysis methodology). These are the "how to debug the hardware" knowledge base.
- **Expected:** Investigation and tooling docs should be high-priority ingestion targets — they contain irreplaceable domain knowledge that agents would otherwise duplicate.
- **Fix:** Ensure discovery agent prompts include `docs/investigation/` and `docs/tooling/` directories. The lead agent's file survey should flag these as high-value.

### O-48: `docs/plans/` subdirectories not scanned — active planning artifacts missed
- **Severity:** suggestion
- **Where:** V2 gap analysis — `voltras/mobile/docs/plans/2026-02-23-android-mvp-design.md`
- **What happened:** A 4-day-old Android MVP design plan exists in `mobile/docs/plans/` but was not found by the mobile agent. The lead agent's `find` scan found it but it wasn't included in the mobile agent's prompt.
- **Expected:** Recent planning artifacts (design docs, ADRs) in `docs/plans/` should be surfaced — they represent active decisions and current priorities.
- **Fix:** Lead agent's doc survey should flag recent files in `**/plans/` or `**/decisions/` directories.

### O-49: PM task notes not indexed — unsearchable via `brain search`
- **Severity:** friction
- **Where:** V2 data audit — 41 task notes have zero chunks in the database
- **What happened:** After `brain index`, 42 knowledge notes were chunked and embedded, but all 41 PM task notes (and the project note) have no chunks. This means `brain search "analytics"` won't find task VLT-01.03 "Implement analytics dashboard..." — only PM-specific commands can find tasks.
- **Expected:** Task notes should be searchable via `brain search` so agents can discover relevant tasks when researching a topic. The search and PM systems should be bridged.
- **Fix:** Either index PM notes during `brain index` (respecting visibility), or add a `--include-pm` flag to `brain search`. Alternatively, O-25 (relations) would solve this by linking searchable knowledge notes to tasks.

## V2 Test Bench Observations

### O-50: `pm context` returns a hash, not actionable context
- **Severity:** blocker
- **Where:** V2 test bench — P-05, P-08, P-19 all tried `brain pm context <task-id>`
- **What happened:** `pm context VLT-01.01` returns a context hash and sparse metadata (status, category, priority) but no task description, related notes, or implementation hints. P-19 tried `brain context <note-slug>` on 5 different notes — all returned "No context found."
- **Impact:** This is the command designed for exactly the "brief me on a task" use case. Agents abandon it after one try and fall back to 5-10 `brain search` queries to manually assemble the same context.
- **Expected:** `pm context` should aggregate: task metadata + body text + related search results (by title/content similarity) + linked decisions + dependency chain. This is what agents build manually in P-08.
- **Fix:** Rewrite `pm context` to query: (1) task note body, (2) `brain search` with task title as query, (3) linked decisions, (4) dependency upstream/downstream. Return a structured briefing.

### O-51: `pm dispatch` returns minimal output — not a usable agent prompt
- **Severity:** friction
- **Where:** V2 test bench — P-05, P-08 tried `brain pm dispatch <task-id>`
- **What happened:** `dispatch` is supposed to produce a ready-to-use agent prompt for implementing a task. In practice it returns minimal structured output — no file references, no architecture context, no acceptance criteria.
- **Expected:** `dispatch` should produce a self-contained agent prompt with: task objective, relevant architecture (from search), files to modify, validation steps, and completion criteria.
- **Fix:** Wire `dispatch` to use `pm context` output (once fixed) + `orchestrate render` template. The dispatch output should be what P-08's agent manually assembled.

### O-52: `pm verify` crashes — "plan.steps is not iterable"
- **Severity:** bug
- **Where:** V2 test bench — P-08, P-16 both tried `brain pm verify <task-id>`
- **What happened:** `brain pm verify VLT-01.01` throws `TypeError: plan.steps is not iterable`. The command exists and has help text but crashes on execution.
- **Expected:** Should return a verification checklist (tests to run, acceptance criteria to check).
- **Fix:** Debug the `verify` command — likely expects a `plan` object with a `steps` array that doesn't exist for tasks that haven't been dispatched yet. Should handle the "no plan yet" case gracefully.

### O-53: Search-loop inflation — agents run 5-10x more searches to avoid file reads
- **Severity:** friction
- **Where:** V2 test bench — P-09 (9→27 calls), P-10 (22→66), P-12 (8→49)
- **What happened:** V1 agents used a few searches + targeted file reads for depth. V2 agents (constrained from reading files) run 20-50 search queries to assemble the same depth from excerpts. `brain search` returns chunked excerpts (~200-500 chars), so agents need many queries to get equivalent content to reading one full note.
- **Impact:** Total call count didn't decrease V1→V2 despite fixes. Search loops replaced file reads 1:1 in cost.
- **Expected:** Agents should be able to get full document content when they need depth, not just excerpts.
- **Fix:** Add `brain search --full` or `brain read <note-slug>` to return complete note content for the top N results. This would let agents do 2-3 searches instead of 20-30.

### O-54: `task show` and `workstream show` return one-line summaries — no descriptions
- **Severity:** friction
- **Where:** V2 test bench — P-02, P-03, P-05 agents noted `show` commands give minimal data
- **What happened:** `brain pm task show VLT-01.01` returns one line: `VLT-01.01 - Build cross-session analytics... [critical] pending (auto)`. No description, body text, acceptance criteria, category explanation, or related context. `workstream show` is similarly sparse.
- **Impact:** Agents must follow up with `brain search` to get the substance that a `show` command should provide. This is the root cause of quality drops in P-02 (5→4), P-03 (5→4), P-05 (4→3).
- **Expected:** `show` should include: title, status, priority, category, description/body text (from the .md note), dependencies, and related decisions. Like `git show` includes the full commit message, not just the subject line.
- **Fix:** Read the task's .md note body and include it in `show` output. Add `--json` to include all fields.

### O-55: No filter flags on `task list` — agents use python to filter JSON
- **Severity:** friction
- **Where:** V2 test bench — P-04, P-06, P-07, P-13 all piped `task list --json` through python3
- **What happened:** Agents needed to filter tasks by priority (P-04: `critical`), category (P-06: `testing`), or status (P-07: `blocked`). No native filter flags exist, so agents pipe JSON through python one-liners.
- **Impact:** Each python filter adds 1 non-brain tool call and obscures the agent's intent from the CLI's perspective.
- **Expected:** `brain pm task list --priority critical --category testing --status pending` as first-class flags.
- **Fix:** Add `--priority`, `--category`, `--status` options to `task list`. These filter the query before output, not post-hoc.

### O-56: `brain graph` returns no edges for any note — graph commands are non-functional
- **Severity:** friction
- **Where:** V2 test bench — P-19 tried `brain graph` on 2 architecture notes
- **What happened:** `brain graph "research/workout-analytics-source-architecture"` and `brain graph "research/titan-design-architecture"` both returned zero edges. The graph visualization shows isolated nodes with no connections.
- **Impact:** Related to O-25 (zero relations) but specifically about the `graph` command being useless. Agents can't discover structural relationships between notes.
- **Expected:** Graph should at minimum show co-occurrence relationships (notes that reference each other by title/slug) even without explicit wikilinks.
- **Fix:** Consider auto-generating "mentioned-in" relations during indexing when note A contains text matching note B's title/slug.

## V2 Sub-Agent Data Audit

### Aggregate Stats
- **42 notes** created (24 Mobile, 8 SDK, 3 Analytics, 7 Design)
- **41 tasks** created (13 Mobile, 10 SDK, 8 Analytics, 10 Design)
- **0 dependencies** (6 attempted by Mobile, all failed)
- **0 relations** between notes
- **192 total tool calls** across 4 agents (100 Mobile, 32 SDK, 24 Analytics, 36 Design)
- **265K tokens** consumed across 4 agents

### Category Distribution
| Category | Count | Agents |
|----------|-------|--------|
| feature | 10 | Mobile (7), Design (3) |
| implementation | 7 | Analytics (7) |
| foundation | 7 | Mobile (7) |
| development | 5 | SDK (5) |
| testing | 5 | SDK (2), Analytics (1), Design (2) |
| infrastructure | 4 | SDK (1), Design (3) |
| documentation | 3 | SDK (2), Design (1) |
| research | 1 | Mobile (1) |
| quality | 1 | Design (1) |

### V1 → V2 Sub-Agent Comparison
| Metric | V1 | V2 | Delta |
|--------|----|----|-------|
| Tasks created | 67 | 41 | -26 (more focused) |
| Notes created | 7 | 42 | +35 (doc ingestion) |
| Categories used | 1 | 9 | +8 (but chaotic) |
| Dependencies | 0 | 0 | — (still blocked) |
| Relations | 0 | 0 | — (still not attempted) |
| Roadmap read | No | Yes (Mobile) | Improved |
| Feature tasks | 0 | 10 | +10 (from roadmap) |

## V2 Gap Analysis (Phase 4)

### Doc Coverage by Repo
| Repo | Docs Available | Ingested | Coverage | Key Misses |
|------|---------------|----------|----------|------------|
| voltras/docs/design | 11 | 10 | 91% | README index only |
| voltras/docs/features | 30 | 29 | 97% | README index only |
| voltras/docs/shared | 11 | 10 | 91% | README index only |
| voltras/mobile/docs | 3 | 2 | 67% | android-mvp-design.md (O-48) |
| titan-design | 5 | 4 | 80% | CLAUDE.md (intentional) |
| voltra-node-sdk | 10 | 8 | 80% | troubleshooting.md, CHANGELOG.md |
| voltra-private | 6 | 2 | **33%** | investigation + tooling docs (O-47) |
| workout-analytics | 2 | 2 | 100% | — |
| Workspace root | 3 | 0 | **0%** | game-plan.md, situation-assessment.md (O-46) |
| **Total (knowledge docs)** | **66** | **57** | **86%** | |

### High-Impact Misses
| File | Size | Why It Matters |
|------|------|----------------|
| `game-plan.md` | 25KB | Master strategic document driving all priorities |
| `situation-assessment.md` | 8KB | Current state diagnosis motivating the game plan |
| `android-mvp-design.md` | 6KB | Active 4-day-old planning artifact |
| `troubleshooting.md` | 7KB | Only SDK debugging guide |
| `remaining-investigations.md` | 9KB | Open BLE research gaps — critical for protocol work |
| BLE tooling docs | 5.5KB | Prerequisite for any protocol investigation |

### Synthesized vs Ingested Notes
3 notes created from code inspection rather than existing docs (titan-design repo):
- `Titan Design Conventions` — synthesized from cursor rules
- `Titan Design Development Guide` — synthesized from CLAUDE.md + code
- `Titan Design Component Inventory` — synthesized from source tree scan

These are additive (agent interpretation), not duplicates of existing docs.

### Indexing Gap
- 88 notes total, 46 have chunks (searchable)
- All 42 PM entities (tasks, project, workstreams) have **zero chunks** — unsearchable via `brain search`
- All 42 knowledge notes ARE indexed and searchable

## Punch List

| ID | Severity | Status | Summary |
|----|----------|--------|---------|
| O-01 | docs | deferred | Docs don't clarify where to run commands from |
| O-02 | friction | deferred | `brain init` output is technical, not welcoming |
| O-03 | blocker | **fixed** | PM module not loaded from npm install (static import in cli.ts) |
| O-04 | suggestion | **fixed** | No way to reset brain (`brain reset --confirm` added) |
| O-05 | friction | **v2-verified** | `pm init` output shows name — `Created project "Voltras" (VLT) — active` |
| O-06 | friction | P3 | No Claude-assisted onboarding path — users expected to run raw CLI |
| O-07 | friction | deferred | Agent spends many tool calls building context that could be provided |
| O-08 | suggestion | deferred | Agent wanted demo project — needs CLI examples in context instead |
| O-09 | blocker | **v2-verified** | `--project` optional — all commands fall back to active project |
| O-10 | docs | deferred | Agent tried `brain list` (doesn't exist, it's `brain pm list`) |
| O-11 | friction | **v2-verified** | `pm init` auto-sets active project, subsequent commands work |
| O-12 | suggestion | deferred | Workstream-per-repo vs workstream-per-feature — object model gap |
| O-13 | friction | P3 | Post-init doesn't guide toward backlog discovery |
| O-14 | friction | P3 | User had to prompt for backlog discovery — agent didn't suggest it |
| O-15 | suggestion | deferred | Sub-agent-per-repo exploration worked well — codify as standard pattern |
| O-16 | friction | **P2** | No deps created — V2: 6 attempted, all failed (see O-44) |
| O-17 | friction | **v2-verified** | Task/workstream list output now shows names (add output still partial — see O-39) |
| O-18 | friction | **fixed** | Briefing dumps all 67 task IDs inline — unreadable at scale |
| O-19 | suggestion | **fixed** | Final summary readout is great — should be a built-in command |
| O-20 | friction | deferred | Agent surfaces CLI commands user won't run in Claude Code |
| O-21 | suggestion | deferred | Dep wiring should happen during creation, not separate pass |
| O-22 | suggestion | deferred | Onboarding should ask about external docs and structure prefs |
| O-23 | friction | improved | V2: 9 categories used (was 1), but chaotic — see O-43 |
| O-24 | friction | confirmed | V2: still 0/41 tasks with explicit mode — all defaulted |
| O-25 | friction | **P2** | V2: 42 notes + 41 tasks, still zero relations (confirmed by DB audit) |
| O-26 | suggestion | confirmed | V2: task notes still have no body content — just title heading |
| O-27 | friction | confirmed | V2: still zero activities recorded |
| O-28 | friction | improved | V2: Mobile read ROADMAP.md, but only because prompt directed it |
| O-29 | friction | improved | V2: 3 synthesized notes (titan-design), but 57/66 docs ingested from source |
| O-30 | suggestion | P3 | No doc manifest presented to user before discovery agents launched |
| O-31 | friction | improved | V2: 10 feature tasks from roadmap (was 0), but still 75% non-feature |
| O-32 | suggestion | confirmed | V2: voltra-private investigation docs still missed (33% repo coverage) |
| O-33 | friction | confirmed | V2: workspace root docs (game-plan.md, situation-assessment.md) still not read |
| O-34 | suggestion | P3 | Doc-first discovery should detect drift and create correction tasks |
| O-35 | friction | **P2** | Brain skill never triggered — 0/8 agents used it |
| O-36 | blocker | **v2-verified** | Title now in metadata interfaces and formatters (list/show commands) |
| O-37 | friction | improved | V2: 14.7% non-brain calls (was 42% in V1), 0 direct .md reads (was 27%) |
| O-38 | docs | new (V2) | `brain reset` doesn't clean up PM hooks, skills, or settings.json entries |
| O-39 | friction | **v3-fixed** | `workstream add` output shows `#1` not the workstream name |
| O-40 | friction | **v3-fixed** | `pm status` output is one line — no task counts, workstream breakdown, or health |
| O-41 | friction | new (V2) | 33% of brain CLI calls are `--help` — orchestrator skill should eliminate this |
| O-42 | suggestion | new (V2) | Briefing never exercised during onboarding — agent recommends it but doesn't run it |
| O-43 | friction | new (V2) | Category chaos — 9 different categories across 41 tasks, no shared vocabulary |
| O-44 | friction | new (V2) | `task update --depends-on` doesn't exist — only `task add` accepts it |
| O-45 | friction | new (V2) | 42 notes with zero relations — no cross-references between repos |
| O-46 | suggestion | new (V2) | `game-plan.md` (25KB strategic doc) never surfaced to any agent |
| O-47 | friction | new (V2) | voltra-private repo only 33% doc coverage — investigation + tooling docs missed |
| O-48 | suggestion | new (V2) | `docs/plans/` subdirectories not scanned — active planning artifacts missed |
| O-49 | friction | new (V2) | PM task notes not indexed (no chunks) — unsearchable via `brain search` |
| O-50 | blocker | **v3-fixed** | `pm context` returns a hash, not actionable context — agents abandon it |
| O-51 | friction | **v3-fixed** | `pm dispatch` returns minimal output — not a usable agent prompt |
| O-52 | bug | **v3-fixed** | `pm verify` crashes with "plan.steps is not iterable" |
| O-53 | friction | new (V2-TB) | Search-loop inflation — agents run 5-10x more searches to avoid file reads |
| O-54 | friction | **v3-fixed** | `task show`/`workstream show` return one-line summaries — no descriptions |
| O-55 | friction | **v3-fixed** | No `--priority`/`--category`/`--status` filter flags on `task list` |
| O-56 | friction | new (V2-TB) | `brain graph` returns no edges — graph commands non-functional |
| O-57 | friction | **v3-fixed** | `claim` output doesn't show token needed by `start` |
| O-58 | friction | **v3-fixed** | No atomic claim+start command |
| O-59 | friction | **v3-fixed** | `release` doesn't work from `in-progress` — tasks get stranded |
| O-60 | friction | deferred | `--workstream` takes number not name |
| O-61 | blocker | **v3-fixed** | State machine invisible — errors don't explain valid transitions |
| O-62 | friction | **v3-fixed** | `pm complete` vs `pm task done` — two paths, same failure |
| O-63 | friction | **v3-fixed** | `pm next` returns 40 items unranked |
| O-64 | blocker | **v3-fixed** | `pm context` text output is 4 lines (reinforces O-50) |
| O-65 | friction | **v3-fixed** | Context hash unexplained in UI |
| O-66 | friction | **v3-fixed** | `pm audit executions` has no `--task` filter |
| O-67 | blocker | **v3-fixed** | `orchestrate render` has no fallback for missing prompts |
| O-68 | blocker | **v3-fixed** | PM and knowledge base completely siloed |
| O-69 | friction | deferred | No workstream-scoped search |
| O-70 | friction | **v3-fixed** | No "list all notes" command |
| O-71 | friction | deferred | `pm check --deep sourceDocuments` is a stub |
| O-72 | friction | partially | No unified cross-domain search (includePm added but not fully wired) |
| O-73 | friction | **v3-fixed** | `task list` has no keyword/text search |
| O-74 | friction | deferred | Workstream names not embedded in task JSON |

### Fix log
- **O-03:** `src/cli.ts` — statically import `pmModule` and pass to `loadModules({ modules: [pmModule] })`. Dynamic discovery remains as fallback for future user plugins.
- **O-04:** New `src/commands/reset.ts` — `brain reset` shows what would be deleted, `brain reset --confirm` wipes database + notes + config. `--keep-config` option available.
- **O-36/O-17:** Added `title?: string` to all metadata interfaces and mappers. Updated `formatTaskLine`, `formatWorkstreamLine`, `formatProjectLine`, `formatDecisionLine` to show entity names. Fixed JSON output in `next`/`waves` to include real titles. 11 files changed.
- **O-09:** Extracted `resolveProject()` into `queries.ts`. Changed `requiredOption('--project')` to `option('--project')` in 9 commands (workstream add/list, task add/list, decision add/list, prompt write/list, capture process). All commands now fall back to active project.
- **O-05/O-11:** `pm init` now calls `setActiveProject()` and outputs `Created project "Name" (PREFIX) — active`. `formatProjectLine` strips "Project " prefix from title.
- **O-18/O-19:** Briefing caps eligible list to top 5 + "and N more". Added `--verbose` flag with per-workstream breakdown, priority matrix, and top eligible with titles.
- **V3 Fix Pass (2026-02-27):** 8 commits, 26 observations targeted. Design doc: `docs/plans/2026-02-27-pm-fix-pass-v2-design.md`. Plan: `.claude/plans/2026-02-27-pm-fix-pass-v2/`.
- **O-50/O-51/O-64/O-65:** Context enrichment — `assembleContext()` now returns body text, workstream info, and relatedNotes placeholder. `pm context` shows rich human output (task title, status/priority/category, workstream, description, related notes, deps, decisions). Context hash removed from human output (kept in --json).
- **O-67:** Template fallback — `renderInstructionsSection()` auto-generates instructions from task title + body + related notes when no prompt is authored.
- **O-68/O-72:** Cross-system search — Added `includePm` option to `SearchOptions` and `--include-tasks` flag to `brain search`. PM notes included when option is set.
- **O-57/O-58/O-61/O-62:** State machine UX — `validateTransition` error messages now list valid transitions with contextual hints. Added `--start` flag to `claim` for atomic claim+start. Token shown in claim human output. `pm complete` auto-walks pending→claimed→in-progress→done.
- **O-59:** Release from in-progress — Added `pending` to `TRANSITIONS['in-progress']`.
- **O-52:** Verify crash fix — Added default case to `suggestVerificationSteps()` returning generic steps.
- **O-54:** Task show enrichment — `pm task show` displays structured metadata (status, priority, category, mode, deps, virtual states) and body text.
- **O-55/O-73:** Task list filters — Added `--priority`, `--category`, `--search` flags to `pm task list`. `listTasks()` expanded with priority/category/search filters.
- **O-63:** PM next improvements — `pm next` now sorts by priority, groups by workstream, supports `--limit` flag (default 10).
- **O-39:** Workstream add output — Shows `Created WS-01 - Name (active)` instead of generic format.
- **O-40:** PM status enrichment — Shows workstream count, task counts by status, priority breakdown.
- **O-66:** Check human output — `pm check` outputs human-readable text by default, JSON only with `--json`.
- **O-70:** Note listing — New `brain notes list` command with `--module`, `--type`, `--tier`, `--limit`, `--json` flags.
