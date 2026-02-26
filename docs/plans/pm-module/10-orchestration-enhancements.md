# Orchestration Enhancements — Patterns from Production Use

**Date:** 2026-02-26
**Status:** Draft
**Extends:** 03-orchestration-layer.md, 02-pm-module-design.md
**Part of:** Task Management Framework — Design Series

---

## Overview

Doc 03 defines the orchestration layer: session lifecycle, dispatch modes, parallel execution, error handling, and telemetry. This document adds patterns proven through real multi-agent project orchestration that make the system more robust, efficient, and safe.

Six enhancements:
1. **Adaptive automation levels** — assisted vs autonomous dispatch modes
2. **Task routing engine** — category + mode to agent type, model, isolation level
3. **Wave-based execution** — topological grouping for parallel dispatch
4. **Worktree isolation safety** — three-layer defense against cross-agent file conflicts
5. **Just-in-time context** — lean startup context with on-demand CLI retrieval
6. **Verification agents** — independent validation of completed work

---

## 1. Adaptive Automation Levels

### The Problem

Not all projects need the same level of human involvement. Early-stage projects with unclear requirements need human guidance at every step. Mature projects with well-defined tasks and proven prompts can run agents autonomously.

### Design

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

### Switching Modes

The human can switch modes at any time during a session:

- "Switch to autonomous for workstream 03" updates the metadata
- "Pause agents" temporarily halts auto-dispatch without changing the stored level
- The orchestrator announces the mode on session start as part of the briefing

---

## 2. Task Routing Engine

### The Problem

Not all tasks need the same execution environment. Research tasks are read-only and can run in parallel without isolation. Implementation tasks modify files and need dedicated worktrees. The orchestrator needs a systematic way to determine **what kind of agent, which model, and what isolation** each task requires.

### Routing Table

The routing engine maps `category + mode` to concrete dispatch parameters:

| Category | Mode | Agent Type | Isolation | Default Model | Concurrency |
|----------|------|-----------|-----------|---------------|-------------|
| implementation | agent | general-purpose | Worktree (coding) | Opus | Sequential within workstream |
| research | agent | Explore (read-only) | None | Sonnet | Parallel (no file conflicts) |
| validation | agent | general-purpose | None | Haiku | Parallel |
| configuration | agent | general-purpose | Worktree if file edits | Haiku/Sonnet | Depends on file overlap |
| design | agent | general-purpose | None (typically) | Opus | Parallel |
| review | agent | Explore or general-purpose | None | Sonnet | Parallel |
| documentation | agent | general-purpose | Worktree if file edits | Sonnet | Depends on file overlap |
| migration | agent | general-purpose | Worktree | Opus | Sequential |
| any | assisted | Orchestrator guides human | N/A | N/A | Sequential (one human) |
| any | human | Human acts independently | N/A | N/A | Sequential |
| any | review | Orchestrator presents artifacts | N/A | N/A | Sequential |

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

The `worktreePath` is null in the dispatch output because worktree allocation is the orchestrator's responsibility (see Section 4).

---

## 3. Wave-Based Execution

### The Problem

When multiple tasks are +ELIGIBLE simultaneously, the orchestrator needs to determine which can run in parallel and which must be sequenced. Dispatching them one at a time wastes throughput. Dispatching them all at once risks file conflicts.

### Design

A **wave** is a set of +ELIGIBLE tasks that can safely execute in parallel. Waves are computed from the dependency DAG and routing constraints.

### CLI Command

```bash
brain pm waves --json
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

### Wave Computation Algorithm

```
1. Query all +ELIGIBLE tasks (pending with all deps done)
2. For remaining tasks, identify those whose only unmet deps are in wave N
   → These form wave N+1
3. Repeat until all tasks are assigned to a wave or are blocked by non-task blockers
```

This is a standard topological level assignment on the dependency DAG.

### Orchestrator's Role

The orchestrator applies routing on top of the wave data:

1. Within each wave, group tasks by isolation needs (worktree vs no worktree)
2. Check worktree budget (see Section 4) — if budget is full, defer worktree-requiring tasks
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

---

## 4. Worktree Isolation Safety

### The Problem

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

### Layer 3: Orchestrator-Level Pre-Dispatch Validation

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

## 5. Just-in-Time Context

### The Problem

Loading full project context into an agent's prompt at startup is wasteful. Most agents don't need the entire dependency graph, all decisions, and the full workstream history. But agents do need context to evolve as they work — a decision made by a parallel agent might affect their task.

### Design: CLI-Based Context Retrieval

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

### The `--since` Flag

The `--since` flag enables incremental context updates. It queries the activities table for events since the given timestamp that are relevant to the task:

```sql
-- New decisions impacting this task since timestamp
SELECT a.* FROM activities a
JOIN note_relations r ON json_extract(a.metadata, '$.decision_id') = r.source_id
WHERE r.target_id = ? AND r.relation_type = 'impacts' AND r.module = 'pm'
  AND a.completed_at > ?;

