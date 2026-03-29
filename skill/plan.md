---
name: plan
description: Create a structured planning workflow for a feature or task. Use when the user says "/plan <description>", wants to plan something, or needs a planning workflow instantiated. Generates a plan directory and kicks off the research phase.
triggers:
  - /plan
  - plan this
  - create a plan for
  - start planning
---

# /plan — Instantiate a Planning Workflow

Create a planning workflow for a feature, refactor, or investigation. Instantiates the brain `planning` workflow and prepares the first research step.

## Usage

```
/plan <description> [--complexity low|medium|high] [--workstream <ws>]
```

- `description` — what to plan (required)
- `--complexity` — planning depth: `low` (quick design), `medium` (multi-step design), `high` (full research-design-spec cycle, default)
- `--workstream` — PM workstream to associate (e.g. `VNM-41`)

## Steps

### 1. Extract arguments from the user prompt

Parse the user's message:
- Everything before any flags is the `<description>`
- `--complexity <level>` sets complexity (default: `high`)
- `--workstream <ws>` sets the PM workstream (default: use the current project's active workstream or leave blank)

### 2. Generate plan ID

Slugify the description:
- Lowercase
- Replace non-alphanumeric runs with `-`
- Strip leading/trailing dashes
- Truncate to 60 characters

Example: `"Add rate limiting to the API"` → `add-rate-limiting-to-the-api`

### 3. Create the plan directory

```bash
mkdir -p .plans/<plan-id>
```

### 4. Instantiate the planning workflow

Run the brain workflow to register and expand the planning instance:

```bash
brain workflow run planning \
  --project VNM \
  --context "planId=<plan-id>,complexity=<complexity>,workstream=<workstream>"
```

If `--workstream` was not provided, omit `workstream=` from the context string.

If the `brain workflow run` command is not yet available (the workflow module may be in development), skip this step and note it in output.

### 5. Report back with first-step instructions

After instantiating, output:

```
Plan created: <plan-id>
Directory: .plans/<plan-id>/
Complexity: <complexity>
Workflow: planning (brain workflow)

## Next step: Research

Your first task is the research phase. Run the research agent with:

  brain pm dispatch <research-task-id> --template planning-research

Or start the research manually:
1. Read the codebase for context relevant to: <description>
2. Check .plans/<plan-id>/ for any existing notes
3. Produce .plans/<plan-id>/research-brief.md

Research focus: <description>
```

## Rules

- Always create the `.plans/<plan-id>/` directory even if workflow instantiation fails
- The plan ID must be deterministic (same description → same ID)
- Default complexity is `high` — do not silently downgrade without user confirmation
- If the workflow run command fails, continue and show the manual next step
- Do not start implementing — this skill ends after the research kickoff instructions
