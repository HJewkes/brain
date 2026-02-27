# PM Module Command Reference

Quick-lookup reference for all `brain pm` commands, organized by command group.

**Enum values:**
- `--status`: `pending`, `claimed`, `in-progress`, `done`, `blocked`, `cancelled`
- `--mode`: `auto`, `interactive`, `review`, `agent`, `assisted`, `human`
- `--category`: `implementation`, `testing`, `documentation`, `research`, `review`, `infrastructure`, `configuration`, `design`, `migration`
- `--priority`: `critical`, `high`, `medium`, `low`

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

**Example:**
```bash
$ brain pm init "Web Relaunch" --prefix WEB
WEB - WEB-000 (active)
```

---

### brain pm list

List all projects.

**Usage:** `brain pm list [options]`

**Options:**
| Flag | Description | Default |
|------|-------------|---------|
| `--json` | Output JSON | false |

**Example:**
```bash
$ brain pm list
WEB - WEB-000 (active)
API - API-000 (active)
```

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

**Example:**
```bash
$ brain pm status WEB
WEB - WEB-000 [alpha] (active)
```

---

### brain pm use

Set the active project context for the current session.

**Usage:** `brain pm use <prefix>`

**Arguments:**
| Name | Required | Description |
|------|----------|-------------|
| `prefix` | Yes | Project prefix to activate |

**Example:**
```bash
$ brain pm use WEB
Active project set to WEB
```

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

**Example:**
```bash
$ brain pm project update WEB --phase beta --status active
WEB - WEB-000 [beta] (active)
```

---

### brain pm project delete

Delete a project.

**Usage:** `brain pm project delete <prefix> [options]`

**Arguments:**
| Name | Required | Description |
|------|----------|-------------|
| `prefix` | Yes | Project prefix |

**Options:**
| Flag | Description | Default |
|------|-------------|---------|
| `--force` | Force delete even with dependent notes | false |
| `--json` | Output JSON | false |

**Example:**
```bash
$ brain pm project delete WEB --force
Deleted project WEB
```

---

## Workstream Commands

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

**Example:**
```bash
$ brain pm workstream add "Frontend" --project WEB
WEB-01 - WEB 1 (active)
```

---

### brain pm workstream list

List workstreams for a project.

**Usage:** `brain pm workstream list --project <PREFIX> [options]`

**Options:**
| Flag | Description | Default |
|------|-------------|---------|
| `--project <PREFIX>` | Filter by project prefix | required |
| `--json` | Output JSON | false |

**Example:**
```bash
$ brain pm workstream list --project WEB
WEB-01 - WEB 1 (active)
WEB-02 - WEB 2 (active)
```

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

**Example:**
```bash
$ brain pm workstream show WEB-01
WEB-01 - WEB 1 (active)
```

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

**Example:**
```bash
$ brain pm workstream update WEB-01 --status done
WEB-01 - WEB 1 (done)
```

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

**Example:**
```bash
$ brain pm workstream delete WEB-02 --force
Deleted workstream WEB-02
```

---

## Task Commands

### brain pm task add

Create a new task within a workstream.

**Usage:** `brain pm task add <name> --project <PREFIX> --workstream <n> [options]`

**Arguments:**
| Name | Required | Description |
|------|----------|-------------|
| `name` | Yes | Task name |

**Options:**
| Flag | Description | Default |
|------|-------------|---------|
| `--project <PREFIX>` | Parent project prefix | required |
| `--workstream <n>` | Workstream number (integer) | required |
| `--mode <mode>` | Task mode (`auto`\|`interactive`\|`review`) | — |
| `--category <cat>` | Task category | — |
| `--priority <pri>` | Task priority (`critical`\|`high`\|`medium`\|`low`) | — |
| `--depends-on <ids...>` | Display IDs this task depends on (space-separated) | — |
| `--json` | Output JSON | false |

**Example:**
```bash
$ brain pm task add "Build login form" --project WEB --workstream 1 \
    --category implementation --priority high --depends-on WEB-01.001
WEB-01.002 - pending [high] (auto)
```

---

### brain pm task list

List tasks for a project, with optional filters.

**Usage:** `brain pm task list --project <PREFIX> [options]`

**Options:**
| Flag | Description | Default |
|------|-------------|---------|
| `--project <PREFIX>` | Filter by project prefix | required |
| `--workstream <n>` | Filter by workstream number | — |
| `--status <status>` | Filter by status | — |
| `--json` | Output JSON | false |

