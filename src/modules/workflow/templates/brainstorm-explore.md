# Brainstorm: Explore Context

Explore-type agent gathering project context before a brainstorming session.

---

## Setup

- Topic: `{{TASK_DESCRIPTION}}`
- Project: `{{PROJECT_PREFIX}}`
- Location: `{{REPO_PATH}}`

## Instructions

Survey the codebase to understand:

1. **Current state** — What exists today? Recent commits, active branches, open PRs.
2. **Related code** — Files, modules, and patterns relevant to "{{TASK_DESCRIPTION}}".
3. **Constraints** — Existing architecture decisions, dependencies, or conventions that apply.
4. **Prior art** — Has something similar been attempted? Check docs, plans, design notes.

## Output

Write a structured context brief covering:
- Key files and their roles
- Architectural patterns in use
- Potential constraints or risks
- Open questions for the interview phase

Keep it under 200 lines. Facts only — no design recommendations yet.
