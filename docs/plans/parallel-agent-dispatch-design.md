# Parallel Agent Dispatch with Work Delivery Lifecycle

**Task**: VNM-48.142 — Consolidated design for VNM-48.60 (parallel dispatch) + VNM-48.86 (delivery lifecycle)  
**Date**: 2026-04-08  
**Status**: Design

## Problem Statement

The current system dispatches tasks **sequentially** within waves (see `wave-execution.ts:87` TODO). Worktrees are allocated **per-workstream**, meaning two tasks in the same workstream share a physical worktree — blocking true parallelism. There is no automated delivery pipeline: PRs and merges are `assisted` steps requiring human intervention. The reconciler tracks one active agent per workflow step, not N concurrent deliveries.

## Current Architecture Constraints

| Component | Current | Limitation |
|---|---|---|
| `worktree.ts` | Per-workstream allocation (`.worktrees/<workstream>/`) | Two tasks in same workstream reuse same worktree |
| `concurrency.ts` | Max 1 `in-progress` per workstream | Blocks parallel execution within a workstream |
| `wave-execution.ts` | Sequential `for` loop over `wave.taskIds` | No concurrent `ctx.dispatch()` calls |
| `auto-merge.ts` | Standalone functions, not integrated into workflow | No state machine, no retry, no queue |
| `agent-done-handler.ts` | Releases worktree DB record immediately | No "wait for PR merge" phase |
| `BackpressureController` | Exists but not wired into wave execution | WIP adjustment is theoretical |
| Reconciler | Polls one `agentId` per workflow step | Can't track N parallel agents |

## Design

### 1. Per-Task Worktree Allocation

**Change**: Worktrees are allocated per-task, not per-workstream.

```
Branch: agent/<workstream>/<taskId>
Path:   .worktrees/<workstream>/<taskId>/
```

The `allocateWorktree` function changes:
- Remove the "reuse existing worktree for same workstream" path (lines 74-93 of `worktree.ts`)
- Path becomes `resolve(projectRoot, basePath, opts.workstream, opts.taskId)` instead of `resolve(projectRoot, basePath, opts.workstream)`
- Budget enforcement stays but counts all active allocations globally (unchanged)
- `DEFAULT_BUDGET` increases from 3 to 6 (configurable via `ao.config.json`)

**Migration**: Existing per-workstream worktrees are cleaned up by `cleanupStaleAllocations()` on next run — no schema change needed since the DB already stores per-task records.

### 2. Delivery State Machine

Each task's work product follows a delivery lifecycle independent of the agent that produced it. This decouples "agent done" from "work merged."

```
States:
  pending → agent-active → push → pr-open → ci-check → merge-ready → merged → cleanup → done
                                                    ↗
  Failure transitions:     push-failed ← push
                          ci-failed ← ci-check → fixup → ci-check
                          merge-conflict ← merge-ready → rebase → ci-check
                          merge-failed ← merge-ready
```

**Key transitions:**

| From | To | Trigger |
|---|---|---|
| `pending` | `agent-active` | `ctx.dispatch()` spawns agent |
| `agent-active` | `push` | Agent completes (agent-done hook) |
| `push` | `pr-open` | `git push` + `gh pr create` succeeds |
| `pr-open` | `ci-check` | PR created, CI triggered |
| `ci-check` | `merge-ready` | All checks pass + PR mergeable |
| `ci-check` | `ci-failed` | Checks fail → retry up to 2x with fixup agent |
| `merge-ready` | `merged` | `gh pr merge --squash` succeeds |
| `merge-ready` | `merge-conflict` | PR no longer mergeable (concurrent merge changed base) |
| `merge-conflict` | `ci-check` | Rebase onto main + force-push → re-run CI |
| `merged` | `cleanup` | Worktree + branch removal |
| `cleanup` | `done` | PM task marked done, cascade triggered |

**New file**: `src/modules/agents/delivery.ts`

```typescript
export type DeliveryState =
  | 'pending' | 'agent-active' | 'push' | 'pr-open' | 'ci-check'
  | 'merge-ready' | 'merged' | 'cleanup' | 'done'
  | 'push-failed' | 'ci-failed' | 'merge-conflict' | 'merge-failed';

export interface DeliveryRecord {
  taskId: string;
  workstream: string;
  branch: string;
  worktreePath: string;
  state: DeliveryState;
  prNumber: number | null;
  agentId: string | null;
  retryCount: number;
  createdAt: string;
  updatedAt: string;
}
```

