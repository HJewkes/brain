# Research Supplement: VNM-48.141

Addendum to `research-brief.md` for planning run 8bc71b60.

## Confirmations

The existing `research-brief.md` is comprehensive. This supplement confirms key findings from an independent code review and adds framing for the 6 stated problems.

## Current Architecture Confirmed

| Component | Current Model | Confirmed Gap |
|---|---|---|
| Worktree allocation | 1 per workstream (`allocateWorktree` line 74) | Blocks intra-workstream parallelism |
| Delivery state machine | None — `tryAutoMerge()` is fire-and-forget | No durable delivery tracking |
| Wave gate | Implicit (all tasks = `done`) | No `pending-merge` check |
| Merge conflict handling | `conflict-recovery.ts` exists | Not wired into delivery loop |
| WIP limits | `BackpressureController` exists | Not wired into dispatch guard |
| Reconciler | Implicit (agent-done hook only) | No periodic polling fallback |

## Problem → Solution Mapping

| Problem | Solution | Key File(s) |
|---|---|---|
| 1. Per-task worktrees | R1: Path `.worktrees/{taskId}` not `.worktrees/{workstream}` | `worktree.ts` |
| 2. Delivery state machine | R2+R3: `delivery_states` table + `delivery.ts` | new `delivery.ts`, `schema.ts` V3 |
| 3. Wave-level gate | R5: `pending-merge` status; gate clears when count = 0 | `pm/types.ts`, `state-machine.ts` |
| 4. Merge conflict resolution | R6: rebase via `conflict-recovery.ts`; merge queue opt-in | `conflict-recovery.ts`, config |
| 5. WIP limits under concurrent dispatch | R7: Wire `BackpressureController` into dispatch loop | `backpressure.ts`, orchestrator |
| 6. Reconciler for N deliveries | R4: Periodic `reconcileDeliveries` polling `pr-open` agents | new `delivery-reconciler.ts` |

## Implementation Sequencing

The 5 phases align with what spec tests already enforce (tests exist, sources don't):

1. **Phase 1** (schema): Add `delivery_states` table via `agentsMigrationV3`
2. **Phase 2** (worktrees): Change allocation to per-task paths; update spec test assertions
3. **Phase 3** (delivery.ts): Implement `initiateTaskDelivery`, `pushTaskBranch`, `createTaskPR`, `completeTaskDelivery`
4. **Phase 4** (reconciler): Implement `reconcileDeliveries`, `cleanupAfterMerge`
5. **Phase 5** (wiring): Add `pending-merge` status, update agent-done-handler, wire backpressure to dispatch

## Additional Open Question

**Delivery slot budget vs agent slot budget**: The backpressure controller manages agent WIP. For delivery, a separate cap (`max_concurrent_deliveries`) prevents CI from being overwhelmed. Should this default to `wipLimit` or `wipLimit * 2` (since deliveries outlive agents)? Recommend `wipLimit * 2` as default — agents finish before CI completes, so deliveries pile up.

## Brain Note

Full design document also saved to brain at:
`~/brain/research/parallel-agent-dispatch-delivery-lifecycle-design-research.md`
