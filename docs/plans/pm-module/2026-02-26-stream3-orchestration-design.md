# Stream 3: Orchestration Layer — Implementation Design

**Date:** 2026-02-26
**Status:** Approved
**Depends on:** Streams 0-2 complete (910 tests, all passing)
**Branch:** `feat/module-system`

---

## Goal

Integrate the PM module with Claude Code for agent-driven project execution. All deterministic logic lives in brain pm CLI commands. The orchestrator skill is a lean ~50-line SKILL.md that calls CLI commands and acts on JSON output. Shell hooks are thin one-line wrappers around CLI commands.

## Design Principles

1. **Deterministic logic in code** — Routing, template rendering, worktree budget, session tracking are all TypeScript functions with unit tests. No agentic guesswork for mechanical operations.
2. **Activation gating** — `BRAIN_PM_ORCHESTRATE=1` env var enables the orchestration flow. All hooks fast-exit when unset. Set automatically when an active project exists, or manually via `/orchestrator`.
3. **Minimal agentic expectations** — The skill tells the agent what CLI commands to run and how to interpret JSON output. No multi-step reasoning chains for routine dispatch.
4. **Stable context windows** — Lean skill (~50 lines loaded into context). Reference docs are NOT loaded — the CLI commands encapsulate their logic.
5. **One install command** — `brain pm install-hooks` writes hooks, skill, and validates setup. Idempotent.

---

## Architecture

```
┌────────────────────────────────────────────────────┐
│  Claude Code Session                                │
│                                                     │
│  ┌───────────────────────────────────────────────┐ │
│  │  Orchestrator Skill (SKILL.md, ~50 lines)      │ │
│  │  Reads JSON from CLI, spawns agents, presents  │ │
│  └──────────────────┬────────────────────────────┘ │
│                     │ calls                         │
│  ┌──────────────────▼────────────────────────────┐ │
│  │  brain pm orchestrate ...                      │ │
│  │  session-start, route, render, worktree,       │ │
│  │  session-end                                   │ │
│  └──────────────────┬────────────────────────────┘ │
│                     │ delegates to                  │
│  ┌──────────────────▼────────────────────────────┐ │
│  │  brain pm (existing)                           │ │
│  │  briefing, next, dispatch, complete, verify,   │ │
│  │  waves, task, decision                         │ │
│  └──────────────────┬────────────────────────────┘ │
│                     │                               │
│  ┌──────────────────▼────────────────────────────┐ │
│  │  Brain Core (SQLite, notes, search, memory)    │ │
│  └───────────────────────────────────────────────┘ │
│                                                     │
│  Hooks (thin wrappers):                             │
│  SessionStart  → brain pm orchestrate session-start │
│  PreToolUse    → brain pm orchestrate worktree check│
│  SubagentStop  → brain pm orchestrate agent-done    │
└────────────────────────────────────────────────────┘
```

---

## Activation Gate

All orchestration hooks and commands gate on `BRAIN_PM_ORCHESTRATE=1`:

```bash
#!/bin/bash
# Every hook starts with this guard
[ -z "$BRAIN_PM_ORCHESTRATE" ] && exit 0
```

The env var is set by:
1. **SessionStart hook**: If `getActiveProject()` returns a project, set `BRAIN_PM_ORCHESTRATE=1` via `CLAUDE_ENV_FILE`
2. **Manual**: User invokes `/orchestrator` which sets the var for the session
3. **Never persisted**: Only lives for the duration of a Claude Code session

---

## New CLI Commands

### `brain pm orchestrate` subcommand group

All commands under `brain pm orchestrate` are the orchestration layer's internal API. They are called by hooks and the skill, not directly by humans (though they can be for debugging).

#### `session-start`

**Input:** stdin JSON from SessionStart hook (contains `session_id`, `transcript_path`)
**Output:** Env var exports written to stdout (for `CLAUDE_ENV_FILE`)
**Side effects:** Records session activity in brain

```
1. Read stdin JSON (session_id, transcript_path)
2. Check getActiveProject(db) — if null, exit 0 (no orchestration)
3. Write activity: { type: 'session_start', session_id, module: 'pm' }
4. Output to stdout:
   export BRAIN_PM_ORCHESTRATE=1
   export BRAIN_PM_SESSION=<session_id>
   export BRAIN_PM_TRANSCRIPT=<transcript_path>
```

#### `route <display-id> [--json]`

**Input:** Task display ID
**Output:** Routing decision JSON
**Pure function:** No side effects, no DB writes

```json
{
  "displayId": "WEB-01.03",
  "category": "implementation",
  "mode": "agent",
  "agentType": "general-purpose",
  "model": "opus",
  "isolation": "worktree",
  "verify": true,
  "concurrency": "sequential-within-workstream"
}
```

