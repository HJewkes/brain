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
   brain pm init "Project Name" --prefix XX --phases "Phase 1,Phase 2"

4. For each workstream:
   brain pm workstream add "Name" --number NN --phase N

5. For each task:
   brain pm task add "Title" --workstream NN --mode M --priority P --depends-on ...

6. For agent tasks, write prompt notes:
   brain pm prompt write XX-NN.MM --content "..."

7. Final validation:
   brain pm status
   brain pm next  # verify dependency graph is coherent
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
│  "Welcome back. Project OC, Phase 1.
│   Since last session: OC-00.01, OC-00.02 completed.
│   Last session cost: $3.42 (2 Opus tasks, 1 Sonnet research).
│   Ready now: OC-00.04, OC-01.01, OC-02.01.
│   Recommendation: Start with OC-01.01 (agent/research, unblocks 3)
│   and OC-00.04 (human, quick account creation)."
│
├─ Human: "Fire off the agents, I'll do the account creation"
│
├─ Orchestrator claims & dispatches (parallel):
│  ├─ brain pm task claim OC-01.01 → token-A
│  ├─ brain pm task claim OC-01.02 → token-B
│  ├─ OC-01.01 → background agent (Sonnet, research)
│  ├─ OC-01.02 → background agent (Sonnet, research)
│  └─ Walks human through OC-00.04 (Tailscale account)
│
├─ Human completes OC-00.04
│  ├─ brain pm complete OC-00.04 --log "Account created"
│  ├─ brain pm next: "OC-00.05 is now eligible (install Tailscale)"
│  └─ Orchestrator: "Want to do OC-00.05 while agents run?"
│
├─ Background agent OC-01.01 completes
│  ├─ Orchestrator records telemetry: 45k tokens, $0.72, 38s
│  ├─ Orchestrator: "UniFi research done ($0.72). Quick look or continue?"
│  ├─ If "continue": queued for review
│  └─ If "quick look": present summary, approve or request revision
│
├─ ... more tasks ...
│
Session End
├─ brain pm status → summary
├─ brain pm audit summary --session current → cost breakdown
├─ Write session log note (includes telemetry)
└─ Preview next session
```

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
  await bash('brain pm task claim OC-08.05 --json')
);
// → { claimToken: "uuid-xxx", taskId: "OC-08.05", status: "claimed" }

// 2. Get dispatch context
const dispatch = JSON.parse(
  await bash('brain pm dispatch OC-08.05 --json')
);

// 3. Read session ID from environment (set by SessionStart hook via CLAUDE_ENV_FILE)
const sessionId = process.env.BRAIN_PM_SESSION;

// 4. Start the task (claimed → in-progress)
await bash(`brain pm task start OC-08.05 --token ${claim.claimToken}`);

// 5. Spawn sub-agent
const agentResult = await Task({
  description: `Execute ${dispatch.task.displayId}: ${dispatch.task.title}`,
  subagent_type: 'general-purpose',
  model: selectModel(dispatch.task),  // category-based: opus for implementation, etc.
  prompt: buildAgentPrompt(dispatch),
  run_in_background: true,
});

// Track in-flight state for parallel management
// Note: agent_id is extracted from result text on completion, not available at spawn
inFlight.set(dispatch.task.displayId, {
  claimToken: claim.claimToken,
  model: selectModel(dispatch.task),
  sessionId,
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

## Output
Write your results to the project. Include:
1. What you did
2. Any decisions you made (and why)
3. Any issues or blockers you encountered
4. Whether all validation criteria are met

Do NOT modify files outside the scope of this task.
```

### Agent Output Processing

When the agent completes:

```typescript
async function processAgentOutput(taskId: string, agentResult: TaskResult) {
  const flight = inFlight.get(taskId);
  const output = agentResult.output;
  const agentId = extractAgentId(output); // parsed from Task tool result text

  // 1. Check for validation criteria
  const validationPassed = checkValidation(output, dispatch.validation);

  // 2. Extract decisions (pattern matching on output)
  const decisions = extractDecisions(output);

  // 3. Record completion (Phase 1 telemetry — no token data yet)
  const outcome = validationPassed ? 'completed' : 'partial';
  await bash(`brain pm complete ${taskId} --token ${flight.claimToken} \
    --outcome ${outcome} \
    --model ${flight.model} \
    --agent-id ${agentId} \
    --session ${flight.sessionId} \
    --log "${summarize(output)}"`);

  // 4. Record decisions
  for (const decision of decisions) {
    await bash(`brain pm decision add "${decision.text}" --task ${taskId}`);
  }

  // 5. Check impact
  const impact = JSON.parse(await bash(`brain pm task show ${taskId} --json`));
  inFlight.delete(taskId);

  // Token enrichment happens later via: brain pm audit enrich
  return { validationPassed, decisions, newlyEligible: impact.unblocked };
}
```

### Failed Agent Processing

