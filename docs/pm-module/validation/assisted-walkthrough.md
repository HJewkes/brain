# Assisted Mode Walkthrough Validation Checklist

## Prerequisites

- [ ] Active project exists with at least one task set to `mode: assisted`
- [ ] The assisted task is in `pending` status with all dependencies `done` (or no dependencies)
- [ ] Hooks installed: `brain pm install-hooks` has been run
- [ ] Claude Code open with active project (`brain pm use <PREFIX>` run beforehand)
- [ ] Confirm task is eligible: `brain pm next --json` includes the assisted task

---

## Steps

### Step 1: Confirm Assisted Task Routing

**Do:** Run `brain pm orchestrate route <TASK_ID> --json` for the assisted task.

**Expect:** JSON shows `agentType: "general-purpose"`, `model: "sonnet"`, `isolation: "none"`,
`verify: false`, `concurrency: "parallel"`. This is the `NON_AGENT_DEFAULT` routing because
`mode: assisted` is not agent-dispatchable (`isAgentDispatchable` returns `false` for non-agent modes).

- [ ] PASS / FAIL

### Step 2: Request Dispatch of Assisted Task

**Do:** Tell the orchestrator "dispatch task <TASK_ID>" or ask it to work on the assisted task.

**Expect:** Orchestrator calls `brain pm dispatch <TASK_ID> --json` (assembles context bundle)
and presents steps to you rather than spawning an autonomous agent. You see the task's
instructions, dependencies, and any relevant decisions in the briefing.

- [ ] PASS / FAIL

### Step 3: Verify Context Bundle Contains Dependencies and Decisions

**Do:** Run `brain pm context <TASK_ID> --json` and examine the output.

**Expect:** JSON bundle has:
- `task` object with `status`, `mode: "assisted"`, `category`, `priority`
- `dependencies` array (each with `displayId`, `name`, `status`, and optionally `summary`)
- `decisions` array listing any decisions that impact this task
- `contextHash` (SHA-256 hash of the bundle contents)

- [ ] PASS / FAIL

### Step 4: Step-by-Step Presentation

**Do:** Ask the orchestrator to walk you through the first step of the task.

**Expect:** Orchestrator presents one discrete step at a time and waits for your confirmation
before proceeding. It offers to automate parts it can handle (e.g., running commands) while
surfacing manual steps for you to complete.

- [ ] PASS / FAIL

### Step 5: Confirm a Step and Observe Progression

**Do:** Confirm the current step (e.g., say "done" or "confirmed, proceed").

**Expect:** Orchestrator acknowledges your confirmation and moves to the next step. It does not
proceed past manual steps without your explicit go-ahead.

- [ ] PASS / FAIL

### Step 6: Record a Decision During Assisted Work

**Do:** During the task, record a decision by running:
```
brain pm decision add "Use postgres over sqlite for production" \
  --project <PREFIX> \
  --source-task <TASK_ID>
```

**Expect:** Output shows the new decision's display ID (e.g., `<PREFIX>-D01`) and status.
Run `brain pm decision show <DECISION_ID>` to confirm the name and `source_task` fields match.

- [ ] PASS / FAIL

### Step 7: Link Decision to Impacted Task

**Do:** If another task will be affected by this decision, supersede or create a new decision
with `--impacts` flag, or check that the decision `source_task` is already correctly set.
Run `brain pm decision list --project <PREFIX> --json` to review.

**Expect:** The decision appears in the list with correct `status` (`accepted`) and
`source_task` pointing to the assisted task.

- [ ] PASS / FAIL

### Step 8: Complete the Assisted Task

**Do:** After all steps are done, tell the orchestrator the task is complete, or run:
```
brain pm complete <TASK_ID> --summary "Completed assisted walkthrough"
```

**Expect:** Task status transitions to `done`. Output shows `Completed <TASK_ID>` and any
`newlyEligible` tasks that were unblocked. Run `brain pm task show <TASK_ID>` to confirm
`status: done`.

- [ ] PASS / FAIL

---

## Troubleshooting

**Assisted task appears in `brain pm next` but orchestrator tries to spawn an agent:**
- Confirm `mode: assisted` in the task file: `brain pm task show <TASK_ID> --json` and check `mode`
- If mode is wrong, update it: `brain pm task update <TASK_ID> --mode assisted`
- Re-index the task file if needed: `brain index`

**Context bundle is empty (no dependencies or decisions):**
- Dependencies: Only tasks that are listed in `depends_on` and exist in the project are included
- Decisions: Only decisions with `impacts` containing this task's display ID are included
- Add an impact link by creating a decision with `--impacts <TASK_ID>` if none exist

**`brain pm dispatch` returns NOT_FOUND:**
- Verify the task ID is correct: `brain pm task list --project <PREFIX>`
- Display IDs are uppercase (e.g., `MYPROJ-01.02`); pass the ID in uppercase

**`brain pm decision add` fails with missing required option:**
- Both `--project` and `--source-task` are required
- The decision text is positional argument `<name>` (first argument after `add`)
- Example: `brain pm decision add "Decision text" --project WEB --source-task WEB-01.02`

**Task does not transition to `done` after complete:**
- Check current status: `brain pm task show <TASK_ID> --json`
- Valid transition to `done` from states: `in-progress`, `pending`, `claimed`
- If task is `blocked`, unblock it first: `brain pm task unblock <TASK_ID>`
