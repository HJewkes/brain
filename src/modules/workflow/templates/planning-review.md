# Planning Review: {{PLAN_ID}}

## When to Use

This is an **assisted** step for the **coordinator** (not a sub-agent). The planning workflow pauses here so the user can review the design before decomposition into tasks.

## Prerequisites

The following artifacts must exist in `.plans/{{PLAN_ID}}/`:

- `spec.md` — what is being built
- `design.md` — how it will be built
- `acceptance-criteria.md` — what "done" looks like
- `critic-report.md` — independent critique of the design

## Review Procedure

### Step 1: Read All Artifacts

Read these files from `{{REPO_PATH}}/.plans/{{PLAN_ID}}/`:

1. `spec.md`
2. `design.md`
3. `acceptance-criteria.md`
4. `critic-report.md`

### Step 2: Present Structured Summary

Present the following to the user using `AskUserQuestion`:

**What's being built:**
Summarise the spec in 2-3 sentences. Include the core problem and proposed solution.

**How it's being built:**
From `design.md`, extract:
- Overall approach (1-2 sentences)
- Key architectural decisions and trade-offs
- Number of files to be created or modified

**What "done" looks like:**
From `acceptance-criteria.md`:
- Total number of acceptance criteria
- Key edge cases covered
- Any notable gaps

**What the critic found:**
From `critic-report.md`:
- Verdict (APPROVED / NEEDS_REVISION / HAS_OPEN_QUESTIONS)
- Count of FIX items vs CONSIDER items
- Top issues or risks flagged

**Key decisions and risks:**
- List the 2-3 most impactful design decisions
- Highlight any open questions or risks that remain

### Step 3: Ask for Direction

Ask the user which path to take:

1. **Approve** — proceed to decomposition (creates PM tasks with wave dependencies)
2. **Request changes** — describe what needs revision (workflow will need manual re-trigger of design)
3. **Skip decompose** — accept the artifacts as-is without creating PM tasks

## Context

- Task: {{TASK_DESCRIPTION}}
- Plan: `{{PLAN_ID}}`
- Location: `{{REPO_PATH}}`

## Output

After the user responds:
- If approved, signal the workflow to continue (decompose step runs next)
- If changes requested, note the feedback for the user to act on
- If skipping decompose, signal completion
