# Research Brief: VNM-48.124 (Consolidated: parallel dispatch + delivery lifecycle)

Plan: 8bc71b60 | Project: VNM

## Existing Code

### Worktree System (`src/modules/agents/worktree.ts`)

- `allocateWorktree(db, projectRoot, opts)` — allocates a git worktree for a task
  - **CRITICAL GAP**: Current model uses one worktree per **workstream**, not per task:
    ```ts
    const existing = allocations.find((a) => a.workstream === opts.workstream);
    if (existing) { /* reuse it */ }
    const worktreePath = resolve(projectRoot, basePath, opts.workstream); // e.g. .worktrees/48
    ```
  - Branch is `agent/{workstream}/{taskId}` but path is `.worktrees/{workstream}` — only one agent can use the worktree at a time
  - Budget limit: `DEFAULT_BUDGET = 3` (total across all workstreams)
- `releaseWorktree(db, projectRoot, taskId)` — removes physical worktree + deletes branch + removes DB record, all at once
- `cleanupStaleAllocations(db, projectRoot)` — removes allocations whose paths are gone
- `WorktreeAllocation` schema: `{ id, task_id, workstream, worktree_path, branch, claim_token, created_at }`

### Delivery Pipeline — Tests Exist, Implementation Does NOT

Three spec test files (`__tests__/modules/agents/delivery.test.ts`, `delivery-reconciler.test.ts`, `agent-done-delivery.test.ts`) define the full API surface; corresponding source files (`src/modules/agents/delivery.ts`, `src/modules/agents/delivery-reconciler.ts`) are absent.

Expected API from tests:
- `delivery.ts`: `initiateTaskDelivery`, `getDeliveryStatus`, `allocateDeliveryWorktree`, `releaseDeliveryWorktree`, `pushTaskBranch`, `createTaskPR`, `autoMergePR`, `completeTaskDelivery`, `recordDelivery`, `getDelivery`
- `delivery-reconciler.ts`: `reconcileDeliveries(db, projectDir)`, `cleanupAfterMerge(db, agent, projectDir)`

Delivery state machine from tests:
```
in_progress → push-failed
            → pr-failed
            → pr-open → merged → delivered
```

### Schema (`src/modules/agents/schema.ts`)

- `agentsMigrationV1`: `agents` table + `worktree_allocations` table
- `agentsMigrationV2`: `context TEXT` column on `agents`
- **Missing**: `delivery_states` table (needed by `recordDelivery`/`getDelivery`)

Test setup uses `agentsMigrationV1.up(db); agentsMigrationV2.up(db)` — so V3 migration for `delivery_states` is needed.

### Agent Done Handler (`src/modules/agents/agent-done-handler.ts`)

Current flow:
1. Mark agent `completed`/`failed`
2. **Always releases worktree** (`tryReleaseWorktree`) — DB record only, not physical
3. Marks PM task `done` via CLI

What needs to change for delivery integration:
- For implementation tasks: do NOT release worktree; trigger push + PR creation instead
- Set delivery state to `pr-open` after PR created
- Reconciler later handles merge detection and worktree cleanup

Test `agent-done-delivery.test.ts` line 99 confirms: `handleAgentDone` should set delivery state (`getDelivery(db, agentId) !== null`) for implementation tasks.

### Auto-Merge (`src/modules/agents/auto-merge.ts`)

Already handles the merge side:
- `getPrForBranch(branch, projectDir)` — polls `gh pr view` for state, CI, mergeability
- `mergePr(prNumber, options)` — `gh pr merge --squash --delete-branch`
- `tryAutoMerge(branch, taskId, options)` — end-to-end: check PR → if open + CI passes + mergeable → merge

Gap: no loop/reconciler wires this into periodic polling.

### Backpressure (`src/modules/agents/backpressure.ts`)

Already implemented:
- `BackpressureController(baseWip)` — tracks merge queue depth, stall rate, conflict rate in 30-minute window
- `computeEffectiveWip()` — reduces WIP limit when merge queue > 2, conflict rate > 30%, or stall rate > 50%
- `recordMerge(success, hadConflict)`, `recordStall(workstream)`, `setMergeQueueDepth(depth)`

Gap: not wired into dispatch guard yet.

### PM Types (`src/modules/pm/types.ts`)

- `isValidTaskStatus` function — test confirms `pending-merge` must be added
- Current status set likely: `pending`, `in-progress`, `blocked`, `done`, `cancelled`

### Workflow Runtime Single-Slot Constraint (`src/modules/workflow/runtime/`)

