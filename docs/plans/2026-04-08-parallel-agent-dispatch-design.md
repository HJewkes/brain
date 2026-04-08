# Parallel Agent Dispatch with Work Delivery Lifecycle — Consolidated Design

**Task:** VNM-48.133 (consolidates VNM-48.60 + VNM-48.86)  
**Date:** 2026-04-08  
**Status:** Research complete → Design phase

---

## Problem Statement

The current agent dispatch model is sequential: one worktree per workstream, one active agent
per workflow run, and a delivery path that holds worktrees while waiting for PR merge. This
blocks parallel agent execution within a wave. Six interlocking problems must be solved:

1. **Worktree allocation** — per-task isolation, not per-workstream reuse
2. **Delivery state machine** — push → PR → CI → merge → cleanup without blocking worktrees
3. **Wave-level gate** — knows when all parallel PRs have merged before advancing
4. **Merge conflict resolution** — parallel PRs targeting main simultaneously
5. **WIP limits under concurrency** — slot management for N concurrent agents
6. **Reconciler** — tracks N deliveries, not just one

---

## Current State (Research Findings)

### What exists

| Component | Location | Current Model |
|-----------|----------|---------------|
| Worktree allocation | `src/modules/agents/worktree.ts` | One per workstream; reused across tasks |
| Dispatch | `src/modules/agents/task-pull.ts` | Pull one, claim one, dispatch one |
| Workflow runtime reconciler | `src/modules/workflow/runtime/runtime.ts` | `activeAgent` (singular) polled every 10s |
| WIP limits | `src/modules/pm/engine/state-machine.ts` | `canClaim()` at claim time only |
| Backpressure | `src/modules/agents/backpressure.ts` | Reactive post-merge; conflict/stall rate |
| Wave execution | `src/modules/workflow/flows/wave-execution.ts` | Sequential `for` loop with TODO to parallelize |
| Delivery | `src/modules/agents/auto-merge.ts` | Manual merge helpers, no state machine |
| Conflict recovery | `src/modules/agents/conflict-recovery.ts` | Rebase + redispatch |

### What's missing

- `src/modules/agents/delivery.ts` — delivery record + state machine (referenced in tests, not implemented)
- `src/modules/agents/delivery-reconciler.ts` — background polling for PR merge detection (tests exist)
- Slot manager — pre-dispatch reservation of N concurrent agent slots
- Multi-agent tracking in WorkflowRun — `activeAgents[]` replacing `activeAgent`

---

## Design

### 1. Per-Task Worktree Allocation

**Change:** Remove the workstream-reuse model. Allocate one worktree per task, period.

**New allocation path:**

```
allocateWorktreeForTask(taskId, workstream, claimToken):
  branch = "agent/{workstream}/{taskId}"
  path = ".worktrees/{taskId}"
  git worktree add {path} -b {branch}
  insert into worktree_allocations (task_id, workstream, worktree_path, branch, claim_token)
  return { path, branch }
```

**Worktree lifecycle:**

```
ALLOCATED → ACTIVE → PUSH_PENDING → PUSHED → DELIVERED → RELEASED
```

- `ALLOCATED`: created, agent has not started
- `ACTIVE`: agent running in worktree
- `PUSH_PENDING`: agent done, branch not yet pushed
- `PUSHED`: branch pushed, PR open (worktree can be removed!)
- `DELIVERED`: PR merged
- `RELEASED`: worktree path deleted, DB record removed

Key insight: worktree can be removed as soon as the branch is pushed. The delivery tracking
moves to the PR number, not the worktree path. This frees the worktree slot immediately.

**Slot budget:** Max concurrent worktrees = `wipLimit * 2` (tasks in-flight + delivery queue).
Backpressure controller modulates the base WIP, not the slot ceiling.

---

### 2. Delivery State Machine

**New table: `agent_deliveries`**

