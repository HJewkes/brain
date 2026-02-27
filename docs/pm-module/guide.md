# PM Module User Guide

The PM module turns the brain knowledge base into a project management system. Projects, workstreams, tasks, decisions, and prompts are stored as notes with structured metadata. The CLI is the primary interface; the orchestration layer wires it into Claude Code's hook system for automated agent dispatch.

See also: quickstart.md for initial setup, architecture.md for internals, commands.md for a complete option listing.

---

## 1. Projects

A project is the top-level container. It has a short uppercase prefix (2-5 chars) that namespaces all subordinate records. Projects move through a lifecycle: `active` → `paused` → `completed` → `archived`.

### Create and activate

```bash
# Initialize a new project
brain pm init "Web Redesign" --prefix WEB --phase "discovery"
# WEB - WEB-01 [discovery] (active)

# Set it as the active project (used by commands that omit --project)
brain pm use WEB
# Active project set to WEB

# List all projects
brain pm list
# WEB - WEB-01 [discovery] (active)
# API - API-01 (paused)

# Show status of a specific project
brain pm status WEB
# WEB - WEB-01 [discovery] (active)
```

### Update and delete

```bash
# Advance phase, change status, or set WIP limit
brain pm project update WEB --phase "implementation"
brain pm project update WEB --status paused
brain pm project update WEB --wip-limit 3

# Delete (add --force to bypass dependent-note check)
brain pm project delete WEB
brain pm project delete WEB --force
```

### Common patterns

- Set `--wip-limit` to cap concurrent in-progress tasks across the project.
- Use `--json` on any command to get machine-readable output for scripting.
- `brain pm status` (no argument) reads the active project set by `brain pm use`.

---

## 2. Workstreams

Workstreams organize parallel tracks of work within a project. Each workstream is numbered automatically (01, 02, …) per project. Tasks belong to exactly one workstream.

### Create and list

```bash
# Add a workstream to a project
brain pm workstream add "Frontend" --project WEB --description "UI layer work"
# WEB-01 - WEB #1 (active)

brain pm workstream add "Backend" --project WEB
# WEB-02 - WEB #2 (active)

# List all workstreams for a project (--project is required)
brain pm workstream list --project WEB
# WEB-01 - WEB #1 (active)
# WEB-02 - WEB #2 (active)
```

### Show, update, and delete

```bash
# Show workstream detail
brain pm workstream show WEB-01

# Update status
brain pm workstream update WEB-01 --status paused
brain pm workstream update WEB-01 --status completed

# Delete (--force removes workstream even if it has tasks)
brain pm workstream delete WEB-01 --force
```

### Common patterns

- One workstream per area of responsibility (frontend, backend, infra, docs).
- Workstream numbers appear in task IDs: `WEB-01.03` = project WEB, workstream 1, task 3.
- Pausing a workstream does not change task statuses; it signals intent only.

---

## 3. Tasks

Tasks are the unit of work. Each task belongs to a project and workstream, has a category that controls routing, a mode that controls execution style, and a status that tracks progress.

**Status flow:** `pending` → `claimed` → `in-progress` → `done`
**Side exits:** `blocked`, `cancelled`

**Categories:** `implementation`, `testing`, `documentation`, `research`, `review`, `infrastructure`, `configuration`, `design`, `migration`

**Modes:** `agent`, `assisted`, `human`, `review`, `auto`, `interactive`

**Priorities:** `critical`, `high`, `medium`, `low`

### Add tasks

```bash
# Basic task (workstream 1, defaults for mode/category/priority)
brain pm task add "Implement login form" --project WEB --workstream 1 \
  --category implementation --mode agent --priority high

# Task with dependencies declared at creation
brain pm task add "Write login tests" --project WEB --workstream 1 \
  --category testing --mode agent --priority medium \
  --depends-on WEB-01.01
```

### List and show

```bash
# List all tasks in a project
brain pm task list --project WEB

# Filter by workstream or status
brain pm task list --project WEB --workstream 1
brain pm task list --project WEB --status pending

# Show a single task (display ID format: PREFIX-WS.NUM)
brain pm task show WEB-01.01
# WEB-01.01 - pending [high] (agent)
```

### Update fields

```bash
# Change mode, category, or priority
brain pm task update WEB-01.01 --priority critical
brain pm task update WEB-01.01 --mode human
brain pm task update WEB-01.01 --category review
```

### Status transitions

