# Orchestration Layer Design

**Date:** 2026-02-25
**Status:** Draft
**Depends on:** 01-brain-module-system.md, 02-pm-module-design.md
**Part of:** Task Management Framework — Design Series

---

## Overview

The orchestration layer sits **above** the PM module and brain. It manages the session-level execution flow: deciding what to work on, dispatching tasks to agents or guiding humans, capturing results, and maintaining momentum across sessions.

The orchestrator is a **Claude Code skill** backed by `brain pm` CLI commands. It does not store state itself — all state lives in brain. It's the conductor; brain is the sheet music and the instrument.

```
┌─────────────────────────────────────┐
│  Claude Code Session                │
│                                     │
│  ┌─────────────────────────────┐   │
│  │  Orchestrator Skill          │   │  ← This document
│  │  (session flow, dispatch,    │   │
│  │   agent management, human    │   │
│  │   walkthrough)               │   │
│  └──────────┬──────────────────┘   │
│             │ calls                 │
│  ┌──────────▼──────────────────┐   │
│  │  brain pm CLI                │   │  ← 02-pm-module-design.md
│  │  (status, next, dispatch,    │   │
│  │   complete, decisions)       │   │
│  └──────────┬──────────────────┘   │
│             │ reads/writes         │
│  ┌──────────▼──────────────────┐   │
│  │  brain core                  │   │  ← 01-brain-module-system.md
│  │  (notes, search, memory,     │   │
│  │   SQLite)                    │   │
│  └─────────────────────────────┘   │
└─────────────────────────────────────┘
```

---

## Design Principles

1. **The orchestrator decides what; brain pm decides how** — The orchestrator picks the next task and manages the human interaction. `brain pm next` does the graph computation, `brain pm dispatch` renders the prompt, `brain pm complete` records results.

2. **State lives in brain, not in the session** — If Claude Code crashes, nothing is lost. The next session reads `brain pm status` and picks up exactly where you left off.

3. **Parallel agents, sequential humans** — Agent tasks fire in background whenever dependencies allow. Human-facing work stays one-at-a-time to avoid context switching.

4. **Pull-based dispatch** — Agents receive work when ready (Kanban pull), not when it's created. WIP limits prevent overcommitting.

5. **Context isolation** — Each sub-agent gets exactly the context it needs from `brain pm dispatch`, never the orchestrator's full session state.

---

## Adaptive Automation Levels

Not all projects need the same level of human involvement. Early-stage projects with unclear requirements need human guidance at every step. Mature projects with well-defined tasks and proven prompts can run agents autonomously.

### Automation Metadata

Projects and workstreams declare an automation level in their metadata:

```yaml
automation: assisted    # assisted | autonomous
```

| Level | Dispatch Behavior | Human Role |
|-------|------------------|------------|
| **assisted** | Orchestrator proposes a dispatch plan (which tasks, which agents, which order). Human approves before any agents are spawned. | Active participant. Approves dispatch, reviews results, makes decisions. |
| **autonomous** | Orchestrator dispatches agents automatically when tasks become +ELIGIBLE. Dashboard shows live status. Human notified at natural break points. | Monitor and reviewer. Can pause at any time. |

Workstream-level setting overrides project-level:

```bash
brain pm project update WEB --automation autonomous
brain pm workstream update 01 --automation assisted   # override for this workstream
```

### Both Levels Share Identical Machinery

- Claim tokens prevent double-dispatch in both modes
- WIP limits constrain concurrency in both modes
- Telemetry records every execution in both modes
- Dashboard shows real-time status in both modes
- The only difference is whether dispatch requires explicit approval

### Switching Modes at Runtime

The human can switch modes at any time during a session:

- "Switch to autonomous for workstream 03" updates the metadata
- "Pause agents" temporarily halts auto-dispatch without changing the stored level
- The orchestrator announces the mode on session start as part of the briefing

---

## Task Routing Engine

Not all tasks need the same execution environment. Research tasks are read-only and can run in parallel without isolation. Implementation tasks modify files and need dedicated worktrees. The routing engine provides a systematic way to determine **what kind of agent, which model, and what isolation** each task requires.

### Routing Table

The routing engine maps `category + mode` to concrete dispatch parameters:

| Category | Mode | Agent Type | Isolation | Default Model | Verify | Concurrency |
|----------|------|-----------|-----------|---------------|--------|-------------|
| implementation | agent | general-purpose | Worktree (coding) | Opus | always | Sequential within workstream |
| research | agent | Explore (read-only) | None | Sonnet | never | Parallel (no file conflicts) |
| validation | agent | general-purpose | None | Haiku | never | Parallel |
| configuration | agent | general-purpose | Worktree if file edits | Haiku/Sonnet | if-file-edits | Depends on file overlap |
| design | agent | general-purpose | None (typically) | Opus | never | Parallel |
| review | agent | Explore or general-purpose | None | Sonnet | never | Parallel |
| documentation | agent | general-purpose | Worktree if file edits | Sonnet | never | Depends on file overlap |
| migration | agent | general-purpose | Worktree | Opus | always | Sequential |
| interview | assisted/human | N/A | N/A | N/A | never | Sequential |
| any | assisted | Orchestrator guides human | N/A | N/A | never | Sequential (one human) |
| any | human | Human acts independently | N/A | N/A | never | Sequential |
| any | review | Orchestrator presents artifacts | N/A | N/A | never | Sequential |

