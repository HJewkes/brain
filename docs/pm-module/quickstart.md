# PM Module Quick Start

Get up and running with brain's project management module in 5 minutes.

## Prerequisites

- Node.js 18+
- brain installed (`npm install` in repo root)
- A terminal with `npx tsx src/cli.ts` available (aliased to `brain` below)

---

## 1. Create a Project

`pm init` takes the project name as a positional argument and requires a `--prefix` (2–5 uppercase chars):

```
brain pm init "My App" --prefix MY
```

Output:

```
MY - MY (active)
```

---

## 2. Set It Active

Set the active project context so subsequent commands don't need `--project`:

```
brain pm use MY
```

Output:

```
Active project set to MY
```

---

## 3. Add Workstreams

Workstreams group related tasks. `--project` is required:

```
brain workstream add "Core Features" --project MY
brain workstream add "Testing" --project MY
```

Output (one line per workstream):

```
MY-01 - MY #1 (active)
MY-02 - MY #2 (active)
```

---

## 4. Add Tasks

`--project` and `--workstream <number>` are both required. `--depends-on` accepts one or more display IDs:

```
brain task add "Set up database schema" --project MY --workstream 1 --category implementation --priority high
brain task add "Write unit tests" --project MY --workstream 2 --category testing --priority medium
brain task add "Add API endpoints" --project MY --workstream 1 --category implementation --priority high --depends-on MY-01-001
```

Output (one line per task):

```
MY-01-001 - pending [high] (auto)
MY-02-001 - pending [medium] (auto)
MY-01-002 - pending [high] (auto)
```

Valid values — `--category`: `implementation` `testing` `documentation` `research` `review` `infrastructure` `configuration` `design` `migration` | `--priority`: `critical` `high` `medium` `low` | `--mode`: `auto` (default) `agent` `assisted` `human` `review` `interactive`

---

## 5. View the Wave Plan

Tasks are grouped by dependency wave — wave 1 tasks have no blockers, later waves become eligible as earlier ones complete:

```
brain pm waves
```

Output:

```
Wave 1: MY-01-001, MY-02-001
Wave 2: MY-01-002
```

---

## 6. See What's Ready

List eligible tasks (pending, all dependencies done), ranked by priority:

```
brain pm next
```

Output:

```
MY-01-001  high +ELIGIBLE
MY-02-001  medium +ELIGIBLE
```

---

## 7. Get a Project Briefing

Full state overview — task counts, blocked items, and recommended next actions:

```
brain pm briefing
```

Output:

```
=== Briefing: MY ===
Status: active

Tasks: 3 total
  Done: 0
  In-progress: 0
  Eligible: 2 (MY-01-001, MY-02-001)
  Blocked: 0
  Pending: 1

Recommended actions:
  -> Pick up eligible task: MY-01-001
```

---

## 8. Check for Consistency Issues

After adding tasks and decisions, run a quick health check:

```
brain pm check --json
```

Output (JSON):

```
{
  "project": "MY",
  "summary": { "totalTasks": 3, "issuesFound": 0, ... },
  "structural": { "orphanedDecisions": [], "stalePrompts": [], ... }
}
```

For deeper analysis (decision contradictions, supersession gaps), add `--deep`:

```
brain pm check --deep --json
```

---

## Next Steps

- [User Guide](guide.md) — comprehensive workflow documentation (incl. consistency checking)
- [Demo Workflow](demo.md) — end-to-end scenario walkthrough
- [Command Reference](commands.md) — all commands with examples