```bash
# Mark done
brain pm task done WEB-01.01

# Block and unblock
brain pm task block WEB-01.02
brain pm task unblock WEB-01.02   # returns to pending

# Delete (--force bypasses dependent-task check)
brain pm task delete WEB-01.01
brain pm task delete WEB-01.01 --force
```

### Common patterns

- Use `brain pm next` to see which tasks are ready to pick up (all deps satisfied).
- Prefer setting `--mode agent` for tasks you want the orchestration skill to dispatch automatically.
- The `--depends-on` flag at creation is a shortcut; dependencies can also be added via `brain pm task update`.

---

## 4. Dependencies and Waves

Tasks form a directed acyclic graph (DAG). A task with dependencies will not appear as eligible until all upstream tasks are `done`. The engine rejects any dependency edge that would create a cycle.

### Adding dependencies

Dependencies are set at task creation with `--depends-on`, or updated afterward:

```bash
# At creation
brain pm task add "Deploy service" --project WEB --workstream 2 \
  --category infrastructure --depends-on WEB-01.01 WEB-01.02

# After creation (update replaces all fields passed)
brain pm task update WEB-02.01 --mode agent
```

Cycle detection runs on every dependency insertion. If you try to add an edge that would create a cycle, the command fails with `CYCLE_DETECTED` and shows the offending path.

### Eligible tasks

```bash
# Tasks that are pending with all dependencies done
brain pm next
# WEB-01.03  high +ELIGIBLE
# WEB-02.01  medium

brain pm next --json
# [{ "display_id": "WEB-01.03", "priority": "high", "virtualStates": ["+ELIGIBLE"] }]
```

### Waves

Waves group remaining tasks into topological layers — wave 0 can start immediately, wave 1 starts after wave 0 is done, and so on:

```bash
brain pm waves
# Wave 0: WEB-01.01, WEB-01.02
# Wave 1: WEB-01.03, WEB-02.01
# Wave 2: WEB-02.02

brain pm waves --json
# [{ "wave": 0, "tasks": [...] }, ...]
```

### Common patterns

- Use `brain pm waves` at session start to understand the project's execution shape before picking work.
- Wave assignment excludes `done` and `cancelled` tasks.
- `brain pm briefing` shows eligible tasks, in-progress tasks, and next recommended actions in one view.

---

## 5. Claims and Dispatch

The claim mechanism prevents two agents from racing on the same task. Claiming a task transitions it to `claimed` and issues a time-limited token (10-minute timeout). Starting the task requires presenting that token, which validates identity and freshness.

### Claim a task

```bash
# Claim transitions pending → claimed and returns a token
brain pm task claim WEB-01.01
# WEB-01.01 - claimed [high] (agent)
# (token printed with --json)

brain pm task claim WEB-01.01 --json
# { "display_id": "WEB-01.01", "status": "claimed", "token": "uuid-here", ... }
```

### Start with token

```bash
# Start transitions claimed → in-progress; token must match
brain pm task start WEB-01.01 --token <uuid-from-claim>
# WEB-01.01 - in-progress [high] (agent)
```

### Dispatch context bundle

The dispatch command assembles the full context bundle for a task: the prompt, all dependency statuses, and relevant decisions:

```bash
brain pm dispatch WEB-01.01
# Task: WEB-01.01
# Status: in-progress
# Prompt: Implement the login form with email + password fields...
# Dependencies: WEB-01.00 (done)
# Decisions: WEB-D01
# Context hash: abc123

brain pm dispatch WEB-01.01 --json
# Full bundle including contextHash
```

### Release a claim (admin)

```bash
# Return a claimed task to pending without validating the token
brain pm task release WEB-01.01
# WEB-01.01 - pending [high] (agent)
```

### Common patterns

- The orchestration skill handles claim/start/dispatch as a sequence automatically (see Section 11).
- If a claim expires (10 minutes) and the token is no longer valid, use `task release` to reset.
- The context hash in the dispatch bundle lets agents detect when their context has changed mid-flight.

---

## 6. Decisions

Decisions are ADR-style records linked to the task that prompted them. They track the evolution of architectural and design choices over time. A decision can impact multiple tasks and can be superseded by a newer decision, forming a chain.

**Status:** `proposed` → `accepted` (also `superseded`, `rejected`)

### Record a decision

```bash
# Link a decision to the task where it arose
brain pm decision add "Use JWT for session tokens" \
  --project WEB --source-task WEB-01.01 \
  --impacts WEB-01.03 WEB-02.01
# WEB-D01 - proposed from WEB-01.01

# List decisions for a project
brain pm decision list --project WEB
# WEB-D01 - proposed from WEB-01.01

# Filter by status
brain pm decision list --project WEB --status accepted
```

