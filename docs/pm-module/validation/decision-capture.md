# Decision Capture Validation Checklist

## Prerequisites

- [ ] Active project with at least 2 tasks where one depends on the other:
  - `TASK_A` (dependency): `done` or `in-progress`
  - `TASK_B` (dependent): `pending`, listed in `TASK_A`'s dependents or vice versa
- [ ] `brain pm use <PREFIX>` has been run to set the active project
- [ ] Confirm tasks: `brain pm task list --project <PREFIX> --json`

---

## Steps

### Step 1: Record a Decision

**Do:** Run:
```
brain pm decision add "Use REST API instead of GraphQL" \
  --project <PREFIX> \
  --source-task <TASK_A_ID>
```

**Expect:** Output prints the new decision's display ID (`<PREFIX>-D01`) and status line, e.g.:
```
<PREFIX>-D01 - proposed from <TASK_A_ID>
```
Exit code is 0.

- [ ] PASS / FAIL

### Step 2: Verify Decision Storage

**Do:** Run `brain pm decision show <PREFIX>-D01 --json`

**Expect:** JSON output contains:
- `display_id: "<PREFIX>-D01"`
- `status: "proposed"` (default status on creation)
- `source_task: "<TASK_A_ID>"`
- `project: "<PREFIX>"`
- `name` matching the text you provided

- [ ] PASS / FAIL

### Step 3: List All Project Decisions

**Do:** Run `brain pm decision list --project <PREFIX> --json`

**Expect:** Array contains at least one entry with the decision you just created. Each entry
includes `display_id`, `status`, `source_task`, and `project` fields.

- [ ] PASS / FAIL

### Step 4: Link Decision to an Impacted Task

**Do:** Create a new decision (or supersede the current one) that explicitly impacts `TASK_B`:
```
brain pm decision add "Use REST API instead of GraphQL" \
  --project <PREFIX> \
  --source-task <TASK_A_ID> \
  --impacts <TASK_B_ID>
```

Note: `--impacts` takes one or more display IDs of tasks that are affected by this decision.

**Expect:** New decision created (e.g., `<PREFIX>-D02`) with `impacts` field containing
`<TASK_B_ID>`. Confirm with `brain pm decision show <PREFIX>-D02 --json`.

- [ ] PASS / FAIL

### Step 5: Verify Decision Appears in Context Bundle for Impacted Task

**Do:** Run `brain pm context <TASK_B_ID> --json`

**Expect:** JSON bundle's `decisions` array contains the decision that impacts `TASK_B`:
```json
{
  "decisions": [
    {
      "displayId": "<PREFIX>-D02",
      "status": "proposed",
      "content": "Use REST API instead of GraphQL"
    }
  ]
}
```
A decision without `<TASK_B_ID>` in its `impacts` does NOT appear here.

- [ ] PASS / FAIL

### Step 6: Verify Agent Prompt Includes the Decision

**Do:** Run `brain pm orchestrate render <TASK_B_ID> --json` and inspect the `prompt` field.

**Expect:** The rendered prompt text contains a "Relevant Decisions" section (or equivalent)
that lists the decision content. The agent dispatched for `TASK_B` will receive this context
automatically.

- [ ] PASS / FAIL

### Step 7: Supersede the Decision

**Do:** Run:
```
brain pm decision supersede <PREFIX>-D02 "Use GraphQL with REST fallback"
```

**Expect:** Output shows:
```
Superseded <PREFIX>-D02 -> <PREFIX>-D03
```
The old decision (`<PREFIX>-D02`) is now `status: "superseded"`. The new decision (`<PREFIX>-D03`)
is `status: "proposed"` and inherits the same `source_task` and `project`.

- [ ] PASS / FAIL

### Step 8: Verify Supersession Chain

**Do:** Run:
```
brain pm decision show <PREFIX>-D02 --json
brain pm decision show <PREFIX>-D03 --json
```

**Expect:**
- `D02` shows `status: "superseded"`
- `D03` shows `status: "proposed"` with `name: "Use GraphQL with REST fallback"`
- Both share the same `source_task` and `project`

- [ ] PASS / FAIL

### Step 9: Verify Updated Context for Impacted Task

**Do:** Run `brain pm context <TASK_B_ID> --json` again.

**Expect:** The `decisions` array now reflects the new decision (`<PREFIX>-D03`) rather than the
superseded one, because `findImpactingDecisions` scans decisions by `impacts` field, and only
non-superseded decisions appear in the relevant context. The `contextHash` has changed from Step 5.

- [ ] PASS / FAIL

---

## Troubleshooting

**`brain pm decision add` fails with "missing required option":**
- Both `--project` and `--source-task` are required flags
- The decision text (`<name>`) is a positional argument (first positional after `add`)
- Full syntax: `brain pm decision add "Text here" --project PREFIX --source-task TASK_ID`

**Decision does not appear in `brain pm context <TASK_B_ID>`:**
- Only decisions with `<TASK_B_ID>` in their `impacts` array are included
- Confirm: `brain pm decision show <DECISION_ID> --json` and check `impacts` field
- The `source_task` alone does not cause a decision to appear in a different task's context;
  `--impacts` must be explicitly set

**`brain pm decision supersede` says decision not found:**
- Decision display IDs are case-sensitive and uppercase (e.g., `WEB-D01`)
- Confirm the ID exists: `brain pm decision list --project <PREFIX> --json`
- The `supersede` command takes `<old-id>` then `<new-name>` as positional arguments:
  `brain pm decision supersede WEB-D01 "New decision name"`

**Context hash is identical before and after adding a decision:**
- The hash is computed from task metadata, dependencies, decisions, and prompt content
- If the decision was not linked via `--impacts`, it does not affect the hash
- Confirm the decision appears in `brain pm context <TASK_B_ID> --json` `decisions` array

**`brain pm decision list` returns "No decisions found":**
- `--project` flag is required and must match the project prefix exactly
- Prefix is stored uppercase; if you used lowercase, it is still uppercased internally
- Confirm at least one decision exists: `brain pm decision show <PREFIX>-D01 --json`
