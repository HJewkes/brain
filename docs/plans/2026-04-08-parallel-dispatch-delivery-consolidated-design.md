# Parallel Agent Dispatch & Delivery Lifecycle — Consolidated Design

**Task:** VNM-48.165  
**Consolidates:** VNM-48.60 (parallel dispatch) + VNM-48.86 (delivery lifecycle)  
**Date:** 2026-04-08  
**Status:** Final design

---

## Summary

Enable N concurrent agents executing within a workstream on isolated per-task worktrees, with an automated delivery pipeline that pushes branches, creates PRs, and merges to main — all without holding worktrees hostage during CI/merge. The wave gate advances only when all parallel PRs are merged to main.

---

## 1. Per-Task Worktree Allocation

**Problem:** Current model reuses one worktree per workstream, blocking parallel execution.

**Design:**

```
.worktrees/{taskId}/     ← task-scoped, not workstream-scoped
  branch: agent/{workstream}/{taskId}
```

Changes to `src/modules/agents/worktree.ts`:
- Remove `findExistingAllocation(db, workstream)` reuse path
- Always create new worktree at `.worktrees/{taskId}/`
- Path uniqueness enforced by `worktree_allocations.path UNIQUE`
- Branch uniqueness enforced by task ID in branch name

**Worktree lifecycle:**
```
ALLOCATED → ACTIVE → PUSHED → RELEASED
```

Key insight: **worktree is released after push, not after merge.** Once the branch is pushed to origin, the local worktree has no further purpose. The delivery pipeline tracks the PR by number, not by worktree path. This means worktree slots are held only during agent execution (~minutes), not during CI/merge (~hours).

**Budget:** Global worktree limit = `effectiveWip` from backpressure controller (default 4). Only `ALLOCATED` and `ACTIVE` worktrees count against this budget. `PUSHED` worktrees are immediately released.

---

## 2. Delivery State Machine

**New table: `agent_deliveries`**

```sql
CREATE TABLE agent_deliveries (
  id            TEXT PRIMARY KEY,
  task_id       TEXT NOT NULL,
  agent_id      TEXT NOT NULL,
  workstream    TEXT,
  branch        TEXT NOT NULL,
  pr_number     INTEGER,
  pr_url        TEXT,
  status        TEXT NOT NULL DEFAULT 'pending',
  pushed_at     TEXT,
  pr_opened_at  TEXT,
  merged_at     TEXT,
  delivered_at  TEXT,
  error         TEXT,
  retry_count   INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_deliveries_status ON agent_deliveries(status);
CREATE INDEX idx_deliveries_task ON agent_deliveries(task_id);
```

**States and transitions:**

```
pending          agent claimed task, delivery record created
  → pushed       agent done, branch pushed to origin
  → failed       agent failed or push error

pushed           branch on origin, no PR yet
  → pr_open      gh pr create succeeded
  → failed       PR creation error

pr_open          PR exists, CI running
  → merge_queued CI passed, auto-merge enabled (gh pr merge --auto --squash)
  → ci_failed    CI failed
  → merged       PR merged (detected by reconciler)

ci_failed        CI checks failed
  → failed       max retries (3) exceeded → redispatch task
  → pr_open      fix pushed, CI re-running

merge_queued     in GitHub merge queue or auto-merge pending
  → merged       merge completed
  → conflict     merge queue conflict detected
  → failed       merge queue error

conflict         merge conflict detected
  → pr_open      rebase succeeded, force-pushed, CI re-running
  → failed       rebase failed after 3 attempts → redispatch task

merged           PR merged to main
  → delivered    cleanup complete, PM task marked done

delivered        (terminal) task fully integrated

failed           (terminal) requires redispatch or human intervention
```

**Implementation:** `src/modules/agents/delivery.ts`

```typescript
// Core CRUD
export function createDelivery(db, opts: { taskId, agentId, workstream, branch }): string
export function transitionDelivery(db, id: string, newStatus: string, updates?: Partial<DeliveryRecord>): void
export function getDelivery(db, taskId: string): DeliveryRecord | null
export function getActiveDeliveries(db): DeliveryRecord[]   // status NOT IN ('delivered', 'failed')
export function getDeliveriesForWave(db, taskIds: string[]): DeliveryRecord[]

// Also re-exported for reconciler test compatibility:
export function recordDelivery(db, agentId, opts): void      // alias for createDelivery
```

---

## 3. Delivery Reconciler

**New file:** `src/modules/agents/delivery-reconciler.ts`

Background poller that drives delivery state transitions by checking GitHub PR status.

