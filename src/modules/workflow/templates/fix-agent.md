# Fix Agent: {{TASK_ID}}

## Setup

- Branch: `{{BRANCH_NAME}}`
- PR: {{PR_URL}}
- Worktree: `{{WORKTREE_PATH}}`

## Original Context

What was built and why:

{{SESSION_SUMMARY}}

## Issues to Fix

{{CI_FAILURES}}

{{CONFLICT_FILES}}

## Instructions

1. Read the failing CI output or conflict markers above to understand the problem.
2. Investigate the affected files — read before modifying.
3. Implement the minimal fix. Do not refactor unrelated code.
4. Verify:
   - Run tests: `npm test`
   - Run typecheck: `npx tsc --noEmit`
   - Run lint: `npx eslint`
5. Stage only changed files — do not use `git add -A` or `git add .`.
6. Commit with an imperative-mood message under 72 characters.
7. Push to `origin/{{BRANCH_NAME}}` — the PR updates automatically.

## Report

On success output exactly:

```
DONE {{TASK_ID}} <one-line summary of what was fixed>
```

On failure after two attempts, output exactly:

```
FAILED {{TASK_ID}} <what failed, what was tried, root cause theory>
```
