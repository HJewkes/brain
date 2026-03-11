# Planning Decompose: {{TASK_ID}}

Decompose an approved design into PM tasks and briefing files. Each task becomes an independently executable unit dispatched via `implementation-compact.md`.

---

## Context

- Plan: `{{PLAN_ID}}`
- Project: `{{PROJECT_PREFIX}}`
- Location: `{{REPO_PATH}}`
- Build: `{{BUILD_CMD}}` | Test: `{{TEST_CMD}}` | Typecheck: `{{TYPECHECK_CMD}}` | Lint: `{{LINT_CMD}}`
- Brain PM task: {{BRAIN_TASK_ID}}

## Input

Read these approved design artifacts before proceeding:

1. `.plans/{{PLAN_ID}}/design.md` -- technical approach, file list, scaffolding boundaries, PR boundary recommendation
2. `.plans/{{PLAN_ID}}/acceptance-criteria.md` -- testable conditions mapped to tests
3. `.plans/{{PLAN_ID}}/critic-report.md` -- critic findings and their resolutions

Also read for conventions:
- `{{REPO_PATH}}/CLAUDE.md` -- project conventions and commands
- Any existing code referenced in `design.md` -- understand current patterns before splitting work

## Decomposition Rules

Apply all five rules. If any rule is violated, restructure until it holds.

1. **One logical unit per task** -- a task produces one coherent change: a component, a store, a utility, a hook, or a test suite. Not "half a component."
2. **Exclusive file ownership** -- no two tasks modify the same file. If a file needs changes from multiple tasks, assign it to one task and make others depend on it.
3. **Independently verifiable** -- each task's success criteria can be checked without other incomplete tasks. Tests may import from scaffolding (wave 1) but not from peer tasks in the same wave.
4. **50-line briefing limit** -- if a briefing exceeds 50 lines of meaningful content (excluding code blocks), the task is too large. Split it.
5. **TDD step structure** -- every task follows: write test, verify fail, implement, verify pass, commit.

## Wave Structure

Group tasks into waves based on `design.md` scaffolding boundaries:

### Wave 1: Scaffolding

Types, interfaces, shared utilities, store structure, configuration. These are the foundations other tasks depend on.

- **Gate:** `{{TYPECHECK_CMD}}` passes. Any scaffolding tests pass.
- **Dependency:** None -- wave 1 tasks run in parallel.

### Wave 2+: Implementation

Features built on top of scaffolding. Tasks within a wave run in parallel.

- **Gate:** `{{TEST_CMD}}` passes. `{{LINT_CMD}}` clean. `{{TYPECHECK_CMD}}` passes.
- **Dependency:** All wave 1 tasks must be complete before wave 2 starts. Within a wave, tasks are independent.

### Final Wave: Integration

Cross-cutting tests, cleanup, integration validation. Only if the design calls for it.

- **Gate:** Full verification pipeline -- `{{TYPECHECK_CMD}}`, `{{TEST_CMD}}`, `{{LINT_CMD}}`, `npx prettier --check .`, `{{BUILD_CMD}}`.
- **Dependency:** All prior waves complete.

## Creating PM Tasks

For each task, create a brain PM entry:

```bash
brain pm task add "<task name>" \
  --workstream <appropriate workstream> \
  --project {{PROJECT_PREFIX}} \
  --category implementation \
  --priority medium \
  --description "Briefing: .plans/{{PLAN_ID}}/briefings/task-NN.md"
```

Set dependencies to enforce wave ordering:

```bash
brain pm task update <TASK-ID> --depends-on <DEPENDENCY-ID>
```

- Wave 1 tasks: no dependencies.
- Wave 2+ tasks: depend on all wave 1 tasks.
- Final wave tasks: depend on all prior wave tasks.

Record each PM task ID -- you will need them for the output summary.

## Creating Briefing Files

For each task, create `.plans/{{PLAN_ID}}/briefings/task-NN.md` using this format:

```markdown
# Task NN: <Component Name>

## Architectural Context

[2-3 sentences: where this fits, what it depends on, why it exists. Reference specific files.]

## File Ownership

**May modify:**
- `exact/path/to/file.ts`
- `exact/path/to/file.test.ts`

**Must not touch:**
- `exact/path/to/adjacent.ts`

**Read for context (do not modify):**
- `exact/path/to/dependency.ts` -- [why relevant]

## Steps

### Step 1: Unstash spec tests (if applicable)
Run: `git stash list` to find `spec-tests-{{PLAN_ID}}`
Run: `git stash pop stash@{N}` (where N is the stash index)
Move relevant test files to this task's test location if needed.

### Step 2: Write the failing test
[Exact test code or clear description of what to test]

### Step 3: Run test to verify it fails
Run: `{{TEST_CMD}} -- <test file path>`
Expected: FAIL

### Step 4: Write minimal implementation
[Implementation guidance -- not full code, but unambiguous direction]

### Step 5: Run test to verify it passes
Run: `{{TEST_CMD}} -- <test file path>`
Expected: PASS

### Step 6: Commit
git add <files>
git commit -m "<imperative mood commit message>"

[Repeat step groups 2-6 for additional changes within this task]

## Success Criteria

- [ ] Tests pass: `{{TEST_CMD}} -- <path>`
- [ ] No lint warnings: `{{LINT_CMD}}`
- [ ] Types check: `{{TYPECHECK_CMD}}`
- [ ] [Feature-specific criterion from acceptance-criteria.md]

## Anti-patterns

- Do NOT modify files outside the ownership list
- Do NOT modify CLAUDE.md
- Do NOT add features beyond the steps
- [Task-specific anti-pattern if applicable]
```

### Briefing Authoring Guidelines

- **Architectural Context**: Orient the agent in 2-3 sentences. Reference concrete file paths.
- **File Ownership**: Explicit allowlist. If a task touches 5+ files, split it.
- **Steps**: Complete enough to be unambiguous. Include exact test expectations.
- **Success Criteria**: Every criterion maps to a command the agent can run.
- **Anti-patterns**: Always include the three universal ones (file ownership, CLAUDE.md, scope creep) plus task-specific ones.
- **Parallel awareness**: If a task's tests depend on code from another wave-2 task, note that the dependency will exist at the wave gate, not during task execution.

## Spec Test Distribution

The spec tests from the previous phase are stashed as `spec-tests-{{PLAN_ID}}`. Distribute them:

- List the stashed test files and map each to the task that will use it.
- Wave 1 (scaffolding) tasks typically have no spec tests -- scaffolding is validated by typecheck.
- Wave 2+ tasks unstash and use spec tests as their TDD targets.
- If a spec test covers multiple tasks, assign it to the task with the most relevant ownership. Other tasks reference it as read-only context.
- Include the unstash step only in the FIRST task of each wave (to avoid double-popping).

## PR Boundary

Read the PR boundary recommendation from `design.md`:

- **Single PR:** All tasks commit to the same feature branch. Simpler, but larger review.
- **Per-wave PR:** Each wave gets its own branch stacked on the previous. Smaller reviews, but more branch management.

Document the chosen strategy in your output. The orchestrator needs this to manage branches during dispatch.

## Output

When decomposition is complete, report:

```
## Decomposition Summary

### Tasks Created
| # | PM Task ID | Name | Wave | Depends On | Briefing |
|---|-----------|------|------|-----------|---------|
| 1 | PROJ-XX.YY | Scaffold types | 1 | -- | task-01.md |
| 2 | PROJ-XX.YY | Implement feature A | 2 | Task 1 | task-02.md |
| ... | ... | ... | ... | ... | ... |

### Wave Gates
- Wave 1 gate: {{TYPECHECK_CMD}} passes
- Wave 2 gate: {{TEST_CMD}} + {{LINT_CMD}} + {{TYPECHECK_CMD}} pass
- [Final wave gate if applicable]

### PR Strategy
[Single PR / Per-wave -- from design.md recommendation, with rationale]

### File Ownership Map
| File | Owned By |
|------|----------|
| src/types.ts | Task 1 |
| src/feature-a.ts | Task 2 |
| ... | ... |

### Spec Test Distribution
| Test File | Assigned To | Unstash In |
|-----------|------------|-----------|
| __tests__/feature-a.test.ts | Task 2 | Task 2 (first in wave 2) |
| ... | ... | ... |
```

Verify before reporting:
- Every file from `design.md` appears exactly once in the ownership map
- Every acceptance criterion maps to at least one task
- No circular dependencies between tasks
- Wave ordering respects scaffolding-first
- All briefing files are under 50 lines of meaningful content
