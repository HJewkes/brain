# Orchestrator Walkthrough Validation Checklist

## Prerequisites

- [ ] `brain pm install-hooks` has been run (verify: `~/.claude/hooks/brain-pm-session.sh` exists)
- [ ] Active project exists with at least 3 tasks:
  - 2 tasks in `pending` status
  - 1 task in `blocked` status with a dependency on one of the pending tasks
- [ ] At least one task has `mode: agent` and `category: implementation`
- [ ] Claude Code is not currently open (fresh session required)
- [ ] Confirm active project: `brain pm use <PREFIX>` then `brain pm briefing`

---

## Steps

### Step 1: Trigger SessionStart Hook

**Do:** Open a new Claude Code session in the project directory.

**Expect:** The SessionStart hook fires (`~/.claude/hooks/brain-pm-session.sh`). Claude Code's
environment gains `BRAIN_PM_ORCHESTRATE=1` and `BRAIN_PM_PROJECT=<PREFIX>`. The orchestrator
skill activates and presents a human-readable briefing derived from `brain pm briefing --json`.

- [ ] PASS / FAIL

### Step 2: Verify Session Briefing Content

**Do:** Read the briefing the orchestrator presents at session start.

**Expect:** Briefing includes: project name, task counts (eligible, in-progress, blocked, done),
any recent decisions, and a recommended first action (e.g., "Pick up eligible task: <ID>").

- [ ] PASS / FAIL

### Step 3: Check Eligible Tasks

**Do:** Ask the orchestrator "what tasks are eligible?" or run `brain pm next --json` in a terminal.

**Expect:** Output lists pending tasks whose dependencies are all `done`. The blocked task does
not appear. At least one task appears as `+ELIGIBLE`.

- [ ] PASS / FAIL

### Step 4: Request Route for an Implementation Task

**Do:** Ask the orchestrator to dispatch the next eligible task, or run:
`brain pm orchestrate route <TASK_ID> --json`

**Expect:** JSON output shows `model: "opus"`, `isolation: "worktree"`, `verify: true`,
`concurrency: "sequential-within-workstream"` for an `implementation`-category task.

- [ ] PASS / FAIL

### Step 5: Claim and Start the Task

**Do:** Observe or manually run:
```
brain pm task claim <TASK_ID> --json   # returns token
brain pm orchestrate worktree-alloc <TASK_ID> --json
brain pm task start <TASK_ID> --token <TOKEN>
```

**Expect:** Claim returns a UUID token. Worktree alloc returns a path and branch name.
Task status transitions from `pending` to `in-progress`.

- [ ] PASS / FAIL

### Step 6: Verify Rendered Agent Prompt

**Do:** Run `brain pm orchestrate render <TASK_ID> --json`

**Expect:** JSON contains `prompt` field with a formatted task brief. Prompt includes task name,
instructions, dependency summaries, and any relevant decisions.

- [ ] PASS / FAIL

### Step 7: SubagentStop Hook Fires on Completion

**Do:** After the agent finishes (or simulate by running `brain pm complete <TASK_ID> --token <TOKEN> --summary "Done"`).

**Expect:** `brain pm task show <TASK_ID>` shows status `done`. The `complete` command output
includes a `newlyEligible` list. If the completed task was a dependency of the blocked task,
that task now appears in `brain pm next`.

- [ ] PASS / FAIL

### Step 8: Verification Agent Triggers (Implementation Tasks)

**Do:** Observe whether the orchestrator spawns a verification agent after the implementation
agent completes. Alternatively check routing: `brain pm orchestrate route <TASK_ID> --json`
confirms `verify: true` before dispatch.

**Expect:** Orchestrator skill description states a Haiku verification agent is spawned before
calling `brain pm complete`. Verification prompt uses `--verification` flag:
`brain pm orchestrate render <TASK_ID> --verification`.

- [ ] PASS / FAIL

### Step 9: Dependent Task Unblocks

**Do:** Run `brain pm next --json` after the implementation task completes.

**Expect:** The previously blocked task now appears in the eligible list (status changed from
`blocked` to eligible). Its dependency is listed as `done`.

- [ ] PASS / FAIL

### Step 10: Session End

**Do:** Say "end session" to the orchestrator, or run `brain pm orchestrate session-end --json`.

**Expect:** Output includes: `session: "ended"`, project prefix, task counts (done, in-progress,
pending, blocked, total), and worktree allocation status (used/max).

- [ ] PASS / FAIL

---

## Troubleshooting

**Hook does not fire (BRAIN_PM_ORCHESTRATE not set):**
- Verify hook scripts exist: `ls ~/.claude/hooks/brain-pm-*.sh`
- Verify `~/.claude/settings.json` contains a `SessionStart` hook entry with `brain-pm-session.sh`
- Run `brain pm install-hooks --dry-run` to preview what would be installed
- Reinstall: `brain pm install-hooks`

**"No active project" error at session start:**
- Run `brain pm use <PREFIX>` before opening Claude Code
- Confirm: `brain pm list` shows your project and it has `active` status

**Route returns `sonnet` / `isolation: none` for implementation task:**
- Confirm task has `mode: agent` (not `assisted` or `human`)
- Check: `brain pm task show <TASK_ID> --json` and inspect `mode` and `category` fields
- Non-agent modes use the `NON_AGENT_DEFAULT` routing (sonnet, no isolation, no verify)

**Worktree alloc fails:**
- Check worktree budget: `brain pm orchestrate worktree-status --json`
- Default max is project-configured; if `used >= max`, release a stale allocation first:
  `brain pm orchestrate worktree-release <STALE_TASK_ID>`

**Completion does not unblock dependent tasks:**
- Confirm dependency is declared: `brain pm task show <BLOCKED_ID> --json` and inspect `depends_on`
- Verify completed task's display ID matches the dependency string exactly (case-sensitive uppercase)
