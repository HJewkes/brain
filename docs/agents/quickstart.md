# Agent Module Quick Start

The agent module tracks Claude agent instances throughout their lifecycle — from registration through completion. Each agent gets a unique ID, an isolated git worktree, file ownership claims, and a PM task association. The done-handler hook automatically updates PM state and captures artifacts when an agent exits.

## Prerequisites

- brain initialized with PM module active
- A PM task to work on (see [PM Quick Start](../pm-module/quickstart.md))

---

## 1. What Problem It Solves

When multiple agents run in parallel, it's easy to lose track of which agent is doing what, which files it owns, and whether it completed successfully. The agent module provides a persistent registry so you can audit every agent run, trace cost, and ensure PM tasks are updated when work finishes — even across restarts.

---

## 2. Register an Agent

Register an agent before spawning it. Provide a name, the PM task ID, and file ownership:

```bash
brain agent register \
  --name "Implement search" \
  --task MY-01-003 \
  --branch feat/search \
  --ownership "src/services/search.ts,src/commands/search.ts"
```

Output:

```
Agent registered: ag_7f3b2a1c
Branch: feat/search
Worktree: /path/to/repo/.worktrees/feat-search
```

---

## 3. List Active Agents

```bash
brain agent list --status active
```

Output:

```
ag_7f3b2a1c  Implement search  active   MY-01-003  feat/search
ag_2e9c4d5f  Write tests       pending  MY-02-001  feat/tests
```

Filter by status: `pending` | `active` | `completed` | `failed` | `abandoned`

---

## 4. Show Agent Detail

```bash
brain agent show ag_7f3b2a1c
```

Output:

```
ID:          ag_7f3b2a1c
Name:        Implement search
Status:      active
Task:        MY-01-003
Branch:      feat/search
Worktree:    /path/to/repo/.worktrees/feat-search
Ownership:   src/services/search.ts, src/commands/search.ts
Started:     2026-04-27T10:00:00Z
PID:         45231
```

---

## 5. Agent Lifecycle

Agents move through these states:

```
pending → active → completed
                 → failed
                 → abandoned
```

State transitions happen automatically when:
- Agent process starts → `active`
- Agent exits with code 0 → `completed` (done-handler fires)
- Agent exits with non-zero → `failed`
- Agent is manually stopped → `abandoned`

---

## 6. What Happens on Completion

When the `agent-done` hook fires, the done-handler (`src/modules/agents/agent-done-handler.ts`):

1. Marks the agent `completed` in the registry
2. Releases its worktree allocation
3. Links any commits and PRs as artifacts
4. Marks the PM task done (if the agent held a claim token)

---

## 7. Migrate Legacy Agents

If you have agents recorded in the old `ao.yaml` format:

```bash
brain agent migrate-ao
```

---

## How It Works

Agent records are stored in SQLite via `src/modules/agents/data.ts`. Each agent holds a `claim_token` from the PM module — this token is what authorizes the agent to transition its task to `done`. Worktree allocation is managed by `src/modules/agents/worktree.ts` and bounded by the `worktreeBudget` setting in `ao.config.json`.

---

## Related

- Agent CRUD: `src/modules/agents/data.ts`
- Worktree allocation: `src/modules/agents/worktree.ts`
- Done-handler: `src/modules/agents/agent-done-handler.ts`
- MCP tools: `brain_agent_list`, `brain_agent_status`, `brain_agent_dispatch`