**Example:**
```bash
$ brain pm task list --project WEB --status pending
WEB-01.001 - pending [high] (auto)
WEB-01.002 - pending [medium] (review)
```

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

**Example:**
```bash
$ brain pm task show WEB-01.001
WEB-01.001 - pending [high] (auto)
```

---

### brain pm task update

Update task metadata fields (mode, category, priority).

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
| `--json` | Output JSON | false |

**Example:**
```bash
$ brain pm task update WEB-01.001 --priority critical --mode interactive
WEB-01.001 - pending [critical] (interactive)
```

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
| `--json` | Output JSON | false |

**Example:**
```bash
$ brain pm task done WEB-01.001
WEB-01.001 - done [high] (auto)
```

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
| `--json` | Output JSON | false |

**Example:**
```bash
$ brain pm task block WEB-01.002
WEB-01.002 - blocked [medium] (review)
```

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

**Example:**
```bash
$ brain pm task unblock WEB-01.002
WEB-01.002 - pending [medium] (review)
```

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

**Example:**
```bash
$ brain pm task delete WEB-01.003
Deleted task WEB-01.003
```

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
| `--json` | Output JSON | false |

**Example:**
```bash
$ brain pm task claim WEB-01.001 --json
{
  "display_id": "WEB-01.001",
  "status": "claimed",
  "token": "clm_a1b2c3d4e5f6"
}
```

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

**Example:**
```bash
$ brain pm task start WEB-01.001 --token clm_a1b2c3d4e5f6
WEB-01.001 - in-progress [high] (auto)
```

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

**Example:**
```bash
$ brain pm task release WEB-01.001
WEB-01.001 - pending [high] (auto)
```

---

## Decision Commands

### brain pm decision add

Record a new architectural or design decision linked to a task.

**Usage:** `brain pm decision add <name> --project <PREFIX> --source-task <id> [options]`

**Arguments:**
| Name | Required | Description |
|------|----------|-------------|
| `name` | Yes | Decision name |

**Options:**
| Flag | Description | Default |
|------|-------------|---------|
| `--project <PREFIX>` | Parent project prefix | required |
| `--source-task <id>` | Task display ID that prompted this decision | required |
| `--impacts <ids...>` | Display IDs of impacted tasks (space-separated) | — |
| `--json` | Output JSON | false |

**Example:**
```bash
$ brain pm decision add "Use JWT for auth" --project WEB \
    --source-task WEB-01.001 --impacts WEB-01.002 WEB-01.003
WEB-D001 - active from WEB-01.001
```

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

**Example:**
```bash
$ brain pm decision list --project WEB
WEB-D001 - active from WEB-01.001
WEB-D002 - superseded from WEB-01.002
```

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

**Example:**
```bash
$ brain pm decision show WEB-D001
WEB-D001 - active from WEB-01.001

Use JWT for auth
```

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

**Example:**
```bash
$ brain pm decision supersede WEB-D001 "Use session cookies instead"
Superseded WEB-D001 -> WEB-D002
```

---

## Prompt Commands

### brain pm prompt write

Write (or update) a prompt for a task.

**Usage:** `brain pm prompt write <task-id> --project <PREFIX> [options]`

**Arguments:**
| Name | Required | Description |
|------|----------|-------------|
| `task-id` | Yes | Task display ID |

**Options:**
| Flag | Description | Default |
|------|-------------|---------|
| `--project <PREFIX>` | Parent project prefix | required |
| `--content <text>` | Prompt content; reads stdin if omitted | — |
| `--json` | Output JSON | false |

**Example:**
```bash
$ brain pm prompt write WEB-01.001 --project WEB \
    --content "Implement the login form with email/password fields"
WEB-P001 v1 - draft (task: WEB-01.001)
```

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

**Example:**
```bash
$ brain pm prompt show WEB-01.001
WEB-P001 v2 - active (task: WEB-01.001)

Implement the login form with email/password fields
```

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

**Example:**
```bash
$ brain pm prompt list --project WEB
WEB-P001 v2 - active (task: WEB-01.001)
WEB-P002 v1 - draft (task: WEB-01.002)
```

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

**Example:**
```bash
$ brain pm prompt history WEB-01.001
WEB-P001 v1 - superseded (task: WEB-01.001)
WEB-P001 v2 - active (task: WEB-01.001)
```