```typescript
async function processAgentFailure(taskId: string, error: string) {
  const flight = inFlight.get(taskId);

  await bash(`brain pm complete ${taskId} --token ${flight.claimToken} \
    --outcome failed \
    --model ${flight.model} \
    --agent-id ${flight.agentId} \
    --session ${flight.sessionId} \
    --log "FAILED: ${error}"`);
  // Task reverts to pending, execution recorded with outcome='failed'
  // Token enrichment via: brain pm audit enrich

  inFlight.delete(taskId);
}
```

---

## Workflow 4: Assisted Task Walkthrough (Detail)

### Walkthrough Pattern

```
Orchestrator: "Let's set up your Anthropic spending cap.
              Step 1: Open console.anthropic.com/settings/billing"

Human: "Done, I see the billing page"

Orchestrator: "Great. Step 2: Click 'Usage limits'.  
              You should see a monthly and daily cap field."
              
Human: "I see it"

Orchestrator: "Set the daily cap to $20.  
              This matches our budget design.  
              [Decision: $20/day hard cap on Anthropic API]"
              
Human: "Set to $20"

Orchestrator: "Perfect. Let me verify..."
              → runs validation if possible
              → brain pm complete OC-00.02 --log "Spending cap set to $20/day"
              → brain pm decision add "$20/day Anthropic API cap" --task OC-00.02
```

### Automation Within Assisted Tasks

The orchestrator actively automates sub-steps:

- **Command steps**: Run directly (`brew install tailscale`)
- **File creation steps**: Write files (`brain pm prompt write ...`)
- **Verification steps**: Run checks and report results
- **Browser steps**: Explain and wait for human confirmation
- **Physical steps**: Explain and wait

This maximizes efficiency — the human only does what requires human presence.

---

## Workflow 5: Decision Capture & Propagation

### During Execution

```
1. Agent completes OC-03.01 (Docker research)
2. Output includes: "Recommend native install with Docker volume mounts"
3. Orchestrator: "The agent recommends native + Docker volumes.
   This affects tasks OC-03.04, OC-04.01, OC-10.02.
   Record as a decision?"
4. Human: "Yes"
5. brain pm decision add "Native install + Docker volume mounts" \
     --task OC-03.01 --impacts OC-03.04,OC-04.01,OC-10.02
6. When OC-03.04 is dispatched later, the prompt includes:
   "Decision DEC-003: Using native install + Docker volume mounts"
```

### Retroactive Decision Discovery

```bash
brain pm decision audit --project OC
# Analyzes completed tasks for undocumented decisions
# Uses brain memory extraction to find decision-like statements
# Proposes ADRs for human approval
```

---

## Workflow 6: Project Retrospective

### Trigger
Project completed or phase milestone reached.

### Flow

```
1. brain pm status --json  # final state
2. brain pm decision list  # all decisions made
3. brain pm audit summary --project OC --json  # full cost/performance data
4. Generate retrospective:
   - Timeline: when tasks completed, how long each took
   - Decision log: what was decided and why
   - Blockers: what slowed things down
   - Velocity: tasks per session over time
   - Cost analysis: total spend, cost by category/model/workstream
   - Agent efficiency: success rate, avg tokens per category, retries
   - Model utilization: which models handled which work, cost-effectiveness
   - What worked / what to improve
5. Write retrospective as brain note
6. Brain memory extraction captures learnings
7. Archive project: brain pm project update OC --status completed
```

---

## Claude Code Skills Inventory

### New Skills Needed

| Skill | Trigger | Purpose |
|-------|---------|----------|
| **orchestrator** | `/orchestrator` or auto on session start with active project | Session management, task dispatch, parallel agent coordination |
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

## Implementation Phases

### Phase 1: Orchestrator Skill with Parallel Dispatch
- SKILL.md with session flow including session ID hook
- Calls `brain pm briefing`, `next`, `claim`, `dispatch`, `start`, `complete`
- Parallel agent dispatch with claim tokens
- WIP limit awareness
- Model selection by task category
- Telemetry collection on every completion
- Natural break point surfacing
- `brain pm audit` for cost visibility

### Phase 2: Skill Chain Integration
- brainstorming → writing-plans → PM handoff
- PM output mode in writing-plans
- Decision capture during brainstorming

### Phase 3: Assisted Walkthrough Enhancement
- Step-by-step guided execution
- Sub-step automation detection
- Validation at each step
- Decision capture during walkthroughs

### Phase 4: Retrospective & Learning
- Session summary auto-generation
- Project retrospective workflow
- Brain memory extraction integration
- Self-improve skill enhancement

---

## References

- Research: orchestration-patterns.md (agent dispatch, human-in-the-loop, context bundling)
- Research: methodologies.md (GTD capture/process, Shape Up hill charts, ADR pattern)
- Design: 03-orchestration-layer.md (session lifecycle, dispatch modes)
- Design: 02-pm-module-design.md (CLI commands, state machine)
- Existing skills: brainstorming, writing-plans, self-improve, brain
- OpenClaw orchestrator.md (proven session flow)