> **Constraint:** `interview` category is only valid with `mode: assisted` or `mode: human`.

### Routing Is Computed, Not Stored

The routing table is logic in the orchestrator skill, not stored metadata. This allows the orchestrator to override based on context:

- A "research" task that needs to write findings to a file gets a worktree
- A "configuration" task in a workstream with no other active tasks might skip worktree isolation
- A complex "validation" task might use Sonnet instead of Haiku

The `brain pm dispatch --json` output includes a `routing` section with the computed decisions:

```json
{
  "task": { "displayId": "WEB-01.03", "category": "implementation", "mode": "agent" },
  "routing": {
    "agentType": "general-purpose",
    "model": "claude-opus-4-6",
    "isolation": "worktree",
    "worktreePath": null,
    "concurrency": "sequential-within-workstream"
  },
  "prompt": "...",
  "context": { ... }
}
```

The `worktreePath` is null in the dispatch output because worktree allocation is the orchestrator's responsibility (see Worktree Isolation Safety).

---

## Session Lifecycle

### Session ID Tracking

The orchestrator captures the Claude Code session ID at session start via a SessionStart hook that writes environment variables through `CLAUDE_ENV_FILE`. These variables persist across all Bash commands in the session.

```json
// .claude/settings.json
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "startup",
        "hooks": [
          {
            "type": "command",
            "command": "~/.claude/hooks/brain-pm-session.sh"
          }
        ]
      }
    ],
    "SubagentStop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "~/.claude/hooks/brain-pm-agent-done.sh"
          }
        ]
      }
    ]
  }
}
```

```bash
# ~/.claude/hooks/brain-pm-session.sh
#!/bin/bash
SESSION_ID=$(jq -r '.session_id' < /dev/stdin)
TRANSCRIPT=$(jq -r '.transcript_path' < /dev/stdin)
echo "export BRAIN_PM_SESSION=$SESSION_ID" >> "$CLAUDE_ENV_FILE"
echo "export BRAIN_PM_TRANSCRIPT=$TRANSCRIPT" >> "$CLAUDE_ENV_FILE"
exit 0
```

The session ID links tasks, executions, and agent transcripts back to the orchestrating session. Sub-agent transcripts live at `~/.claude/projects/{project}/{sessionId}/subagents/agent-{agentId}.jsonl`.

### SubagentStop Hook

When a sub-agent completes, Claude Code fires a `SubagentStop` hook with `agent_id`, `agent_type`, and `agent_transcript_path`. This hook can log the transcript path for later telemetry enrichment:

```bash
# ~/.claude/hooks/brain-pm-agent-done.sh
#!/bin/bash
AGENT_ID=$(jq -r '.agent_id' < /dev/stdin)
TRANSCRIPT_PATH=$(jq -r '.agent_transcript_path' < /dev/stdin)
# Log for later enrichment by brain pm audit enrich
echo "$AGENT_ID $TRANSCRIPT_PATH" >> /tmp/brain-pm-agent-transcripts.log
exit 0
```

### Session Start

```
1. User opens Claude Code, loads orchestrator skill
2. Session hook writes $BRAIN_PM_SESSION and $BRAIN_PM_TRANSCRIPT via CLAUDE_ENV_FILE
3. Orchestrator runs: brain pm briefing --json
4. Parses structured briefing:
   - Project name, phase, overall progress
   - What's completed since last session
   - What's currently in-progress (check for stale/claimed tasks)
   - Eligible tasks with recommendations
   - Blocked tasks and blockers
   - Pending decisions
   - Cost summary since last session
5. Presents human-friendly summary
6. Recommends first action
```

### Task Selection

The orchestrator recommends based on:

1. **Review tasks first** — Unreviewed agent output takes priority (fast to process, may unblock others)
2. **Blocking tasks** — Tasks in the critical path that block the most downstream work
3. **Mode-appropriate** — If human is present, prefer assisted/review. If human wants to multitask, fire agent tasks.
4. **Priority** — Critical > High > Medium > Low within the above ordering
5. **Phase coherence** — Prefer completing current phase before starting next

```bash
# The orchestrator calls:
brain pm next --json
# Returns ranked list with rationale for each recommendation
```

### Task Dispatch by Mode

#### Agent Tasks (🤖)

```
1. brain pm task claim WEB-08.05
   → Returns: claim_token (UUID), confirms pending (+READY) → claimed transition
2. brain pm dispatch WEB-08.05 --json
   → Returns: prompt, context bundle, validation criteria, output location
3. Orchestrator spawns sub-agent via Task tool:
   - subagent_type: general-purpose
   - prompt: rendered from dispatch output (includes claim_token)
   - model: opus for implementation, sonnet for research, haiku for validation
   - run_in_background: true (if human has other work)
4. brain pm task start WEB-08.05 --token <claim_token>
   → Validates token, transitions claimed → in-progress
   → Records agent_id, parent_session, started_at
5. When agent completes:
   - Orchestrator reviews output
   - Runs validation checks if applicable
   - brain pm complete WEB-08.05 --token <claim_token> \
       --log "summary" \
       --model claude-sonnet-4-6 \
       --agent-id <agent_id> --session $BRAIN_PM_SESSION
   - Creates activity record with execution telemetry (Phase 1 — no token data yet)
   - Token enrichment via: brain pm audit enrich (Phase 2 — parses transcript)
   - Captures any decisions made
   - Surfaces newly unblocked tasks
```

