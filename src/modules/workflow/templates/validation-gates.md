# Validation Gates

Deterministic verification steps used across the planning and implementation lifecycle. Each gate is a CLI command or script — not agent judgment.

## Implementation Verification Pipeline

Run in order. All must pass before commit.

| # | Gate | Command | Pass Criteria |
|---|------|---------|---------------|
| 1 | Typecheck | `{{TYPECHECK_CMD}}` | Exit code 0, no errors |
| 2 | Tests | `{{TEST_CMD}}` | Exit code 0, all tests pass |
| 3 | Lint | `{{LINT_CMD}}` | Exit code 0, no errors/warnings |
| 4 | Format | `npx prettier --check .` | Exit code 0 (fix: `npx prettier --write .`) |
| 5 | Build | `{{BUILD_CMD}}` | Exit code 0, no errors |

**Retry policy:** If any gate fails, fix and retry. Try at least twice before escalating.

## Planning Phase Gates

### Research Gate
- **Check:** `.plans/<planId>/research-brief.md` exists and is non-empty
- **Pass:** File has at least the 4 required sections (Existing Code, External Findings, Knowledge Gaps, Recommendations)
- **Command:** `test -s .plans/<planId>/research-brief.md && grep -c "^## " .plans/<planId>/research-brief.md`

### Design Gate
- **Check:** All 3 artifacts exist
- **Pass:** `spec.md`, `design.md`, and `acceptance-criteria.md` all exist in `.plans/<planId>/`
- **Command:**
  ```bash
  for f in spec.md design.md acceptance-criteria.md; do
    test -s ".plans/<planId>/$f" || echo "MISSING: $f"
  done
  ```

### Critic Gate
- **Check:** Critic report exists with verdict
- **Pass:** `critic-report.md` exists and contains `## Verdict: READY`
- **Fail:** Contains `## Verdict: NEEDS REVISION` — route back to design agent
- **Command:** `grep "^## Verdict:" .plans/<planId>/critic-report.md`

### Spec Test Gate
- **Check:** Tests are stashed
- **Pass:** `git stash list` contains an entry matching `spec-tests-<planId>`
- **Command:** `git stash list | grep "spec-tests-<planId>"`

### Decompose Gate
- **Check:** PM tasks created and briefings exist
- **Pass:** `brain pm task list --project <PREFIX>` shows new tasks with matching planId metadata, and briefing files exist
- **Command:**
  ```bash
  ls .plans/<planId>/briefings/task-*.md | wc -l
  brain pm task list --project <PREFIX> | grep "<planId>"
  ```

## Wave Gates

Between implementation waves, verify:

| Gate | Command | Purpose |
|------|---------|---------|
| All wave N tests pass | `{{TEST_CMD}}` | No regressions from parallel work |
| Typecheck clean | `{{TYPECHECK_CMD}}` | Type compatibility across wave outputs |
| Lint clean | `{{LINT_CMD}}` | Code quality maintained |
| No file ownership conflicts | `git diff --name-only <wave-start>..HEAD` | Verify no unexpected file overlaps |

## Review Gates

After implementation, before merge:

| Gate | Command | Purpose |
|------|---------|---------|
| Risk assessment | `review-route.sh <PREFIX> <RISK> <VERDICT>` | Route review based on risk |
| MERGE threshold | Risk < `reviewThreshold` AND verdict PASS | Auto-merge eligible |
| HUMAN_REVIEW threshold | Risk >= `reviewThreshold` | Requires human review task |

## Gate Failure Escalation

| Failure | Action |
|---------|--------|
| Implementation gate fails 2x | Agent reports diagnostics, orchestrator decides: resume, re-design, or escalate |
| Critic verdict NEEDS REVISION 3x | Escalate to human walkthrough |
| Wave gate fails | Identify which task's output broke it, resume that agent |
| Review NEEDS WORK | Dispatch fixup agent via `review-fixup.md` |
