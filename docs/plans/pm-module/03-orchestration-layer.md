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
1. brain pm task claim OC-08.05
   → Returns: claim_token (UUID), confirms pending (+READY) → claimed transition
2. brain pm dispatch OC-08.05 --json
   → Returns: prompt, context bundle, validation criteria, output location
3. Orchestrator spawns sub-agent via Task tool:
   - subagent_type: general-purpose
   - prompt: rendered from dispatch output (includes claim_token)
   - model: opus for implementation, sonnet for research, haiku for validation
   - run_in_background: true (if human has other work)
4. brain pm task start OC-08.05 --token <claim_token>
   → Validates token, transitions claimed → in-progress
   → Records agent_id, parent_session, started_at
5. When agent completes:
   - Orchestrator reviews output
   - Runs validation checks if applicable
   - brain pm complete OC-08.05 --token <claim_token> \
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
│  Task: OC-08.05 Build Task Tracking     │
│  Mode: agent                            │
│                                         │
│  ## Context                             │
│  - Completed dep: OC-08.04 summary      │
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
1. brain pm dispatch OC-00.02 --json
   → Returns: walkthrough steps, decision points, validation checks
2. Orchestrator presents first step to human
3. For each step:
   a. Explain what to do
   b. If automatable, offer to run it
   c. If browser/physical, wait for human confirmation
   d. Validate the step succeeded
   e. Record any decisions made
4. On completion:
   - brain pm complete OC-00.02 --log "summary"
   - Surface next eligible task
```

**Key behavior:** The orchestrator actively looks for ways to automate parts of assisted tasks. If a step says "run this command," the orchestrator runs it. If a step says "go to this URL," the orchestrator explains and waits.

#### Review Tasks (📋)

```
1. brain pm dispatch OC-01.03 --json
   → Returns: artifacts to review, review criteria, approval checklist
2. Orchestrator presents artifacts:
   - Reads log files or output from the producing task
   - Formats for human review
   - Presents checklist
3. Human reviews:
   - Approved → brain pm complete, capture any feedback
   - Revision needed → brain pm task update OC-01.03 --status pending
     with notes about what to fix
```

#### Human Tasks (👤)

```
1. brain pm dispatch OC-00.01 --json
   → Returns: explanation, helpful links, what to do
2. Orchestrator explains what needs to happen
3. Provides context, links, tips
4. Waits for human to confirm completion
5. Validates if possible (e.g., check if account exists)
6. brain pm complete OC-00.01
```

### Parallel Execution

The orchestrator manages concurrent work streams:

```
Human working on:        Background agents:
┌──────────────┐        ┌──────────────┐
│ OC-00.02     │        │ OC-01.01 🤖  │ ← research UniFi
│ (assisted)   │        │ running...   │
│ configuring  │        ├──────────────┤
│ spending cap │        │ OC-02.09 🤖  │ ← build AGENTS.md
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

The OpenClaw orchestrator was a standalone `orchestrator.md` file that had to be manually passed to Claude Code. Problems:
- Manual loading every session
- Prompt file itself contained project-specific context
- No way to auto-invoke

As a Claude Code skill, the orchestrator:
- Auto-loads when Claude Code detects a brain pm project
- Is project-agnostic (all state comes from `brain pm` commands)
- Can be invoked with `/orchestrator` or auto-triggered
- Can be versioned and updated independently

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

## Decision Capture Integration

The orchestrator captures decisions at two points:

### Explicit (Human Decisions)

During assisted tasks or reviews, when the human makes a choice:
```
Orchestrator: "Do you want native install or Docker-only?"
Human: "Native with Docker volumes"
Orchestrator: brain pm decision add "Native install + Docker volume mounts" \
  --task OC-03.01 --impacts OC-03.04,OC-04.01 --tags architecture
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
module_instance: openclaw
title: "Session 2026-02-25 afternoon"
tags: [session, openclaw]
---

## Completed
- OC-00.01: Created Anthropic account
- OC-00.02: Configured $20/day spending cap

## Decisions
- DEC-001: API key stored in macOS Keychain (not 1Password)

## In Progress
- OC-01.01: UniFi research (agent, background)

## Next Session
- Review OC-01.01 output
- Start OC-02.01 (SOUL.md research)
```

Brain's memory extraction picks up decisions and patterns from these session logs, making them available to future brain queries.

### Context Loading Strategy

The orchestrator loads context in tiers (proven pattern from OpenClaw):

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

## Implementation Phases

### Phase 1: Orchestrator Skill with Parallel Dispatch
- SKILL.md with session start/dispatch/complete flow
- Session ID capture via SessionStart hook
- Claim mechanism (claim → start → complete with tokens)
- Parallel agent dispatch with WIP limits
- Model selection by task category
- Execution telemetry collection on every complete
- Auto-recommendation logic (priority, mode, critical path)
- `brain pm audit` commands for cost/performance visibility

### Phase 2: Decision Integration
- Automatic decision capture from agent output
- Prompt staleness detection
- Decision propagation to downstream tasks

### Phase 3: Cross-Session Continuity
- Session summary notes with telemetry
- Stale/orphaned claim detection and recovery
- Velocity/health metrics
- Brain memory integration for decision retrieval

---

## References

- Research: orchestration-patterns.md (ReAct, plan-and-execute, supervisor/worker, context management)
- Research: methodologies.md (GTD next actions, Kanban pull-based, Shape Up appetite)
- Research: tools-and-patterns.md (LangGraph state management, CrewAI task dispatch)
- OpenClaw orchestrator.md (proven session flow pattern)
- OpenClaw execution-framework.md (task modes, parallelism rules, prompt format)