---

## Planning Commands

### brain pm next

Show eligible tasks — those in `pending` status with all dependencies `done`.

**Usage:** `brain pm next [options]`

**Options:**
| Flag | Description | Default |
|------|-------------|---------|
| `--project <PREFIX>` | Project prefix; uses active project if omitted | — |
| `--json` | Output JSON | false |

**Example:**
```bash
$ brain pm next
WEB-01.001  high
WEB-01.003  medium  [stale-prompt]
```

---

### brain pm waves

Show topological wave grouping of remaining tasks. Wave 1 tasks have no incomplete dependencies; later waves depend on earlier ones.

**Usage:** `brain pm waves [options]`

**Options:**
| Flag | Description | Default |
|------|-------------|---------|
| `--project <PREFIX>` | Project prefix; uses active project if omitted | — |
| `--json` | Output JSON | false |

**Example:**
```bash
$ brain pm waves
Wave 1: WEB-01.001, WEB-01.003
Wave 2: WEB-01.002
Wave 3: WEB-01.004
```

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
| `--deps` | Include dependencies | true |
| `--since <timestamp>` | Filter to activities/decisions after timestamp | — |
| `--json` | Output JSON | false |

**Example:**
```bash
$ brain pm context WEB-01.002
Task: WEB-01.002
Status: pending
Category: implementation
Priority: high

--- Prompt ---
Implement JWT middleware

--- Dependencies ---
  WEB-01.001 [done] Setup project scaffold

Context hash: a3f9b2c1
```

---

### brain pm briefing

Print a session briefing with project state overview: task counts by status, recent decisions, stale prompts, and recommended next actions.

**Usage:** `brain pm briefing [options]`

**Options:**
| Flag | Description | Default |
|------|-------------|---------|
| `--project <PREFIX>` | Project prefix; uses active project if omitted | — |
| `--json` | Output JSON | false |

**Example:**
```bash
$ brain pm briefing
=== Briefing: WEB-000 ===
Status: active | Phase: alpha

Tasks: 8 total
  Done: 3
  In-progress: 1
  Eligible: 2 (WEB-01.004, WEB-02.001)
  Blocked: 0
  Pending: 2

Recommended actions:
  -> Pick up eligible task: WEB-01.004
```

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

**Example:**
```bash
$ brain pm verify WEB-01.001
Verification Plan: WEB-01.001
Category: implementation

Verification steps:
  [ ] Verify all acceptance criteria are met
  [ ] Run unit tests for changed modules
  [ ] Check for regressions in dependent code
  [ ] Review code for style and correctness
```

---

### brain pm dispatch

Assemble and output a context bundle for a task (task metadata, prompt, dependencies, decisions, context hash).

**Usage:** `brain pm dispatch <id> [options]`

**Arguments:**
| Name | Required | Description |
|------|----------|-------------|
| `id` | Yes | Task display ID |

**Options:**
| Flag | Description | Default |
|------|-------------|---------|
| `--json` | Output JSON | false |

**Example:**
```bash
$ brain pm dispatch WEB-01.002
Task: WEB-01.002
Status: in-progress
Prompt: Implement JWT middleware
Dependencies: WEB-01.001
Context hash: a3f9b2c1
```

---

## Orchestration Commands

These commands are primarily called by hooks and the orchestrator skill. They manage session lifecycle, routing, rendering, and worktree allocation.

### brain pm orchestrate session-start

Initialize an orchestration session. Called by the `SessionStart` hook. Reads JSON from stdin (optional `sessionId`). Requires an active project.

**Usage:** `brain pm orchestrate session-start`

**Example:**
```bash
$ echo '{}' | brain pm orchestrate session-start
{
  "sessionId": "a1b2c3d4",
  "project": "WEB",
  "env": {
    "BRAIN_PM_PROJECT": "WEB",
    "BRAIN_PM_SESSION": "a1b2c3d4"
  }
}
```

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

**Example:**
```bash
$ brain pm orchestrate route WEB-01.001
Task: WEB-01.001
Agent: code
Model: claude-opus-4-6
Isolation: worktree
Verify: true
Concurrency: 1
```

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

**Example:**
```bash
$ brain pm orchestrate render WEB-01.001 --json
{
  "taskId": "WEB-01.001",
  "contextHash": "a3f9b2c1",
  "prompt": "You are implementing WEB-01.001..."
}
```

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

