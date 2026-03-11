# Implementation Task: {{TASK_ID}}

## Setup

- Location: `{{REPO_PATH}}`
- Branch: `{{BRANCH_NAME}}` (base: `{{BASE_BRANCH}}`)
- Build: `{{BUILD_CMD}}` | Test: `{{TEST_CMD}}` | Typecheck: `{{TYPECHECK_CMD}}` | Lint: `{{LINT_CMD}}`
- Worktree: `{{WORKTREE_PATH}}` (omit if not isolated)
- Brain PM task: `{{BRAIN_TASK_ID}}` / claim token: `{{CLAIM_TOKEN}}`

## Ownership Scope

Only modify files matching: `{{OWNERSHIP_PATTERNS}}`

## Context

{{CONTEXT_FILES}}

{{PREREQUISITES}}

## What to Implement

{{IMPLEMENTATION_INSTRUCTIONS}}

Constraints: {{DESIGN_CONSTRAINTS}}

## Tests

{{TEST_INSTRUCTIONS}}

## Verify and Complete

Run in order — all must pass:

1. `{{TYPECHECK_CMD}}` — no type errors
2. `{{TEST_CMD}}` — all tests pass
3. `{{LINT_CMD}}` — no lint errors
4. `npx prettier --check .` — no formatting issues (fix with `npx prettier --write .` if needed)
5. `{{BUILD_CMD}}` — builds successfully
6. {{MANUAL_VERIFICATION_STEPS}}

If verification fails, fix and retry twice before exiting with diagnostics.

When all pass, commit referencing `{{TASK_ID}}` (imperative mood, <72 chars) and push to `origin/{{BRANCH_NAME}}`. Report: summary of changes, files modified, test count delta, issues encountered.

Stay within ownership scope, run all verification steps, no dead code, no skipping on failure.
