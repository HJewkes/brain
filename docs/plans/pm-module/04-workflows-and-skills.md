# Agent/User Workflows & Claude Code Skills

**Date:** 2026-02-25
**Status:** Draft
**Depends on:** 01-brain-module-system.md, 02-pm-module-design.md, 03-orchestration-layer.md
**Part of:** Task Management Framework — Design Series

---

## Overview

This document defines the end-to-end workflows for using the task management system — from project inception through execution to completion. It also specifies the Claude Code skills that make these workflows ergonomic.

The key insight: the system supports a **full project lifecycle** where each phase has a natural workflow and corresponding skill.

```
Research → Brainstorm → Design → Plan → Execute → Verify → Archive
   ↑                                        │
   └────── decisions feed back ──────────────┘
```

---

## Lifecycle Phases & Skill Mapping

| Phase | Activity | Primary Skill | PM Module Role |
|-------|----------|---------------|----------------|
| **Research** | Explore problem space, gather information | `brain` (search, capture) | Captures as project notes |
| **Brainstorm** | Turn ideas into designs | `brainstorming` (existing) | Captures decisions |
| **Design** | Detailed technical design | `brainstorming` → design doc | Writes design as brain note |
| **Plan** | Break design into executable tasks | `writing-plans` (existing) → PM | Creates project, workstreams, tasks, prompts |
| **Execute** | Work through task backlog | `orchestrator` (new) | Manages state, dispatch, decisions |
| **Verify** | Validate completed work | `orchestrator` | Review tasks, acceptance criteria |
| **Archive** | Wrap up, capture learnings | `self-improve` (existing) + PM | Session summaries, retrospective |

---

## Workflow 1: Project Initialization

### Trigger
User says: "Let's start a new project for X" or invokes brainstorming skill.

### Flow

```
1. brainstorming skill activates
   - Explores context, asks clarifying questions
   - Proposes approaches, gets approval
   - Writes design doc

2. writing-plans skill activates (invoked by brainstorming)
   - Reads design doc
   - Breaks down into workstreams and tasks
   - Identifies task modes (agent/assisted/review/human)
   - Maps dependencies

3. PM module initializes project:
   brain pm init "Project Name" --prefix XX --phases "Phase 1,Phase 2" \
     --automation assisted

4. For each workstream:
   brain pm workstream add "Name" --number NN --phase N

5. For each task:
   brain pm task add "Title" --workstream NN --mode M --priority P --depends-on ...

6. For agent tasks, write prompt notes:
   brain pm prompt write XX-NN.MM --content "..."

7. Validate dependency graph:
   brain pm status
   brain pm next           # verify dependency ordering is coherent
   brain pm waves --json   # confirm wave groupings match intended parallelism
```

The `--automation assisted` default ensures the orchestrator will present dispatch plans for human approval. Switch to autonomous later once the project is proven:

```bash
brain pm project update XX --automation autonomous
```

### Integration Point: brainstorming → writing-plans → PM

The existing brainstorming skill ends with "invoke writing-plans." The writing-plans skill should end with "create PM project." This chain:

```
/brainstorm "Build a task management CLI"
  → design doc written
  → /writing-plans invoked
    → implementation plan created
    → brain pm init + task creation
      → /orchestrator available for execution
```

### Skill Enhancement: writing-plans

The existing `writing-plans` skill needs a PM output mode:

```markdown
## PM Output Mode

When a brain PM project exists or the user wants structured tracking:
1. Create project and workstreams via `brain pm` commands
2. Create tasks with dependencies, modes, and priorities
3. Write prompt files for agent tasks
4. Verify dependency graph with `brain pm status`
5. Validate wave plan with `brain pm waves --json`

When no PM project is needed (simple tasks):
1. Use the existing plan file format
2. Track via CLAUDE.md task list
```

---

## Workflow 2: Session Execution

### Trigger
User opens Claude Code for a work session. Orchestrator skill activates.

### Flow

