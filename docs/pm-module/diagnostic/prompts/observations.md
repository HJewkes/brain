You are extracting new observations from a diagnostic cycle's outputs.

## Task

Review all outputs from diagnostic cycle {{VERSION}} and identify new observations not already tracked in the observations document.

## ID Coordination — Do This First

Before reading any diagnostic output, you MUST:

1. Read `docs/pm-module/onboarding-observations-v3.md` (the canonical registry)
2. Scan every `O-NNN` heading to find the highest existing ID
3. Set `next_id = max_id + 1` — all new observations in this run start from there
4. Never reuse or skip an ID; assign them sequentially (next_id, next_id+1, …)
5. For observations that still appear open, reference their **canonical ID** in the Confirmed Observations section — do NOT create a new O-XX entry for them

This prevents ID collisions across diagnostic cycles.

## Inputs

Read these files:
- `docs/pm-module/onboarding-observations-v3.md` — canonical observations registry (read first; establishes max ID)
- `{{RESULTS_DIR}}/test-bench-results.md` — assembled test bench results with per-prompt analysis
- `{{RESULTS_DIR}}/session-audit.md` — session log analysis
- `{{RESULTS_DIR}}/data-audit.md` — data quality findings
- `{{RESULTS_DIR}}/gap-analysis.md` — documentation coverage gaps

## Process

1. Read `docs/pm-module/onboarding-observations-v3.md` and record the highest existing O-NNN ID (see ID Coordination above)
2. Read each diagnostic output file
3. For each finding, check if it's already captured by an existing O-XX observation
4. For genuinely new issues, write a new observation entry starting from `next_id`

## Output Format

Write to {{RESULTS_DIR}}/observations.md with:

### New Observations

For each new observation, use this format:

#### O-XX: [Short title]
- **Severity:** blocker | friction | suggestion | docs | observation
- **Where:** [command or feature area]
- **What happened:** [description]
- **Expected:** [what should happen]
- **Fix:** [proposed solution]
- **Test bench evidence:** [which P-XX prompts hit this]

### Confirmed Observations

List existing O-XX IDs that were confirmed by this cycle's results, with brief evidence.

### Resolved Observations

List any O-XX IDs that appear to be fixed based on this cycle's results.

### Punch List Updates

Table of O-XX entries with recommended status changes (new, confirmed, resolved, deferred).
