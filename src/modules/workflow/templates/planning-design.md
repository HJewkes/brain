# Planning Design: {{TASK_ID}}

Produce design artifacts for a planning workflow. Read the research brief, synthesize with interview answers (if provided), and write spec, design, and acceptance criteria. Do NOT implement or write code — only produce design documents.

---

## Setup

- Plan: `{{PLAN_ID}}`
- Project: `{{PROJECT_PREFIX}}`
- Location: `{{REPO_PATH}}`
- Complexity: {{COMPLEXITY}}
- Build: `{{BUILD_CMD}}` | Test: `{{TEST_CMD}}` | Typecheck: `{{TYPECHECK_CMD}}` | Lint: `{{LINT_CMD}}`

## Input

### Pre-Existing Context

Check for pre-existing context gathered during the seed phase:

```bash
cat {{REPO_PATH}}/.plans/{{PLAN_ID}}/pre-existing-context.md 2>/dev/null
```

If this file exists, treat it as foundational context alongside the research brief. Decisions and constraints documented here take precedence over fresh research where they conflict.

### Research Brief

Read `{{REPO_PATH}}/.plans/{{PLAN_ID}}/research-brief.md` for context gathered during the research phase. This is your primary source of truth for existing code, patterns, constraints, and external findings.

### Interview Answers (high complexity only)

{{INTERVIEW_ANSWERS}}

### Task Description

{{TASK_DESCRIPTION}}

## Instructions

Produce three artifacts in `{{REPO_PATH}}/.plans/{{PLAN_ID}}/`. These documents are the contract for all subsequent phases — critic review, spec tests, work decomposition, and implementation. Be concrete: file paths, type signatures, function names. The decompose phase uses these to create implementation tasks with file ownership.

### Artifact 1: spec.md

Write `{{REPO_PATH}}/.plans/{{PLAN_ID}}/spec.md` — the problem specification.

```markdown
# Spec: <feature name>

## Problem
[What problem does this solve? What happens without it? 2-3 sentences.]

## Requirements
[Numbered list of functional requirements. Each must be testable.]

## Constraints
[What can't change. Backward compatibility. Performance bounds. API contracts.]

## Out of Scope
[Explicit list of what this work does NOT include.]

## Dependencies
[Other systems, packages, or tasks this depends on.]
```

Keep it to 1-2 pages. Reference interview answers where applicable.

### Artifact 2: design.md

Write `{{REPO_PATH}}/.plans/{{PLAN_ID}}/design.md` — the technical approach.

```markdown
# Design: <feature name>

## Approach
[2-3 paragraph summary of the technical approach.]

## Files to Create/Modify
[Exact paths for every file that will be created or modified.]

| Action | Path | Purpose |
|--------|------|---------|
| Create | `src/features/foo.ts` | Core logic for X |
| Modify | `src/store/bar.ts` | Add Y state |
| Create | `src/__tests__/foo.test.ts` | Tests for X |

## API Shapes / Type Signatures
[TypeScript interfaces, function signatures, or data structures. Concrete, not abstract.]

## Data Flow
[How data moves through the system. Which components talk to which.]

## Key Decisions

| Decision | Chosen | Alternative | Rationale |
|----------|--------|-------------|-----------|
| State management | Zustand | Context | Simpler API, existing pattern |

## Risks and Mitigations
[What could go wrong. How to handle it.]

## Scaffolding vs. Implementation
[What should be built first (wave 1) vs. what can be parallelized (wave 2+).]
- **Scaffolding (wave 1):** [types, interfaces, shared utilities, store structure]
- **Implementation (wave 2+):** [features that can be built in parallel on top of scaffolding]

## PR Boundaries
[Should this be one PR or multiple? If multiple, what is the boundary?]
- Option A: One PR for everything (simpler review, all-or-nothing)
- Option B: One PR per wave (incremental, reviewable chunks)
- Recommendation: [chosen option with rationale]
```

### Artifact 3: acceptance-criteria.md

Write `{{REPO_PATH}}/.plans/{{PLAN_ID}}/acceptance-criteria.md` — testable conditions.

```markdown
# Acceptance Criteria: <feature name>

## Criteria

### AC-01: <short name>
**Given:** <precondition>
**When:** <action>
**Then:** <expected result>

### AC-02: <short name>
**Given:** <precondition>
**When:** <action>
**Then:** <expected result>

[Continue for all criteria...]

## Edge Cases

### EC-01: <short name>
**Given:** <edge condition>
**When:** <action>
**Then:** <expected behavior>

## Non-Functional

### NF-01: <short name>
[Performance, accessibility, or other non-functional requirement with measurable threshold]
```

Every requirement in spec.md must map to at least one acceptance criterion. Every acceptance criterion must be testable — no vague conditions like "works correctly."

## Quality Checks

Before reporting, verify your artifacts:

- Every spec requirement has a corresponding AC
- Every AC uses Given/When/Then format with concrete, testable conditions
- design.md files table has exact paths (no placeholders like `src/...`)
- API shapes include TypeScript types, not prose descriptions
- Key decisions table has at least one entry with a considered alternative
- Scaffolding section clearly separates wave 1 (blocking) from wave 2+ (parallelizable)
- PR boundaries section has a concrete recommendation

## Output

When complete, report to the orchestrator:

- **Design approach** — 3-5 sentence summary of the technical approach
- **Files** — count of files to create and modify
- **Acceptance criteria** — count of ACs, edge cases, and non-functional criteria
- **Key decisions** — list of decisions made (one line each)
- **Open questions** — any unresolved questions that need human input before implementation proceeds

Stay in design mode. Do not write implementation code, tests, or make changes to the codebase. Flag ambiguity as open questions rather than resolving it with assumptions.