```
Session Start
│
├─ SessionStart hook writes $BRAIN_PM_SESSION via CLAUDE_ENV_FILE
│
├─ brain pm briefing --json
│  "Welcome back. Project WEB, Phase 1.
│   Automation mode: assisted (approve dispatch before agents run).
│   Say 'switch to autonomous' to change.
│
│   Since last session: WEB-00.01, WEB-00.02 completed.
│   Last session cost: $3.42 (2 Opus tasks, 1 Sonnet research).
│   Ready now: WEB-00.04, WEB-01.01, WEB-02.01.
│   Recommendation: Start with WEB-01.01 (agent/research, unblocks 3)
│   and WEB-00.04 (human, quick service account creation)."
│
├─ Inter-session catch-up (if needed):
│  brain pm context --since "2026-02-25T18:00:00Z"
│  → Shows decisions, completions, and state changes since last session end
│
├─ Compute wave plan:
│  brain pm waves --json
│  → Wave 1: WEB-01.01 (research, Sonnet), WEB-02.01 (design, Opus)
│  → Wave 2: WEB-01.02 (impl, Opus), WEB-02.02 (migration, Opus)
│  → Blocked: WEB-03.01 (waiting on WEB-01.02, WEB-02.02)
│
│  In assisted mode: orchestrator presents wave plan for approval
│  In autonomous mode: orchestrator dispatches Wave 1 immediately
│
├─ Human: "Looks good, fire off wave 1. I'll do the service account setup"
│
├─ Orchestrator claims & dispatches (parallel):
│  ├─ brain pm task claim WEB-01.01 → token-A
│  ├─ brain pm task claim WEB-02.01 → token-B
│  ├─ Allocate worktrees where routing requires isolation
│  ├─ WEB-01.01 → background agent (Sonnet, research, no worktree)
│  ├─ WEB-02.01 → background agent (Opus, design, no worktree)
│  └─ Walks human through WEB-00.04 (service account setup)
│
├─ Human completes WEB-00.04
│  ├─ brain pm complete WEB-00.04 --log "Service account created"
│  ├─ brain pm next: "WEB-00.05 is now eligible (configure VPN client)"
│  └─ Orchestrator: "Want to do WEB-00.05 while agents run?"
│
├─ Background agent WEB-01.01 completes
│  ├─ Orchestrator spawns verification agent if routing requires it
│  ├─ Orchestrator records telemetry: 45k tokens, $0.72, 38s
│  ├─ Orchestrator: "Research done ($0.72). Quick look or continue?"
│  ├─ If "continue": queued for review
│  └─ If "quick look": present summary, approve or request revision
│
├─ ... more tasks / waves ...
│
Session End
├─ brain pm status → summary
├─ brain pm audit summary --session current → cost breakdown
├─ Write session log note (includes telemetry)
└─ Preview next session
```

### Worktree Safety During Parallel Execution

When multiple agents run in parallel, the orchestrator ensures safe file isolation:

1. **Claim assigns worktree** — tasks requiring file edits get a worktree from the budget pool at claim time
2. **Hook validates at runtime** — a PreToolUse hook checks `BRAIN_PM_WORKTREE` on every file-modifying tool call, blocking writes outside the assigned worktree
3. **Pre-dispatch check** — orchestrator verifies no two claimed tasks share a worktree before spawning agents

See doc 03 (Worktree Isolation Safety) for the full defense-in-depth design.

### Natural Break Points

The orchestrator surfaces background results at these moments:
- After completing a human/assisted task (natural transition)
- When all human tasks are blocked (nothing else to do)
- When human explicitly asks ("what's pending?")
- Before session end

NOT during:
- Middle of an assisted walkthrough
- While human is reviewing something
- During active problem-solving discussion

---

## Workflow 3: Agent Task Execution (Detail)

### Sub-Agent Spawn Pattern

```typescript
// 1. Claim the task (prevents double-dispatch)
const claim = JSON.parse(
  await bash('brain pm task claim WEB-08.05 --json')
);
// → { claimToken: "uuid-xxx", taskId: "WEB-08.05", status: "claimed" }

// 2. Get dispatch context (includes routing)
const dispatch = JSON.parse(
  await bash('brain pm dispatch WEB-08.05 --json')
);
// dispatch.routing → { agentType, model, isolation, concurrency }

// 3. Read session ID from environment (set by SessionStart hook)
const sessionId = process.env.BRAIN_PM_SESSION;

// 4. Allocate worktree if routing requires isolation
let worktreePath: string | undefined;
if (dispatch.routing.isolation === 'worktree') {
  worktreePath = allocateWorktree(dispatch.task.displayId, claim.claimToken);
  await bash(`brain pm task update WEB-08.05 --worktree "${worktreePath}"`);
}

// 5. Start the task (claimed → in-progress)
await bash(`brain pm task start WEB-08.05 --token ${claim.claimToken}`);

// 6. Spawn sub-agent with routing-derived parameters
const agentResult = await Task({
  description: `Execute ${dispatch.task.displayId}: ${dispatch.task.title}`,
  subagent_type: dispatch.routing.agentType,  // from routing table
  model: dispatch.routing.model,               // from routing table (overridable with --model)
  prompt: buildAgentPrompt(dispatch, worktreePath),
  run_in_background: true,
});

// Track in-flight state for parallel management
inFlight.set(dispatch.task.displayId, {
  claimToken: claim.claimToken,
  model: dispatch.routing.model,
  sessionId,
  worktreePath,
  startedAt: new Date().toISOString(),
});
```

