# Planning Spec Tests: {{TASK_ID}}

## Context

- Plan: {{PLAN_ID}}
- Project: {{PROJECT_PREFIX}}
- Location: `{{REPO_PATH}}`
- Test command: `{{TEST_CMD}}`

## Input Artifacts

Read these files before writing any tests:

1. `.plans/{{PLAN_ID}}/acceptance-criteria.md` — the testable conditions to implement
2. `.plans/{{PLAN_ID}}/design.md` — the technical approach (for understanding API shapes and data flow)

## Your Task

Write failing test files that map each acceptance criterion to one or more test cases. These tests are the executable specification — they define what "done" means for the implementation agent.

### Rules

1. **One test per acceptance criterion minimum** — every Given/When/Then in acceptance-criteria.md must have a corresponding test
2. **Arrange-Act-Assert structure** — clear setup, action, assertion in every test
3. **Follow project conventions** — use the same test framework (Vitest), file naming patterns, and import styles as existing tests in the repo
4. **Tests MUST fail** — you are writing tests before implementation exists. If a test passes, either the feature already exists (check!) or the test is wrong
5. **No implementation code** — do not create source files, stubs, or mocks for the feature being tested. Import paths should reference where the code WILL be (per design.md)
6. **Descriptive test names** — test names describe the scenario, not the method (e.g., "creates active session when user has no existing sessions" not "test createSession")

### Process

For each acceptance criterion in acceptance-criteria.md:

1. Read the criterion
2. Determine which file(s) the test belongs in (based on design.md file paths)
3. Write the test using Arrange-Act-Assert
4. Add edge case tests where the criterion implies boundary conditions

### Test File Placement

Place test files in the project's standard test directory, following existing patterns:
- If tests live in `__tests__/`, put them there
- If tests live alongside source as `*.test.ts`, follow that pattern
- Mirror the source file structure from design.md

## Verification

After writing all test files, run `{{TEST_CMD}}` and confirm failures. Compilation errors from missing imports are expected and acceptable — they prove the tests reference code that does not yet exist.

If any test passes unexpectedly, investigate: the feature may already exist, or the test assertion is wrong. Fix the test so it fails for the right reason.

## Handoff

After writing and verifying all test files:

1. **Do NOT commit** — these tests are pre-implementation artifacts
2. **Git stash the tests** — run:
   ```bash
   cd {{REPO_PATH}}
   git add <test files you created>
   git stash push -m "spec-tests-{{PLAN_ID}}" -- <test files>
   ```
3. **Report** using the output format below

## Output

```
## Spec Test Summary

### Tests Written
- <file path> — <N> tests covering criteria: <list of criteria IDs>

### Coverage
- Total acceptance criteria: <N>
- Criteria with tests: <N>
- Criteria without tests: <N> (explain why if any)

### Stash Reference
- `git stash list` entry: spec-tests-{{PLAN_ID}}

### Notes
- <any assumptions made about API shapes>
- <any criteria that were ambiguous>
```
