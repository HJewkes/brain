# Writing Plans

Agent-mode phase. Create a structured implementation plan from the approved design.

---

## Context

- Topic: `{{TASK_DESCRIPTION}}`
- Project: `{{PROJECT_PREFIX}}`
- Location: `{{REPO_PATH}}`
- Plan ID: `{{PLAN_ID}}`

## Instructions

Create the plan directory at `.claude/plans/{{PLAN_ID}}/` with:

### 1. plan.md (<200 lines)
- Goal (one sentence)
- Architecture (2-3 sentences)
- Dependency graph
- Wave plan (parallel groups)
- Task table (name, files, wave, depends-on)

### 2. manifest.json
- planId, createdAt, goal
- tasks array: id, name, briefing path, wave, dependsOn, fileOwnership, status
- waves array: id, tasks, gate

### 3. briefings/task-NN.md (per task)
- Exact file paths
- Complete code (not "add validation")
- Exact commands with expected output
- File ownership allowlist
- Success criteria (runnable commands)
- Under 50 lines of meaningful content

## Rules

- DRY: no duplicated logic across tasks
- YAGNI: only what's needed for the current feature
- TDD: write failing test → implement → pass
- Frequent commits: one per logical step
- Bite-sized steps: each step is one action (2-5 minutes)

## Output

The complete plan directory, ready for execution.