```typescript
export class DeliveryReconciler {
  private intervalMs = 15_000;  // 15s default
  private timer: NodeJS.Timeout | null = null;

  start(db: Database): void     // begins polling
  stop(): void                   // stops polling
  async reconcileOnce(db: Database, projectDir: string): Promise<ReconcileResult>
}

interface ReconcileResult {
  checked: number;
  transitioned: number;
  errors: string[];
}
```

**Reconcile loop per delivery:**

| Current status | Check | Transition |
|---|---|---|
| `pushed` | — | Create PR via `gh pr create`, → `pr_open` |
| `pr_open` | `gh pr view --json state,statusCheckRollup` | CI passed → `merge_queued` (enable auto-merge); CI failed → `ci_failed`; already merged → `merged` |
| `merge_queued` | `gh pr view --json state,mergeStateStatus` | MERGED → `merged`; CONFLICTING → `conflict` |
| `conflict` | Attempt rebase via `conflict-recovery.ts` | Success → force-push → `pr_open`; Fail → `failed` |
| `merged` | — | Release worktree, mark PM task done → `delivered` |

**Lifecycle:** Embedded in workflow runtime, started lazily when first parallel dispatch begins, stopped when all wave deliveries reach terminal state. Not a long-running daemon — avoids process management complexity.

**GitHub API efficiency:** Use `gh pr list --json number,state,mergeStateStatus` to batch-check multiple PRs in one call rather than N individual `gh pr view` calls.

---

## 4. Wave-Level Gate Checks

**Problem:** Current wave gate checks PM task status (`done`), but with async delivery a task can be `done` in PM while its PR hasn't merged.

**Design: Two-phase completion**

- **`done` in PM** = agent finished work, delivery initiated (may not be merged yet)
- **`delivered`** = PR merged to main, worktree cleaned up, code integrated

**Wave gate logic** (modifies `computeEligible` in `dependency.ts`):

```typescript
function isDeliveryComplete(db: Database, taskId: string): boolean {
  const delivery = getDelivery(db, taskId);
  if (delivery) return delivery.status === 'delivered';
  // No delivery record = non-isolated task (research/design) — PM status sufficient
  return true;
}

// In computeEligible: add delivery check after dependency check
const eligible = tasks.filter(t =>
  t.status === 'pending' &&
  allDependenciesMet(t) &&
  t.depends_on.every(depId => isDeliveryComplete(db, depId))
);
```

**Wave gate in wave-execution flow:**
1. Dispatch all wave N tasks in parallel (up to WIP limit)
2. Wait for all agents to complete (agent-done signals)
3. Delivery reconciler drives all PRs to terminal state
4. Wave gate: poll `getDeliveriesForWave(waveTaskIds)` — advance when ALL are `delivered`
5. On any `failed`: pause workflow for assisted intervention
6. On all `delivered`: run post-merge integration checks (`npm run typecheck && npm test` on main)
7. Only advance to wave N+1 if integration checks pass

**Timeout:** `wipLimit * 30 minutes` per wave. Timeout triggers pause, not failure.

---

## 5. WIP Limits & Slot Management

**Problem:** `checkWorkstreamConcurrency()` enforces one in-progress per workstream. `BackpressureController` computes effective WIP but isn't wired into dispatch.

**Design:**

Remove `checkWorkstreamConcurrency()` sequential lock. Replace with global slot management:

```typescript
function computeUsedSlots(db: Database): number {
  // Only count active agents, NOT delivery pipeline
  return countTasksWithStatus(db, ['claimed', 'in-progress']);
}

function canDispatch(db: Database, backpressure: BackpressureController): { allowed: boolean; reason?: string } {
  const { effectiveWip } = backpressure.computeEffectiveWip();
  const used = computeUsedSlots(db);
  if (used >= effectiveWip) {
    return { allowed: false, reason: `WIP limit: ${used}/${effectiveWip} slots used` };
  }
  return { allowed: true };
}
```

**Key decision: delivery pipeline does NOT consume WIP slots.** Rationale: agents free their slot as soon as they push. The delivery pipeline (PR creation, CI, merge) runs asynchronously without holding compute resources. If we counted deliveries against WIP, a slow CI pipeline would starve agent dispatch. Instead, backpressure from delivery problems (conflicts, stalls) feeds into `BackpressureController` which reduces the effective WIP cap dynamically.

**Dispatch loop** (replaces sequential `for` in `wave-execution.ts`):

```typescript
async function dispatchWaveParallel(ctx, waveTasks) {
  const pending = [...waveTasks];
  const inFlight = new Map<string, Promise<void>>();

  while (pending.length > 0 || inFlight.size > 0) {
    // Fill available slots
    while (pending.length > 0 && canDispatch(ctx.db, ctx.backpressure).allowed) {
      const task = pending.shift()!;
      const p = dispatchAgent(ctx, task);
      inFlight.set(task.id, p);
    }

    // Wait for any agent to complete, freeing a slot
    if (inFlight.size > 0) {
      const completedId = await Promise.race(
        [...inFlight.entries()].map(([id, p]) => p.then(() => id))
      );
      inFlight.delete(completedId);
    }
  }
}
```

