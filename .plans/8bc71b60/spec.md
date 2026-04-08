# Spec: Parallel Agent Dispatch with Delivery Lifecycle

## Problem

The brain platform dispatches agents sequentially within a workstream — one worktree per workstream means only one agent can execute at a time, even when tasks have no dependency relationship. After an agent completes, there is no automated pipeline to push its branch, create a PR, wait for CI, merge, and clean up the worktree. This manual gap blocks autonomous multi-agent execution and makes wave-level coordination impossible.

## Requirements

1. **Per-task worktree allocation**: Each dispatched agent gets its own isolated worktree and branch, enabling N agents in the same workstream to execute concurrently.
2. **Delivery state machine**: Agent completion triggers an automated pipeline: push branch → create PR → poll CI → merge → cleanup. Each stage is tracked as a durable state transition.
3. **Delivery state persistence**: A `delivery_states` table tracks each delivery through the state machine with PR metadata, timestamps, and failure reasons.
4. **Delivery reconciler**: A periodic reconciler polls all `pr-open` deliveries, attempts auto-merge when CI passes, detects conflicts, and triggers cleanup after merge.
5. **`pending-merge` task status**: PM task status set gains `pending-merge` so wave gates can distinguish "code done" from "code merged."
6. **Wave-level gate**: A wave is complete only when all its tasks reach `done` (merged) — not just `pending-merge`. The coordinator blocks next-wave dispatch until the gate clears.
7. **Conflict resolution**: When a PR becomes unmergeable (another PR merged first), the reconciler rebases the branch and force-pushes. If rebase fails, the task is re-dispatched.
8. **Backpressure integration**: `BackpressureController` is wired into the dispatch guard — effective WIP is reduced when merge queue depth, conflict rate, or stall rate exceed thresholds.
9. **Slot management**: Worktree budget is tied to effective WIP limit. The dispatch guard checks both WIP count and worktree budget before spawning.
10. **Reconciler tracks N deliveries**: The reconciler iterates all active deliveries (not a single slot) and drives each independently through the state machine.

## Constraints

- **No new external dependencies**: Uses existing `gh` CLI, `git` CLI, and better-sqlite3.
- **Backward compatible**: Existing single-agent workflows continue to work. Tasks without branches skip the delivery pipeline.
- **Idempotent reconciler**: Safe to run multiple times concurrently. Each state transition is guarded by current-state checks.
- **No GitHub merge queue requirement**: Design must work without repo-level merge queue enabled. Merge queue is an optional optimization.
- **ESM-only, Node16 resolution**: All new files use `.js` import extensions.
- **Existing test contracts**: Spec test files in `__tests__/modules/agents/delivery*.test.ts` define expected API surface — implementation must satisfy these.

## Out of Scope

- GitHub merge queue repo configuration (docs only — users enable it themselves).
- Cross-repo delivery (all PRs target same repo's `main`).
- Runtime-level multi-agent parallelism in `WorkflowRuntime` (tracked by VNM-48.59 separately; this design produces the infrastructure it will consume).
- Dashboard UI for delivery status (separate workstream).
- Automated rollback on post-merge test failure.

## Dependencies

- `src/modules/agents/auto-merge.ts` — existing PR polling and merge primitives.
- `src/modules/agents/conflict-recovery.ts` — existing rebase logic.
- `src/modules/agents/backpressure.ts` — existing `BackpressureController`.
- `src/modules/agents/completion-protocol.ts` — existing completion message parsing.
- `src/modules/pm/engine/state-machine.ts` — task status validation (needs `pending-merge`).
- `src/modules/pm/engine/dependency.ts` — wave computation.