- `WorkflowRun.activeAgent: { pid, taskId, agentId?, stepId } | null` — scalar field, only one agent tracked per workflow run at a time
- `WorkflowRuntime.reconcile()` (runtime.ts lines 304-329) polls this single slot every 10s; resolves completion and detects stale PIDs
- `wave-execution.ts` line 86 has an explicit `// TODO: parallelize once runtime supports multiple concurrent active agents (VNM-48.59)` comment — sequential loop is intentional placeholder
- **Design implication**: changing to `activeAgents: Map<stepId, AgentSlot>` is needed for true runtime-level parallelism; the reconciler loop must iterate all active slots instead of one

### Wave Execution Flow (`src/modules/workflow/flows/wave-execution.ts`)

- Wave loop (lines 84-150): sequential `for` loop dispatches one task at a time, waits for each step to resolve, then runs gate check
- Gate: `npm run typecheck && npm test` run after every wave; failures pause the workflow for assisted intervention
- Wave structure computed by `computeWaves()` (dependency.ts lines 191-259): Kahn's topological sort assigns wave numbers

### Conflict Recovery (`src/modules/agents/conflict-recovery.ts`)

File exists — review needed but likely handles rebase-on-conflict logic.

### Completion Protocol (`src/modules/agents/completion-protocol.ts`)

- `parseCompletionMessage` / `handleCompletion` — worker sends `DONE {taskId}` or `FAILED {taskId}`
- `handleDone` marks task `done` and calls `computeImpact` for dependency cascade

---

## External Findings

### Per-Task Worktree Pattern (Git)

- Git supports N worktrees from one repo; each is an independent checkout on a different branch
- Standard pattern for parallel agents: `git worktree add -b {branch} {path}` where path is unique per task
- Branches can coexist; physical paths must be unique
- GitHub CLI (`gh pr create --head {branch}`) works per-branch, so N branches → N PRs

### GitHub Merge Queue

- GitHub Merge Queue (`gh pr merge --auto` or branch protection "Require merge queue") serializes concurrent PR merges automatically
- Each PR is re-tested against the current main before merging — prevents "works individually but breaks combined" problems
- Requires repo-level configuration; cannot be enabled per-PR from CLI
- Without merge queue: parallel PRs targeting main must merge sequentially; the second PR typically shows "behind main" after first merges and needs a rebase

### Squash-Merge + Branch Deletion Pattern

- `gh pr merge --squash --delete-branch` is idempotent in effect (second call on merged PR fails gracefully)
- After squash merge, original branch is deleted on GitHub; local branch and worktree can be cleaned up independently

### Delivery State Machine Art (Prior Art)

- Temporal.io uses durable workflow functions with `await activity(...)` that survive process restart
- CI/CD pipelines (GitHub Actions, Buildkite) model delivery as state machines with explicit stage transitions
- Pattern: separate "delivery tracker" from "agent" — agent owns code, tracker owns integration lifecycle

### Reconciler Pattern

- Standard pattern in distributed systems: periodic reconciler loop polls external state and drives local state forward
- Key properties: idempotent (safe to run multiple times), non-blocking (does not hold worktree hostage)
- GitHub PR state polling: `gh pr view --json state,mergedAt` → transition `pr-open` → `merged` when `state === "MERGED"`

---

## Knowledge Gaps

1. **Task type classification**: How does the delivery pipeline distinguish "implementation" tasks (need delivery) from "research"/"planning" tasks (no delivery needed)? Current `AgentRecord` has no task-type field. Options:
   - Branch pattern: tasks with `agent/` branches are implementation
   - PM task field: `type: 'implementation' | 'research' | 'planning'`
   - Agent context flag set at dispatch time

2. **Worktree path collision for parallel tasks in same workstream**: Current path scheme uses workstream ID. Per-task paths (`.worktrees/{taskId}`) avoid collision but make cleanup tracking harder. Recommendation needed.

3. **Budget calibration**: With per-task worktrees, budget should scale with WIP limit. Should budget = WIP limit, or should it be separately configurable?

4. **Wave gate implementation**: How does the coordinator know "all tasks in wave N are delivered"? Options:
   - PM wave status: count tasks still in `pending-merge`
   - Delivery reconciler emits event when wave is clear
   - Coordinator polls `brain pm task list --wave N --status pending-merge`

5. **Worktree preservation window**: If the delivery takes a long time (CI is slow), the worktree directory sits idle. Is that acceptable, or should the physical worktree be cleaned up after push and reconstructed if rebase is needed?

6. **GitHub merge queue availability**: Does the target repo have merge queue enabled? If not, what is the fallback conflict resolution strategy?

7. **`agentsMigrationV3` schema**: What columns does `delivery_states` need? From tests: `agent_id`, `status`, `pr_number`, `pr_url`, `pr_merged_at`, `delivered_at`. Need `created_at` and `updated_at` for observability.