Routing table (hardcoded, deterministic):

| Category | Mode | Agent Type | Model | Isolation | Verify |
|----------|------|-----------|-------|-----------|--------|
| implementation | agent | general-purpose | opus | worktree | true |
| research | agent | Explore | sonnet | none | false |
| validation | agent | general-purpose | haiku | none | false |
| configuration | agent | general-purpose | haiku | worktree-if-edits | false |
| design | agent | general-purpose | opus | none | false |
| review | agent | Explore | sonnet | none | false |
| documentation | agent | general-purpose | sonnet | worktree-if-edits | false |
| migration | agent | general-purpose | opus | worktree | true |
| any | assisted | (human-guided) | N/A | N/A | false |
| any | human | (human-only) | N/A | N/A | false |

#### `render <display-id> [--json]`

**Input:** Task display ID
**Output:** Complete agent dispatch prompt (markdown string, or JSON with prompt + metadata)
**Side effects:** None (reads context bundle from dispatch engine)

Internally calls `assembleContext()` for the context bundle, then renders through a TypeScript template:

```markdown
# Task ${displayId}: ${name}

You are executing a project task. Follow these instructions precisely.

## Context
${dependencies}
${decisions}

## Instructions
${prompt from prompt note}

## Validation Criteria
${category-specific checks from routing}

## Status Reporting
Report significant state changes only:
  brain pm task update ${displayId} --msg "PROGRESS: <significant finding>"
  brain pm task update ${displayId} --msg "BLOCKED: <what you need>"

## Worktree
${worktreePath ? `Assigned: ${worktreePath}. Do not write files outside it.` : 'No isolation.'}

## Completion
Do NOT call brain pm complete. The orchestrator handles completion after verification.
Write a summary of your work as the final output.
```

#### `worktree alloc <display-id> [--json]`

**Input:** Task display ID (must be claimed)
**Output:** `{ path, branch, taskId }`
**Side effects:** Creates git worktree, records allocation in db_meta

```
1. Check task is claimed and needs worktree (from routing)
2. Check budget (db_meta 'pm_worktree_allocations')
3. If same workstream has an existing worktree, reuse it
4. Otherwise: git worktree add .claude/worktrees/<branch-name>
5. Record allocation in db_meta
6. Return { path, branch, taskId }
```

#### `worktree check`

**Input:** Reads `BRAIN_PM_WORKTREE` env var + tool input from stdin
**Output:** Exit 0 (OK) or exit 1 (mismatch, blocks tool call)
**Used by:** PreToolUse hook

```
1. If BRAIN_PM_WORKTREE not set → exit 0 (not a PM agent)
2. Read tool input from stdin (file path being modified)
3. If file path starts with $BRAIN_PM_WORKTREE → exit 0
4. Otherwise → stderr "WORKTREE MISMATCH" + exit 1
```

#### `worktree release <display-id> [--json]`

**Input:** Task display ID
**Output:** `{ released: true, path }`
**Side effects:** Removes allocation from db_meta. Does NOT delete the worktree (orchestrator decides cleanup).

#### `worktree status [--json]`

**Input:** None
**Output:** Current allocations + budget info

```json
{
  "budget": { "max": 3, "used": 1, "available": 2 },
  "allocations": [
    { "taskId": "WEB-01.03", "workstream": "01", "path": ".claude/worktrees/web-01-auth", "branch": "feat/web-01-auth" }
  ]
}
```

#### `agent-done`

**Input:** stdin JSON from SubagentStop hook (contains `agent_id`, `agent_transcript_path`)
**Output:** None (logs to brain)
**Side effects:** Records agent transcript path in activity metadata for later enrichment

#### `session-end [--json]`

**Input:** None (reads from brain)
**Output:** Session summary

```json
{
  "session": "uuid",
  "tasksCompleted": ["WEB-01.01", "WEB-02.01"],
  "tasksInProgress": ["WEB-01.02"],
  "decisionsRecorded": 2,
  "cost": { "total": "$3.42", "byModel": { "opus": "$2.80", "sonnet": "$0.62" } },
  "nextEligible": ["WEB-01.03", "WEB-02.02"]
}
```

### `brain pm install-hooks [--remove]`

Writes/removes hook scripts and skill files:

**Install:**
1. Write `~/.claude/hooks/brain-pm-session.sh` (SessionStart wrapper)
2. Write `~/.claude/hooks/brain-pm-worktree.sh` (PreToolUse wrapper)
3. Write `~/.claude/hooks/brain-pm-agent-done.sh` (SubagentStop wrapper)
4. Register hooks in `~/.claude/settings.json` (merge into existing hooks array)
5. Write `~/.claude/skills/orchestrator/SKILL.md`
6. Validate brain CLI is accessible
7. Print success message with activation instructions

