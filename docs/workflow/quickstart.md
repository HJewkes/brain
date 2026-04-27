# Workflow Runtime Quick Start

The V2 workflow runtime lets you define multi-step agent pipelines as plain TypeScript async functions. Brain handles memoized dispatch (steps that already ran are not re-dispatched on restart), agent supervision, step output capture, and channel-based push events for live progress.

## Prerequisites

- brain running with MCP server active (`brain serve --mcp` or integrated via Claude Code)
- Claude Code configured with the brain MCP server

---

## 1. What Problem It Solves

Long agent tasks — planning, implementation, PR review — need to survive restarts, recover from failures, and sequence multiple agent steps without manual coordination. The workflow runtime provides a durable execution layer: workflows are persisted to the brain database and resume from their last completed step after a crash or restart.

---

## 2. Start a Workflow

Workflows are launched via the `brain_workflow_start` MCP tool. Provide the workflow name and parameters:

```
brain_workflow_start  name="planning"  params='{"project":"MY","scope":"add search feature"}'
```

Response:

```json
{ "runId": "wf_abc123", "status": "running", "currentStep": "seed" }
```

Available workflows (defined in `src/modules/workflow/flows/`):

| Name | Purpose |
|---|---|
| `planning` | Research → spec → acceptance criteria → task breakdown |
| `implementation` | Seed context → agent dispatch → verify |
| `review` | Code review with structured findings |
| `brainstorming` | Creative exploration with iterative agent steps |
| `pr-lifecycle` | PR open → CI → review → merge |
| `ux-prototype` | Iterative UX design with feedback loops |

---

## 3. Check Status

Poll for progress using the run ID:

```
brain_workflow_status  runId="wf_abc123"
```

Response:

```json
{
  "runId": "wf_abc123",
  "status": "running",
  "currentStep": "implementation",
  "stepResults": [
    { "stepId": "seed", "completedAt": "2026-04-27T10:00:00Z" },
    { "stepId": "research", "completedAt": "2026-04-27T10:02:00Z" }
  ]
}
```

Statuses: `running` | `completed` | `failed` | `paused` | `cancelled`

---

## 4. Stream Live Events

Use `brain_workflow_events` to poll incremental updates (pass the cursor from each response as `since` in the next call):

```
brain_workflow_events  since="<cursor>"
```

Response includes new step completions, agent dispatches, and error events since the cursor.

---

## 5. Signal an Assisted Step

Some workflows pause at `assisted` steps and wait for human input. Signal completion with data:

```
brain_workflow_signal  runId="wf_abc123"  stepId="scope-review"  data='{"approved":true}'
```

The workflow resumes from the next step.

---

## 6. View via CLI

List running workflows from the terminal:

```bash
brain workflow list
brain workflow show wf_abc123
```

---

## How It Works

Each workflow is a TypeScript async function `(ctx: WorkflowContext) => Promise<void>` registered in `src/modules/workflow/flows/index.ts`. Steps use `ctx.dispatch(stepId, template)` for agent work or `ctx.seed(stepId, fn)` for deterministic setup. Dispatch calls are memoized by `stepId` — restarting a workflow skips steps that already completed.

The `WorkflowRuntime` (`src/modules/workflow/runtime/runtime.ts`) persists run state to SQLite, reconciles stalled runs on startup, and pushes events via MCP resource change notifications.

---

## Related

- Workflow flows: `src/modules/workflow/flows/`
- Runtime source: `src/modules/workflow/runtime/runtime.ts`
- Context API: `src/modules/workflow/runtime/context.ts`