---

## Recommendations

### R1: Per-Task Worktree Allocation

Change `allocateWorktree` path scheme from `workstream` to `taskId`:

```ts
// Before
const worktreePath = resolve(projectRoot, basePath, opts.workstream); // .worktrees/48

// After
const worktreePath = resolve(projectRoot, basePath, opts.taskId); // .worktrees/VNM-48.113
```

Keep branch naming as `agent/{workstream}/{taskId}`. Remove the "reuse by workstream" logic — each task gets its own worktree. Set budget = `wipLimit` (passed from coordinator config).

**Risk**: More disk usage. **Mitigation**: Reconciler cleans up after merge, so idle time is bounded by CI duration.

### R2: `delivery_states` Table (V3 Migration)

```sql
CREATE TABLE IF NOT EXISTS delivery_states (
  agent_id     TEXT PRIMARY KEY REFERENCES agents(id),
  status       TEXT NOT NULL DEFAULT 'in_progress'
               CHECK(status IN ('in_progress','push-failed','pr-failed','pr-open','merged','delivered')),
  pr_number    INTEGER,
  pr_url       TEXT,
  pr_merged_at TEXT,
  delivered_at TEXT,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);
```

### R3: Agent-Done Handler: Detect Implementation Tasks by Branch

- If agent has a `branch` starting with `agent/` AND exit code 0: trigger delivery pipeline (push + PR)
- If agent has no branch, or exit code ≠ 0: current behavior (release worktree, mark done)
- Delivery pipeline runs synchronously in the hook (push + `gh pr create`), sets `delivery_states.status = 'pr-open'`
- Do NOT release worktree DB record for `pr-open` agents — worktree cleanup deferred to reconciler

### R4: Reconciler as a Periodic Hook

`reconcileDeliveries(db, projectDir)` runs periodically (cron/hook):
1. Query all agents with `delivery_states.status = 'pr-open'`
2. For each: call `gh pr view --json state,mergedAt`
3. If `MERGED`: call `cleanupAfterMerge` → set status `delivered`, release worktree DB record, `git worktree remove --force`
4. If still `OPEN`: call `tryAutoMerge` → if CI now passes and no conflicts, merge

**Key**: reconciler does NOT block. If merge fails, leave in `pr-open` and retry next cycle.

### R5: `pending-merge` Task Status

Add `pending-merge` to PM task status set. When delivery pipeline creates a PR:
- Mark PM task status `pending-merge` (not `done`)
- Mark `done` only in `cleanupAfterMerge` (after PR actually merges)

Wave gate check: wave is clear when zero tasks have status `pending-merge`.

### R6: Conflict Resolution Strategy

Without GitHub merge queue:
1. `reconcileDeliveries` detects `mergeable === false`
2. Call `conflict-recovery.ts` logic: `git fetch; git rebase origin/main`
3. If rebase succeeds: force-push and retry merge
4. If rebase fails: re-dispatch task (set PM status back to `pending`, clear delivery state)

With GitHub merge queue: rely on queue serialization; reconciler just polls for `MERGED`.

### R7: Backpressure Wiring

Wire `BackpressureController` into the coordinator's dispatch loop:
1. Before dispatching a new task: call `controller.computeEffectiveWip()`
2. If `effectiveWip < activeAgentCount`: skip dispatch this cycle
3. After merge: call `controller.recordMerge(success, hadConflict)`
4. Periodically: call `controller.setMergeQueueDepth(prOpenCount)`

---

## Suggested Interview Questions

1. **Task type classification**: Should the delivery pipeline trigger based on the agent's branch pattern (any `agent/` branch), or should implementation tasks have an explicit type field in the PM schema? The branch-based approach is zero-schema-change but requires naming discipline.

2. **Merge queue**: Is GitHub Merge Queue enabled (or can it be enabled) on the target repo? If not, is sequential rebase-based merging acceptable, or should we treat parallel PRs as inherently serialized (only one merge attempt at a time)?

3. **Wave gate coupling**: Should the wave gate be implemented as a PM-level query (`count tasks WHERE wave=N AND status='pending-merge'`) or as a delivery-system event that the coordinator subscribes to? The query approach is simpler but requires polling.

4. **Worktree preservation**: Is it acceptable to keep the physical worktree directory alive through the full delivery pipeline (push → PR → CI → merge)? For long CI runs, this could be 30+ minutes of idle disk usage per task.

5. **Reconciler scheduling**: Should `reconcileDeliveries` run as a Claude Code cron hook, a launchd job, or should the coordinator agent poll it in its main loop? The coordinator loop approach is simplest but requires the coordinator to stay alive.
