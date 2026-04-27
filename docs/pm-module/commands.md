# PM Module Command Reference

Quick-lookup reference for all `brain pm` commands, organized by command group.

**Enum values:**
- `--status`: `pending`, `claimed`, `in-progress`, `pending-merge`, `done`, `blocked`, `cancelled`
- `--status` (virtual states): `blocked`, `ready`, `eligible` — computed from dependencies, not stored
- `--mode`: `auto`, `interactive`, `review`, `agent`, `assisted`, `human`
- `--category`: `implementation`, `testing`, `documentation`, `research`, `review`, `infrastructure`, `configuration`, `design`, `migration`
- `--priority`: `critical`, `high`, `medium`, `low`

**Aliases:**
- `brain pm tasks` → `brain pm task list` (passes through all flags)
- `brain pm workstreams` → `brain pm workstream list` (passes through all flags)

**MCP equivalents** are noted where a 1:1 tool exists. See the [MCP Equivalents](#mcp-equivalents) table at the bottom for the full mapping.

---

## Project Commands

### brain pm init

Initialize a new project.

**Usage:** `brain pm init <name> --prefix <PREFIX> [options]`

**Arguments:**
| Name | Required | Description |
|------|----------|-------------|
| `name` | Yes | Project name |

**Options:**
| Flag | Description | Default |
|------|-------------|---------|
| `--prefix <PREFIX>` | Project prefix, 2-5 uppercase chars | required |
| `--phase <phase>` | Initial phase label | — |
| `--wip-limit <n>` | WIP limit (integer) | — |
| `--json` | Output JSON | false |

---

### brain pm list

List all projects.

**Usage:** `brain pm list [options]`

**Options:**
| Flag | Description | Default |
|------|-------------|---------|
| `--json` | Output JSON | false |

---

### brain pm status

Show project status. Uses active project if no prefix given.

**Usage:** `brain pm status [prefix] [options]`

**Arguments:**
| Name | Required | Description |
|------|----------|-------------|
| `prefix` | No | Project prefix; falls back to active project |

**Options:**
| Flag | Description | Default |
|------|-------------|---------|
| `--json` | Output JSON | false |

---

### brain pm use

Set the active project context for the current session.

**Usage:** `brain pm use <prefix>`

**Arguments:**
| Name | Required | Description |
|------|----------|-------------|
| `prefix` | Yes | Project prefix to activate |

---

### brain pm project show

Show full project detail.

**Usage:** `brain pm project show <prefix> [options]`

**Arguments:**
| Name | Required | Description |
|------|----------|-------------|
| `prefix` | Yes | Project prefix |

**Options:**
| Flag | Description | Default |
|------|-------------|---------|
| `--json` | Output JSON | false |

---

### brain pm project update

Update project fields.

**Usage:** `brain pm project update <prefix> [options]`

**Arguments:**
| Name | Required | Description |
|------|----------|-------------|
| `prefix` | Yes | Project prefix |

**Options:**
| Flag | Description | Default |
|------|-------------|---------|
| `--status <status>` | New status | — |
| `--phase <phase>` | New phase label | — |
| `--wip-limit <n>` | New WIP limit (integer) | — |
| `--json` | Output JSON | false |

---

### brain pm project delete

Delete a project and all associated notes.

**Usage:** `brain pm project delete <prefix> [options]`

**Arguments:**
| Name | Required | Description |
|------|----------|-------------|
| `prefix` | Yes | Project prefix |

**Options:**
| Flag | Description | Default |
|------|-------------|---------|
| `--confirm` | Required confirmation flag | false |
| `--all` | Delete all notes including those not tracked in activity log | false |
| `--force` | Bypass safety checks | false |
| `--json` | Output JSON | false |

---

## Workstream Commands

MCP equivalents: `brain_pm_workstream_list`, `brain_pm_workstream_add`

### brain pm workstream add

Create a new workstream inside a project.

**Usage:** `brain pm workstream add <name> --project <PREFIX> [options]`

**Arguments:**
| Name | Required | Description |
|------|----------|-------------|
| `name` | Yes | Workstream name |

**Options:**
| Flag | Description | Default |
|------|-------------|---------|
| `--project <PREFIX>` | Parent project prefix | required |
| `--description <desc>` | Workstream description | — |
| `--json` | Output JSON | false |

**MCP equivalent:** `brain_pm_workstream_add`

---

### brain pm workstream list

List workstreams for a project.

**Usage:** `brain pm workstream list [prefix] [options]`

**Options:**
| Flag | Description | Default |
|------|-------------|---------|
| `--project <PREFIX>` | Filter by project prefix | — |
| `--json` | Output JSON | false |

**MCP equivalent:** `brain_pm_workstream_list`

---

### brain pm workstream show

Show workstream detail.

**Usage:** `brain pm workstream show <id> [options]`

**Arguments:**
| Name | Required | Description |
|------|----------|-------------|
| `id` | Yes | Workstream display ID (e.g. `WEB-01`) |

**Options:**
| Flag | Description | Default |
|------|-------------|---------|
| `--json` | Output JSON | false |

---

### brain pm workstream update

Update a workstream's status.

**Usage:** `brain pm workstream update <id> [options]`

**Arguments:**
| Name | Required | Description |
|------|----------|-------------|
| `id` | Yes | Workstream display ID |

**Options:**
| Flag | Description | Default |
|------|-------------|---------|
| `--status <status>` | New status | — |
| `--json` | Output JSON | false |

---

### brain pm workstream delete

Delete a workstream.

**Usage:** `brain pm workstream delete <id> [options]`

**Arguments:**
| Name | Required | Description |
|------|----------|-------------|
| `id` | Yes | Workstream display ID |

**Options:**
| Flag | Description | Default |
|------|-------------|---------|
| `--force` | Force delete even with tasks | false |
| `--json` | Output JSON | false |

---

## Task Commands

MCP equivalents: `brain_pm_task_add`, `brain_pm_task_list`, `brain_pm_task_show`, `brain_pm_task_update`, `brain_pm_task_release`, `brain_pm_task_complete`

### brain pm task add

Create a new task within a workstream.

**Usage:** `brain pm task add <name> --workstream <n> [options]`

**Arguments:**
| Name | Required | Description |
|------|----------|-------------|
| `name` | Yes | Task name |

**Options:**
| Flag | Description | Default |
|------|-------------|---------|
| `--workstream <n>` | Workstream number (integer) | required |
| `--description <text>` | Task description (body text) | — |
| `--project <PREFIX>` | Parent project prefix | active project |
| `--mode <mode>` | Task mode | — |
| `--category <cat>` | Task category | — |
| `--priority <pri>` | Task priority | — |
| `--depends-on <ids...>` | Display IDs this task depends on | — |
| `--due <date>` | Due date (ISO 8601) | — |
| `--milestone <name>` | Milestone label | — |
| `--done-when <text>` | Completion criterion text | — |
| `--ac <criterion>` | Acceptance criterion (repeatable) | — |
| `--refs <urls...>` | Reference URLs | — |
| `--json` | Output JSON | false |

**MCP equivalent:** `brain_pm_task_add`

---

### brain pm task list

List tasks for a project, with optional filters.

**Usage:** `brain pm task list --project <PREFIX> [options]`

**Options:**
| Flag | Description | Default |
|------|-------------|---------|
| `--project <PREFIX>` | Filter by project prefix | active project |
| `--workstream <n>` | Filter by workstream number or display ID | — |
| `--status <status>` | Filter by status or virtual state (`blocked`, `ready`, `eligible`) | — |
| `--priority <level>` | Filter by priority | — |
| `--category <cat>` | Filter by category | — |
| `--search <text>` | Filter by title (case-insensitive substring) | — |
| `--due-before <date>` | Filter tasks due before date (ISO 8601) | — |
| `--milestone <name>` | Filter by milestone label | — |
| `--sort <field>` | Sort by field (`priority`, `due`, `created`) | — |
| `--limit <n>` | Max tasks to return | — |
| `--full` | Show full task details | false |
| `--short` | Compact one-line output | false |
| `--json` | Output JSON (includes `virtualStates` and `depends_on`) | false |

**Notes:**
- `--status blocked` returns tasks with raw `blocked` status OR computed `+BLOCKED` virtual state
- `--status ready` and `--status eligible` filter by computed virtual states only

**MCP equivalent:** `brain_pm_task_list`

---

### brain pm task show

Show task detail.

**Usage:** `brain pm task show <id> [options]`

**Arguments:**
| Name | Required | Description |
|------|----------|-------------|
| `id` | Yes | Task display ID (e.g. `WEB-01.003`) |

**Options:**
| Flag | Description | Default |
|------|-------------|---------|
| `--json` | Output JSON | false |

**MCP equivalent:** `brain_pm_task_show`

---

### brain pm task update

Update task metadata fields.

**Usage:** `brain pm task update <id> [options]`

**Arguments:**
| Name | Required | Description |
|------|----------|-------------|
| `id` | Yes | Task display ID |

**Options:**
| Flag | Description | Default |
|------|-------------|---------|
| `--mode <mode>` | New mode | — |
| `--category <cat>` | New category | — |
| `--priority <pri>` | New priority | — |
| `--due <date>` | New due date (ISO 8601) | — |
| `--milestone <name>` | New milestone label | — |
| `--depends-on <ids...>` | Replace dependency list | — |
| `--json` | Output JSON | false |

**MCP equivalent:** `brain_pm_task_update`

---

### brain pm task done

Mark a task as done.

**Usage:** `brain pm task done <id> [options]`

**Arguments:**
| Name | Required | Description |
|------|----------|-------------|
| `id` | Yes | Task display ID |

**Options:**
| Flag | Description | Default |
|------|-------------|---------|
| `--token <token>` | Claim token to validate | — |
| `--cascade` | Also complete downstream tasks whose only blocker was this task | false |
| `--json` | Output JSON | false |

**Note:** Prefer `brain pm complete` for agent completions — it also records activity and runs impact analysis in one step.

---

### brain pm task block

Mark a task as blocked.

**Usage:** `brain pm task block <id> [options]`

**Arguments:**
| Name | Required | Description |
|------|----------|-------------|
| `id` | Yes | Task display ID |

**Options:**
| Flag | Description | Default |
|------|-------------|---------|
| `--reason <text>` | Reason for blocking | — |
| `--json` | Output JSON | false |

---

### brain pm task unblock

Unblock a task by setting it back to `pending`.

**Usage:** `brain pm task unblock <id> [options]`

**Arguments:**
| Name | Required | Description |
|------|----------|-------------|
| `id` | Yes | Task display ID |

**Options:**
| Flag | Description | Default |
|------|-------------|---------|
| `--json` | Output JSON | false |

---

### brain pm task reset

Reset a completed task back to `pending`. Requires `--force`.

**Usage:** `brain pm task reset <id> --force [options]`

**Arguments:**
| Name | Required | Description |
|------|----------|-------------|
| `id` | Yes | Task display ID |

**Options:**
| Flag | Description | Default |
|------|-------------|---------|
| `--force` | Required safety flag | required |
| `--json` | Output JSON | false |

---

### brain pm task delete

Delete a task.

**Usage:** `brain pm task delete <id> [options]`

**Arguments:**
| Name | Required | Description |
|------|----------|-------------|
| `id` | Yes | Task display ID |

**Options:**
| Flag | Description | Default |
|------|-------------|---------|
| `--force` | Force delete even with dependents | false |
| `--json` | Output JSON | false |

---

### brain pm task claim

Claim an eligible task, transitioning it from `pending` to `claimed`. Returns a claim token required by `task start`.

**Usage:** `brain pm task claim <id> [options]`

**Arguments:**
| Name | Required | Description |
|------|----------|-------------|
| `id` | Yes | Task display ID |

**Options:**
| Flag | Description | Default |
|------|-------------|---------|
| `--start` | Also transition immediately to `in-progress` | false |
| `--json` | Output JSON | false |

---

### brain pm task start

Start a claimed task, transitioning it from `claimed` to `in-progress`. Requires the claim token issued by `task claim`.

**Usage:** `brain pm task start <id> --token <token> [options]`

**Arguments:**
| Name | Required | Description |
|------|----------|-------------|
| `id` | Yes | Task display ID |

**Options:**
| Flag | Description | Default |
|------|-------------|---------|
| `--token <token>` | Claim token from `task claim` | required |
| `--json` | Output JSON | false |

---

### brain pm task release

Release a claim on a task, returning it to `pending`.

**Usage:** `brain pm task release <id> [options]`

**Arguments:**
| Name | Required | Description |
|------|----------|-------------|
| `id` | Yes | Task display ID |

**Options:**
| Flag | Description | Default |
|------|-------------|---------|
| `--json` | Output JSON | false |

**MCP equivalent:** `brain_pm_task_release`

---

### brain pm task migrate

Move a task to a different workstream (reassigns display ID).

**Usage:** `brain pm task migrate <id> <target-workstream>`

**Arguments:**
| Name | Required | Description |
|------|----------|-------------|
| `id` | Yes | Task display ID to move |
| `target-workstream` | Yes | Target workstream display ID (e.g. `WEB-02`) |

**Options:**
| Flag | Description | Default |
|------|-------------|---------|
| `--json` | Output JSON | false |

---

## Decision Commands

### brain pm decision add

Record a new architectural or design decision linked to a task.

**Usage:** `brain pm decision add <name> --source-task <id> [options]`

**Arguments:**
| Name | Required | Description |
|------|----------|-------------|
| `name` | Yes | Decision name |

**Options:**
| Flag | Description | Default |
|------|-------------|---------|
| `--source-task <id>` | Task display ID that prompted this decision | required |
| `--project <PREFIX>` | Parent project prefix | active project |
| `--impacts <ids...>` | Display IDs of impacted tasks (space-separated) | — |
| `--json` | Output JSON | false |

---

### brain pm decision list

List decisions for a project.

**Usage:** `brain pm decision list --project <PREFIX> [options]`

**Options:**
| Flag | Description | Default |
|------|-------------|---------|
| `--project <PREFIX>` | Filter by project prefix | required |
| `--status <status>` | Filter by decision status | — |
| `--json` | Output JSON | false |

---

### brain pm decision show

Show decision detail including content body.

**Usage:** `brain pm decision show <id> [options]`

**Arguments:**
| Name | Required | Description |
|------|----------|-------------|
| `id` | Yes | Decision display ID (e.g. `WEB-D001`) |

**Options:**
| Flag | Description | Default |
|------|-------------|---------|
| `--json` | Output JSON | false |

---

### brain pm decision supersede

Supersede an existing decision with a new one (marks old decision as `superseded`).

**Usage:** `brain pm decision supersede <old-id> <name> [options]`

**Arguments:**
| Name | Required | Description |
|------|----------|-------------|
| `old-id` | Yes | Display ID of decision to supersede |
| `name` | Yes | Name for the new decision |

**Options:**
| Flag | Description | Default |
|------|-------------|---------|
| `--impacts <ids...>` | Display IDs of impacted tasks | — |
| `--json` | Output JSON | false |

---

## Prompt Commands

### brain pm prompt write

Write (or update) a prompt for a task.

**Usage:** `brain pm prompt write <task-id> [options]`

**Arguments:**
| Name | Required | Description |
|------|----------|-------------|
| `task-id` | Yes | Task display ID |

**Options:**
| Flag | Description | Default |
|------|-------------|---------|
| `--project <PREFIX>` | Parent project prefix | active project |
| `--content <text>` | Prompt content; reads stdin if omitted | — |
| `--json` | Output JSON | false |

---

### brain pm prompt show

Show the current (or a specific version of) prompt for a task.

**Usage:** `brain pm prompt show <task-id> [options]`

**Arguments:**
| Name | Required | Description |
|------|----------|-------------|
| `task-id` | Yes | Task display ID |

**Options:**
| Flag | Description | Default |
|------|-------------|---------|
| `--version <n>` | Specific version number | latest |
| `--json` | Output JSON | false |

---

### brain pm prompt list

List prompts for a project.

**Usage:** `brain pm prompt list --project <PREFIX> [options]`

**Options:**
| Flag | Description | Default |
|------|-------------|---------|
| `--project <PREFIX>` | Filter by project prefix | required |
| `--status <status>` | Filter by prompt status | — |
| `--json` | Output JSON | false |

---

### brain pm prompt history

Show all versions of prompts for a task.

**Usage:** `brain pm prompt history <task-id> [options]`

**Arguments:**
| Name | Required | Description |
|------|----------|-------------|
| `task-id` | Yes | Task display ID |

**Options:**
| Flag | Description | Default |
|------|-------------|---------|
| `--json` | Output JSON | false |

---

## Planning & Dispatch Commands

MCP equivalents: `brain_pm_next`, `brain_pm_overview`, `brain_pm_wave`, `brain_pm_context`, `brain_pm_task_complete`

### brain pm next

Show eligible tasks — those in `pending` status with all dependencies `done`. Sorted by priority then workstream.

**Usage:** `brain pm next [prefix] [options]`

**Options:**
| Flag | Description | Default |
|------|-------------|---------|
| `--project <PREFIX>` | Project prefix; uses active project if omitted | — |
| `--all` | Show all eligible tasks without truncation | false |
| `--limit <n>` | Max tasks to show | 10 |
| `--workstream <ws>` | Filter by workstream number, display ID, or name | — |
| `--json` | Output JSON | false |

**MCP equivalent:** `brain_pm_next`

---

### brain pm waves

Show topological wave grouping of remaining tasks. Wave 1 tasks have no incomplete dependencies; later waves depend on earlier ones.

**Usage:** `brain pm waves [prefix] [options]`

**Options:**
| Flag | Description | Default |
|------|-------------|---------|
| `--project <PREFIX>` | Project prefix; uses active project if omitted | — |
| `--workstream <id>` | Filter to tasks in a specific workstream | — |
| `--json` | Output JSON | false |

**MCP equivalent:** `brain_pm_wave`

---

### brain pm dispatch

Assemble and output a rich context bundle for a task (task metadata, prompt, dependencies, decisions, peer tasks, downstream dependents, related notes, context hash).

**Usage:** `brain pm dispatch <id> [options]`

**Arguments:**
| Name | Required | Description |
|------|----------|-------------|
| `id` | Yes | Task display ID |

**Options:**
| Flag | Description | Default |
|------|-------------|---------|
| `--spawn-prompt` | Output agent-ready spawn prompt with routing metadata (JSON) | false |
| `--json` | Output full bundle as JSON | false |

**Notes:**
- Without `--spawn-prompt`: outputs structured context bundle (task + workstream + deps + decisions + related notes)
- With `--spawn-prompt`: outputs `{ taskId, prompt, routing, dispatchable }` ready for agent invocation

---

### brain pm complete

Mark a task done, record activity, and run dependency impact analysis. Accepts tasks in any pre-done state — auto-advances `pending → claimed → in-progress → done` as needed.

**Usage:** `brain pm complete <id> [options]`

**Arguments:**
| Name | Required | Description |
|------|----------|-------------|
| `id` | Yes | Task display ID |

**Options:**
| Flag | Description | Default |
|------|-------------|---------|
| `--token <token>` | Claim token to validate | — |
| `--summary <text>` | Completion summary (written to `{id}/summary.md`) | — |
| `--json` | Output JSON with newly eligible tasks | false |

**MCP equivalent:** `brain_pm_task_complete`

---

### brain pm context

Assemble rich context for a task: prompt, dependencies, and decisions.

**Usage:** `brain pm context <id> [options]`

**Arguments:**
| Name | Required | Description |
|------|----------|-------------|
| `id` | Yes | Task display ID |

**Options:**
| Flag | Description | Default |
|------|-------------|---------|
| `--decisions` | Include decisions | true |
| `--no-deps` | Exclude dependencies | false |
| `--since <timestamp>` | Filter activities/decisions after timestamp | — |
| `--json` | Output JSON | false |

**MCP equivalent:** `brain_pm_context`

---

### brain pm briefing

Print a session briefing with project state overview: task counts by status, recent decisions, stale prompts, and recommended next actions. Automatically includes a one-line consistency summary when structural issues exist.

**Usage:** `brain pm briefing [options]`

**Options:**
| Flag | Description | Default |
|------|-------------|---------|
| `--project <PREFIX>` | Project prefix; uses active project if omitted | — |
| `--verbose` | Show workstream breakdown and priority matrix | false |
| `--json` | Output JSON | false |

---

### brain pm overview

Strategic project overview in a single call: workstream progress, priority matrix, and top eligible tasks per workstream. Optimised for agent bootstrapping (fewer round-trips than `briefing` + `workstream list` + `next`).

**Usage:** `brain pm overview [options]`

**Options:**
| Flag | Description | Default |
|------|-------------|---------|
| `--project <PREFIX>` | Project prefix; uses active project if omitted | — |
| `--json` | Output JSON | false |

**MCP equivalent:** `brain_pm_overview`

---

### brain pm verify

Generate a verification checklist for a task, tailored to its category.

**Usage:** `brain pm verify <id> [options]`

**Arguments:**
| Name | Required | Description |
|------|----------|-------------|
| `id` | Yes | Task display ID |

**Options:**
| Flag | Description | Default |
|------|-------------|---------|
| `--json` | Output JSON | false |

---

### brain pm dispatch-wave

Compute the current dependency wave and show eligible, in-progress, and blocked tasks with file-ownership collision detection. Surfaces which tasks are ready to dispatch in parallel and which are waiting.

**Usage:** `brain pm dispatch-wave [prefix] [options]`

**Arguments:**
| Name | Required | Description |
|------|----------|-------------|
| `prefix` | No | Project prefix; uses active project if omitted |

**Options:**
| Flag | Description | Default |
|------|-------------|---------|
| `--project <prefix>` | Project prefix (alternative to positional) | — |
| `--claim` | Auto-claim all eligible tasks | false |
| `--max <n>` | Max eligible tasks to include | all |
| `--dry-run` | Show what would be claimed without claiming | false |
| `--json` | Output JSON (`{ wave, eligible, inProgress, blocked, nextWave, collisions }`) | false |

**Notes:**
- Detects file-path ownership collisions: if two eligible tasks reference the same files, a warning is printed.
- `--claim` transitions all eligible tasks to `claimed` status.

---

### brain pm pull

Pull the next eligible task for agent dispatch. Claims the task and returns routing information and the claim token.

**Usage:** `brain pm pull [options]`

**Options:**
| Flag | Description | Default |
|------|-------------|---------|
| `--project <prefix>` | Project prefix | active project |
| `--json` | Output JSON (`{ taskId, claimToken, routing, agentDispatchable }`) | false |

---

### brain pm render-prompt

Render an agent prompt template with task context variables substituted. Used by coordinators to build worker spawn prompts from templates in `templates/agents/`.

**Usage:** `brain pm render-prompt <id> --template <name> [options]`

**Arguments:**
| Name | Required | Description |
|------|----------|-------------|
| `id` | Yes | Task display ID |

**Options:**
| Flag | Description | Default |
|------|-------------|---------|
| `--template <name>` | Template name (file in `templates/agents/<name>.md`) | required |
| `--project-dir <dir>` | Project directory | cwd |
| `--team-name <name>` | Team name for coordinator/worker communication | — |
| `--claim-token <token>` | Claim token for the task | — |

---

## Review Commands

The review lifecycle tracks PR creation and automated review for agent-submitted work.

### brain pm review create

Create a review task linked to a PR. Optionally auto-completes the source task and rewires its downstream dependencies to point at the new review task.

**Usage:** `brain pm review create <task-id> --pr <url> --branch <branch> [options]`

**Arguments:**
| Name | Required | Description |
|------|----------|-------------|
| `task-id` | Yes | Source task display ID (e.g. `WEB-02.01`) |

**Options:**
| Flag | Description | Default |
|------|-------------|---------|
| `--pr <url>` | Pull request URL | required |
| `--branch <branch>` | Branch name | required |
| `--agent <id>` | Agent ID that created the PR | — |
| `--no-rewire` | Skip dependency rewiring | rewire enabled |
| `--no-auto-complete` | Skip auto-completing the source task | auto-complete enabled |
| `--risk <1-5>` | Risk score for review routing advisory | — |
| `--json` | Output JSON (`{ reviewTaskId, rewiredDeps, riskAdvisory, sourceAutoCompleted }`) | false |

**Notes:**
- By default, downstream tasks that depended on `task-id` are rewired to depend on the new review task instead.
- Risk score 1-5 influences the review routing advisory (1 = low risk, 5 = high risk).

---

## Burndown Commands

The burndown orchestrator drives continuous task dispatch: it monitors the active project, fills WIP slots with eligible tasks, and detects stalled agents.

### brain pm burndown run

Run the burndown orchestrator to process the task backlog.

**Usage:** `brain pm burndown run [options]`

**Options:**
| Flag | Description | Default |
|------|-------------|---------|
| `--project <prefix>` | Project prefix | active project |
| `--wip-limit <n>` | Max concurrent agents | 3 |
| `--dry-run` | Show what would be dispatched without spawning | false |
| `--once` | Run a single tick then exit | false |
| `--interval <ms>` | Tick interval in milliseconds | 60000 |
| `--json` | Output JSON | false |

**Notes:**
- Runs indefinitely until SIGINT/SIGTERM unless `--once` is passed.
- `--dry-run` shows the dispatch plan without claiming tasks or spawning agents.

---

### brain pm burndown status

Show the burndown progress dashboard: task counts, active agents, WIP utilisation, and stall detection.

**Usage:** `brain pm burndown status [options]`

**Options:**
| Flag | Description | Default |
|------|-------------|---------|
| `--project <prefix>` | Project prefix | active project |
| `--json` | Output JSON | false |

---

### brain pm burndown launch

Render a coordinator prompt for the Team/Agent pattern. The coordinator prompt is rendered from a template and printed to stdout, ready to paste into a Claude Code coordinator agent invocation.

**Usage:** `brain pm burndown launch [options]`

**Options:**
| Flag | Description | Default |
|------|-------------|---------|
| `--project <prefix>` | Project prefix | active project |
| `--wip-limit <n>` | Max concurrent agents (reads from `ao.config.json` if not set) | 4 |
| `--team-name <name>` | Base team name (suffixed with project prefix) | `burndown` |
| `--template <name>` | Coordinator template name in `templates/agents/` | `coordinator` |
| `--dry-run` | Print coordinator prompt without launching | false |
| `--json` | Output JSON (`{ project, teamName, wipLimit, totalTasks, doneTasks, prompt }`) | false |

---

## Activity Commands

Activity notes record PM events (imports, dispatch runs, completions) for audit and provenance tracking.

### brain pm activity list

List activity notes for a project.

**Usage:** `brain pm activity list [options]`

**Options:**
| Flag | Description | Default |
|------|-------------|---------|
| `--project <prefix>` | Filter by project prefix | — |
| `--json` | Output JSON | false |

---

### brain pm activity show

Show full detail of an activity note.

**Usage:** `brain pm activity show <id> [options]`

**Arguments:**
| Name | Required | Description |
|------|----------|-------------|
| `id` | Yes | Activity note ID |

**Options:**
| Flag | Description | Default |
|------|-------------|---------|
| `--json` | Output JSON | false |

---

## Onboard Commands

### brain pm onboard

Set up a PM project from a codebase. Detects components, discovers docs, ingests them, and creates a project with an onboard manifest.

**Usage:** `brain pm onboard <project-name> [options]`

**Arguments:**
| Name | Required | Description |
|------|----------|-------------|
| `project-name` | Yes | Project name |

**Options:**
| Flag | Description | Default |
|------|-------------|---------|
| `--prefix <PREFIX>` | Project prefix (2-5 uppercase chars) | derived from name |
| `--cwd <path>` | Project directory to scan | current working directory |
| `--max-docs <n>` | Max docs to ingest (0 = no limit) | no limit |
| `--skip-ingest` | Skip doc ingestion phase | false |
| `--reset` | Wipe existing onboard data and start fresh | false |
| `--json` | Output JSON | false |

**Phases:**
1. **Detect** — Scan `--cwd` for components (package.json, Cargo.toml, etc.)
2. **Create** — Create project note with prefix
3. **Discover** — Find and score `.md` files across component paths
4. **Ingest** — Copy docs to brain notes dir, add frontmatter, index
5. **Reference** — Ingest PM reference docs (commands.md, architecture.md) from brain package

---

## Orchestration Commands

These commands are primarily called by hooks and the orchestrator skill. They manage session lifecycle, routing, rendering, and worktree allocation.

### brain pm orchestrate session-start

Initialize an orchestration session. Called by the `SessionStart` hook. Reads JSON from stdin (optional `sessionId`). Requires an active project. Outputs JSON metadata followed by a command quick-reference cheat sheet for agent context.

**Usage:** `brain pm orchestrate session-start`

---

### brain pm orchestrate route

Compute routing for a task: which agent type, model, isolation, verification, and concurrency.

**Usage:** `brain pm orchestrate route <id> [options]`

**Arguments:**
| Name | Required | Description |
|------|----------|-------------|
| `id` | Yes | Task display ID |

**Options:**
| Flag | Description | Default |
|------|-------------|---------|
| `--json` | Output JSON | false |

---

### brain pm orchestrate render

Render the agent prompt (or verification prompt) for a task.

**Usage:** `brain pm orchestrate render <id> [options]`

**Arguments:**
| Name | Required | Description |
|------|----------|-------------|
| `id` | Yes | Task display ID |

**Options:**
| Flag | Description | Default |
|------|-------------|---------|
| `--worktree <path>` | Worktree path to include in prompt | — |
| `--verification` | Render verification prompt instead of agent prompt | false |
| `--json` | Output JSON with metadata | false |

---

### brain pm orchestrate worktree-alloc

Allocate a git worktree for a task.

**Usage:** `brain pm orchestrate worktree-alloc <id> [options]`

**Arguments:**
| Name | Required | Description |
|------|----------|-------------|
| `id` | Yes | Task display ID |

**Options:**
| Flag | Description | Default |
|------|-------------|---------|
| `--json` | Output JSON | false |

---

### brain pm orchestrate worktree-check

Validate that the current working directory (or a given path) is inside the expected worktree. Uses the `BRAIN_PM_WORKTREE` environment variable. Called by the `PreToolUse` hook.

**Usage:** `brain pm orchestrate worktree-check [options]`

**Options:**
| Flag | Description | Default |
|------|-------------|---------|
| `--path <path>` | Path to validate | CWD |

---

### brain pm orchestrate worktree-release

Release the worktree allocation for a task.

**Usage:** `brain pm orchestrate worktree-release <id> [options]`

**Arguments:**
| Name | Required | Description |
|------|----------|-------------|
| `id` | Yes | Task display ID |

**Options:**
| Flag | Description | Default |
|------|-------------|---------|
| `--json` | Output JSON | false |

---

### brain pm orchestrate worktree-status

Show all current worktree allocations and budget (used/max/available).

**Usage:** `brain pm orchestrate worktree-status [options]`

**Options:**
| Flag | Description | Default |
|------|-------------|---------|
| `--json` | Output JSON | false |

---

### brain pm orchestrate agent-done

Record sub-agent completion. Called by the `SubagentStop` hook. Reads JSON from stdin with fields `taskId`, `sessionId`, `outcome`, `project`, `agentId`, `startedAt`.

**Usage:** `brain pm orchestrate agent-done`

---

### brain pm orchestrate session-end

End an orchestration session and output a summary of task counts and worktree state.

**Usage:** `brain pm orchestrate session-end [options]`

**Options:**
| Flag | Description | Default |
|------|-------------|---------|
| `--json` | Output JSON | false |

---

## Capture Commands

MCP equivalent: `brain_pm_capture`

### brain pm capture

Quick-capture a note into the PM inbox.

**Usage:** `brain pm capture <text> [options]`

**Arguments:**
| Name | Required | Description |
|------|----------|-------------|
| `text` | Yes | Text to capture |

**Options:**
| Flag | Description | Default |
|------|-------------|---------|
| `--project <p>` | Project scope | — |
| `--source <s>` | Capture source identifier | `cli` |
| `--json` | Output JSON | false |

**MCP equivalent:** `brain_pm_capture`

---

### brain pm inbox

List unprocessed captures. Alias: `brain pm capture inbox`.

**Usage:** `brain pm inbox [options]`

**Options:**
| Flag | Description | Default |
|------|-------------|---------|
| `--project <p>` | Filter by project | — |
| `--all` | Include processed captures | false |
| `--json` | Output JSON | false |

---

### brain pm process

Process a capture into a task. Alias: `brain pm capture process`.

**Usage:** `brain pm process <capture-id> --task-name <n> --workstream <ws> --project <p> [options]`

**Arguments:**
| Name | Required | Description |
|------|----------|-------------|
| `capture-id` | Yes | Capture note ID |

**Options:**
| Flag | Description | Default |
|------|-------------|---------|
| `--task-name <n>` | Name for the new task | required |
| `--workstream <ws>` | Workstream number (integer) | required |
| `--description <text>` | Task description | — |
| `--project <p>` | Project prefix | required |
| `--json` | Output JSON | false |

---

## Import Commands

### brain pm import

Import an entire project structure (project, workstreams, tasks with dependencies) from a JSON file.

**Usage:** `brain pm import --from-json <file> [options]`

**Options:**
| Flag | Description | Default |
|------|-------------|---------|
| `--from-json <file>` | JSON file to import | required |
| `--json` | Output JSON | false |

**JSON file format:**
```json
{
  "name": "Web Relaunch",
  "prefix": "WEB",
  "workstreams": [
    {
      "name": "Frontend",
      "tasks": [
        { "name": "Setup scaffold", "priority": "high" },
        { "name": "Build login", "priority": "medium", "depends_on": ["WEB-01.001"] }
      ]
    }
  ]
}
```

---

## Audit Commands

### brain pm audit summary

Aggregated activity stats for PM module (total, completed, failed, counts by type).

**Usage:** `brain pm audit summary [options]`

**Options:**
| Flag | Description | Default |
|------|-------------|---------|
| `--project <p>` | Filter by project | — |
| `--since <date>` | Filter by start date (ISO 8601) | — |
| `--json` | Output JSON | false |

---

### brain pm audit cost

Cost estimation from token usage recorded in activity metadata.

**Usage:** `brain pm audit cost [options]`

**Options:**
| Flag | Description | Default |
|------|-------------|---------|
| `--project <p>` | Filter by project | — |
| `--json` | Output JSON | false |

---

### brain pm audit performance

Completion rates and average duration from activity records.

**Usage:** `brain pm audit performance [options]`

**Options:**
| Flag | Description | Default |
|------|-------------|---------|
| `--project <p>` | Filter by project | — |
| `--json` | Output JSON | false |

---

### brain pm audit executions

Recent execution activity log.

**Usage:** `brain pm audit executions [options]`

**Options:**
| Flag | Description | Default |
|------|-------------|---------|
| `--project <p>` | Filter by project | — |
| `--limit <n>` | Max records to return | — |
| `--json` | Output JSON | false |

---

### brain pm audit enrich

Add telemetry (token count and model) to an existing activity record.

**Usage:** `brain pm audit enrich <activity-id> --tokens <n> --model <m> [options]`

**Arguments:**
| Name | Required | Description |
|------|----------|-------------|
| `activity-id` | Yes | Activity ID |

**Options:**
| Flag | Description | Default |
|------|-------------|---------|
| `--tokens <n>` | Token count (integer) | required |
| `--model <m>` | Model name | required |
| `--json` | Output JSON | false |

---

### brain pm audit cleanup

Cancel planning stubs and release orphaned claims. Safe to run periodically.

**Usage:** `brain pm audit cleanup [options]`

**Options:**
| Flag | Description | Default |
|------|-------------|---------|
| `--project <p>` | Filter by project | — |
| `--dry-run` | Preview changes without applying | false |
| `--claim-ttl <ms>` | Override claim TTL for stale detection | default TTL |
| `--json` | Output JSON | false |

---

## Consistency Commands

### brain pm check

Run consistency checks on a PM project. Returns a report of structural issues and (with `--deep`) semantic analysis pairs for LLM-powered contradiction detection.

**Usage:** `brain pm check [options]`

**Options:**
| Flag | Description | Default |
|------|-------------|---------|
| `--project <PREFIX>` | Project prefix; uses active project if omitted | — |
| `--deep` | Include semantic analysis (decision pairs, supersession gaps, source doc clustering) | false |
| `--deps` | Include dependency chain analysis | false |
| `--json` | Output JSON | false |

**Structural checks (always run):**
- Orphaned decisions — decisions with no task impacts
- Stale prompts — prompts older than their impacting decisions
- Broken dependencies — tasks referencing nonexistent dependency targets
- Blocked without cause — blocked tasks whose dependencies are all done
- Cancelled dependencies — active tasks depending on cancelled tasks

**Semantic analysis (with `--deep`):**
- Decision pairs — decisions sharing impact targets, for contradiction analysis
- Task-decision alignment — tasks with their impacting decisions
- Supersession gaps — decisions on the same source task without formal supersession
- Source document clustering — groups ingested docs by title similarity

**Integration:** The `briefing` command includes a one-line consistency summary when structural issues exist. The `/sanity-check` skill automates the full workflow.

---

## Admin Commands

### brain pm rename-prefix

Rename a project's prefix. Renames all associated note files and updates frontmatter metadata.

**Usage:** `brain pm rename-prefix <old> <new> [options]`

**Arguments:**
| Name | Required | Description |
|------|----------|-------------|
| `old` | Yes | Current project prefix |
| `new` | Yes | New project prefix (2-5 uppercase chars) |

**Options:**
| Flag | Description | Default |
|------|-------------|---------|
| `--dry-run` | Preview renames without applying | false |
| `--json` | Output JSON | false |

---

### brain pm relate

Create or remove a relation between PM notes.

**Usage:** `brain pm relate <source> <target> [options]`

**Arguments:**
| Name | Required | Description |
|------|----------|-------------|
| `source` | Yes | Source note display ID |
| `target` | Yes | Target note display ID |

**Options:**
| Flag | Description | Default |
|------|-------------|---------|
| `--type <type>` | Relation type (`related`, `depends_on`, `derived-from`, `parent`) | `related` |
| `--remove` | Remove the relation instead of adding | false |
| `--json` | Output JSON | false |

---

### brain pm install-hooks

Install orchestration hooks and skills into `~/.claude/`. Writes three hook scripts and registers them in `~/.claude/settings.json` under `SessionStart`, `PreToolUse`, and `SubagentStop` hooks. Also installs the orchestrator skill and the sanity-check skill.

**Usage:** `brain pm install-hooks [options]`

**Options:**
| Flag | Description | Default |
|------|-------------|---------|
| `--remove` | Remove installed hooks and skill | false |
| `--dry-run` | Preview changes without writing files | false |

---

## MCP Equivalents

The following MCP tools have 1:1 CLI equivalents. Use these when calling PM commands from MCP-enabled contexts (e.g., the brain MCP server).

| MCP Tool | CLI Equivalent |
|----------|----------------|
| `brain_pm_task_add` | `brain pm task add` |
| `brain_pm_task_list` | `brain pm task list` |
| `brain_pm_task_show` | `brain pm task show` |
| `brain_pm_task_update` | `brain pm task update` |
| `brain_pm_task_release` | `brain pm task release` |
| `brain_pm_task_complete` | `brain pm complete` |
| `brain_pm_next` | `brain pm next` |
| `brain_pm_overview` | `brain pm overview` |
| `brain_pm_wave` | `brain pm waves` |
| `brain_pm_context` | `brain pm context` |
| `brain_pm_capture` | `brain pm capture` |
| `brain_pm_workstream_list` | `brain pm workstream list` |
| `brain_pm_workstream_add` | `brain pm workstream add` |
