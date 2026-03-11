# Review Fixup: {{TASK_ID}}

## Setup

- Location: `{{REPO_PATH}}`
- Branch: `{{BRANCH_NAME}}`
- PR: `{{OWNER}}/{{REPO}}#{{PR_NUMBER}}`
- Build: `{{BUILD_CMD}}` | Test: `{{TEST_CMD}}` | Typecheck: `{{TYPECHECK_CMD}}` | Lint: `{{LINT_CMD}}`

## Step 1: Fetch review comments

```bash
cd {{REPO_PATH}} && git checkout {{BRANCH_NAME}} && git pull origin {{BRANCH_NAME}}
```

```bash
gh api repos/{{OWNER}}/{{REPO}}/pulls/{{PR_NUMBER}}/reviews --jq '.[].body'
gh api repos/{{OWNER}}/{{REPO}}/pulls/{{PR_NUMBER}}/comments --jq '.[] | {path, line, body}'
```

## Step 2: Categorize findings

Parse each comment. Extract items tagged `[FIX]` — these are required changes. Skip items tagged `[WON'T FIX]` or purely informational comments. Build a checklist of actionable fixes with file path, line, and description.

## Step 3: Implement fixes

For each `[FIX]` item:

1. Read the referenced file in full
2. Implement the fix
3. Re-read the file to confirm the change addresses the comment

Stay within the files referenced by review comments. Do not refactor unrelated code.

## Step 4: Verify

Run in order — all must pass:

1. `{{TYPECHECK_CMD}}`
2. `{{TEST_CMD}}`
3. `{{LINT_CMD}}`
4. `npx prettier --check .` — fix with `npx prettier --write .` if needed
5. `{{BUILD_CMD}}`

**Retry policy:** If any step fails, investigate and fix. Try at least **twice** before giving up. On failure after 2 attempts, report: (1) what is failing, (2) what you tried, (3) your theory on root cause.

## Step 5: Commit

Stage only changed files — do not use `git add -A` or `git add .`.

```bash
cd {{REPO_PATH}}
git add <changed files>
git commit -m "Address review feedback for {{TASK_ID}}"
```

Do NOT push — the orchestrator handles push and follow-up.

## Step 6: Report

```
## Fixup Summary

### Fixed (<count>)
- <file:line> -- <what was fixed>

### Skipped (<count>)
- <file:line> -- <reason skipped (WON'T FIX / informational)>

### Verification
- Typecheck: PASS/FAIL
- Tests: PASS/FAIL (<count> tests)
- Lint: PASS/FAIL
- Prettier: PASS/FAIL
- Build: PASS/FAIL

### Issues
- <any problems encountered, or "None">
```