**Remove:**
1. Remove hook scripts
2. Remove hook entries from settings.json
3. Remove skill directory
4. Print confirmation

**Idempotent:** Safe to run multiple times. Overwrites existing files.

---

## Worktree Safety: Full 3-Layer Defense

### Layer 1: Budget Allocation (brain pm orchestrate worktree alloc)

State stored in `db_meta` table as JSON under key `pm_worktree_allocations`:

```typescript
interface WorktreeAllocation {
  taskId: string;
  workstream: string;
  claimToken: string;
  path: string;
  branch: string;
  allocatedAt: string;
}
```

**Invariant:** No two allocations share the same path. Enforced at allocation time.

Budget stored in project metadata (`wip_limit` or dedicated `worktree_budget` field). Default: 3.

**Workstream reuse:** If workstream `01` already has an allocated worktree and the new task is in workstream `01`, reuse that worktree (sequential within workstream).

### Layer 2: PreToolUse Hook (brain pm orchestrate worktree check)

Runs on every Bash/Write/Edit tool call. Zero overhead when `BRAIN_PM_ORCHESTRATE` is unset (fast-exit in shell before invoking brain CLI).

When active, compares the tool's target file path against `BRAIN_PM_WORKTREE`. Blocks writes outside the assigned worktree.

### Layer 3: Pre-Dispatch Validation (in worktree alloc)

Before allocating a worktree, checks:
1. No other claimed task uses the target path
2. Worktree exists and is clean (`git status --porcelain` is empty)
3. Budget not exceeded

---

## Session Lifecycle

### Session Start Flow

```
Claude Code starts
  → SessionStart hook fires
  → ~/.claude/hooks/brain-pm-session.sh
  → brain pm orchestrate session-start < /dev/stdin
    → Reads { session_id, transcript_path }
    → Checks getActiveProject(db)
    → If project exists:
      - BRAIN_PM_ORCHESTRATE=1 → CLAUDE_ENV_FILE
      - BRAIN_PM_SESSION=<id> → CLAUDE_ENV_FILE
      - Records session_start activity
    → If no project: exit 0 (no env vars, orchestration stays off)
```

### Dispatch Flow (in the skill)

```
Skill reads briefing → presents to human → human approves dispatch
  → brain pm task claim <id> --json → { claimToken }
  → brain pm orchestrate route <id> --json → { model, isolation, ... }
  → If isolation=worktree:
    brain pm orchestrate worktree alloc <id> --json → { path, branch }
  → brain pm task start <id> --token <claimToken>
  → brain pm orchestrate render <id> --json → { prompt }
  → Spawn Task tool with { prompt, model, subagent_type, run_in_background }
  → Track in-flight: { taskId, claimToken, model, worktreePath }
```

### Completion Flow

```
Agent completes (SubagentStop hook fires)
  → brain pm orchestrate agent-done < /dev/stdin
  → Skill detects completion
  → If routing.verify:
    → Spawn verification agent (Haiku, same worktree, read-only)
    → On pass: brain pm complete <id> --token <token> --summary "..."
    → On fail: task reverts to pending (new claim cycle)
  → Else:
    → brain pm complete <id> --token <token> --summary "..."
  → brain pm orchestrate worktree release <id>
  → Check newly eligible tasks
```

### Session End

```
Human says goodbye or session times out
  → brain pm orchestrate session-end --json
  → Summary: completed, in-progress, decisions, cost, next eligible
  → Clean up stale claims (>10min without start)
```

---

## Orchestrator Skill (SKILL.md)

```markdown
# Project Orchestrator

Manage project execution through brain PM. All state lives in brain.

## Activation
This skill activates when BRAIN_PM_ORCHESTRATE=1 is set (auto-detected on session start
when an active PM project exists). If not set, tell the user to run `brain pm use <PREFIX>`.

## Session Start
1. Run `brain pm briefing --json` and present a human-friendly summary
2. Show eligible tasks, in-progress work, recent decisions, cost since last session
3. Recommend first action (review tasks first, then blocking tasks, then by priority)

## Task Dispatch
1. `brain pm task claim <id> --json` → get claim token
2. `brain pm orchestrate route <id> --json` → get routing (model, isolation, verify)
3. If worktree needed: `brain pm orchestrate worktree alloc <id> --json`
4. `brain pm task start <id> --token <token>`
5. `brain pm orchestrate render <id> --json` → get agent prompt
6. Spawn agent via Task tool with the rendered prompt, model from routing

## After Task Completion
1. If routing said verify=true, spawn verification agent first
2. `brain pm complete <id> --token <token> --summary "..."`
3. `brain pm orchestrate worktree release <id>` if worktree was used
4. Check output for newly eligible tasks
5. Recommend next action

## Parallel Agents
- Run agent tasks in background (run_in_background: true)
- Surface completed agent work at natural break points (between human tasks)
- Max concurrent: respect project's worktree budget
- Human can say "pause agents" to stop auto-dispatch

## Key Commands
- `brain pm briefing --json` — session overview
- `brain pm next --json` — ranked eligible tasks
- `brain pm waves --json` — dependency wave groups
- `brain pm orchestrate route <id> --json` — routing decision
- `brain pm orchestrate render <id> --json` — agent prompt
- `brain pm complete <id> --token <token> --summary "..."` — mark done
- `brain pm verify <id> --json` — verification plan
```