```sql
CREATE TABLE agent_deliveries (
  id          TEXT PRIMARY KEY,  -- UUID
  task_id     TEXT NOT NULL,
  agent_id    TEXT NOT NULL,
  workstream  TEXT,
  branch      TEXT NOT NULL,
  pr_number   INTEGER,
  pr_url      TEXT,
  state       TEXT NOT NULL DEFAULT 'pending',
  -- states: pending | pushing | pr_open | ci_running | ci_failed | merge_queued | merged | delivered | failed
  pushed_at   TEXT,
  pr_opened_at TEXT,
  merged_at   TEXT,
  delivered_at TEXT,
  error       TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
```

**State machine transitions:**

```
pending
  → pushing         (agent marks done, delivery starts)
  → failed          (push error)

pushing
  → pr_open         (gh pr create succeeds, PR number stored)
  → failed          (gh pr create error)

pr_open
  → ci_running      (CI checks detected)
  → merge_queued    (no CI, or CI passed, merge queue entry created)
  → ci_failed       (CI failed)
  → merged          (PR already merged, detected by reconciler)

ci_running
  → merge_queued    (CI passed)
  → ci_failed       (CI failed)

ci_failed
  → pr_open         (agent redispatched, new commit pushed)
  → failed          (max retries exceeded)

merge_queued
  → merged          (reconciler detects merge)
  → failed          (merge queue error)

merged
  → delivered       (PM task marked done, dependents unblocked)

delivered
  (terminal)

failed
  (terminal — may trigger redispatch depending on failure type)
```

**Transitions are driven by:**
- Agent actions: `pending → pushing → pr_open` (via delivery.ts helpers called from agent-done handler)
- Reconciler polling: `pr_open → merged → delivered` (via delivery-reconciler.ts)
- CI status events: `pr_open → ci_running → merge_queued` (via `gh pr checks` polling)

**`src/modules/agents/delivery.ts`** (new file):

```typescript
export interface DeliveryRecord { /* maps agent_deliveries table */ }

export async function createDelivery(db, { taskId, agentId, workstream, branch }): Promise<string>
export async function transitionDelivery(db, id, newState, updates?): Promise<void>
export async function getDeliveriesForWave(db, taskIds): Promise<DeliveryRecord[]>
export async function getPendingDeliveries(db): Promise<DeliveryRecord[]>
export async function getOpenPrDeliveries(db): Promise<DeliveryRecord[]>
```

---

### 3. Delivery Reconciler

**`src/modules/agents/delivery-reconciler.ts`** (new file):

The reconciler is a background poller (separate from workflow runtime reconciler) that:
1. Queries all `pr_open | ci_running | merge_queued` deliveries
2. For each, calls `gh pr view {pr_number} --json state,mergeStateStatus,statusCheckRollup`
3. Transitions state based on response
4. On `merged`: marks PM task done, unblocks dependents, emits wave-progress event

```typescript
export class DeliveryReconciler {
  private intervalMs: number;    // default 15_000
  private timer: NodeJS.Timer | null;

  start(db: BrainDB): void
  stop(): void
  async reconcileOnce(db: BrainDB): Promise<ReconcileResult>
}

interface ReconcileResult {
  checked: number;
  transitioned: number;
  errors: string[];
}
```

**Integration point:** `DeliveryReconciler` starts when the first parallel dispatch begins and
stops when all deliveries in the current wave reach terminal state. Owned by the workflow
runtime, not the agent module.

---

### 4. Wave-Level Gate with Parallel PR Awareness

**Current gate:** Runs `npm run typecheck && npm test` after all tasks in a wave dispatch
sequentially. Does not know about PR state.

**New gate model:**

```
Wave N tasks dispatched
  → all agents complete (agent-done signals received)
  → all push: pending → pr_open transitions complete
  → DeliveryReconciler polling active
  → WaveGate polls getDeliveriesForWave(waveTaskIds)
  → when ALL deliveries reach 'delivered' state
  → advance to Wave N+1
```

**Wave gate check (replaces post-wave `npm test`):**