Storage: New `delivery` table in brain.db (module migration in agents module). The delivery record is the source of truth for "where is this task's code?"

**Critical design choice**: The worktree is released at the `push` state (after code is pushed to remote), NOT at `merged`. This means the worktree slot is freed as soon as the agent finishes and its branch is pushed — the PR review/merge cycle doesn't hold a worktree hostage.

### 3. Parallel Dispatch in Wave Execution

**Change `wave-execution.ts`**: Replace the sequential `for` loop with concurrent dispatch.

```typescript
// Current (sequential):
for (const taskId of wave.taskIds) {
  await ctx.dispatch(stepId, template, taskId);
}

// New (parallel):
const dispatches = wave.taskIds.slice(0, effectiveWip).map(taskId => {
  const stepId = `wave-${wave.wave}-task-${taskId}`;
  return ctx.dispatch(stepId, template, taskId);
});
await Promise.allSettled(dispatches);
```

**New runtime capability needed**: `WorkflowRuntime` must support multiple concurrent `dispatch()` calls per workflow run. Currently `ctx.dispatch()` sets a single `agentId` on the run and the reconciler checks that one ID. This must change to a **set of active agent IDs** per run.

### 4. Multi-Agent Reconciler

**Change `runtime.ts` reconciler**: Instead of checking one `agentId` per run, iterate over all active delivery records for the workflow.

```typescript
// Current reconcile():
if (run.agentId) { checkAgent(run.agentId); }

// New reconcile():
const activeDeliveries = getActiveDeliveries(db, run.id);
for (const delivery of activeDeliveries) {
  reconcileDelivery(delivery);  // check agent status, advance state machine
}
```

The `reconcileDelivery` function drives the delivery state machine:
1. If `agent-active` and agent completed → transition to `push`, trigger push
2. If `push` → execute `git push`, create PR → transition to `pr-open`
3. If `ci-check` → poll PR status via `gh pr view` → transition based on checks
4. If `merge-ready` → attempt `gh pr merge --squash` → handle success/conflict
5. If `merge-conflict` → rebase branch onto main, force-push → back to `ci-check`
6. If `merged` → release worktree, mark task done → `cleanup` → `done`

**Reconciler cadence**: Keep 10s for agent status checks. Add a 30s cadence for delivery pipeline polling (PR status checks are slower and rate-limited by GitHub API).

### 5. Wave Gate Checks

**Change**: Gates must wait for all parallel tasks' deliveries to reach `done`, not just for agents to finish.

```typescript
// After dispatching a wave's tasks in parallel:
await waitForWaveDeliveries(ctx, wave);
// Then run gate check (typecheck + tests on main)
await runGateCheck(ctx, wave, gateCommand);
```

`waitForWaveDeliveries` polls the delivery table until all tasks in the wave are in a terminal state (`done` or a permanent failure). This is driven by the reconciler advancing deliveries automatically.

**Wave-level failure policy**: If any delivery in a wave reaches a permanent failure state (`merge-failed` after max retries), the wave pauses for assisted intervention — same as the current gate-failure behavior.

### 6. Merge Conflict Resolution

**Strategy**: Sequential merge with automatic rebase.

When N PRs from the same wave target main simultaneously:
1. The reconciler attempts to merge PRs in task-ID order (deterministic)
2. If a merge succeeds, other PRs in `merge-ready` may become conflicted
3. The reconciler detects `merge-conflict` via `gh pr view` showing `NOT_MERGEABLE`
4. It rebases the branch onto the new main: `git fetch origin main && git rebase origin/main`
5. If rebase succeeds → force-push → back to `ci-check` (CI must re-pass after rebase)
6. If rebase has conflicts → transition to `merge-failed`, require human intervention

**Why not GitHub merge queue?** Merge queues are overkill for a single-developer project and add latency. The sequential merge + auto-rebase approach is simpler and faster. If needed later, merge queue support can be added as an alternative `MergeStrategy`.