---

## 6. Merge Conflict Resolution

**Primary: GitHub Merge Queue**

When available (repo has merge queue enabled):
1. On `pr_open` with CI passed: `gh pr merge --auto --squash`
2. GitHub serializes merges atomically — no manual conflict resolution needed
3. Reconciler polls `mergeStateStatus`: `MERGEABLE | CONFLICTING | BLOCKED | MERGED`

**Fallback: Rebase strategy** (when merge queue unavailable or conflict detected):

1. Reconciler detects `CONFLICTING` on PR
2. Worktree still exists (or re-created if already released) — fetch + rebase onto `origin/main`
3. Force-push with lease: `git push --force-with-lease`
4. Delivery transitions back to `pr_open` (CI re-runs)
5. Max 3 rebase attempts per delivery; on failure → `failed` → task redispatched

**Conflict prevention:** File ownership partitioning at dispatch time. Each parallel task gets a disjoint set of owned files via `ownership.json` injected into agent context. Pre-tool-use hook enforces ownership boundaries. Parallel tasks in the same wave should not touch overlapping files.

---

## Resolved Open Questions

| Question | Decision | Rationale |
|---|---|---|
| Reconciler: daemon or embedded? | **Embedded in workflow runtime** | Avoids process management; lifecycle tied to active workflow run |
| Partial wave success? | **Block entirely** | Failed deliveries pause for assisted review; partial advancement risks broken integration |
| Delivery slots count against WIP? | **No** | Agents free slots on push; delivery is async I/O. Backpressure controller handles delivery problems indirectly |
| Worktree budget model? | **Budget = effectiveWip** | Only active agent worktrees count; released immediately after push |
| Per-task file ownership? | **Injected at dispatch time** | Task-scoped ownership in agent context JSON; pre-tool-use hook enforces |
| Conflict redispatch limit? | **3 attempts per delivery** | After 3 failed rebases, task goes to `failed` and workflow pauses |
| Wave gate granularity? | **All-or-nothing per wave** | No partial advancement; ensures integration checks run on complete wave |
| Merge queue required? | **Optional with graceful degradation** | Rebase fallback sufficient for N ≤ 5; document merge queue as recommended for larger N |

---

## Implementation Phases

| Phase | Files | Description |
|---|---|---|
| 1 | `worktree.ts` | Per-task allocation, remove workstream reuse |
| 2 | `schema.ts`, `delivery.ts` | `agent_deliveries` table + state machine CRUD |
| 3 | `delivery-reconciler.ts` | Background PR polling + state transitions |
| 4 | `concurrency.ts`, `task-pull.ts`, `backpressure.ts` | Remove sequential lock, wire backpressure into dispatch gate |
| 5 | `agent-done-handler.ts` | Create delivery record on agent completion, push branch |
| 6 | `wave-execution.ts` | Parallel dispatch loop with slot management |
| 7 | `dependency.ts` | Wave gate: require `delivered` not just `done` |
| 8 | `auto-merge.ts` | Merge queue integration + rebase fallback |
| 9 | `runtime.ts` | `activeAgents[]` support in workflow runtime reconciler |

---

## Test Coverage Alignment

Existing spec tests in `__tests__/modules/agents/delivery.test.ts` and `delivery-reconciler.test.ts` cover:

- 7-stage delivery pipeline (allocate → work → push → PR → review → merge → cleanup)
- Idempotent PR creation
- Reconciler detecting externally merged PRs
- Cleanup after merge (worktree release, delivery → delivered)
- Critic issues C1 (review command), C2 (no premature worktree release), C3 (orphaned cleanup)

Additional tests needed for:
- Parallel dispatch loop (N agents dispatched, slot management)
- Wave gate blocking until all deliveries reach `delivered`
- Backpressure integration (conflict rate → reduced WIP)
- Rebase conflict recovery (success + failure paths)
- State machine transition validation (no invalid transitions)

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| GitHub API rate limits under N polls | Medium | Medium | Batch `gh pr list`; 15s interval caps at 4 calls/min |
| Rebase conflicts not auto-resolvable | Low | High | File ownership partitioning; max 3 retries → escalate |
| Worktree disk usage during high parallelism | Low | Low | Released after push; budget = effectiveWip (max ~6) |
| Slot starvation from slow CI | Medium | Medium | Delivery doesn't consume WIP slots; agents always dispatch |
| Race condition in concurrent task claims | Low | Medium | DB UNIQUE constraint on task_id in deliveries; claim_token validation |