The wave gate should:
1. Wait for all wave task deliveries to reach `delivered` or `failed`
2. On any `failed`: pause workflow for assisted intervention (existing pattern)
3. On all `delivered`: run post-merge integration checks (typecheck + test on main)
4. Only advance if integration checks pass

**Timeout:** Wave gate times out after `wipLimit * 30 minutes` (configurable). On timeout,
pause for assisted review.

---

### 5. WIP Limits and Slot Management Under Concurrency

**Slot Manager** (embedded in wave-execution flow, not a separate service):

```typescript
interface SlotState {
  capacity: number;          // base WIP limit from backpressure controller
  allocated: Set<string>;    // taskIds currently holding slots
  delivering: Set<string>;   // taskIds in delivery pipeline (don't count against capacity)
}
```

**Slot lifecycle:**
- `allocated` when task claimed (pulls from pool)
- Moved from `allocated` → `delivering` when agent done and branch pushed
- Removed from `delivering` when delivery reaches terminal state

This means WIP capacity tracks *in-flight agents*, not deliveries. Agents can push their
branch and immediately free their slot for the next agent, while the delivery pipeline
continues independently.

**Dispatch loop (replaces sequential `for` loop):**

```typescript
async function dispatchWave(ctx, tasks, slotState) {
  const pending = [...tasks];
  const inFlight: Map<string, Promise<void>> = new Map();

  while (pending.length > 0 || inFlight.size > 0) {
    // Fill available slots
    while (pending.length > 0 && inFlight.size < slotState.capacity) {
      const task = pending.shift()!;
      const p = dispatchAndMonitor(ctx, task, slotState);
      inFlight.set(task.id, p);
    }

    // Wait for any agent to complete
    if (inFlight.size > 0) {
      const completed = await Promise.race([...inFlight.entries()].map(([id, p]) =>
        p.then(() => id)
      ));
      inFlight.delete(completed);
      slotState.allocated.delete(completed);
    }
  }
}
```

**Backpressure integration:** Backpressure controller modulates `slotState.capacity` between
dispatch iterations. If merge queue depth is high, capacity drops; stalls increase, capacity
drops. Effective concurrency self-regulates.

---

### 6. Merge Conflict Resolution

**Strategy: GitHub Merge Queue** (primary), rebase fallback (secondary)

**Primary — Merge Queue:**
- When creating PRs, use `gh pr merge --merge-queue` (requires merge queue enabled on repo)
- GitHub serializes merges; PRs queue up and merge sequentially without manual conflict resolution
- Reconciler polls `gh pr view --json mergeStateStatus`: `MERGEABLE | CONFLICTING | BLOCKED`

**Fallback — Rebase and retry:**
When merge queue not available or PR is `CONFLICTING`:
1. Reconciler detects `CONFLICTING` state
2. Calls existing `conflict-recovery.ts` rebase logic against current main
3. Force-pushes rebased branch
4. Transitions delivery back to `pr_open` (CI re-runs)
5. Max 3 rebase attempts before escalating to `failed`

**Conflict prevention:** Per-task worktrees with task-scoped file ownership (from
`ownership.json`) means parallel tasks rarely touch the same files. File ownership gates
at dispatch time reduce conflict probability from O(N²) to near zero.

---

### 7. Updated WorkflowRun Schema

```typescript
interface WorkflowRun {
  // existing fields...
  activeAgent: AgentRef | null;  // keep for backward compat, single-agent workflows

  // new fields for parallel dispatch:
  activeAgents: AgentRef[];      // all currently in-flight agents
  deliveryIds: string[];         // IDs in agent_deliveries for this run
  slotCapacity: number;          // current effective WIP limit
}

interface AgentRef {
  pid: number;
  taskId: string;
  agentId?: string;
  stepId: string;
}
```

**Runtime reconciler update:**
- Existing single-agent reconciler → generalized to loop over `activeAgents[]`
- Each check: DB status first, then process liveness (existing pattern, just N times)
- Completion: pop from `activeAgents`, push taskId to `delivering` set in slot state

