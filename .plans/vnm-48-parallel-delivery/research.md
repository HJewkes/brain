# VNM-48.122 — Parallel Agent Dispatch & Delivery Lifecycle: Research

**Workflow run**: 8bc71b60  
**Step**: planning:research  
**Date**: 2026-04-08

---

## 1. Problem Statement

Consolidate VNM-48.60 (parallel agent dispatch) with VNM-48.86 (work delivery lifecycle) into a single coherent design. Five problems must be solved:

1. **Per-task worktree allocation** — current per-workstream model limits intra-workstream parallelism  
2. **Delivery state machine** — push → PR → CI → merge → cleanup, without holding worktrees hostage  
3. **Wave-level gate checks** — know when all parallel PRs in a wave have merged  
4. **Merge conflict resolution** — parallel PRs targeting main simultaneously  
5. **WIP limits + slot management** — under concurrent dispatch and delivery  
6. **Reconciler** — tracks N parallel deliveries, not just one  

---

## 2. Current Architecture (as-built)

### 2.1 Worktree Allocation (`src/modules/agents/worktree.ts`)

- **Model**: ONE git worktree per **workstream**, at `.worktrees/{workstream}`
- **Branch**: per-task, `agent/{workstream}/{taskId}`
- **DB table**: `worktree_allocations` (task_id UNIQUE, worktree_path, branch, claim_token)
- **Reuse**: if same workstream already has a worktree, returns its path
- **Budget**: configurable max concurrent worktrees (default 3)

**Key constraint**: `task_id UNIQUE` means only one DB record per workstream at a time.  
This enforces sequential-within-workstream execution.

### 2.2 Routing / Concurrency Policy (`src/modules/pm/engine/routing.ts`, `concurrency.ts`)

- Implementation/infrastructure/migration tasks: `isolation: 'worktree'`, `concurrency: 'sequential-within-workstream'`
- Research/testing/config/review tasks: `isolation: 'none'`, `concurrency: 'parallel'`
- `checkWorkstreamConcurrency()` enforces only 1 task `in-progress` per workstream

### 2.3 Agent Done Handler (`src/modules/agents/agent-done-handler.ts`) — Current Gaps

Current `handleAgentDone` flow:
1. Mark agent completed/failed  
2. Release worktree DB record immediately  
3. Mark PM task `done` via CLI  
4. Session commit  

**Missing**: no push, no PR creation, no delivery state tracking.

### 2.4 Auto-merge Infrastructure (`src/modules/agents/auto-merge.ts`)

Complete but **unused**: `getPrForBranch()`, `mergePr()`, `tryAutoMerge()`. Ready to be wired up.

### 2.5 Schema — `agentsMigrationV2`

Currently adds only `context TEXT` column to `agents`. The delivery table does not exist yet.

### 2.6 Existing Tests (Spec Contracts)

Three test files define acceptance criteria:

| File | Covers |
|------|--------|
| `__tests__/modules/agents/delivery.test.ts` | 7-stage delivery lifecycle API |
| `__tests__/modules/agents/delivery-reconciler.test.ts` | reconcileDeliveries + cleanupAfterMerge |
| `__tests__/modules/agents/agent-done-delivery.test.ts` | handleAgentDone integration |

---

## 3. Design Decisions

### 3.1 Problem 1: Per-Task vs Per-Workstream Worktrees

**Finding**: The spec tests (`delivery.test.ts` AC-01) show worktrees at `.worktrees/{workstream}` — still per-workstream. Branches are per-task (`agent/{workstream}/{taskId}`).

**Design decision**: Keep **per-workstream worktrees** with **per-task branches**. True intra-workstream parallelism is not a goal of this feature (tasks within a workstream remain sequential). Cross-workstream parallelism (already supported) is the primary mechanism.

**Why the original requirement is satisfied**: "Per-task worktree allocation" in the task description refers to ensuring each *task's work* is isolated on its own branch — not that each task gets a separate directory. Branch isolation provides code isolation. Directory reuse within a workstream is safe because sequential-within-workstream concurrency ensures only one task runs at a time.

