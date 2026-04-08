# Design: Parallel Agent Dispatch with Work Delivery Lifecycle

**Task**: VNM-48.161 (consolidated from VNM-48.60 + VNM-48.86, prior: VNM-48.152, VNM-48.137, VNM-48.132, VNM-48.124, VNM-48.115)
**Plan**: 8bc71b60 | **Date**: 2026-04-08

Consolidates VNM-48.60 (parallel agent dispatch) and VNM-48.86 (work delivery lifecycle) into a unified system where N agents execute concurrently within a workstream, each on isolated per-task worktrees, with an automated delivery pipeline that handles push, PR, CI, merge, and cleanup.

---

## 1. Problem Statement

The current system has three blocking constraints that prevent true parallel agent execution:

1. **One worktree per workstream** — `allocateWorktree` reuses the same physical path for all tasks in a workstream (`.worktrees/{workstream}`), so only one agent can execute at a time.
2. **No delivery state machine** — when an agent completes, the done-handler immediately releases the worktree and marks the task `done`, with no tracking of the push/PR/merge lifecycle.
3. **Single active agent slot** — `WorkflowRun.activeAgent` is a scalar field; the reconciler polls one agent at a time.

These constraints serialize all work within a workstream, making wave-level parallelism impossible.

---

## 2. Architecture Overview

```
                    +-----------------+
                    |   Coordinator   |
                    | (dispatch loop) |
                    +--------+--------+
                             |
              +--------------+--------------+
              |              |              |
         +----v----+   +----v----+   +----v----+
         | Agent 1 |   | Agent 2 |   | Agent 3 |
         | wt/T.01 |   | wt/T.02 |   | wt/T.03 |
         +----+----+   +----+----+   +----+----+
              |              |              |
              v              v              v
         push+PR        push+PR        push+PR
              |              |              |
              v              v              v
         +----------------------------------------+
         |        Delivery Reconciler             |
         | (polls PRs, merges, cleans worktrees)  |
         +----------------------------------------+
              |              |              |
              v              v              v
           merged         merged         merged
              |              |              |
              v              v              v
         +----------------------------------------+
         |          Wave Gate Check               |
         | (all tasks delivered? advance wave)    |
         +----------------------------------------+
```

---

## 3. Per-Task Worktree Allocation

### Current → Proposed

| Aspect | Current | Proposed |
|--------|---------|----------|
| Path scheme | `.worktrees/{workstream}` | `.worktrees/{taskId}` |
| Reuse | Same workstream → reuse path | No reuse; each task is isolated |
| Branch | `agent/{workstream}/{taskId}` | `agent/{workstream}/{taskId}` (unchanged) |
| Budget | `DEFAULT_BUDGET = 3` (global) | `budget = effectiveWip` (dynamic, from backpressure) |

### Changes to `worktree.ts`

```typescript
// allocateWorktree — remove workstream reuse logic
export function allocateWorktree(db, projectRoot, opts): AllocateWorktreeResult {
  const budget = opts.budget ?? DEFAULT_BUDGET;
  const basePath = opts.basePath ?? DEFAULT_BASE_PATH;

  // Clean stale allocations first
  cleanupStaleAllocations(db, projectRoot);

  const allocations = getWorktreeAllocations(db);
  if (allocations.length >= budget) {
    throw new Error(`Worktree budget exhausted: ${allocations.length}/${budget}`);
  }

  // Per-task path: .worktrees/VNM-48.103
  const branch = `agent/${opts.workstream}/${opts.taskId}`;
  const worktreePath = resolve(projectRoot, basePath, opts.taskId);

  // ... create worktree, record in DB (same as today)
  return { worktreePath, branch, reused: false };
}
```

### Concurrency: Remove One-Per-Workstream Constraint

`checkWorkstreamConcurrency` in `concurrency.ts` currently blocks dispatch if another task in the same workstream is `in-progress`. This must be replaced with a WIP-limit check against the global effective WIP (from `BackpressureController`), not a per-workstream serialization gate.

```typescript
export function checkDispatchConcurrency(db, backpressure): ConcurrencyCheck {
  const active = countActiveAgents(db); // all in-progress, any workstream
  const { effectiveWip } = backpressure.computeEffectiveWip();
  if (active >= effectiveWip) {
    return { allowed: false, reason: `WIP limit: ${active}/${effectiveWip}` };
  }
  return { allowed: true };
}
```