### Agent Prompt Template

```markdown
# Task ${displayId}: ${title}

You are executing a project task. Follow these instructions precisely.

## Context
${completedDependencies.map(d => `- ${d.id}: ${d.summary}`)}
${decisions.map(d => `- Decision ${d.id}: ${d.summary}`)}

## Instructions
${prompt}

## Validation Criteria
${validation.map(v => `- [ ] ${v}`)}

## Status Reporting
Report significant state changes only (not routine progress):
  brain pm task update ${displayId} --status in-progress --msg "STARTING: <what you are doing>"
  brain pm task update ${displayId} --status in-progress --msg "PROGRESS: <significant finding or decision>"
  brain pm task update ${displayId} --status blocked --msg "BLOCKED: <what you need>"

## Fetching Additional Context
If you need more context during execution:
  brain pm context ${displayId} --json            # full task context
  brain pm context ${displayId} --decisions        # decisions impacting this task
  brain pm context ${displayId} --since "<timestamp>"  # changes since you started

## Output
Write your results to the project. Include:
1. What you did
2. Any decisions you made (and why)
3. Any issues or blockers you encountered
4. Whether all validation criteria are met

Do NOT modify files outside the scope of this task.
${worktreePath ? `Your assigned worktree: ${worktreePath}. Do not write files outside it.` : ''}
```

Note: the agent does NOT call `brain pm complete`. The orchestrator handles completion after the agent finishes and verification passes (see below).

### Verification Flow

After the implementation agent finishes, the orchestrator gates completion behind independent verification:

```
Implementation agent completes work (task stays in-progress)
  → Orchestrator detects completion (SubagentStop hook or poll)
  → Orchestrator fetches verification plan: brain pm verify WEB-08.05 --json
  → Orchestrator spawns verification agent in same worktree (Haiku, read-only)
  → Verification agent runs checks (tests, types, lint, build, summary)
  → Verification agent records result:
      brain pm verify WEB-08.05 --record --outcome passed --log "All checks pass"

  On pass:
    → Orchestrator calls: brain pm complete WEB-08.05 --token <claim> \
        --outcome completed --model <model> --agent-id <id> \
        --session $BRAIN_PM_SESSION --log "summary"
    → Task transitions to done, worktree released, newly eligible tasks dispatched

  On fail:
    → Task reverts to pending (new claim cycle)
    → Verification feedback stored in task metadata
    → Next implementation attempt receives: "Previous attempt failed: {feedback}"
```

Not all tasks require verification. Research, design, and review tasks skip it. See doc 03 for the full routing table with verification flags.

### Agent Output Processing

When the agent completes, the orchestrator (not the agent) handles post-processing:

```typescript
async function processAgentOutput(taskId: string, agentResult: TaskResult) {
  const flight = inFlight.get(taskId);
  const output = agentResult.output;
  const agentId = extractAgentId(output);

  // 1. Check if verification is needed (from routing table)
  if (dispatch.routing.verify) {
    // Spawn verification agent — completion is deferred until verification passes
    await spawnVerificationAgent(taskId, flight);
    return;
  }

  // 2. No verification needed — complete directly
  const validationPassed = checkValidation(output, dispatch.validation);
  const outcome = validationPassed ? 'completed' : 'partial';

  await bash(`brain pm complete ${taskId} --token ${flight.claimToken} \
    --outcome ${outcome} \
    --model ${flight.model} \
    --agent-id ${agentId} \
    --session ${flight.sessionId} \
    --log "${summarize(output)}"`);

  // 3. Extract and record decisions
  const decisions = extractDecisions(output);
  for (const decision of decisions) {
    await bash(`brain pm decision add "${decision.text}" --task ${taskId}`);
  }

  // 4. Check impact
  const impact = JSON.parse(await bash(`brain pm task show ${taskId} --json`));
  inFlight.delete(taskId);

  return { validationPassed, decisions, newlyEligible: impact.unblocked };
}
```

### Failed Agent Processing

```typescript
async function processAgentFailure(taskId: string, error: string) {
  const flight = inFlight.get(taskId);

  // Record failure — task reverts to pending, claim released
  await bash(`brain pm complete ${taskId} --token ${flight.claimToken} \
    --outcome failed \
    --model ${flight.model} \
    --session ${flight.sessionId} \
    --log "FAILED: ${error}"`);

  inFlight.delete(taskId);

  // Retry logic: max 2 retries (configurable), each is a new claim cycle
  // After max retries: escalate to human (task → blocked)
}
```

---

## Workflow 4: Assisted Task Walkthrough (Detail)

### Automation Gating

In `--automation assisted` mode, all dispatch requires human approval. The orchestrator presents the plan and waits for confirmation before spawning any agents. This applies equally to wave dispatch, individual task dispatch, and verification agent dispatch.