**Claim timeout:** If a claimed task receives no `start` within 10 minutes, it reverts to `pending`. This prevents zombie claims from crashed sessions.

**Agent context bundle** (from `brain pm dispatch --json`):

```
┌─────────────────────────────────────────┐
│  Agent Prompt                           │
│                                         │
│  Task: WEB-08.05 Build Task Tracking     │
│  Mode: agent                            │
│                                         │
│  ## Context                             │
│  - Completed dep: WEB-08.04 summary      │
│  - Decision DEC-001: brain assessed     │
│  - Project constraint: TypeScript, ESM  │
│                                         │
│  ## Instructions                        │
│  (the full prompt from prompt note)     │
│                                         │
│  ## Validation                          │
│  - [ ] Tests pass                       │
│  - [ ] Build succeeds                   │
│                                         │
│  ## Output                              │
│  Write to: workstream 08 logs/          │
└─────────────────────────────────────────┘
```

#### Assisted Tasks (🧑‍💻)

```
1. brain pm dispatch HA-00.02 --json
   → Returns: walkthrough steps, decision points, validation checks
2. Orchestrator presents first step to human
3. For each step:
   a. Explain what to do
   b. If automatable, offer to run it
   c. If browser/physical, wait for human confirmation
   d. Validate the step succeeded
   e. Record any decisions made
4. On completion:
   - brain pm complete HA-00.02 --log "summary"
   - Surface next eligible task
```

**Key behavior:** The orchestrator actively looks for ways to automate parts of assisted tasks. If a step says "run this command," the orchestrator runs it. If a step says "go to this URL," the orchestrator explains and waits.

#### Review Tasks (📋)

```
1. brain pm dispatch WEB-01.03 --json
   → Returns: artifacts to review, review criteria, approval checklist
2. Orchestrator presents artifacts:
   - Reads log files or output from the producing task
   - Formats for human review
   - Presents checklist
3. Human reviews:
   - Approved → brain pm complete, capture any feedback
   - Revision needed → brain pm task update WEB-01.03 --status pending
     with notes about what to fix
```

#### Human Tasks (👤)

```
1. brain pm dispatch HA-00.01 --json
   → Returns: explanation, helpful links, what to do
2. Orchestrator explains what needs to happen
3. Provides context, links, tips
4. Waits for human to confirm completion
5. Validates if possible (e.g., check if account exists)
6. brain pm complete HA-00.01
```

### Parallel Execution

The orchestrator manages concurrent work streams:

```
Human working on:        Background agents:
┌──────────────┐        ┌──────────────┐
│ HA-00.02     │        │ WEB-01.01 🤖  │ ← research auth libs
│ (assisted)   │        │ running...   │
│ configuring  │        ├──────────────┤
│ spending cap │        │ WEB-02.09 🤖  │ ← build schema docs
│              │        │ running...   │
└──────────────┘        └──────────────┘
```