---

## 4. Delivery State Machine

### States

```
in_progress ──► push-failed
    │
    ▼
  pushed ──────► pr-failed
    │
    ▼
  pr-open ─────► merged ──► delivered
    │               │
    ▼               ▼
 conflicted    (cleanup)
    │
    ▼
 rebasing ─────► redispatched (on rebase failure)
```

### `delivery_states` Table (V3 Migration)

```sql
CREATE TABLE IF NOT EXISTS delivery_states (
  agent_id     TEXT PRIMARY KEY REFERENCES agents(id),
  task_id      TEXT NOT NULL,
  branch       TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'in_progress'
               CHECK(status IN (
                 'in_progress','pushed','push_failed',
                 'pr_open','pr_failed','conflicted','rebasing',
                 'merged','delivered','redispatched'
               )),
  pr_number    INTEGER,
  pr_url       TEXT,
  pr_merged_at TEXT,
  delivered_at TEXT,
  retry_count  INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_delivery_status ON delivery_states(status);
CREATE INDEX idx_delivery_task ON delivery_states(task_id);
```

> **Note**: Status values use underscores (`push_failed`, `pr_open`) for consistency with SQLite conventions and the existing codebase style. The `retry_count` tracks rebase/push retry attempts per delivery — max 2 before redispatch.

### PM Task Status: Add `pending-merge`

A task in delivery is not `done` — it's `pending-merge`. The task only transitions to `done` when the PR actually merges. This is critical for wave gate correctness.

```
pending → claimed → in-progress → pending-merge → done
                                                 → blocked (on conflict)
```

Add `pending-merge` to `isValidTaskStatus` and `TRANSITIONS` in `state-machine.ts`.

---

## 5. Agent-Done Handler Integration

When an agent completes, the done-handler behavior changes based on whether the agent produced deliverable code:

```typescript
async function handleAgentDone(db, agentId, parsed, cwd) {
  updateAgentStatus(db, agentId, parsed.success ? 'completed' : 'failed');

  const agent = getAgent(db, agentId);

  if (parsed.success && agent.branch?.startsWith('agent/')) {
    // Implementation task: enter delivery pipeline
    const result = await runDeliveryPipeline(db, agent, cwd);
    // Sets delivery_states.status = 'pr-open' (or 'push-failed'/'pr-failed')
    // Sets PM task status to 'pending-merge'
    // Does NOT release worktree — reconciler handles that after merge
  } else {
    // Non-implementation or failed: current behavior
    tryReleaseWorktree(db, agent.brain_task);
    markTaskDone(db, agent.brain_task);
  }
}
```

### `runDeliveryPipeline` (synchronous in done-hook)

1. `git push origin {branch}` — if fails, set status `push-failed`, release worktree, return
2. `gh pr create --head {branch} --title "[{taskId}] {summary}" --body {body}` — if fails, set status `pr-failed`, return
3. Record delivery state: `{ status: 'pr-open', pr_number, pr_url }`
4. Set PM task status to `pending-merge`
5. If task is low-risk (no schema changes, no API changes): `gh pr merge --auto --squash --delete-branch`

Worktree is **not** released. The reconciler will clean it up after merge.

---

## 6. Delivery Reconciler

Periodic loop that drives all pending deliveries forward. Runs as part of the coordinator's main loop or as a cron hook.

```typescript
export function reconcileDeliveries(db, projectDir): ReconcileResult {
  const pending = getAllDeliveries(db, { status: ['pr-open', 'conflicted', 'rebasing'] });
  const results: DeliveryAction[] = [];

  for (const delivery of pending) {
    const prState = pollPrState(delivery.pr_number, projectDir);

    if (prState.state === 'MERGED') {
      // PR merged externally or via auto-merge
      updateDeliveryStatus(db, delivery.agent_id, 'merged', {
        pr_merged_at: prState.mergedAt
      });
      cleanupAfterMerge(db, delivery, projectDir);
      results.push({ taskId: delivery.task_id, action: 'delivered' });

    } else if (prState.mergeable === false) {
      // Conflict detected
      updateDeliveryStatus(db, delivery.agent_id, 'conflicted');
      const rebaseResult = attemptRebase(delivery, projectDir);
      if (rebaseResult.success) {
        forcePush(delivery.branch, projectDir);
        updateDeliveryStatus(db, delivery.agent_id, 'pr-open');
      } else {
        // Rebase failed: redispatch the task
        redispatchTask(db, delivery);
        results.push({ taskId: delivery.task_id, action: 'redispatched' });
      }

    } else if (prState.state === 'OPEN' && prState.ciPassed && prState.mergeable) {
      // Ready to merge but auto-merge not enabled
      tryAutoMerge(delivery.branch, delivery.task_id, { projectDir });
    }
    // else: still waiting for CI or review — no action
  }

  return { processed: results.length, actions: results };
}
```

