---
id: pr-lifecycle
title: "PR Lifecycle Workflow"
type: workflow
module: workflow
tier: slow
summary: "Full PR lifecycle: implement → create PR → review → merge with feedback loop"
created: 2026-03-14
modified: 2026-03-14
---

# PR Lifecycle Workflow

{
  "version": 1,
  "name": "pr-lifecycle",
  "description": "Full PR lifecycle: implement → create PR → review → merge (with feedback loop on changes requested)",
  "steps": [
    {
      "id": "implement",
      "name": "Implement",
      "category": "implementation",
      "template": "implementation-compact",
      "mode": "agent"
    },
    {
      "id": "create-pr",
      "name": "Create PR",
      "category": "infrastructure",
      "template": "implementation-compact",
      "mode": "agent"
    },
    {
      "id": "review",
      "name": "Review",
      "category": "review",
      "template": "review-agent",
      "mode": "agent",
      "gates": [
        { "type": "human-approval", "description": "Human or agent review must approve or request changes" }
      ]
    },
    {
      "id": "fixup",
      "name": "Fixup",
      "category": "implementation",
      "template": "review-fixup",
      "mode": "agent",
      "gates": [
        { "type": "iteration", "maxIterations": 3, "description": "Max 3 fixup rounds before escalation" }
      ]
    },
    {
      "id": "merge",
      "name": "Merge",
      "category": "infrastructure",
      "mode": "human"
    }
  ],
  "edges": [
    { "from": "implement", "to": "create-pr" },
    { "from": "create-pr", "to": "review" },
    { "from": "review", "to": "merge", "condition": "approved" },
    { "from": "review", "to": "fixup", "condition": "changes_requested" },
    { "from": "fixup", "to": "review" }
  ],
  "parameters": [
    { "name": "taskId", "description": "PM task display ID being implemented", "required": true },
    { "name": "branch", "description": "Feature branch name", "required": true },
    { "name": "prUrl", "description": "Pull request URL (populated after create-pr step)", "required": false },
    { "name": "baseBranch", "description": "Base branch to merge into", "required": false, "default": "main" }
  ]
}

## How it works

1. **Implement**: Agent works on the task, writes code against the branch
2. **Create PR**: Agent creates a GitHub PR (`gh pr create`) targeting `baseBranch`
3. **Review**: Review task auto-created (via `session-post-tool-handler`), reviewer agent dispatched or human reviews
4. **On approval**: Merge the PR (human step)
5. **On changes requested**: Resume the fixup agent with PR feedback context (via `brain pr feedback <url>`), loop back to review

## Integration points

- PR creation detected by `session-post-tool-handler` → auto-creates PM review task
- `brain pr feedback <url>` → fetches PR comments → generates resumption prompt for fixup
- `brain agent resume` → continues the author agent with review context
- Iteration gate on `fixup` step caps feedback loops at 3 rounds

## Registration

To register this workflow in the brain database:

```bash
# 1. Add the note to the brain workspace
brain add templates/workflows/pr-lifecycle.md

# 2. Register it using the note ID
brain workflow register pr-lifecycle

# 3. Verify it appears in the list
brain workflow list
```

## Usage

To run a PR lifecycle workflow for a task:

```bash
brain workflow run pr-lifecycle \
  --project VNM \
  --param taskId=VNM-07.03 \
  --param branch=feat/vnm-07-03-session-capture
```