### Show a decision

```bash
brain pm decision show WEB-D01
# WEB-D01 - proposed from WEB-01.01
#
# <content of the decision note>
```

### Supersede a decision

When a decision is reversed or updated, supersede it rather than editing it in place:

```bash
brain pm decision supersede WEB-D01 "Use opaque session tokens instead"
# Superseded WEB-D01 -> WEB-D02
```

The old decision moves to `superseded` status; the new one is `proposed`. Both are preserved in the note graph, forming an auditable chain.

### Common patterns

- Write decision content by editing the generated note file directly (the `add` command creates a stub).
- The dispatch bundle includes decisions that impact a task, so agents automatically receive relevant context.
- Use `--impacts` liberally: it ensures affected tasks get the decision in their context bundles.

---

## 7. Prompts

Prompts are versioned instruction documents written for a specific task. Each write creates a new version. The orchestration layer renders a prompt into the full agent invocation (with dependencies and decisions injected around it).

**Status:** `stub` → `draft` → `current` (also `stale`, `superseded` as computed states)

### Write a prompt

```bash
# Write inline content
brain pm prompt write WEB-01.01 --project WEB \
  --content "Implement the login form. Use React Hook Form. Validate on submit."

# Omit --content to write an empty stub and edit the note file directly
brain pm prompt write WEB-01.01 --project WEB
```

Each write increments the version number. The previous version moves to `superseded`.

### Show and list

```bash
# Show current prompt for a task
brain pm prompt show WEB-01.01

# Show a specific version
brain pm prompt show WEB-01.01 --version 2

# List all prompts for a project
brain pm prompt list --project WEB

# Filter by status
brain pm prompt list --project WEB --status current
brain pm prompt list --project WEB --status stale
```

### Browse history

```bash
# All versions for a task, newest first
brain pm prompt history WEB-01.01
# WEB-P01.01 v3 - current (task: WEB-01.01)
# WEB-P01.01 v2 - superseded (task: WEB-01.01)
# WEB-P01.01 v1 - superseded (task: WEB-01.01)
```

### Common patterns

- A prompt with status `stale` means the task's dependencies changed after the prompt was written. Update it before dispatching.
- `brain pm briefing` surfaces stale prompts under "Recommended actions".
- The `orchestrate render` command wraps the current prompt with dependencies and decisions for final agent delivery.

---

## 8. Capture and Inbox

Quick capture records an idea or note without requiring it to be structured upfront. Captures land in an inbox and can be processed into tasks when you are ready.

### Capture an idea

```bash
# Capture text to the PM inbox
brain pm capture "Consider lazy loading images in the gallery view"

# Scope a capture to a project
brain pm capture "API rate limit needs review" --project WEB

# Override the default source label
brain pm capture "From standup: deploy blocked on env vars" --source standup
```

### Browse the inbox

```bash
# List unprocessed captures (default)
brain pm inbox

# Filter by project
brain pm inbox --project WEB

# Include already-processed captures
brain pm inbox --all
```

### Process a capture into a task

```bash
# Get the note ID from inbox output, then process
brain pm process <capture-note-id> \
  --project WEB --workstream 1 \
  --task-name "Lazy load gallery images"
# Processed capture into task WEB-01.04
```

### Common patterns

- Use `brain pm capture` as the first step when something comes up mid-session that shouldn't derail the current task.
- Process the inbox at the start of each session as part of planning.
- Processed captures retain their original text in the note; the task links back to it.

---

## 9. Verification

The verify command generates a task-specific verification checklist. The steps are determined by the task's category. The checklist also shows whether upstream dependencies are complete and which decisions are relevant.

### Generate a verification plan

```bash
brain pm verify WEB-01.01
# Verification Plan: WEB-01.01
# Category: implementation
#
# Objective:
#   Implement the login form...
#
# Dependencies:
#   [x] WEB-01.00 (done)
#
# Decisions to consider:
#   - WEB-D01: Use JWT for session tokens
#
# Verification steps:
#   [ ] Verify all acceptance criteria are met
#   [ ] Run unit tests for changed modules
#   [ ] Check for regressions in dependent code
#   [ ] Review code for style and correctness

brain pm verify WEB-01.01 --json
# Returns structured VerificationPlan object
```

### Category-specific steps