-- Newly completed dependencies since timestamp
SELECT a.* FROM activities a
WHERE a.activity_type = 'execution' AND a.outcome = 'completed'
  AND a.module = 'pm'
  AND json_extract(a.note_ids, '$[0]') IN (
    SELECT r.target_id FROM note_relations r
    WHERE r.source_id = ? AND r.relation_type = 'depends_on' AND r.module = 'pm'
  )
  AND a.completed_at > ?;
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
brain pm complete WEB-01.03 --token {claim_token} --log "summary"

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

---

## 6. Verification Agents

### The Problem

Agents that implement code and then self-verify have a bias toward confirming their own work. A separate verification step by an independent agent provides better quality assurance and catches issues the implementation agent might overlook.

### Design

When an implementation agent completes, the orchestrator spawns a separate verification agent:

```
Implementation Agent (Opus)          Verification Agent (Haiku/Sonnet)
+-------------------------+         +------------------------------+
| Writes code              |         | Runs tests                    |
| Creates/modifies files   |  --->   | Checks types                  |
| Writes summary.md        |  done   | Validates deliverables table  |
| Calls brain pm complete  |         | Checks for lint warnings      |
+-------------------------+         | Verifies against criteria     |
                                    | Reports pass/fail + details   |
                                    +------------------------------+
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

### Verification Flow

```
1. Implementation agent completes task
   → brain pm complete WEB-01.03 --token <claim> --outcome completed --log "..."
   → Activity recorded with activity_type='execution'

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
    → Task confirmed as done
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

The routing table (Section 2) includes a `verify` flag that the orchestrator uses to decide whether to spawn a verification agent.

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

On completion:
brain pm verify {display_id} --record --outcome {passed|failed} --log "summary"
```

---

## Status Push Protocol

### The Problem

Doc 03 mentions agents reporting back to the orchestrator, but doesn't specify the protocol. Without a clear protocol, agents either over-report (wasting context) or under-report (orchestrator flies blind).

### Design: Transition-Only Reporting

Agents report status on **state transitions only** — not periodically:

| Transition | When | Example |
|-----------|------|---------|
| STARTING | Agent begins work | "Starting implementation of JWT middleware" |
| PROGRESS | Significant discovery or decision | "Chose middleware pattern X. Key finding: library Y doesn't support ESM." |
| BLOCKED | Cannot proceed without input | "Need API credentials for testing. Blocked on human action." |

**Not reported:** Routine progress ("writing tests"), file-by-file updates, or periodic heartbeats.

### Implementation

The status push is embedded in every agent dispatch prompt (see Section 5, "Status Reporting" in the startup context). Agents use the existing `brain pm task update` command:

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

---

## New CLI Commands (Summary)

These commands are additions to doc 02's CLI interface:

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

## Implementation Phases

### Phase 1: Core Orchestration Patterns (extends doc 03 Phase 1)
- Task routing engine in orchestrator skill
- Wave computation CLI command (`brain pm waves`)
- Worktree budget configuration and allocation tracking
- Status push protocol in dispatch prompt templates
- Adaptive automation metadata field and behavior switch

### Phase 2: Safety and Verification (extends doc 03 Phase 2)
- Worktree validation hook (PreToolUse)
- `brain pm verify` command (plan generation + result recording)
- Verification agent dispatch from orchestrator
- Verification feedback loop (failed -> pending with feedback in context)

### Phase 3: Context Efficiency (extends doc 03 Phase 3)
- `brain pm context` command with --since delta support
- Orchestrator context push for critical state changes
- Lean dispatch prompt template (startup context only, CLI for more)

---

## Open Questions

1. **Verification agent model choice.** Haiku is cheapest for mechanical checks, but some verification requires understanding the implementation (e.g., "do the tests cover the right cases?"). Consider Sonnet for tasks with `category: implementation` and Haiku for `category: configuration`.

2. **Worktree cleanup on session crash.** If a session ends abruptly, worktrees may be left in a dirty state. The next session's `brain pm briefing` should detect orphaned worktree assignments and offer cleanup options.

3. **Wave recomputation frequency.** Waves are computed at dispatch time. Should the orchestrator recompute waves after each task completion (to discover newly eligible tasks in the same wave) or only between waves?

4. **Context push mechanism for background agents.** Claude Code's Task tool doesn't support sending messages to running background agents. The context push may only work with team-based dispatch (SendMessage tool). For background agents, the polling approach (`brain pm context --since`) at natural checkpoints is the fallback.

---

## References

- Doc 02 (PM Module Design) — CLI commands, state machine, dependency engine
- Doc 03 (Orchestration Layer) — Session lifecycle, dispatch modes, parallel execution
- Doc 04 (Workflows & Skills) — Agent prompt templates, sub-agent spawn pattern
- Doc 09 (Directory-Backed Notes) — Summary.md conventions, content_dir lifecycle