The same claim/WIP/telemetry machinery operates in both assisted and autonomous modes. The only difference is the approval gate before dispatch.

### Walkthrough Pattern

```
Orchestrator: "Let's configure your API rate limits.
              Step 1: Open the API provider's dashboard settings"
Human: "Done, I see the settings page"

Orchestrator: "Great. Step 2: Click 'Rate Limits'.  
              You should see request and token limit fields."
              
Human: "I see it"

Orchestrator: "Set the daily request limit to 1000.  
              This matches our capacity plan.  
              [Decision: 1000 req/day API rate limit]"
              
Human: "Set to 1000"

Orchestrator: "Perfect. Let me verify..."
              → runs validation if possible
              → brain pm complete WEB-00.02 --log "Rate limit set to 1000 req/day"
              → brain pm decision add "1000 req/day API rate limit" --task WEB-00.02
```

### Automation Within Assisted Tasks

The orchestrator actively automates sub-steps:

- **Command steps**: Run directly (`brew install wireguard-tools`)
- **File creation steps**: Write files (`brain pm prompt write ...`)
- **Verification steps**: Run checks and report results
- **Browser steps**: Explain and wait for human confirmation
- **Physical steps**: Explain and wait

This maximizes efficiency — the human only does what requires human presence.

---

## Workflow 5: Decision Capture & Propagation

### During Execution

```
1. Agent completes WEB-03.01 (deployment research)
2. Output includes: "Recommend containerized deployment with persistent volumes"
3. Orchestrator: "The agent recommends containerized + persistent volumes.
   This affects tasks WEB-03.04, WEB-04.01, WEB-05.02.
   Record as a decision?"
4. Human: "Yes"
5. brain pm decision add "Containerized deployment with persistent volumes" \
     --task WEB-03.01 --impacts WEB-03.04,WEB-04.01,WEB-05.02
6. When WEB-03.04 is dispatched later, the prompt includes:
   "Decision DEC-003: Using containerized deployment with persistent volumes"
```

### Retroactive Decision Discovery (v2)

Retroactive discovery of undocumented decisions from completed task output is deferred to v2. This would analyze completed tasks for decision-like statements and propose ADRs for human approval, using brain memory extraction to find decision patterns.

---

## Workflow 6: Project Retrospective

### Trigger
Project completed or phase milestone reached.

### Flow

```
1. brain pm status --json  # final state
2. brain pm decision list  # all decisions made
3. brain pm audit summary --project WEB --json  # full cost/performance data
4. Generate retrospective:
   - Timeline: when tasks completed, how long each took
   - Decision log: what was decided and why
   - Blockers: what slowed things down
   - Velocity: tasks per session over time
   - Cost analysis: total spend, cost by category/model/workstream
   - Agent efficiency: success rate, avg tokens per category, retries
   - Model utilization: which models handled which work, cost-effectiveness
   - Verification stats: pass/fail rate by category, common failure reasons
5. Write retrospective as brain note
6. Brain memory extraction captures learnings
7. Archive project: brain pm project update WEB --status completed
```

---

## Claude Code Skills Inventory

### New Skills Needed

| Skill | Trigger | Purpose |
|-------|---------|----------|
| **orchestrator** | `/orchestrator` or auto on session start with active project | Session management, wave computation, task routing, parallel agent dispatch, verification agent dispatch, JIT context delivery, status push handling, adaptive automation |
| **pm** | `/pm` or `brain pm` commands | Direct PM module interaction for manual task management |

### Existing Skills to Enhance

| Skill | Enhancement |
|-------|-----------|
| **brainstorming** | Add PM output: create brain notes for design docs, capture decisions as ADRs |
| **writing-plans** | Add PM output mode: create project/workstreams/tasks via `brain pm` commands |
| **self-improve** | Add project retrospective mode: analyze completed projects for learnings |
| **brain** | Ensure module-aware search (respects visibility tiers, active context) |

### Skill Interaction Flow

```
/brainstorm → design doc → /writing-plans → PM project → /orchestrator → execution
                                                              ↓
                                                        /self-improve → retrospective
```

---

## Implementation Roadmap

See [00-overview.md](00-overview.md) for the consolidated implementation roadmap.

---

## References

- Research: orchestration-patterns.md (agent dispatch, human-in-the-loop, context bundling)
- Research: methodologies.md (GTD capture/process, Shape Up hill charts, ADR pattern)
- Design: 03-orchestration-layer.md (session lifecycle, dispatch modes, routing, waves, worktree safety, verification, JIT context)
- Design: 02-pm-module-design.md (CLI commands, state machine)
- Existing skills: brainstorming, writing-plans, self-improve, brain
- Prior orchestration patterns (proven session flow)