### `cleanupAfterMerge`

1. Set delivery status to `delivered` with `delivered_at` timestamp
2. Set PM task status to `done` (triggers dependency cascade)
3. Release worktree DB record
4. `git worktree remove --force {path}` (physical cleanup)
5. `git branch -D {branch}` (local branch cleanup)
6. Record merge in `BackpressureController` for WIP adjustment

### Reconciler Scheduling

The reconciler runs:
- **In the coordinator loop**: after each dispatch cycle, call `reconcileDeliveries` to poll all pending PRs
- **On session-start hook**: catch up on merges that happened while no coordinator was running
- **Optionally via cron**: `brain hook dispatch reconcile-deliveries` every 5 minutes

---

## 7. Wave Gate Integration

A wave gate checks whether all tasks in the current wave have been delivered before advancing to the next wave.

### Gate Check Logic

```typescript
function isWaveComplete(db, waveNumber, workstream): boolean {
  const waveTasks = listTasks(db, prefix, {
    workstream,
    wave: waveNumber,
  });

  // Wave is complete when no tasks are pending-merge, in-progress, or claimed
  return waveTasks.every(t =>
    t.status === 'done' || t.status === 'cancelled'
  );
}
```

### Integration with Wave Execution Flow

In `wave-execution.ts`, the sequential `for` loop becomes a parallel dispatch + reconcile loop:

```typescript
for (const wave of waves) {
  // Dispatch all tasks in wave concurrently (up to WIP limit)
  const dispatched = await dispatchWaveTasks(wave.tasks, ctx);

  // Poll until wave is complete
  while (!isWaveComplete(db, wave.number, workstream)) {
    reconcileDeliveries(db, projectDir);
    await sleep(30_000); // 30s poll interval
  }

  // Run gate check on merged main
  const gateResult = await runGateCheck(projectDir);
  if (!gateResult.passed) {
    await pauseForIntervention(ctx, gateResult);
  }
}
```

---

## 8. Conflict Resolution Strategy

### Without GitHub Merge Queue (default)

When parallel PRs target main, the second PR to merge may show conflicts after the first merges.

**Resolution flow**:
1. Reconciler detects `mergeable === false` on a PR
2. Attempts `git fetch && git rebase origin/main` in the worktree
3. If rebase succeeds: `git push --force-with-lease` and retry merge
4. If rebase fails (conflict in changed files): 
   - Close the PR
   - Release the worktree
   - Reset PM task to `pending` (clears claim)
   - Task re-enters the eligible queue and will be redispatched with fresh main

**Max rebase attempts**: 2 per delivery. After 2 failures, redispatch unconditionally.

### With GitHub Merge Queue (optional, repo-level config)

If merge queue is enabled on the repo:
1. PRs enter the queue via `gh pr merge --auto --squash`
2. GitHub re-tests each PR against current main before merging
3. Reconciler only needs to poll for `MERGED` state — no rebase logic needed
4. Conflict handling is fully delegated to GitHub

Detection: `gh api repos/{owner}/{repo} --jq '.merge_commit_allowed'` or check branch protection rules.

---

## 9. Backpressure & WIP Management

### Wiring `BackpressureController` into Dispatch

```typescript
class CoordinatorLoop {
  private backpressure: BackpressureController;

  async dispatchCycle() {
    // 1. Reconcile existing deliveries first
    const reconciled = reconcileDeliveries(db, projectDir);

    // 2. Update backpressure signals
    for (const action of reconciled.actions) {
      if (action.action === 'delivered') {
        this.backpressure.recordMerge(true, false);
      } else if (action.action === 'redispatched') {
        this.backpressure.recordMerge(false, true);
      }
    }
    this.backpressure.setMergeQueueDepth(
      countDeliveries(db, { status: 'pr-open' })
    );

    // 3. Check if we can dispatch more
    const { effectiveWip } = this.backpressure.computeEffectiveWip();
    const activeCount = countActiveAgents(db);

    while (activeCount < effectiveWip) {
      const task = await pullNextTask(db, config, embedder);
      if (!task) break; // no eligible tasks
      await dispatchAgent(task);
      activeCount++;
    }
  }
}
```