| Category | Verification steps |
|---|---|
| `implementation` | Acceptance criteria, unit tests, regression check, code review |
| `testing` | Coverage threshold, full suite, test name clarity, mock scope |
| `documentation` | Behavior accuracy, runnable examples, clarity, link validity |
| `research` | Documented findings with sources, actionable conclusions |
| `review` | All comments addressed, feedback incorporated, no open questions |
| `infrastructure` / `configuration` / `migration` | Deploy success, monitoring configured, smoke tests, rollback plan |
| `design` | Requirements coverage, architecture consistency, trade-offs documented |

### Common patterns

- The orchestration skill spawns a lightweight verification agent (Haiku, read-only) before calling `brain pm complete` when the routing result has `verify: true`.
- Run `brain pm verify` manually to review what an agent will check before dispatching.

---

## 10. Audit and Telemetry

The audit commands aggregate activity records to report on cost, throughput, and completion rates. Activity records are written automatically by the orchestration layer when tasks complete; they can also be enriched manually.

### Activity summary

```bash
# Aggregated stats across all PM activity
brain pm audit summary

# Filter by project or date
brain pm audit summary --project WEB
brain pm audit summary --since 2026-02-01

# Output:
# Total: 42, Completed: 38, Failed: 2
#   task_completed: 35
#   agent_done: 7
```

### Cost estimation

```bash
# Token usage and estimated dollar cost by model
brain pm audit cost --project WEB
# Total tokens: 847000
# Estimated cost: $12.4800
#   claude-opus-4: 320000 tokens ($9.6000)
#   claude-sonnet-4: 527000 tokens ($2.8800)

brain pm audit cost --json
```

### Performance metrics

```bash
brain pm audit performance --project WEB
# Total: 38, Completed: 35
# Completion rate: 92%
# Avg duration: 184000ms
```

### Recent executions

```bash
# Show the activity log (default: last 20)
brain pm audit executions --project WEB --limit 10
# act-uuid [task_completed] done @ 2026-02-27T14:23:00Z
```

### Enrich an activity record

When token counts are not captured automatically (e.g., a manually run agent), add them after the fact:

```bash
brain pm audit enrich <activity-id> --tokens 45000 --model claude-opus-4
# Enriched activity act-uuid with 45000 tokens (claude-opus-4)
```

### Common patterns

- Cost data is estimated from token counts stored in activity metadata, not from API billing records.
- Use `--since` to scope reports to the current sprint or billing period.
- The `brain pm briefing` command does not include cost; run `audit cost` separately for a cost summary.

---

## 11. Orchestration

Orchestration is the layer that coordinates the full task lifecycle: session setup, routing, worktree allocation, agent dispatch, completion, and session teardown. It is primarily invoked by the orchestration skill and hooks, but all commands are usable manually.

### Session lifecycle

```bash
# Initialize a session (reads active project, emits env vars)
# Normally called by the SessionStart hook
brain pm orchestrate session-start

# Get a full project briefing to start a session
brain pm briefing
# === Briefing: WEB ===
# Status: active | Phase: implementation
#
# Tasks: 12 total
#   Done: 3
#   In-progress: 1
#   Eligible: 2 (WEB-01.03, WEB-02.01)
#   Blocked: 0
#   Pending: 8
#
# Recommended actions:
#   -> Pick up eligible task: WEB-01.03

# End a session and get a summary
brain pm orchestrate session-end
# === Session End: WEB ===
# Tasks: 4 done, 1 in-progress, 7 pending, 0 blocked (12 total)
# Worktrees: 1/3 in use
```

### Routing

The routing table maps `category + mode` to an agent type, model, isolation strategy, and whether to run verification. Only `mode=agent` tasks are auto-dispatched; all others return the non-agent default.

```bash
brain pm orchestrate route WEB-01.01
# Task: WEB-01.01
# Agent: general-purpose
# Model: opus
# Isolation: worktree
# Verify: true
# Concurrency: sequential-within-workstream

brain pm orchestrate route WEB-01.01 --json
```

Routing table summary:

| Category | Model | Isolation | Verify | Concurrency |
|---|---|---|---|---|
| `implementation` | opus | worktree | yes | sequential-within-workstream |
| `infrastructure` | opus | worktree | yes | sequential-within-workstream |
| `migration` | opus | worktree | yes | sequential-within-workstream |
| `design` | opus | none | no | parallel |
| `research` | sonnet | none | no | parallel |
| `review` | sonnet | none | no | parallel |
| `documentation` | sonnet | none | no | parallel |
| `testing` | haiku | none | no | parallel |
| `configuration` | haiku | none | no | parallel |

### Rendering the agent prompt

