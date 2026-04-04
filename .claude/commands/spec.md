---
name: spec
description: Start the brain planning workflow for a feature or task. Produces spec, design, acceptance criteria, and critic review.
triggers:
  - /spec
  - spec this
  - create a spec for
  - start spec
  - plan this
  - create a plan for
  - start planning
---

# /spec — Start a Planning Workflow

Kick off brain's planning workflow to produce design artifacts for a feature, refactor, or investigation.

## Usage

```
/spec <description> [--complexity low|medium|high] [--workstream <ws>]
```

- `description` — what to plan (required, becomes the `brief`)
- `--complexity` — planning depth: `low` (skip research/interview), `medium` (skip interview), `high` (full pipeline, default)
- `--workstream` — PM workstream number (e.g. `34`)

## Steps

### 1. Parse arguments

- Everything before flags is the `description` (becomes `brief`)
- `--complexity <level>` (default: `high`)
- `--workstream <n>` (default: current active workstream)

### 2. Generate plan ID

Slugify the description: lowercase, replace non-alphanumeric with `-`, truncate to 60 chars.

### 3. Gather context from conversation

If the current conversation has research, decisions, or requirements already discussed:
- Summarize them as `priorContext`
- List any brain note slugs referenced as `brainNotes`
- List any source files reviewed as `files`
- If the user has already answered design questions, capture as `interviewAnswers`

### 4. Start the workflow via MCP

```typescript
brain_workflow_start({
  workflowId: 'planning',
  project: 'VNM',
  workstream: <workstream>,
  context: {
    brief: '<description>',
    complexity: '<complexity>',
    planId: '<plan-id>',
    brainNotes: '<comma-separated note slugs>',
    files: '<comma-separated file paths>',
    priorContext: '<summary of prior context>',
    interviewAnswers: '<requirements if available>',
  }
})
```

### 5. Report back

```
Planning workflow started: <instanceId>
Plan ID: <plan-id>
Complexity: <complexity>

The workflow will run: seed → research → design ⇄ critic → spec-tests
Monitor with: brain_workflow_status({ instanceId: '<instanceId>' })

Artifacts will be written to .plans/<plan-id>/
```

## Rules

- Always pass a meaningful `brief` — this becomes `{{TASK_DESCRIPTION}}` in all agent templates
- Include conversation context when available — don't make agents re-discover what we already know
- Default complexity is `high` — don't silently downgrade
- Do not start implementing — this skill ends after the workflow is started