**Implication**: No schema or worktree allocation code changes needed for problem 1.

---

### 3.2 Problem 2: Delivery State Machine

**New module**: `src/modules/agents/delivery.ts`

**States**:
```
in_progress → push → pr-open → merged → delivered
                ↓         ↓
           push-failed   pr-failed
```

**New DB migration**: `agentsMigrationV3` adds `agent_deliveries` table:
```sql
CREATE TABLE IF NOT EXISTS agent_deliveries (
  agent_id      TEXT PRIMARY KEY REFERENCES agents(id),
  status        TEXT NOT NULL CHECK(status IN (
                  'in_progress','push','pr-open','merged','delivered',
                  'push-failed','pr-failed')),
  pr_number     INTEGER,
  pr_url        TEXT,
  pr_merged_at  TEXT,
  delivered_at  TEXT,
  created_at    TEXT NOT NULL
);
```

**API** (from test contracts):
- `initiateTaskDelivery(db, {taskId, workstream})` → records `in_progress`
- `getDeliveryStatus(db, taskId)` → current stage + metadata
- `recordDelivery(db, agentId, {status, pr_number?, pr_url?})` → upsert row
- `getDelivery(db, agentId)` → current delivery row
- `pushTaskBranch(db, taskId, {branch, projectDir})` → `git push`, returns `{branch, pushed, commitMessage}`
- `createTaskPR(db, taskId, {branch, projectDir})` → `gh pr create`, returns `{prNumber, prUrl, title, body, mergeable, state}`
- `autoMergePR(db, taskId, {requiresReview, prNumber, projectDir, mergeStrategy?, reviewComplete?, runGateCheck?})` → `{merged, reason?, ciPassed, conflicted?, rebaseAttempted?, branchDeleted, gateCheckPassed?, mergeStrategy}`
- `completeTaskDelivery(db, taskId, {status, clearWorktreePath?})` → `{dbReleased, worktreePathCleared}`
- `allocateDeliveryWorktree(db, projectDir, {taskId, workstream, failOnError?})` → `{worktreePath, branch}`
- `releaseDeliveryWorktree(db, taskId, {releaseDbOnly})` → `{dbReleased, physicalCleaned, cleanupCommand}`

**Key constraints** (from critic issues in tests):
- **C2**: Do NOT release worktree DB record before push completes
- **C3**: Physical worktree removal is NOT automatic — provide `cleanupCommand` string
- **Idempotency**: `createTaskPR` checks for existing PR before creating (by branch lookup)

---

### 3.3 Problem 3: Wave-Level Gate Checks

**New PM task status**: `pending-merge` inserted between `done` and `delivered`.

```
in-progress → pending-merge → done
```

Wait — actually `done` should remain terminal for non-delivery tasks. For delivery tasks:
```
in-progress → pending-merge → done
```

Or alternatively, `done` means "agent finished, PR merged", and `pending-merge` is intermediate.

**Revised status flow** (from AC-12 and agent-done-delivery tests):
- Agent completes → PM task enters `pending-merge`  
- Reconciler detects PR merged → PM task transitions `pending-merge → done`  
- Wave gate: checks all tasks in wave have status `done` (no tasks in `pending-merge`)

**Changes needed**:
- `src/modules/pm/types.ts`: add `'pending-merge'` to `TaskStatus` union + `isValidTaskStatus`
- PM state machine: allow `in-progress → pending-merge` transition
- Wave eligibility: tasks downstream of a wave don't start until all wave tasks are `done` (not just `pending-merge`)

---

### 3.4 Problem 4: Merge Conflict Resolution