**Example:**
```bash
$ brain pm orchestrate worktree-alloc WEB-01.001
Allocated: /tmp/brain-worktrees/WEB-01.001
Branch: pm/WEB-01.001
```

---

### brain pm orchestrate worktree-check

Validate that the current working directory (or a given path) is inside the expected worktree. Uses the `BRAIN_PM_WORKTREE` environment variable. Called by the `PreToolUse` hook.

**Usage:** `brain pm orchestrate worktree-check [options]`

**Options:**
| Flag | Description | Default |
|------|-------------|---------|
| `--path <path>` | Path to validate | CWD |

**Example:**
```bash
$ BRAIN_PM_WORKTREE=/tmp/brain-worktrees/WEB-01.001 \
    brain pm orchestrate worktree-check
# exits 0 if CWD is inside the worktree, 1 otherwise
```

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

**Example:**
```bash
$ brain pm orchestrate worktree-release WEB-01.001
Released worktree for WEB-01.001
```

---

### brain pm orchestrate worktree-status

Show all current worktree allocations and budget (used/max/available).

**Usage:** `brain pm orchestrate worktree-status [options]`

**Options:**
| Flag | Description | Default |
|------|-------------|---------|
| `--json` | Output JSON | false |

**Example:**
```bash
$ brain pm orchestrate worktree-status
Budget: 1/4 (3 available)
  WEB-01.001: /tmp/brain-worktrees/WEB-01.001 (pm/WEB-01.001)
```

---

### brain pm orchestrate agent-done

Record sub-agent completion. Called by the `SubagentStop` hook. Reads JSON from stdin with fields `taskId`, `sessionId`, `outcome`, `project`, `agentId`, `startedAt`.

**Usage:** `brain pm orchestrate agent-done`

**Example:**
```bash
$ echo '{"taskId":"WEB-01.001","outcome":"completed"}' \
    | brain pm orchestrate agent-done
{"recorded":true,"taskId":"WEB-01.001","outcome":"completed"}
```

---

### brain pm orchestrate session-end

End an orchestration session and output a summary of task counts and worktree state.

**Usage:** `brain pm orchestrate session-end [options]`

**Options:**
| Flag | Description | Default |
|------|-------------|---------|
| `--json` | Output JSON | false |

**Example:**
```bash
$ brain pm orchestrate session-end
=== Session End: WEB ===
Tasks: 3 done, 0 in-progress, 4 pending, 1 blocked (8 total)
Worktrees: 0/4 in use
```

---

## Capture Commands

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

**Example:**
```bash
$ brain pm capture "Need to add rate limiting to auth endpoints" --project WEB
note-abc123 (WEB) — Need to add rate limiting to auth endpoints
```

---

### brain pm inbox

List unprocessed captures.

**Usage:** `brain pm inbox [options]`

**Options:**
| Flag | Description | Default |
|------|-------------|---------|
| `--project <p>` | Filter by project | — |
| `--all` | Include processed captures | false |
| `--json` | Output JSON | false |

**Example:**
```bash
$ brain pm inbox --project WEB
note-abc123 (WEB) — Need to add rate limiting to auth endpoints
note-def456 (WEB) — Consider Redis for session storage
```

---

### brain pm process

Process a capture into a task.

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
| `--project <p>` | Project prefix | required |
| `--json` | Output JSON | false |

**Example:**
```bash
$ brain pm process note-abc123 --task-name "Add rate limiting" \
    --workstream 1 --project WEB
Processed capture into task WEB-01.005
```

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

**Example:**
```bash
$ brain pm import --from-json project.json
Created project: WEB-000 (Web Relaunch)
Created workstream: WEB-01 (Frontend)
Created task: WEB-01.001 (Setup scaffold)
Created task: WEB-01.002 (Build login)

Import complete: 4 item(s) created.
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

**Example:**
```bash
$ brain pm audit summary --project WEB
Total: 42, Completed: 38, Failed: 2
  task_completed: 20
  agent_done: 18
  task_created: 4
