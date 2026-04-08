# Acceptance Criteria: Parallel Agent Dispatch with Delivery Lifecycle

## Criteria

### AC-01: Per-task worktree allocation
**Given:** Two tasks `VNM-48.101` and `VNM-48.102` in the same workstream, both eligible for dispatch
**When:** Both are dispatched concurrently via `allocateWorktree`
**Then:** Each gets a unique worktree path (`.worktrees/VNM-48-101` and `.worktrees/VNM-48-102`), unique branch (`agent/48/VNM-48.101` and `agent/48/VNM-48.102`), and neither blocks the other

### AC-02: Worktree budget enforcement
**Given:** WIP limit is set to 3 and 3 worktrees are already allocated
**When:** A 4th task attempts `allocateWorktree`
**Then:** Allocation throws `"Worktree budget exhausted: 3/3"` and the task remains in `pending` status

### AC-03: Delivery initiation on agent completion
**Given:** An agent completes (exit code 0) with branch `agent/48/VNM-48.101`
**When:** `agent-done-handler` fires
**Then:** `initiateTaskDelivery` is called, branch is pushed to origin, a PR is created targeting main, `delivery_states` record is created with status `pr-open`, and PM task status becomes `pending-merge`

### AC-04: Non-implementation agent skips delivery
**Given:** An agent completes (exit code 0) with no branch (design/research task)
**When:** `agent-done-handler` fires
**Then:** Worktree is released immediately, PM task is marked `done`, no `delivery_states` record is created

### AC-05: Failed agent skips delivery
**Given:** An agent completes with exit code 1 (failure) and has a branch
**When:** `agent-done-handler` fires
**Then:** Agent is marked `failed`, worktree is released, PM task is set to `blocked`, no delivery is initiated

### AC-06: Reconciler auto-merges ready PR
**Given:** A delivery with status `pr-open`, CI passes, and PR is mergeable
**When:** `reconcileDeliveries` runs
**Then:** PR is merged via `gh pr merge --squash --delete-branch`, delivery status transitions to `merged`, then `cleanupAfterMerge` runs: worktree released (physical + DB), PM task marked `done`, delivery status set to `delivered`

### AC-07: Reconciler handles conflict
**Given:** A delivery with status `pr-open` and PR is not mergeable (conflict with main)
**When:** `reconcileDeliveries` runs
**Then:** Reconciler calls `tryRebase` on the branch. If rebase succeeds, branch is force-pushed and delivery remains `pr-open` for next cycle. If rebase fails, delivery is cleared, PM task returns to `pending`, worktree is released.

### AC-08: Reconciler retries push failures
**Given:** A delivery with status `push-failed`
**When:** `reconcileDeliveries` runs
**Then:** `pushTaskBranch` is retried. On success, status advances to `pr-open` (after PR creation). On repeated failure, status remains `push-failed` for next cycle.

### AC-09: Wave gate blocks next wave
**Given:** Wave 1 has tasks A (status `done`) and B (status `pending-merge`)
**When:** Coordinator checks wave gate for wave 1
**Then:** Gate returns `false` (wave not complete) because task B has not merged yet

### AC-10: Wave gate clears when all merged
**Given:** Wave 1 has tasks A (status `done`) and B (status `done`, just merged)
**When:** Coordinator checks wave gate for wave 1
**Then:** Gate returns `true`, wave 2 tasks become eligible for dispatch

### AC-11: Backpressure reduces effective WIP
**Given:** `BackpressureController` with base WIP of 5, merge queue depth is 3 (>2 threshold)
**When:** `computeEffectiveWip()` is called during dispatch guard
**Then:** Effective WIP is less than 5 (reduced by backpressure), and dispatch is blocked if active agent count >= effective WIP

### AC-12: Delivery state persistence survives restart
**Given:** A delivery with status `pr-open` and the coordinator process restarts
**When:** `reconcileDeliveries` runs after restart
**Then:** The delivery is found in the `delivery_states` table and processing continues from `pr-open` (no data loss)

### AC-13: `pending-merge` is a valid PM task status
**Given:** A PM task in status `in-progress`
**When:** `updateTaskStatus(taskId, 'pending-merge')` is called
**Then:** The transition succeeds and the task's status is `pending-merge`

### AC-14: Delivery record tracks PR metadata
**Given:** A delivery has been initiated and PR #42 was created
**When:** `getDelivery(db, agentId)` is called
**Then:** Returns `DeliveryRecord` with `prNumber: 42`, `prUrl: "https://github.com/.../pull/42"`, `status: 'pr-open'`, and valid `createdAt`/`updatedAt` timestamps

## Edge Cases

### EC-01: Agent completes but push fails (no network)
**Given:** An agent completes successfully but `git push` fails (network error)
**When:** `initiateTaskDelivery` runs
**Then:** Delivery status is set to `push-failed`, worktree is NOT released (needed for retry), PM task stays `in-progress` (not yet `pending-merge`)

### EC-02: PR created but CI never passes
**Given:** A delivery in `pr-open` where CI has been failing for >1 hour
**When:** `reconcileDeliveries` runs repeatedly
**Then:** Delivery remains in `pr-open` (no auto-merge attempted), backpressure controller records stall, effective WIP decreases

### EC-03: Two PRs merge concurrently, second causes conflict
**Given:** PR-A and PR-B both target main, both pass CI, PR-A merges first
**When:** Reconciler processes PR-B (now shows as not mergeable)
**Then:** Reconciler detects conflict, attempts rebase on PR-B's branch, force-pushes if successful

### EC-04: Rebase fails due to irreconcilable conflict
**Given:** A delivery in `pr-open` where rebase fails (conflicting changes in same lines)
**When:** `reconcileDeliveries` runs rebase and it fails
**Then:** Delivery record is deleted, worktree is released, PM task status returns to `pending` for re-dispatch with updated main context

### EC-05: Stale worktree allocation (path deleted externally)
**Given:** A worktree allocation exists in DB but the physical directory was manually deleted
**When:** `cleanupStaleAllocations` runs (or delivery reconciler encounters it)
**Then:** DB record is cleaned up, no error thrown, task can be re-dispatched with fresh allocation

### EC-06: Concurrent reconciler invocations
**Given:** Two reconciler cycles overlap (first still running when second starts)
**When:** Both attempt to process the same `pr-open` delivery
**Then:** State transitions are guarded by current-status WHERE clauses — only one succeeds, the other is a no-op

## Non-Functional

### NF-01: Reconciler cycle time
Reconciler completes a full cycle (all active deliveries) within 30 seconds for up to 10 concurrent deliveries. Each `gh pr view` call is expected to take <2s.

### NF-02: Worktree disk usage
Each worktree uses approximately the same disk as a shallow checkout. With default WIP limit of 5, maximum disk overhead is 5x repo size in `.worktrees/`.

### NF-03: Delivery state machine idempotency
Every delivery state transition function is safe to call multiple times with the same input. Duplicate calls produce no side effects beyond the first successful transition.

### NF-04: Zero data loss on restart
All delivery state is persisted in SQLite. Process restart results in zero lost deliveries — reconciler resumes from persisted state.
