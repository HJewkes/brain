# Spec: Workflow Executor V2 E2E Tests

## Problem

The imperative `WorkflowRuntime` + `WorkflowContext` system is implemented but has no test coverage spanning the full execution path. Without E2E tests, cross-seam bugs go undetected: memoized dispatch not skipping completed steps on restart, signal dispatch not resolving the correct waitpoint, reconciler not detecting dead agents, or `brain_workflow_start` returning stale state through the MCP layer. These failures only surface during live coordinator sessions — a slow and expensive feedback loop.

## Requirements

1. **R-01**: An integration test suite wires a real `WorkflowRuntime` to a real `BrainDB` (cloned template) and exercises `runtime.start()` → agent resolution → `runtime.getStatus()` → final status `completed` for a minimal two-step workflow.
2. **R-02**: Tests verify memoized dispatch: a workflow hydrated on a pre-seeded DB must replay cached step results without calling `createTask` or `dispatchTask` for the cached steps.
3. **R-03**: Tests verify the `hydrate()` path: given a `workflow_runs` row in `running` status with partial `step_results`, hydration must resume from the first uncached step.
4. **R-04**: Tests verify assisted steps: a workflow with an `assisted()` call must pause with status `paused`, and `runtime.signal()` must unblock it and advance the workflow to completion.
5. **R-05**: Tests verify the critic revision loop: a workflow whose critic step emits `needs_revision` must re-dispatch the design step and complete only after the loop exits.
6. **R-06**: Tests verify process supervision: when `ctx.handleAgentDeath()` is called for the active agent, the runtime retries once, and on second death marks the run `failed`.
7. **R-07**: Tests verify channel push events: a `WorkflowRuntime` constructed with a `channelPush` spy must emit `step_complete` for each resolved dispatch and `workflow_complete` on finish.
8. **R-08**: An MCP integration test wires a real `WorkflowRuntime` to an in-memory MCP server (via `InMemoryTransport`) with `BRAIN_EXECUTOR_V2=1` and calls `brain_workflow_start` → `brain_workflow_status` → asserts the response includes `runtimeVersion: 'v2'`.
9. **R-09**: The MCP test calls `brain_workflow_signal` on a paused assisted step and asserts the workflow unblocks and advances to completion.
10. **R-10**: A `planningWorkflow` E2E scenario runs the full `low`-complexity planning flow with all steps resolved to completion, asserting `status = 'completed'` and `stepResults` containing all expected entries.

## Constraints

- **C-01**: No Ollama or real `claude` subprocess. `createTask`, `dispatchTemplate`, and `dispatchTask` are mocked with `vi.mock()`.
- **C-02**: All DB access uses `createTestDb()` from `__tests__/helpers.ts` (template clone pattern).
- **C-03**: The `workflow_runs` table must be created inline per test file via `CREATE TABLE IF NOT EXISTS` using the same DDL as in `migration.ts`. The template DB does not include this table.
- **C-04**: `BRAIN_EXECUTOR_V2=1` must be set/restored with `vi.stubEnv` — never left set globally across test files.
- **C-05**: No new npm dependencies. Uses Vitest, `@modelcontextprotocol/sdk/inMemory.js`, and `node:crypto`.
- **C-06**: Each `describe` block owns its own `db` and `WorkflowRuntime` instance; no shared state between test cases.

## Out of Scope

- Real agent spawning (`dispatchTask` is always mocked).
- `WorkflowChannel` MCP notification delivery to external coordinator (fire-and-forget; no observable side effect to assert in tests).
- The v1 workflow executor path.
- CLI subprocess tests for the `brain workflow` command.
- Load/stress testing the reconciler with many concurrent runs.

## Dependencies

- **D-01**: `WorkflowRuntime` (`src/modules/workflow/runtime/runtime.ts`) — must be complete with `start`, `hydrate`, `getStatus`, `signal`, `waitForCompletion`, reconciler.
- **D-02**: `WorkflowContext` (`src/modules/workflow/runtime/context.ts`) — including `resolveAgent`, `handleAgentDeath`, `signal`, `assisted`, `toRun`.
- **D-03**: `planningWorkflow` (`src/modules/workflow/flows/planning.ts`).
- **D-04**: `createBrainMcpServer` (`src/server/mcp.ts`) — `getV2Runtime` guard and `brain_workflow_*` tools wired.
- **D-05**: `__tests__/helpers.ts` — `createTestDb`, `createMockEmbedder`.
- **D-06**: Existing `InMemoryTransport` pattern from `__tests__/integration/workflow-activation.test.ts`.
- **D-07**: `src/modules/workflow/runtime/migration.ts` — `createWorkflowRunsMigration` DDL.
