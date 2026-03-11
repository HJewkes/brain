# Implementation Task: {{TASK_ID}}

## Repo Setup

- Location: `{{REPO_PATH}}`
- Branch: `{{BRANCH_NAME}}` (base: `{{BASE_BRANCH}}`)
- Build: `{{BUILD_CMD}}`
- Test: `{{TEST_CMD}}`
- Typecheck: `{{TYPECHECK_CMD}}`
- Lint: `{{LINT_CMD}}`
- Worktree: `{{WORKTREE_PATH}}` (omit if not isolated)
- Brain PM task: `{{BRAIN_TASK_ID}}` / claim token: `{{CLAIM_TOKEN}}`

## Ownership Scope

You may only modify files matching these patterns:

```
{{OWNERSHIP_PATTERNS}}
```

Do NOT modify files outside this scope.

## Context

### Read first

{{CONTEXT_FILES}}

### Prerequisites

{{PREREQUISITES}}

### What NOT to change

{{DO_NOT_CHANGE}}

## What to Implement

{{IMPLEMENTATION_INSTRUCTIONS}}

## Design Constraints

{{DESIGN_CONSTRAINTS}}

## Tests

{{TEST_INSTRUCTIONS}}

## Verification

After all changes, run each of these in order. All must pass.

1. **Typecheck**: `{{TYPECHECK_CMD}}` — no type errors
2. **Tests**: `{{TEST_CMD}}` — all tests pass
3. **Lint**: `{{LINT_CMD}}` — no lint errors
4. **Format**: `npx prettier --check .` — no formatting issues (fix with `npx prettier --write .`)
5. **Build**: `{{BUILD_CMD}}` — builds successfully
5. **Manual checks**:

{{MANUAL_VERIFICATION_STEPS}}

## Completion

When all verification passes:

1. Commit with a descriptive message referencing `{{TASK_ID}}` (imperative mood, <72 chars subject)
2. Push to `origin/{{BRANCH_NAME}}`
3. Report back with:
   - Summary of what changed and why
   - Files modified (list)
   - Test count (before/after if tests were added)
   - Any issues encountered or things the orchestrator should know

## Retry Policy

If tests, typecheck, lint, or build fail after your changes, investigate the root cause and fix it. Try at least **twice** before giving up. If after 2 fix attempts you still cannot resolve the issue, exit with a clear explanation of:

1. What is failing (exact error output)
2. What you tried to fix it
3. Your best theory on the root cause

## Anti-Patterns

- Do NOT modify files outside the ownership scope listed above
- Do NOT skip any verification step
- Do NOT commit generated files unless explicitly told to
- Do NOT create new files unless necessary — prefer editing existing files
- Do NOT leave TODO comments without a tracking issue
- Do NOT leave dead code or commented-out code
- Do NOT suppress lint/type errors — fix the underlying issue
- Do NOT exit on first test failure — follow the retry policy above