```

---

### brain pm audit cost

Cost estimation from token usage recorded in activity metadata.

**Usage:** `brain pm audit cost [options]`

**Options:**
| Flag | Description | Default |
|------|-------------|---------|
| `--project <p>` | Filter by project | — |
| `--json` | Output JSON | false |

**Example:**
```bash
$ brain pm audit cost --project WEB
Total tokens: 245000
Estimated cost: $0.7350
  claude-opus-4-6: 180000 tokens ($0.5400)
  claude-haiku-3-5: 65000 tokens ($0.1950)
```

---

### brain pm audit performance

Completion rates and average duration from activity records.

**Usage:** `brain pm audit performance [options]`

**Options:**
| Flag | Description | Default |
|------|-------------|---------|
| `--project <p>` | Filter by project | — |
| `--json` | Output JSON | false |

**Example:**
```bash
$ brain pm audit performance --project WEB
Total: 42, Completed: 38
Completion rate: 90%
Avg duration: 12500ms
```

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

**Example:**
```bash
$ brain pm audit enrich act-uuid-1234 --tokens 18000 --model claude-opus-4-6
Enriched activity act-uuid-1234 with 18000 tokens (claude-opus-4-6)
```

---

## Consistency Commands

### brain pm check

Run consistency checks on a PM project. Returns a JSON report of structural issues and (with `--deep`) semantic analysis pairs for LLM-powered contradiction detection.

**Usage:** `brain pm check [options]`

**Options:**
| Flag | Description | Default |
|------|-------------|---------|
| `--project <PREFIX>` | Project prefix; uses active project if omitted | — |
| `--deep` | Include semantic analysis (decision pairs, supersession gaps, source doc clustering) | false |
| `--json` | Output JSON | false |

**Structural checks (always run):**
- Orphaned decisions — decisions with no task impacts
- Stale prompts — prompts older than their impacting decisions (with decision details inline)
- Broken dependencies — tasks referencing nonexistent dependency targets
- Blocked without cause — blocked tasks whose dependencies are all done
- Cancelled dependencies — active tasks depending on cancelled tasks

**Semantic analysis (with `--deep`):**
- Decision pairs — decisions sharing impact targets, for contradiction analysis
- Task-decision alignment — tasks with their impacting decisions, for misalignment detection
- Supersession gaps — decisions on the same source task without formal supersession
- Source document clustering — groups ingested docs by title similarity for freshness review

**Example:**
```bash
# Quick structural check
$ brain pm check --project WEB --json
{
  "project": "WEB",
  "summary": { "totalTasks": 12, "issuesFound": 3, ... },
  "structural": { "orphanedDecisions": [...], "stalePrompts": [...], ... }
}

# Full deep analysis
$ brain pm check --deep --project WEB --json
# Includes semantic.decisionPairs, semantic.supersessionGaps, sourceDocuments
```

**Integration:** The briefing command (`brain pm briefing`) includes a one-line consistency summary when structural issues exist:
```
Consistency: 3 structural issue(s) found. Run /sanity-check for details.
```

**Claude Code skill:** The `/sanity-check` skill (installed by `brain pm install-hooks`) automates the full workflow: run checks, reason over semantic pairs, write a report, and offer corrective actions.

---

## Admin Commands

### brain pm install-hooks

Install orchestration hooks and skills into `~/.claude/`. Writes three hook scripts (`brain-pm-session.sh`, `brain-pm-worktree.sh`, `brain-pm-agent-done.sh`) and registers them in `~/.claude/settings.json` under `SessionStart`, `PreToolUse`, and `SubagentStop` hooks. Also installs the orchestrator skill (`~/.claude/skills/orchestrator/SKILL.md`) and the sanity-check skill (`~/.claude/skills/sanity-check/SKILL.md`).

**Usage:** `brain pm install-hooks [options]`

**Options:**
| Flag | Description | Default |
|------|-------------|---------|
| `--remove` | Remove installed hooks and skill | false |
| `--dry-run` | Preview changes without writing files | false |

**Example:**
```bash
$ brain pm install-hooks
Installed 5 items.
Orchestration hooks are ready. Start a new Claude Code session to activate.

$ brain pm install-hooks --dry-run
Would install:
  ~/.claude/hooks/brain-pm-session.sh
  ~/.claude/hooks/brain-pm-worktree.sh
  ~/.claude/hooks/brain-pm-agent-done.sh
  ~/.claude/skills/orchestrator/SKILL.md
  ~/.claude/skills/sanity-check/SKILL.md
  Hook entries in ~/.claude/settings.json

$ brain pm install-hooks --remove
Removed 5 items.
```