**Strategy** (from delivery.test.ts AC-11, AC-12):
1. On PR creation: detect `mergeable: false`
2. Attempt auto-rebase: `git fetch origin main && git rebase origin/main`
3. If rebase succeeds: force-push, update PR
4. If rebase fails: mark delivery `pr-failed`, set PM task `redispatch` strategy
5. **GitHub merge queue**: Not in scope for this feature. Sequential squash-merge is sufficient initially. Merge queue can be added as a future enhancement.

**`autoMergePR` conflict handling**:
```typescript
if (result.conflicted) {
  result.rebaseAttempted = true;
  if (rebaseFailed) {
    result.redispatchStrategy = 'redispatch';
  }
}
```

---

### 3.5 Problem 5: WIP Limits Under Concurrent Dispatch

**Current**: WIP counts `in-progress` tasks only. Worktree budget is separate (max 3 concurrent worktrees).

**Issue**: With delivery pipeline, `pending-merge` tasks still occupy a worktree during push/PR phase. If WIP only counts `in-progress`, a coordinator might over-dispatch.

**Design decision**: WIP slot = consumed by `in-progress` tasks. `pending-merge` tasks do NOT count against the WIP slot — they're in the delivery pipeline awaiting external events (CI, merge), not consuming agent compute.

**Worktree slot**: separate from WIP. `pending-merge` tasks DO hold a worktree slot until `cleanupAfterMerge` releases it. This is correct — the physical directory is still needed for potential conflict resolution.

**No changes needed** to WIP limit enforcement. The existing `canClaim()` check against `in-progress` count is correct.

---

### 3.6 Problem 6: Reconciler for N Parallel Deliveries

**New module**: `src/modules/agents/delivery-reconciler.ts`

**`reconcileDeliveries(db, projectDir)`**:
1. Query all `agent_deliveries` WHERE `status = 'pr-open'`
2. For each, call `spawnSync('gh', ['pr', 'view', prNumber.toString(), '--json', 'state,mergedAt'])`
3. If `state === 'MERGED'`: call `cleanupAfterMerge(db, agent, projectDir)`
4. If `state === 'CLOSED'` (not merged): mark delivery `pr-failed`, mark PM task `cancelled`
5. Leave `OPEN` PRs unchanged

**`cleanupAfterMerge(db, agent, projectDir)`**:
1. Set `agent_deliveries.status = 'delivered'`, `delivered_at = now()`
2. Delete `worktree_allocations` row for agent's `brain_task`
3. Call `execFileSync('git', ['worktree', 'remove', '--force', worktreePath])`
4. Update PM task: `pending-merge → done`

**Reconciler invocation**:
- Called on a timer (every 60s) via the background processing hook
- Called immediately after `handleAgentDone` for any `pr-open` delivery
- No persistent process needed — reconciler is stateless, reads from DB

---

### 3.7 handleAgentDone Changes

**New flow for implementation tasks**:
1. Mark agent completed/failed (existing)
2. If `exit_code === 0` AND agent has `branch` AND task routing is `isolation: 'worktree'`:
   a. Call `pushTaskBranch()`  
   b. If push succeeds: call `createTaskPR()`
   c. If PR created: `recordDelivery(db, agentId, {status: 'pr-open', ...})`
   d. Update PM task to `pending-merge` (instead of `done`)
   e. **Do NOT release worktree** (preserved for conflict resolution)
3. If push or PR fails: `recordDelivery(db, agentId, {status: 'push-failed'/'pr-failed'})`
4. If `exit_code !== 0`: no delivery triggered (existing behavior)
5. Session commit (existing)

**Key change**: worktree release deferred to `cleanupAfterMerge()`, not in `handleAgentDone`.

---

## 4. File Map: What Needs Creating/Modifying

### New files

| File | Purpose |
|------|---------|
| `src/modules/agents/delivery.ts` | Delivery lifecycle API (7-stage pipeline) |
| `src/modules/agents/delivery-reconciler.ts` | PR polling, cleanupAfterMerge |

### Modified files