---

## Component Interaction Diagram

```
Wave Execution Flow
  │
  ├── SlotManager.allocate(taskId)
  │     └── canClaim() check → WIP gating
  │
  ├── dispatchAndMonitor(task)
  │     ├── allocateWorktreeForTask(task)
  │     ├── spawn agent process
  │     └── WorkflowRuntime.addActiveAgent(agentRef)
  │
  ├── [Agent runs in worktree]
  │     ├── writes code
  │     ├── runs tests
  │     └── signals DONE via stdout
  │
  ├── agent-done hook fires
  │     ├── AgentRecord.status → completed
  │     └── createDelivery(taskId, branch)
  │
  ├── DeliveryPipeline.execute(deliveryId)
  │     ├── git push origin {branch}
  │     ├── gh pr create → pr_number stored
  │     ├── worktree removed (slot freed!)  ← key: no longer blocks
  │     └── SlotManager.toDelivering(taskId)
  │
  ├── DeliveryReconciler (background, 15s interval)
  │     ├── polls gh pr view for all pr_open deliveries
  │     ├── transitions state (pr_open → ci_running → merged)
  │     └── on merged: PM cascade, wave-progress event
  │
  └── WaveGate.wait(waveTaskIds)
        ├── polls getDeliveriesForWave()
        ├── waits for all → delivered
        └── runs post-merge checks on main
```

---

## Open Questions for Design Phase

1. **Should `DeliveryReconciler` be a long-running daemon or embedded in workflow runtime?**
   Daemon is cleaner but adds process management complexity. Embedded is simpler but ties
   reconciliation lifetime to the workflow run. Recommendation: embedded, started lazily.

2. **How to handle partial wave success?** If 3 of 5 parallel tasks deliver and 2 fail,
   does the wave gate advance (with failures escalated) or block entirely?
   Recommendation: block entirely — failed deliveries pause for assisted review.

3. **File ownership enforcement for parallel tasks within a wave.** Current ownership.json
   is per-session; for parallel dispatch, ownership must be per-task. The ownership check
   hook needs to know which task owns which paths at dispatch time.
   Recommendation: inject per-task ownership at dispatch context build time, stored in
   agent's context JSON, referenced by pre-tool-use hook.

4. **Merge queue availability.** Not all GitHub repos have merge queue enabled.
   Fallback must be robust. The rebase strategy is sufficient for small N (≤5 parallel).
   For larger N, recommend documenting the requirement.

---

## Files to Create / Modify

| File | Change |
|------|--------|
| `src/modules/agents/delivery.ts` | New — delivery record CRUD + state machine |
| `src/modules/agents/delivery-reconciler.ts` | New — background PR polling loop |
| `src/modules/agents/worktree.ts` | Modify — per-task allocation, lifecycle states |
| `src/modules/workflow/flows/wave-execution.ts` | Modify — parallel dispatch loop, wave gate |
| `src/modules/workflow/runtime/runtime.ts` | Modify — `activeAgents[]` + multi-agent reconcile |
| `src/modules/pm/data/delivery-queries.ts` | New — SQL queries for agent_deliveries table |
| Migration SQL | New — `agent_deliveries` table |

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| GitHub API rate limits under N concurrent PR polls | Medium | Medium | Batch `gh pr list` instead of N individual calls; exponential backoff |
| Rebase conflicts not auto-resolvable | Low | High | Max retry limit → escalate to human; file ownership partitioning reduces probability |
| Process liveness race in multi-agent reconciler | Low | Medium | Existing AgentDeathError pattern extends naturally; DB check is primary |
| Slot starvation if delivery pipeline backs up | Medium | Medium | `delivering` set doesn't count against WIP capacity — agents always get slots |
| Wave gate timeout if CI is slow | Medium | Low | Configurable timeout; timeout triggers pause not failure |
