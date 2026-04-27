# PM Module Demo: Build a CLI Todo App

End-to-end walkthrough of the PM module managing a small project from initialization through
completion. Every command is verified against the source files in `src/modules/pm/commands/`.
This document is the basis for automated integration tests in Wave 3.

## Scenario

You are starting a new project: a CLI Todo App. The work breaks naturally into two tracks:
core implementation and testing/documentation. Tasks depend on each other, so the wave engine
will sequence them automatically.

---

## Step 1 — Initialize the project

Create the project with a short prefix, then set it as the active context for subsequent commands.

```
$ brain pm init "CLI Todo App" --prefix TODO
TODO - TODO (active)

$ brain pm use TODO
Active project set to TODO
```

`brain pm init` accepts the project name as a positional argument and requires `--prefix`.
`brain pm use` sets the active project so later commands can omit `--project`.

---

## Step 2 — Create workstreams

Workstreams group related tasks. Here we create two: one for core implementation and one for
testing and documentation.

```
$ brain pm workstream add "Core Implementation" --project TODO
TODO-01 - TODO #1 (active)

$ brain pm workstream add "Testing & Docs" --project TODO
TODO-02 - TODO #2 (active)
```

The display ID format is `PREFIX-NN` where `NN` is the two-digit workstream number.

---

## Step 3 — Add tasks with dependencies

Tasks are added with `--project` and `--workstream` (both required). Dependencies are declared
at creation time with `--depends-on`. The display ID format for tasks is `PREFIX-WW.TT`.

```
$ brain pm task add "Design data model" \
    --project TODO --workstream 1 \
    --category design --priority high --mode agent
TODO-01.01 - pending [high] (agent)

$ brain pm task add "Implement CRUD operations" \
    --project TODO --workstream 1 \
    --category implementation --priority high --mode agent \
    --depends-on TODO-01.01
TODO-01.02 - pending [high] (agent)

$ brain pm task add "Add CLI interface" \
    --project TODO --workstream 1 \
    --category implementation --priority medium --mode agent \
    --depends-on TODO-01.02
TODO-01.03 - pending [medium] (agent)

$ brain pm task add "Write unit tests" \
    --project TODO --workstream 2 \
    --category testing --priority high --mode agent \
    --depends-on TODO-01.02
TODO-02.01 - pending [high] (agent)

$ brain pm task add "Write integration tests" \
    --project TODO --workstream 2 \
    --category testing --priority medium --mode agent \
    --depends-on TODO-01.03 --depends-on TODO-02.01
TODO-02.02 - pending [medium] (agent)

$ brain pm task add "Write README" \
    --project TODO --workstream 2 \
    --category documentation --priority low --mode agent \
    --depends-on TODO-02.02
TODO-02.03 - pending [low] (agent)
```

`--depends-on` accepts one or more display IDs. Pass the flag multiple times for multiple
dependencies. The dependency chain is: design → CRUD → (CLI interface, unit tests) →
integration tests → README.

---

## Step 4 — View the wave plan

The wave engine performs a topological sort of all pending tasks and groups them by the
earliest wave they can execute. Tasks in the same wave have no interdependencies and can
run in parallel.

```
$ brain pm waves
Wave 1: TODO-01.01
Wave 2: TODO-01.02
Wave 3: TODO-01.03, TODO-02.01
Wave 4: TODO-02.02
Wave 5: TODO-02.03
```

Wave 1 contains only the first task because everything else depends on it directly or
transitively. Once Wave 1 completes, Wave 2 becomes eligible, and so on.

---

## Step 5 — Get the session briefing

Before starting work, `brain pm briefing` gives a full snapshot of project state: task
counts by status, eligible tasks ready to pick up, any blocked tasks, recent decisions,
and recommended next actions.

```
$ brain pm briefing
=== Briefing: TODO ===
Status: active

Tasks: 6 total
  Done: 0
  In-progress: 0
  Eligible: 1 (TODO-01.01)
  Blocked: 0
  Pending: 5

Recommended actions:
  -> Pick up eligible task: TODO-01.01
```

Only `TODO-01.01` is eligible because all other tasks have unsatisfied dependencies.

---

## Step 6 — Claim and start the first task

The claim/start flow prevents two agents from picking up the same task simultaneously.
`task claim` transitions the task from `pending` to `claimed` and returns a token.
`task start` validates the token and transitions to `in-progress`.

```
$ brain pm task claim TODO-01.01 --json
{
  "display_id": "TODO-01.01",
  "status": "claimed",
  "token": "clm_a3f9b2e1d4c7"
}

$ brain pm task start TODO-01.01 --token clm_a3f9b2e1d4c7
TODO-01.01 - in-progress [high] (agent)
```

The token is a short hash derived from the claim. Pass it to `task start` to prove
ownership. Any other process attempting to start the task without the correct token will
receive an error.

---

## Step 7 — Get routing for the task

`brain pm orchestrate route` computes how the task should be executed: which agent type,
which model, whether to run in an isolated worktree, and whether a verification pass is
needed.

```
$ brain pm orchestrate route TODO-01.01
Task: TODO-01.01
Agent: code
Model: claude-opus-4-6
Isolation: worktree
Verify: true
Concurrency: 1
```

Routing is determined by the task's `category` and `mode` fields. A `design` task in
`agent` mode routes to the `code` agent with full isolation.

---

## Step 8 — Assemble task context

`brain pm context` assembles the full context bundle for an agent: task metadata,
dependency summaries, recorded decisions, and the task prompt if one exists.