**Rules:**
- Max concurrent agents: configurable (default 3)
- Agent tasks auto-dispatch when dependencies are met and WIP allows
- Each dispatched agent gets a **claim token** — prevents double-dispatch across sessions
- When an agent completes, brief notification to human (don't interrupt flow)
- At natural break points (between human tasks), surface completed agent work for review
- Human can say "pause agents" to stop auto-dispatch
- Orchestrator tracks in-flight agents in session memory: `{ taskId, claimToken, agentId, model, startedAt }`

### Wave-Based Execution

When multiple tasks are +ELIGIBLE simultaneously, the orchestrator needs to determine which can run in parallel and which must be sequenced. Dispatching them one at a time wastes throughput. Dispatching them all at once risks file conflicts. **Waves** solve this by grouping eligible tasks into safe parallel batches.

A **wave** is a set of +ELIGIBLE tasks that can safely execute in parallel. Waves are computed from the dependency DAG and routing constraints.

#### CLI Command

```bash
brain pm waves --json
brain pm waves --project WEB --json      # specific project
```

This command computes dependency-free groups (pure DAG analysis) and returns them as waves:

```json
{
  "waves": [
    {
      "wave": 1,
      "tasks": [
        { "displayId": "WEB-01.01", "title": "Research auth libraries", "category": "research", "mode": "agent", "priority": "high" },
        { "displayId": "WEB-02.01", "title": "Design database schema", "category": "design", "mode": "agent", "priority": "high" }
      ]
    },
    {
      "wave": 2,
      "tasks": [
        { "displayId": "WEB-01.02", "title": "Implement JWT middleware", "category": "implementation", "mode": "agent", "priority": "high" },
        { "displayId": "WEB-02.02", "title": "Create migration scripts", "category": "migration", "mode": "agent", "priority": "medium" }
      ]
    }
  ],
  "blocked": [
    { "displayId": "WEB-03.01", "blockedBy": ["WEB-01.02", "WEB-02.02"] }
  ]
}
```

#### Wave Computation Algorithm

```
1. Query all +ELIGIBLE tasks (pending with all deps done)
2. For remaining tasks, identify those whose only unmet deps are in wave N
   → These form wave N+1
3. Repeat until all tasks are assigned to a wave or are blocked by non-task blockers
```

This is a standard topological level assignment on the dependency DAG.

#### Orchestrator Applies Routing

The orchestrator applies routing on top of the wave data:

1. Within each wave, group tasks by isolation needs (worktree vs no worktree)
2. Check worktree budget (see Worktree Isolation Safety) — if budget is full, defer worktree-requiring tasks
3. In **assisted** mode: present the wave plan for human approval
4. In **autonomous** mode: dispatch immediately, respecting WIP limits

Example (assisted mode):

```
Orchestrator: "Wave 1 has 3 eligible tasks:
  - WEB-01.01 (research, Sonnet, no worktree) — parallel OK
  - WEB-02.01 (design, Opus, no worktree) — parallel OK
  - WEB-01.03 (implementation, Opus, needs worktree) — 1 worktree slot used

  Budget: 3 worktrees max, 0 in use.
  Recommendation: dispatch all three.
  Shall I proceed?"
```

### Session End

```
1. Orchestrator runs: brain pm status --json
2. Orchestrator runs: brain pm audit summary --session current --json
   → Gathers telemetry for all executions this session
3. Updates any in-progress tasks with session notes
4. Summarizes:
   - Tasks completed this session
   - Tasks still in progress
   - Decisions made
   - Background agents still running (if any)
   - Session cost: total tokens, estimated USD by model
   - Next session preview
5. brain captures session summary as a brain note (for memory extraction)
   → Includes execution telemetry in session log metadata
```

---

## Worktree Isolation Safety

When multiple agents edit files concurrently, conflicts are catastrophic and hard to detect. An agent doesn't check `git status` mid-work — it assumes it has exclusive access. If two agents operate in the same worktree, changes interleave silently, tests fail with confusing errors, and recovery requires manual git archaeology.

This is one of the most dangerous failure modes in multi-agent execution. The design uses defense in depth: three independent layers of protection.

### Layer 1: Assignment at Claim Time

When `brain pm task claim` succeeds for a task that needs worktree isolation, the orchestrator assigns a worktree from its budget pool:

```bash
# Orchestrator's dispatch flow
claim=$(brain pm task claim WEB-01.03 --json)
# → { "claimToken": "uuid-xxx", "displayId": "WEB-01.03" }

# Assign worktree (orchestrator logic, not a brain pm command)
worktreePath=$(allocateWorktree "WEB-01.03" "$claimToken")
# → /path/to/repo/.claude/worktrees/web-01-auth

# Record assignment on the task
brain pm task update WEB-01.03 --worktree "$worktreePath"
```

**The invariant: no two claimed tasks share a worktree.** The orchestrator enforces this before dispatch.

### Worktree Budget

The budget is configured at the module level with per-project override:

```json
// brain config.json
{
  "modules": {
    "pm": {
      "worktreeBudget": 3
    }
  }
}
```

```bash
# Per-project override
brain pm project update WEB --worktree-budget 2
```

**Budget rules:**
- One coding worktree per active workstream, reused for sequential coding tasks
- Research, validation, and review tasks do not consume worktree budget
- When budget is full, worktree-requiring tasks wait until a slot frees up
- On task completion, the worktree slot is released for reuse

**Orchestrator tracks allocations in session state:**

```json
{
  "worktrees": {
    "/path/to/wt-1": { "taskId": "WEB-01.03", "workstream": "01", "claimToken": "uuid-a" },
    "/path/to/wt-2": { "taskId": "WEB-02.04", "workstream": "02", "claimToken": "uuid-b" }
  },
  "budget": { "max": 3, "used": 2, "available": 1 }
}
```

### Layer 2: Hook-Based Runtime Validation

A Claude Code hook validates worktree integrity on file-modifying tool calls. The hook is lightweight — a single path comparison:

```bash
#!/bin/bash
# brain-pm-worktree-check.sh
# Configured as a PreToolUse hook for Bash, Write, Edit tools

EXPECTED_WORKTREE="${BRAIN_PM_WORKTREE:-}"
if [ -z "$EXPECTED_WORKTREE" ]; then
  exit 0  # No worktree assignment — not a PM agent task
fi

ACTUAL_CWD=$(pwd)
if [[ "$ACTUAL_CWD" != "$EXPECTED_WORKTREE"* ]]; then
  echo "WORKTREE MISMATCH: Agent expected to operate in $EXPECTED_WORKTREE but is in $ACTUAL_CWD" >&2
  echo "This agent may be modifying files in the wrong worktree." >&2
  exit 1  # Block the tool call
fi

exit 0
```

**Properties:**
- Zero overhead for non-PM sessions (early exit if env var not set)
- Blocks file modifications outside the assigned worktree
- Injected via dispatch prompt: the `BRAIN_PM_WORKTREE` env var is set when the agent starts
- The hook fires on every Bash/Write/Edit call — catches drift immediately

### Layer 3: Orchestrator Pre-Dispatch Validation

Before dispatching any worktree-requiring task, the orchestrator runs a pre-flight check:

```
1. Is the intended worktree path already assigned to another claimed task?
   → If yes: ERROR. Do not dispatch. This is a bug in the allocation logic.
2. Is the worktree clean (no uncommitted changes from a previous task)?
   → If dirty: prompt human to review/clean, or auto-stash if in autonomous mode.
3. Is the worktree on the correct branch?
   → If wrong branch: checkout the expected branch before dispatch.
```

### Worktree Lifecycle

```
ALLOCATE → PREPARE → DISPATCH → EXECUTE → COMPLETE → RELEASE
    │          │                                          │
    │     checkout branch                          clean up or
    │     verify clean state                       recycle for next
    │                                              task in workstream
    └── claim task, assign slot
```

**Within a workstream:** Sequential coding tasks reuse the same worktree. After task A completes, the orchestrator verifies the worktree state (clean, on correct branch) before dispatching task B. This avoids the cost of creating a new worktree for every task.

**Across workstreams:** Each workstream gets its own worktree. This is the primary isolation boundary.

---

## The Orchestrator Skill

### Skill Structure

```
~/.claude/skills/orchestrator/
├── SKILL.md              # Skill definition (loaded by Claude Code)
├── references/
│   ├── dispatch-modes.md # How to handle each task mode
│   └── session-flow.md   # Detailed session lifecycle
└── templates/
    ├── agent-prompt.md   # Template for agent task prompts
    └── briefing.md       # Template for session briefing
```

### SKILL.md Content

The skill prompt is lean — it delegates to `brain pm` for all state:

```markdown
# Project Orchestrator

You are managing a project using the brain PM module.

## Session Start
Run `brain pm briefing --json` and present a human-friendly summary.

## When the human picks a task
Run `brain pm dispatch <task-id> --json` to get the full execution context.
Follow the dispatch mode instructions in references/dispatch-modes.md.

## After completing a task
Run `brain pm complete <task-id> --log "<summary>"` to record results.
Check the output for newly unblocked tasks.
Recommend the next task.

## Background agents
For agent tasks with met dependencies, offer to run them in background.
Use the Task tool with run_in_background: true.
Don't interrupt human work for agent completions — surface at break points.

## Key commands
- `brain pm status --json` — current state
- `brain pm next --json` — recommended next tasks
- `brain pm dispatch <id> --json` — execution context for a task
- `brain pm complete <id> --log "..."` — mark task done
- `brain pm decision add "..." --task <id>` — record a decision
- `brain pm task list --eligible --json` — all tasks computed as +READY
```

### Why a Skill, Not a Standalone Prompt

Earlier project orchestrators used a standalone `orchestrator.md` file that had to be manually passed to Claude Code. Problems:
- Manual loading every session
- Prompt file itself contained project-specific context
- No way to auto-invoke

As a Claude Code skill, the orchestrator:
- Auto-loads when Claude Code detects a brain pm project
- Is project-agnostic (all state comes from `brain pm` commands)
- Can be invoked with `/orchestrator` or auto-triggered
- Can be versioned and updated independently

### Additional CLI Commands

Beyond the core commands listed in SKILL.md, the orchestration layer introduces:

```bash
# Adaptive automation
brain pm project update <prefix> --automation <assisted|autonomous>
brain pm workstream update <number> --automation <assisted|autonomous>

# Wave computation
brain pm waves --json                    # dependency-free task groups
brain pm waves --project WEB --json      # specific project

# Just-in-time context
brain pm context <display-id> --json                # full task context
brain pm context <display-id> --decisions --json     # decisions only
brain pm context <display-id> --deps --json          # dependency summaries
brain pm context <display-id> --since <ISO-8601>     # delta since timestamp

# Verification
brain pm verify <display-id> --json                  # verification plan
brain pm verify <display-id> --record --outcome <passed|failed> --log "..."
brain pm verify <display-id> --summary               # validate summary.md quality

# Worktree tracking (informational, used by orchestrator)
brain pm task update <display-id> --worktree <path>  # record worktree assignment
```

---

## Model Selection for Sub-Agents

The orchestrator selects models based on task characteristics:

| Task Category | Model | Reasoning |
|-------|-------|-----------|
| `implementation` (write code, build features) | Opus | Best at complex multi-file changes |
| `research` (investigate, survey, analyze) | Sonnet | Good at synthesis, cheaper for read-heavy work |
| `validation` (run tests, check types, verify) | Haiku | Fast, cheap, sufficient for yes/no checks |
| `review` (evaluate proposals, code review) | Sonnet | Good at analysis and feedback |
| `configuration` (create file, update config) | Haiku | Fastest for straightforward operations |
| `design` (architecture, API design) | Opus | Needs deep reasoning |
| `documentation` (docs, guides) | Sonnet | Good prose, cheaper |
| `migration` (data transforms, refactors) | Opus | Needs precision |

The task's `category` and `mode` fields inform the model choice. The orchestrator can override based on context. The selected model is recorded in the execution activity for cost auditing.

---

## Error Handling & Recovery

### Agent Failure

```
1. Agent task fails (error, timeout, bad output)
2. Orchestrator captures the error:
   brain pm complete <id> --token <claim_token> --outcome failed \
     --model <model> --agent-id <agent_id> --session $BRAIN_PM_SESSION \
     --log "Agent failed: <error summary>"
   → Creates activity record with outcome='failed'
   → Releases claim token, transitions in-progress → pending (dependency engine re-computes +READY)
   → Token enrichment via: brain pm audit enrich
3. Options:
   a. Retry with same prompt (transient error) — new claim cycle
   b. Retry with adjusted prompt (bad output) — new claim cycle
   c. Escalate to human (persistent failure) — status → blocked
   d. Skip and move on (non-critical task) — status → cancelled
4. Max retries: 2 (configurable). Each attempt is a separate activity record
   with incrementing attempt number in metadata.
```

**Worktree creation failure:** If worktree creation fails, retry once. If retry fails, defer the task and emit a warning to the orchestrator. Do not block the session.

### Session Interruption

All state is in brain. Next session:
```
1. brain pm briefing detects in-progress tasks
2. Shows: "These tasks were in-progress when last session ended"
3. For each: option to resume, restart, or mark as blocked
```

### Stale Tasks

Tasks in-progress for >48h without log updates are flagged:
```
brain pm task list --stale
# Shows tasks that may need attention
```

---

## Status Push Protocol

Agents report status on **state transitions only** — not periodically:

| Transition | When | Example |
|-----------|------|---------|
| STARTING | Agent begins work | "Starting implementation of JWT middleware" |
| PROGRESS | Significant discovery or decision | "Chose middleware pattern X. Key finding: library Y doesn't support ESM." |
| BLOCKED | Cannot proceed without input | "Need API credentials for testing. Blocked on human action." |

**Not reported:** Routine progress ("writing tests"), file-by-file updates, or periodic heartbeats.

The status push is embedded in every agent dispatch prompt (see Just-in-Time Context, "Startup Context"). Agents use the existing `brain pm task update` command:

```bash
brain pm task update WEB-01.03 --status in-progress --msg "Starting implementation"
brain pm task update WEB-01.03 --status in-progress --msg "Key decision: using express middleware pattern"
brain pm task update WEB-01.03 --status blocked --msg "Need database credentials"
```

Each update creates an activity record with `activity_type: 'state_change'`, making the timeline queryable:

```bash
brain pm audit executions --task WEB-01.03
# Shows: claim -> start -> progress update -> progress update -> complete
```

**Orchestrator consumption:** The orchestrator polls `brain pm task list --in-progress --json` between natural break points. For team-based dispatch, uses `SendMessage`.

**BLOCKED protocol:** After reporting blocked, the agent should attempt an alternative approach if one exists, or exit with a summary of work accomplished. Do not wait indefinitely.

**PROGRESS guidance (for dispatch prompt template):**

Report:
- Significant architectural decisions ("Chose middleware pattern X")
- Key discoveries that affect approach ("Library Y doesn't support ESM")
- Completion of major sub-tasks ("Auth middleware tests passing, moving to session management")

Do NOT report:
- Routine file creation ("Created auth.ts")
- Writing tests for code you just wrote
- Reading documentation
- Standard build/lint passes

**Completion log relationship:** The `--log` summary in `brain pm complete` should synthesize key decisions and outcomes. It is not a transcript of PROGRESS messages.

---

## Verification Agents

Agents that implement code and then self-verify have a bias toward confirming their own work. A separate verification step by an independent agent provides better quality assurance and catches issues the implementation agent might overlook.

### Verification Flow

When an implementation agent completes, the orchestrator spawns a separate verification agent:

```
Implementation Agent (Opus)          Orchestrator                 Verification Agent (Haiku)
+-------------------------+         +-------------------+        +----------------------------+
| Writes code              |         | Detects completion |        | Runs tests                  |
| Creates/modifies files   |  --->   | (SubagentStop or  |  --->  | Checks types                |
| Writes summary.md        |  done   |  poll)             |        | Validates deliverables      |
| (stays in-progress)      |         | Spawns verifier    |        | Reports pass/fail           |
+-------------------------+         +-------------------+        +----------------------------+
                                           │                              │
                                           │  ┌── passed ────────────────┘
                                           │  │
                                           ▼  ▼
                                    Orchestrator calls
                                    brain pm complete → done
                                           │
                                    ┌── failed ──────────────────┘
                                    │
                                    ▼
                              Revert to pending
                              (new claim cycle)
```

### Verification Plan CLI

```bash
brain pm verify WEB-01.03 --json
```

Returns a verification plan based on the task's category, validation criteria, and project configuration:

```json
{
  "task": { "displayId": "WEB-01.03", "title": "Implement JWT Middleware", "category": "implementation" },
  "checks": [
    { "type": "test", "command": "npm test -- --grep auth", "description": "Run auth-related tests" },
    { "type": "typecheck", "command": "npm run typecheck", "description": "TypeScript type checking" },
    { "type": "lint", "command": "npm run lint", "description": "Lint modified files" },
    { "type": "build", "command": "npm run build", "description": "Verify build succeeds" },
    { "type": "summary", "check": "summary.md exists and has required sections" }
  ],
  "worktreePath": "/path/to/worktree",
  "summaryPath": "{notesDir}/modules/pm/WEB-01/03/summary.md"
}
```

### Detailed Verification Flow

```
1. Implementation agent completes work (task stays `in-progress`)
   → Agent writes summary.md and exits
   → Task remains in-progress — agent does NOT call brain pm complete

2. Orchestrator detects completion (SubagentStop hook or poll)

3. Orchestrator spawns verification agent:
   - Uses the verification plan from brain pm verify --json
   - Runs in the SAME worktree as the implementation agent
   - Uses Haiku (fast, cheap, sufficient for mechanical checks)
   - Does NOT modify code — read-only + command execution

4. Verification agent runs each check, records results

5. On completion:
   brain pm verify WEB-01.03 --record --outcome passed --json '{...results...}'
   → Creates activity with activity_type='verification'

6a. If passed:
    → Orchestrator calls `brain pm complete` → done
    → Worktree released for reuse
    → Newly eligible tasks dispatched

6b. If failed:
    → Task transitions back to pending
    → Verification feedback stored in task metadata (verification_feedback field)
    → Next implementation attempt receives the feedback in its context
    → brain pm dispatch includes: "Previous attempt failed verification: {feedback}"
```

### Recording Verification Results

```bash
brain pm verify WEB-01.03 --record \
  --outcome passed \
  --checks '{"test":"passed","typecheck":"passed","lint":"2 warnings","build":"passed"}' \
  --log "All checks pass. 2 non-blocking lint warnings in auth.ts."
```

This creates an activity record:

```json
{
  "activity_type": "verification",
  "note_ids": ["task-note-id"],
  "module": "pm",
  "actor_type": "agent",
  "outcome": "passed",
  "metadata": {
    "display_id": "WEB-01.03",
    "checks": {
      "test": "passed",
      "typecheck": "passed",
      "lint": "2 warnings",
      "build": "passed"
    },
    "implementation_activity_id": "exec-uuid"
  }
}
```

### When to Verify

Not all tasks need a separate verification agent:

| Category | Verification | Reasoning |
|----------|-------------|-----------|
| implementation | Always | Code changes need independent validation |
| migration | Always | Data transforms need independent validation |
| configuration | If file edits involved | Config changes can break builds |
| research | Never | Read-only, no artifacts to verify |
| design | Never | Human reviews design output |
| documentation | Optional | Grammar/link checks could be automated |
| review | Never | The task IS the review |
| validation | Never | The task IS the validation |

The routing table includes a `verify` flag that the orchestrator uses to decide whether to spawn a verification agent.

### Verification Agent Prompt Template

```markdown
# Verification: {display_id} — {title}

You are verifying the output of a completed implementation task.
Do NOT modify any code. Your job is to run checks and report results.

## Checks to Run
{checks from brain pm verify --json}

## Expected Artifacts
{deliverables from task metadata or summary.md}

## Reporting
For each check, report:
- Command run
- Actual output (paste it, don't summarize)
- Pass/fail assessment

On completion, report pass/fail with a summary. The orchestrator decides on task completion.
```

**Verification timeout:** If no `brain pm verify --record` within 30 minutes, the orchestrator treats the verification as failed.

**Retry budget:** Verification failure counts as an attempt toward `maxRetries` (default: 2).

---

## Just-in-Time Context

Loading full project context into an agent's prompt at startup is wasteful. Most agents don't need the entire dependency graph, all decisions, and the full workstream history. But agents do need context to evolve as they work — a decision made by a parallel agent might affect their task.

### CLI-Based Context Retrieval

Agents start with focused context (task prompt + immediate dependencies + relevant decisions). During execution, they can fetch more context on demand via CLI:

```bash
# Full context for a task
brain pm context WEB-01.03 --json

# Just decisions impacting this task
brain pm context WEB-01.03 --decisions --json

# Dependency completion summaries
brain pm context WEB-01.03 --deps --json

# Changes since a timestamp (new decisions, completed deps, state changes)
brain pm context WEB-01.03 --since "2026-02-26T10:00:00Z" --json
```

The `--since` flag enables incremental context updates. It queries the activities table for events since the given timestamp that are relevant to the task — new decisions, newly completed dependencies, and state changes in the same workstream.

### Startup Context (Included in Dispatch Prompt)

The agent prompt rendered by `brain pm dispatch --json` includes a minimal but complete startup context:

```markdown
# Task WEB-01.03: Implement JWT Middleware

## Context
- Completed: WEB-01.01 (Research auth libraries — chose jsonwebtoken + passport)
- Decision DEC-004: Use RS256 signing with rotating keys (impacts this task)
- Project constraint: TypeScript, ESM, Vitest for testing

## Instructions
{prompt note body}

## Verification
- [ ] All auth middleware tests pass
- [ ] No type errors
- [ ] Build succeeds

## On Completion
Do NOT call `brain pm complete`. The orchestrator handles completion after verification.
When you finish your work, report what you did and any decisions made. The orchestrator will verify and complete the task.

## Status Reporting
Report significant state changes:
  brain pm task update WEB-01.03 --status in-progress --msg "Starting implementation"
  brain pm task update WEB-01.03 --status in-progress --msg "Key decision: using middleware pattern X"
Report only on transitions, not periodic updates.

## Fetching Additional Context
If you need more context during execution:
  brain pm context WEB-01.03 --json          # full task context
  brain pm context WEB-01.03 --decisions     # decisions impacting this task
  brain pm context WEB-01.03 --since "..."   # changes since a timestamp
```

### Context Push from Orchestrator

The orchestrator can proactively push context updates to in-flight agents when critical state changes occur:

1. Orchestrator detects a state change (decision captured, upstream task completed, blocker resolved)
2. Runs `brain pm context <task-id> --since <agent-start-time> --json` to compute the delta
3. If the delta is relevant to an in-flight agent:
   - For team-based dispatch: sends a message via `SendMessage`
   - For background agents: the agent can poll `brain pm context --since` at natural checkpoints

**When to push:**
- A decision is captured that impacts the in-flight task's workstream
- An upstream dependency completes (may change approach or unlock new information)
- A parallel task in the same workstream is blocked (may affect shared resources)

**When NOT to push:**
- Routine status updates from other tasks
- Decisions in unrelated workstreams
- Session-level metrics changes

---

## Decision Capture Integration

The orchestrator captures decisions at two points:

### Explicit (Human Decisions)

During assisted tasks or reviews, when the human makes a choice:
```
Orchestrator: "Do you want native install or Docker-only?"
Human: "Native with Docker volumes"
Orchestrator: brain pm decision add "Native install + Docker volume mounts" \
  --task WEB-03.01 --impacts WEB-03.04,WEB-04.01 --tags architecture
```

### Implicit (Agent Decisions)

After an agent task completes, the orchestrator reviews the output for decisions:
```
1. Parse agent output for decision-like statements
2. Present to human: "The agent chose X. Record as a decision?"
3. If yes: brain pm decision add ...
4. If no: skip
```

This ensures important choices are tracked regardless of who made them.

---

## Cross-Session Continuity

### Brain Memory Integration

The orchestrator writes session summaries as brain notes:
```yaml
---
type: pm-session-log
module: pm
module_instance: webproject
title: "Session 2026-02-25 afternoon"
tags: [session, webproject]
---

## Completed
- HA-00.01: Created cloud provider account
- HA-00.02: Configured spending cap

## Decisions
- DEC-001: API key stored in macOS Keychain (not 1Password)

## In Progress
- WEB-01.01: Auth library research (agent, background)

## Next Session
- Review WEB-01.01 output
- Start WEB-02.01 (schema design research)
```

Brain's memory extraction picks up decisions and patterns from these session logs, making them available to future brain queries.

### Context Loading Strategy

The orchestrator loads context in tiers (proven pattern from production use):

| Tier | What | When |
|------|------|------|
| Always | `brain pm briefing --json` (compact state) | Every session start |
| Active | Full task details for in-progress/next tasks | When working on them |
| Reference | Decision summaries, dependency context | Included in dispatch bundles |
| Archive | Completed task logs | Only when explicitly referenced |

This prevents context bloat while maintaining awareness.

---

## Metrics & Observability

### Session Metrics (captured automatically)

```json
{
  "session": {
    "sessionId": "abc-123",
    "date": "2026-02-25",
    "duration_minutes": 90,
    "tasks_completed": 5,
    "tasks_started": 2,
    "decisions_captured": 3,
    "agent_tasks_dispatched": 4,
    "agent_tasks_completed": 3,
    "agent_tasks_failed": 1,
    "cost": {
      "total_tokens": 245000,
      "estimated_usd": 4.82,
      "by_model": {
        "claude-opus-4-6": { "tokens": 85000, "cost_usd": 3.15 },
        "claude-sonnet-4-6": { "tokens": 120000, "cost_usd": 1.44 },
        "claude-haiku-4-5": { "tokens": 40000, "cost_usd": 0.23 }
      },
      "by_category": {
        "implementation": { "tasks": 2, "cost_usd": 3.15 },
        "research": { "tasks": 2, "cost_usd": 1.44 },
        "validation": { "tasks": 1, "cost_usd": 0.23 }
      }
    }
  }
}
```

### Execution Telemetry Collection

The orchestrator collects telemetry from sub-agents at completion time:

```typescript
async function collectAndRecordTelemetry(
  taskId: string,
  claimToken: string,
  agentResult: TaskResult,
  dispatch: DispatchContext
) {
  // Phase 1: Record what the orchestrator knows (no token data from Task tool)
  const sessionId = process.env.BRAIN_PM_SESSION;
  const agentId = extractAgentId(agentResult.output); // parsed from result text

  await bash(`brain pm complete ${taskId} --token ${claimToken} \
    --model ${dispatch.model} \
    --agent-id ${agentId} \
    --session ${sessionId} \
    --log "${summarize(agentResult.output)}"`);

  // Phase 2: Token enrichment happens asynchronously via:
  //   brain pm audit enrich --task ${taskId}
  // which parses the agent transcript JSONL for token counts and cost
}
```

### Project Health (from `brain pm status`)

- **Velocity:** tasks completed per session (rolling average)
- **Throughput by mode:** agent vs human task completion rates
- **Block rate:** how often tasks get blocked
- **Decision density:** decisions per workstream (low = under-documented)
- **WIP age:** how long tasks stay in-progress
- **Cost efficiency:** cost per task by category, model utilization patterns
- **Agent success rate:** completion vs failure ratio by model and category

---

## Implementation Roadmap

See [00-overview.md](00-overview.md) for the consolidated implementation roadmap.

---

## References

- Research: orchestration-patterns.md (ReAct, plan-and-execute, supervisor/worker, context management)
- Research: methodologies.md (GTD next actions, Kanban pull-based, Shape Up appetite)
- Research: tools-and-patterns.md (LangGraph state management, CrewAI task dispatch)
- Prior project orchestrator.md (proven session flow pattern)
- Prior project execution-framework.md (task modes, parallelism rules, prompt format)