### Slot Management

| Signal | Effect |
|--------|--------|
| Merge queue depth > 2 | Reduce WIP by `depth - 2` |
| Conflict rate > 30% | Halve effective WIP |
| Stall rate > 50% | Reduce WIP by 1 |
| All nominal | Use base WIP (default: 3) |

---

## 10. Multi-Agent Runtime Support

### `WorkflowRun` Changes

Replace the scalar `activeAgent` with a map:

```typescript
interface AgentSlot {
  pid: number;
  taskId: string;
  agentId?: string;
  stepId: string;
  startedAt: number;
}

interface WorkflowRun {
  // ... existing fields
  activeAgents: Map<string, AgentSlot>; // keyed by stepId
}
```

### Reconciler Changes

The runtime reconciler iterates all active slots instead of checking one:

```typescript
async reconcile(run: WorkflowRun): Promise<void> {
  for (const [stepId, slot] of run.activeAgents) {
    if (!isProcessAlive(slot.pid)) {
      run.activeAgents.delete(stepId);
      await this.resolveStep(run, stepId, slot);
    }
  }
}
```

---

## 11. Data Flow Summary

```
Task eligible
  → pullNextTask (claim)
  → allocateWorktree (per-task path)
  → spawn agent in worktree
  → agent works, commits locally
  → agent sends DONE
  → agent-done hook fires:
      → push branch
      → create PR
      → set delivery_states.status = 'pr-open'
      → set PM task status = 'pending-merge'
  → reconciler polls:
      → PR merged? → cleanupAfterMerge → task done → cascade deps
      → PR conflicted? → rebase → force-push → retry
      → PR open + CI pass? → tryAutoMerge
  → wave gate: all tasks done? → advance wave
```

---

## 12. Files to Create/Modify

### New Files
| File | Purpose |
|------|---------|
| `src/modules/agents/delivery.ts` | Delivery pipeline functions: `initiateTaskDelivery`, `pushTaskBranch`, `createTaskPR`, `autoMergePR`, `completeTaskDelivery`, `recordDelivery`, `getDelivery` |
| `src/modules/agents/delivery-reconciler.ts` | `reconcileDeliveries`, `cleanupAfterMerge` |

### Modified Files
| File | Change |
|------|--------|
| `src/modules/agents/worktree.ts` | Per-task path scheme, remove workstream reuse |
| `src/modules/agents/schema.ts` | Add `agentsMigrationV3` with `delivery_states` table |
| `src/modules/agents/agent-done-handler.ts` | Integrate delivery pipeline for implementation tasks |
| `src/modules/agents/backpressure.ts` | No changes needed (already correct) |
| `src/modules/pm/engine/concurrency.ts` | Replace per-workstream check with global WIP check |
| `src/modules/pm/engine/state-machine.ts` | Add `pending-merge` status and transitions |
| `src/modules/workflow/runtime/runtime.ts` | `activeAgent` → `activeAgents` map |
| `src/modules/workflow/flows/wave-execution.ts` | Parallel dispatch + reconcile loop |

---

## 13. Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Disk usage from N worktrees | High for large repos | Reconciler cleans up after merge; budget caps total |
| Rebase loops on conflicting PRs | Wasted compute | Max 2 rebase attempts, then redispatch |
| Race in concurrent PR merges | Merge conflicts | Backpressure reduces WIP on high conflict rate |
| Stale worktrees if coordinator dies | Disk leak | `cleanupStaleAllocations` on session-start; `brain doctor` check |
| PR created but never merged | Zombie PRs | Reconciler detects PRs open > 24h, flags for human review |

---

## 14. Open Questions for Review

1. **Worktree preservation**: Keep physical worktree alive through full delivery (push → CI → merge), or clean up after push and reconstruct if rebase needed? Current design keeps it alive for simplicity.

2. **GitHub merge queue**: Should the design auto-detect merge queue availability and switch strategies? Current design treats it as optional with fallback to sequential rebase.

3. **Review gating**: Which task types require human review before merge? Current design uses a `requiresReview` flag set at dispatch time based on task risk classification.