The render command assembles the full prompt the agent will receive, including the task prompt, dependency statuses, and decisions:

```bash
brain pm orchestrate render WEB-01.01
# (rendered prompt text for the agent)

# Render with an allocated worktree path in the prompt
brain pm orchestrate render WEB-01.01 --worktree /path/to/worktree

# Render the verification prompt instead
brain pm orchestrate render WEB-01.01 --verification

# Return prompt plus metadata (taskId, contextHash)
brain pm orchestrate render WEB-01.01 --json
```

### Worktree management

Worktrees give implementation tasks an isolated git working tree. The budget defaults to 3 simultaneous worktrees.

```bash
# Allocate a worktree for a task
brain pm orchestrate worktree-alloc WEB-01.01
# Allocated: /path/to/worktrees/WEB-01.01
# Branch: pm/WEB-01.01

# Check current budget
brain pm orchestrate worktree-status
# Budget: 1/3 (2 available)
#   WEB-01.01: /path/to/worktrees/WEB-01.01 (pm/WEB-01.01)

# Release after task completion
brain pm orchestrate worktree-release WEB-01.01
# Released worktree for WEB-01.01

# Validate the CWD is inside the expected worktree (called by PreToolUse hook)
brain pm orchestrate worktree-check
```

### Completing a task through orchestration

```bash
# Mark done, validate token, record activity, and compute impact
brain pm complete WEB-01.01 --token <claim-token> --summary "Login form implemented with validation"
# Completed WEB-01.01
# Newly eligible: WEB-01.03, WEB-02.01
```

### Common patterns

- The full agent dispatch sequence: `task claim` → `orchestrate route` → `orchestrate worktree-alloc` (if needed) → `task start` → `orchestrate render` → spawn agent → `complete`.
- Use `brain pm next --json` to get the ranked list of eligible tasks before picking which to dispatch next.
- Respect the worktree budget: check `worktree-status` before allocating for a new task.

---

## 12. Configuration

Configuration lives at two levels: project-level settings (WIP limit, phase) and system-level hook installation.

### Project-level configuration

```bash
# Set or change the WIP limit (max concurrent in-progress tasks)
brain pm project update WEB --wip-limit 3

# Change project phase
brain pm project update WEB --phase "beta"

# Pause and resume a project
brain pm project update WEB --status paused
brain pm project update WEB --status active
```

### Hook installation

The `install-hooks` command writes three hook scripts to `~/.claude/hooks/` and registers them in `~/.claude/settings.json`. It also installs the orchestrator skill to `~/.claude/skills/orchestrator/SKILL.md`.

```bash
# Install hooks and skill (idempotent: safe to run again)
brain pm install-hooks
# Installed 4 items.
# Orchestration hooks are ready. Start a new Claude Code session to activate.

# Preview what would be installed without writing anything
brain pm install-hooks --dry-run
# Would install:
#   ~/.claude/hooks/brain-pm-session.sh
#   ~/.claude/hooks/brain-pm-worktree.sh
#   ~/.claude/hooks/brain-pm-agent-done.sh
#   ~/.claude/skills/orchestrator/SKILL.md
#   Hook entries in ~/.claude/settings.json

# Remove all installed hooks and skill
brain pm install-hooks --remove
```

Hooks installed:

| Hook event | Script | Purpose |
|---|---|---|
| `SessionStart` | `brain-pm-session.sh` | Activates orchestration if a PM project is active; initializes session |
| `PreToolUse` | `brain-pm-worktree.sh` | Validates the agent is running inside the expected worktree |
| `SubagentStop` | `brain-pm-agent-done.sh` | Records agent completion as a PM activity |

### Task mode and its effect on dispatch

The task `mode` field controls how the orchestration skill handles the task:

| Mode | Behavior |
|---|---|
| `agent` | Fully automated: claim, route, allocate, start, spawn agent, complete |
| `assisted` | Semi-automated: present context bundle, help with automatable parts, wait for user confirmation |
| `human` | Manual: present context only, user does the work |
| `review` | Manual review task: no agent dispatch |
| `auto` / `interactive` | Treated as non-agent by routing engine (falls back to non-agent defaults) |

### Common patterns

- Run `brain pm install-hooks` once after installing the brain CLI. Re-running it is safe.
- Change task mode from `human` to `agent` when you're ready to automate a task you were previously doing manually.
- The worktree budget (default 3) is managed in memory per session; it resets when a new session starts. Adjust by releasing unused worktrees with `orchestrate worktree-release`.
