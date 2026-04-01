# Research Brief: VNM-53.77

Plan: v2-e2e-test | Project: VNM

## Existing Code

- `src/modules/workflow/runtime/types.ts` — `WorkflowStatus`, `StepResult`, `WorkflowRun`, `WorkflowContext` interface, `WorkflowFn`, `ChannelPushFn` type definitions. Already complete.
- `src/modules/workflow/runtime/runtime.ts` — `WorkflowRuntime` singleton: `register`, `start`, `hydrate`, `getStatus`, `waitForCompletion`, `signal`, `startReconciler`, `stopReconciler`. Reconciler uses `process.kill(pid, 0)` for liveness. Already complete.
- `src/modules/workflow/runtime/context.ts` — `WorkflowContext` class implementing dispatch (memoized via `stepResults`), assisted (channel push + signal wait), iteration counting, agent resolution, death handling. Already complete.
- `src/modules/workflow/runtime/signals.ts` — Signal parsing from agent output strings. Already complete.
- `src/modules/workflow/runtime/channel.ts` — `WorkflowChannel` for push events. Exists (referenced in server/index.ts).
- `src/modules/workflow/flows/planning.ts` — Imperative planning workflow function. Already complete (research→design⇄critic loop→spec-tests→decompose→implement→review).
- `src/server/mcp.ts` — `brain_workflow_start`, `brain_workflow_status`, `brain_workflow_signal` tools wired to V2 runtime via `getV2Runtime()` with `BRAIN_EXECUTOR_V2=1` guard.
- `src/server/index.ts` — `initV2Runtime()` creates `WorkflowRuntime` on server startup when `BRAIN_EXECUTOR_V2=1`; registers `planningWorkflow`.
- `__tests__/integration/workflow-activation.test.ts` — existing pattern for `InMemoryTransport` + `createBrainMcpServer` in tests.
- `__tests__/helpers.ts` — `createTestDb()` template clone helper, `createMockEmbedder()`.

## External Findings

- The `executor-v2-test` plan (`.plans/executor-v2-test/`) has a detailed design for E2E tests that covers the same topic. Those artifacts were produced before the runtime was implemented; the current design can reference and refine them.
- `@modelcontextprotocol/sdk` is already a dev dependency; `InMemoryTransport` is available.
- Vitest with globals enabled; no additional test dependencies needed.

## Knowledge Gaps

- Whether `workflow_runs` table is present in the test template DB (`__tests__/helpers.ts`). If not, tests must create it inline.
- Whether `context.ts` exposes a `resolveAgent(stepId, output)` method that tests can call to drive completion without real agents.
- Whether `WorkflowRuntime` exposes a `handleAgentDeath` method for supervision tests.

## Recommendations

- Use inline workflow fixtures (`minimalWorkflow`, `assistedWorkflow`, `criticLoopWorkflow`) for fast targeted tests; reserve `planningWorkflow` for the full E2E scenario.
- Create `workflow_runs` table inline per test file via `CREATE TABLE IF NOT EXISTS` — do not modify the template DB.
- Split into two test files: `e2e.test.ts` (runtime-level) and `workflow-mcp.test.ts` (MCP transport-level).

## Suggested Interview Questions

1. Does `createTestDb()` in `__tests__/helpers.ts` already include the `workflow_runs` table in its template?
2. Does `WorkflowContext` expose `resolveAgent(stepId, output)` and `handleAgentDeath(agent)` as public methods for testing?
3. Should the live E2E test (VNM-53.17) be a manual validation script or an automated Vitest test?