**Rebase retry limit**: Max 2 rebase attempts per delivery (covers the case where another PR merges between your rebase and merge attempt). After 2 failures → `merge-failed`.

### 7. WIP Limits and Slot Management

**Integration point**: Wire `BackpressureController` into wave execution.

```typescript
// In wave execution, before dispatching:
const adjustment = backpressure.computeEffectiveWip();
const effectiveWip = Math.min(wipLimit, adjustment.effectiveWip);
const tasksToDispatch = wave.taskIds.slice(0, effectiveWip);
```

**Slot tracking**: Active slots = count of delivery records NOT in terminal state (`done`, `merge-failed`). The budget check in `allocateWorktree` already counts active allocations, but now worktrees are released at `push` (not `done`), so the worktree budget and delivery slot count diverge intentionally:
- **Worktree slots** (physical): released after push, limits concurrent disk usage
- **Delivery slots** (logical): released after done, limits concurrent pipeline load

`BackpressureController` feeds are updated by the reconciler:
- `recordMerge()` called when delivery transitions to `merged` or `merge-failed`
- `setMergeQueueDepth()` set to count of deliveries in `pr-open` + `ci-check` + `merge-ready`
- `recordStall()` called when a delivery has been in `ci-check` for >5 minutes

### 8. Concurrency Model Change

**Remove single-lane constraint**: `checkWorkstreamConcurrency` currently blocks if any task in the workstream is `in-progress`. For parallel dispatch, this must allow N concurrent tasks up to the WIP limit.

```typescript
// Current: blocks if ANY other task is in-progress
// New: blocks if active count >= effectiveWip
export function checkWorkstreamConcurrency(
  db: BrainDB, taskDisplayId: string, wipLimit: number
): ConcurrencyCheck {
  const activeTasks = listTasks(db, prefix, { workstream, status: 'in-progress' });
  if (activeTasks.length >= wipLimit) {
    return { allowed: false, blockingTask: activeTasks[0].display_id };
  }
  return { allowed: true };
}
```

## Implementation Plan

### Phase 1: Per-Task Worktrees + Delivery Table
1. Change `allocateWorktree` to per-task paths
2. Add `delivery` table migration in agents module
3. Implement `delivery.ts` with state machine and transitions
4. Update `agent-done-handler.ts` to create delivery record instead of immediately marking task done

### Phase 2: Delivery Reconciler
5. Implement `delivery-reconciler.ts` with push/PR/CI/merge automation
6. Add delivery polling loop to `WorkflowRuntime.reconcile()`
7. Wire `BackpressureController` into reconciler feedback

### Phase 3: Parallel Wave Dispatch
8. Update `WorkflowRuntime` to support multiple concurrent agents per run
9. Update `wave-execution.ts` to use `Promise.allSettled` for parallel dispatch
10. Update `checkWorkstreamConcurrency` to allow N concurrent tasks
11. Add `waitForWaveDeliveries` gate logic

### Phase 4: Conflict Resolution + Hardening
12. Implement auto-rebase on merge conflict
13. Add retry limits and permanent failure states
14. Wire backpressure feedback from delivery outcomes
15. Integration tests for parallel dispatch + delivery lifecycle

## Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| GitHub API rate limiting from PR polling | Delivery stalls | 30s poll cadence, batch `gh` calls, cache PR status |
| Rebase conflicts in parallel PRs | Blocked deliveries | Auto-rebase with retry limit; fallback to assisted |
| Worktree disk usage with many parallel tasks | Disk full | Budget limit (default 6), early release at push |
| Race condition in concurrent `allocateWorktree` | Double allocation | SQLite serializes writes; budget check is atomic |
| Agent spawning overhead (N Claude processes) | System resource pressure | BackpressureController reduces WIP under load |

## Non-Goals

- **GitHub merge queue integration**: Deferred; auto-rebase is sufficient for single-developer
- **Cross-workstream parallelism**: This design is within-workstream; cross-workstream already works via separate worktrees
- **PR review by other agents**: The pr-lifecycle workflow already handles this; delivery pipeline just needs to wait for checks to pass
- **Partial wave advancement**: All tasks in a wave must complete before the next wave starts (maintains dependency ordering)