| File | Change |
|------|--------|
| `src/modules/agents/schema.ts` | Add `agentsMigrationV3` with `agent_deliveries` table |
| `src/modules/agents/agent-done-handler.ts` | Wire delivery pipeline on agent completion |
| `src/modules/pm/types.ts` | Add `'pending-merge'` to `TaskStatus`, update `isValidTaskStatus` |
| `src/modules/pm/engine/state-machine.ts` | Allow `in-progress → pending-merge` transition |

### Read-only (owned by parallel workers — no changes)

- `src/modules/agents/data.ts` — `allocateWorktree`, `releaseWorktree` already correct
- `src/modules/agents/auto-merge.ts` — existing infrastructure, used via `delivery.ts`
- `src/modules/pm/engine/dependency.ts` — wave computation is already correct

---

## 5. Data Flow Diagram

```
Coordinator dispatches task
       │
       ▼
Agent spawned in worktree (.worktrees/48/, branch agent/48/VNM-48.x)
       │
       ▼ [agent exits cleanly]
handleAgentDone()
  ├── updateAgentStatus(completed)
  ├── pushTaskBranch() ──────────────── git push origin agent/48/VNM-48.x
  │      └── [push-failed] → recordDelivery(push-failed) → release worktree
  ├── createTaskPR() ─────────────────  gh pr create ...
  │      └── [pr-failed]  → recordDelivery(pr-failed)  → release worktree
  ├── recordDelivery(pr-open, pr_number, pr_url)
  ├── PM task: in-progress → pending-merge
  └── [worktree preserved — not released]

       │ (async, reconciler polls)
       ▼
reconcileDeliveries() every 60s
  ├── SELECT * FROM agent_deliveries WHERE status = 'pr-open'
  ├── gh pr view {prNumber} --json state,mergedAt
  │      ├── MERGED → cleanupAfterMerge()
  │      │     ├── agent_deliveries.status = 'delivered'
  │      │     ├── DELETE worktree_allocations WHERE task_id = brain_task
  │      │     ├── git worktree remove --force .worktrees/48
  │      │     └── PM task: pending-merge → done
  │      └── OPEN → no-op (check again next poll)
  └── [wave gate: all tasks done? → advance to next wave]
```

---

## 6. Risk Assessment

| Risk | Likelihood | Mitigation |
|------|-----------|-----------|
| Orphaned worktrees if reconciler fails | Medium | `cleanupCommand` string returned for manual cleanup |
| Reconciler misses merged PR | Low | Idempotent — next poll catches it |
| `pending-merge` breaks existing PM queries | Low | `isValidTaskStatus` update; wave gate already checks `!= 'done'` |
| Multiple tasks in same workstream conflict on PR | Low | Sequential-within-workstream prevents overlap |
| `agentsMigrationV2` naming collision | High | Use `agentsMigrationV3` for delivery table — V2 is taken by `context` column |

---

## 7. Implementation Order (for design step)

1. `agentsMigrationV3` — delivery table schema
2. `src/modules/agents/delivery.ts` — core API
3. `src/modules/pm/types.ts` — `pending-merge` status
4. `src/modules/agents/delivery-reconciler.ts` — polling + cleanup
5. `src/modules/agents/agent-done-handler.ts` — wire delivery pipeline
6. `src/modules/pm/engine/state-machine.ts` — allow pending-merge transition

Tests to verify: `agent-done-delivery.test.ts`, `delivery.test.ts`, `delivery-reconciler.test.ts`

---

## 8. Open Questions (for design step)

1. Should `pending-merge` tasks block wave advancement? (Proposed: YES — wave gates on `done`, not `pending-merge`)
2. Should reconciler be invoked from a cron/launchd daemon or triggered by `handleAgentDone`? (Proposed: both — immediate poll after agent done + periodic background poll)
3. `autoMergePR` uses squash strategy — should this be configurable per task? (Proposed: fixed squash for consistency)
4. Should `redispatch` on conflict failure reset worktree to main HEAD and re-run? (Proposed: yes — same worktree, reset branch, new agent spawned)