```
$ brain pm context TODO-01.01
Task: TODO-01.01
Status: in-progress
Category: design
Priority: high

Context hash: sha256:7a3b...
```

With `--json`, the output is a structured bundle suitable for feeding directly into an
agent invocation:

```
$ brain pm context TODO-01.01 --json
{
  "task": {
    "display_id": "TODO-01.01",
    "status": "in-progress",
    "category": "design",
    "priority": "high",
    "mode": "agent"
  },
  "dependencies": [],
  "decisions": [],
  "contextHash": "sha256:7a3b..."
}
```

`TODO-01.01` has no dependencies and no prior decisions, so both arrays are empty.
Downstream tasks will see populated `dependencies` arrays once upstream tasks complete.

---

## Step 9 — Record a decision during execution

Architectural decisions made during task execution are recorded with `decision add`.
They are linked to the source task and optionally to impacted tasks.

```
$ brain pm decision add "Use SQLite for storage" \
    --project TODO --source-task TODO-01.01
TODO-D01 - open from TODO-01.01
```

Decisions surface in the briefing and in the context bundle for dependent tasks, so
downstream agents know which architectural choices have already been made.

To list all decisions for the project:

```
$ brain pm decision list --project TODO
TODO-D01 - open from TODO-01.01
```

---

## Step 10 — Complete the task

`task done` marks the task as done and reports which tasks are now newly eligible.

```
$ brain pm task done TODO-01.01
TODO-01.01 - done [high] (agent)
```

Alternatively, `brain pm complete` records the completion in the activity log and
performs impact analysis in one step:

```
$ brain pm complete TODO-01.01 --summary "Defined schema: items(id, text, done, created_at)"
Completed TODO-01.01
Newly eligible: TODO-01.02
```

`TODO-01.02` becomes eligible because its only dependency (`TODO-01.01`) is now done.

---

## Step 11 — Check what is next

`brain pm next` lists all tasks whose dependencies are fully satisfied and whose status
is `pending` — i.e. tasks ready to be picked up.

```
$ brain pm next
TODO-01.02  high
```

Only `TODO-01.02` is shown. `TODO-01.03`, `TODO-02.01`, `TODO-02.02`, and `TODO-02.03`
all have unsatisfied dependencies further down the chain.

---

## Step 12 — Run the audit

`audit summary` gives a count of all PM activity records, grouped by activity type.
This tracks task completions, agent invocations, and other recorded events.

```
$ brain pm audit summary --project TODO
Total: 1, Completed: 1, Failed: 0
  task_completed: 1
```

For cost visibility after agent runs:

```
$ brain pm audit cost --project TODO
Total tokens: 0
Estimated cost: $0.0000
```

Token data is added post-hoc via `audit enrich` after agent execution telemetry is
available.

---

## Step 13 — End the session

`brain pm orchestrate session-end` prints a final summary of task status and worktree
allocations. Use this at the end of a work session to confirm state before closing.

```
$ brain pm orchestrate session-end
=== Session End: TODO ===
Tasks: 1 done, 0 in-progress, 5 pending, 0 blocked (6 total)
Worktrees: 0/4 in use
```

---

## Summary of Commands

| Step | Command | Purpose |
|------|---------|---------|
| 1 | `brain pm init "CLI Todo App" --prefix TODO` | Create project |
| 1 | `brain pm use TODO` | Set active project |
| 2 | `brain pm workstream add "Core Implementation" --project TODO` | Create workstream |
| 3 | `brain pm task add "Design data model" --project TODO --workstream 1 --category design --priority high --mode agent` | Add task |
| 3 | `brain pm task add "Implement CRUD operations" --project TODO --workstream 1 --category implementation --priority high --mode agent --depends-on TODO-01.01` | Add task with dependency |
| 4 | `brain pm waves` | View wave groupings |
| 5 | `brain pm briefing` | Session overview |
| 6 | `brain pm task claim TODO-01.01 --json` | Claim task, get token |
| 6 | `brain pm task start TODO-01.01 --token <TOKEN>` | Start claimed task |
| 7 | `brain pm orchestrate route TODO-01.01` | Compute routing |
| 8 | `brain pm context TODO-01.01 --json` | Assemble context bundle |
| 9 | `brain pm decision add "Use SQLite for storage" --project TODO --source-task TODO-01.01` | Record decision |
| 10 | `brain pm complete TODO-01.01 --summary "..."` | Complete with impact analysis |
| 11 | `brain pm next` | List eligible tasks |
| 12 | `brain pm audit summary --project TODO` | Activity summary |
| 13 | `brain pm orchestrate session-end` | End session |

---

## Key Concepts

**Display ID format:** `PREFIX-WW.TT` — prefix, two-digit workstream number, two-digit task number.
Examples: `TODO-01.01`, `TODO-02.03`.

**Dependency declaration:** Use `--depends-on` on `task add`. Pass the flag multiple times for
multiple dependencies. Dependencies cannot be added or modified after task creation via the CLI.

**Wave computation:** The wave engine uses topological sort on the dependency graph of all
non-done tasks. Tasks in Wave 1 are eligible immediately. Completing a task may promote
tasks in later waves to Wave 1.

**Claim tokens:** Short-lived identifiers that bind a task claim to a specific agent. Prevents
two parallel agents from executing the same task. Format: `clm_<hex>`.

**Context hash:** A hash of the task's full context bundle (metadata + deps + decisions).
Changes when any input changes, enabling cache invalidation.