---

## New Files

### Source Files

| File | Purpose | Tests |
|------|---------|-------|
| `src/modules/pm/engine/routing.ts` | Pure routing function: category+mode → dispatch params | `routing.test.ts` |
| `src/modules/pm/engine/template.ts` | Agent prompt template renderer | `template.test.ts` |
| `src/modules/pm/engine/worktree.ts` | Worktree budget: alloc, check, release, status | `worktree.test.ts` |
| `src/modules/pm/commands/orchestrate.ts` | `brain pm orchestrate` command group (8 subcommands) | Integration test |
| `src/modules/pm/commands/install-hooks.ts` | `brain pm install-hooks` command | `install-hooks.test.ts` |

### Generated Files (by install-hooks)

| File | Purpose |
|------|---------|
| `~/.claude/hooks/brain-pm-session.sh` | SessionStart hook (1 line) |
| `~/.claude/hooks/brain-pm-worktree.sh` | PreToolUse hook (2 lines) |
| `~/.claude/hooks/brain-pm-agent-done.sh` | SubagentStop hook (1 line) |
| `~/.claude/skills/orchestrator/SKILL.md` | Orchestrator skill (~50 lines) |

### Test Files

| File | Purpose |
|------|---------|
| `__tests__/modules/pm/routing.test.ts` | All routing table combinations |
| `__tests__/modules/pm/template.test.ts` | Template rendering with various bundles |
| `__tests__/modules/pm/worktree.test.ts` | Budget alloc/release/check/reuse |
| `__tests__/modules/pm/install-hooks.test.ts` | Hook file generation, settings.json merge |
| `__tests__/integration/pm/wave-9-orchestrate.test.ts` | V8-V9 gate tests |

---

## Verification Strategy (V8-V10)

### V8: Orchestrator Dry Run

- Create project with tasks in various states
- Call routing for each → verify correct model/isolation assignment
- Call render → verify prompt contains context, deps, decisions
- Call worktree alloc → verify budget enforcement
- No actual agent spawning

### V9: Session Lifecycle

- Simulate session-start → verify env vars and activity recorded
- Simulate claim → start → complete cycle → verify state transitions
- Simulate worktree alloc → check → release → verify budget tracking
- Simulate session-end → verify summary output

### V10: End-to-End (Manual/Scripted)

1. `brain pm install-hooks` → hooks registered
2. Start Claude Code session → SessionStart hook fires, env set
3. `/orchestrator` → briefing presented
4. Dispatch one task → agent runs → verification → completion
5. `brain pm orchestrate session-end --json` → summary

---

## Implementation Waves

| Wave | Tasks | Delivers |
|------|-------|----------|
| 1 | Routing engine + template renderer | Pure functions, fully tested |
| 2 | Worktree budget engine | Alloc/check/release/status, db_meta storage |
| 3 | Orchestrate commands | All 8 subcommands wired up |
| 4 | Install-hooks command | Hook generation, settings merge, skill install |
| 5 | Integration tests (V8-V9) | Gate tests for production readiness |

---

## Key Differences from Doc 03

| Topic | Doc 03 (Original) | This Design |
|-------|-------------------|-------------|
| Routing | Logic in skill | Logic in TypeScript CLI (`brain pm orchestrate route`) |
| Template | Markdown file in skill dir | TypeScript string interpolation in `template.ts` |
| Worktree tracking | Session memory | `db_meta` table (persists across sessions) |
| Hook complexity | Multi-line shell scripts | One-line wrappers calling brain CLI |
| Activation | Implicit (skill loaded) | Explicit env var `BRAIN_PM_ORCHESTRATE` |
| Install | Manual setup | `brain pm install-hooks` command |
| Adaptive automation | In skill logic | Deferred to v2 (start with assisted only) |

### Deferred to v2

- **Autonomous mode**: Start with assisted-only. Autonomous dispatch adds complexity without proven value yet.
- **Retroactive decision discovery**: Analyzing transcripts for undocumented decisions.
- **Token enrichment from transcripts**: `brain pm audit enrich` parsing agent transcripts for token counts.
- **JIT context push**: Mid-flight context updates to running agents.
