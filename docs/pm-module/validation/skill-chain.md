# Skill Chain Validation Checklist

Tests the end-to-end flow: brainstorming → writing-plans → PM import → task dispatch.

## Prerequisites

- [ ] `brain` CLI installed and on PATH
- [ ] `brain pm install-hooks` has been run
- [ ] The `brainstorming` and `writing-plans` skills are available in `~/.claude/skills/`
- [ ] No active PM project set (or a fresh prefix ready): `brain pm list` shows no active project,
  or you have chosen a prefix that does not yet exist
- [ ] Claude Code open to begin the skill chain

---

## Steps

### Step 1: Invoke the Brainstorming Skill

**Do:** In Claude Code, invoke `/brainstorming` with a project idea, e.g.:
> "I want to build a CLI tool that tracks reading habits. /brainstorming"

**Expect:** The brainstorming skill activates, asks clarifying questions, and produces a
structured design document. The design doc includes: goals, constraints, high-level architecture,
and a list of work areas or workstreams.

- [ ] PASS / FAIL

### Step 2: Verify Design Document Output

**Do:** Look at the output of the brainstorming skill or check the file it writes (if any).

**Expect:** Design output contains clearly separated sections: problem statement, proposed
solution, workstreams or feature areas, and any technical decisions or constraints noted.
This content will seed the writing-plans skill.

- [ ] PASS / FAIL

### Step 3: Writing-Plans Skill Produces a Plan

**Do:** The brainstorming skill should hand off to `/writing-plans`, or invoke it directly:
> "/writing-plans" (with the design doc as context)

**Expect:** The writing-plans skill generates a plan directory, typically under
`.claude/plans/<DATE>-<SLUG>/`. The directory contains:
- `plan.md` — human-readable plan with all tasks described
- `manifest.json` — machine-readable project import definition
- `briefings/` — per-task briefing files for agent consumption

- [ ] PASS / FAIL

### Step 4: Verify Manifest Structure

**Do:** Open the generated `manifest.json` file and inspect it.

**Expect:** The JSON matches the import schema:
```json
{
  "name": "<project name>",
  "prefix": "<2-5 UPPERCASE CHARS>",
  "workstreams": [
    {
      "name": "<workstream name>",
      "tasks": [
        {
          "name": "<task name>",
          "priority": "high|medium|low|critical",
          "depends_on": ["<TASK_DISPLAY_ID>", ...]
        }
      ]
    }
  ]
}
```

- [ ] PASS / FAIL

### Step 5: Import the Plan into the PM Module

**Do:** Run `brain pm import --from-json <path-to-manifest.json>`

**Expect:** Output lists each created item:
```
Created project: <PREFIX>
Created workstream: <PREFIX>-S1
Created task: <PREFIX>-01.01 (<task name>)
Created task: <PREFIX>-01.02 (<task name>)
...
Import complete: N item(s) created.
```
No errors appear. Exit code is 0.

- [ ] PASS / FAIL

### Step 6: Verify All Tasks Imported with Correct Dependencies

**Do:** Run `brain pm task list --project <PREFIX> --json` and inspect the output.

**Expect:** All tasks from the manifest appear with `status: "pending"`. Tasks that had
`depends_on` entries in the manifest have corresponding `depends_on` arrays in their metadata,
and the display IDs match (e.g., `<PREFIX>-01.01`). Use `brain pm waves --json` to verify
the dependency wave grouping is topologically correct.

- [ ] PASS / FAIL

### Step 7: Set Active Project and Check Eligible Tasks

**Do:** Run:
```
brain pm use <PREFIX>
brain pm next --json
```

**Expect:** `brain pm use` prints `Active project set to <PREFIX>`. `brain pm next` returns
tasks in wave 1 (those with no unfulfilled dependencies). Tasks with unsatisfied dependencies
do not appear as eligible.

- [ ] PASS / FAIL

### Step 8: Dispatch First Task and Verify Routing

**Do:** Take the first eligible task ID from `brain pm next`, then run:
`brain pm orchestrate route <TASK_ID> --json`

**Expect:** Routing matches what was specified or implied in the plan. For implementation tasks:
`model: "opus"`, `isolation: "worktree"`, `verify: true`. For research tasks: `model: "sonnet"`,
`isolation: "none"`, `verify: false`. Confirm routing matches the task's `category` field.

- [ ] PASS / FAIL

---

## Troubleshooting

**Brainstorming or writing-plans skill not found:**
- Verify skills directory: `ls ~/.claude/skills/`
- Skills should be in `~/.claude/skills/brainstorming/SKILL.md` and `~/.claude/skills/writing-plans/SKILL.md`
- If missing, these skills must be installed separately from the PM module hooks

**`brain pm import` fails with INVALID_INPUT on manifest:**
- Confirm `prefix` field is 2-5 uppercase letters (the import command uppercases it, but it must be present)
- Confirm `name` field is non-empty at both project and workstream/task levels
- Validate JSON syntax before importing: `node -e "JSON.parse(require('fs').readFileSync('manifest.json','utf8'))"`

**Dependencies not linked after import:**
- The `depends_on` values in manifest must be display IDs that exist in the same import
  (e.g., `"MYPROJ-01.01"`) — forward references to tasks not yet created are skipped with an error
- Check `result.errors` in JSON output: `brain pm import --from-json manifest.json --json`
- Missing dependency relations show as errors but do not fail the overall import

**`brain pm next` returns no eligible tasks after import:**
- All tasks may have dependencies on tasks that are also `pending`
- Run `brain pm waves --json` to see the wave structure — wave 1 tasks should be eligible
- If wave 1 tasks have dependencies on each other, the manifest has a cycle

**Routing does not match expected model for a task:**
- Run `brain pm task show <TASK_ID> --json` and check `category` and `mode` fields
- Tasks default to no category/mode at import; set explicitly:
  `brain pm task update <TASK_ID> --category implementation --mode agent`
