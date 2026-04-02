# Design: Workflow Executor V2 E2E Tests

## Approach

The test suite is split into two files targeting different seams. The first (`e2e.test.ts`) exercises `WorkflowRuntime` directly with a real DB and mocked infrastructure dependencies — a pure in-process integration test. It covers the full lifecycle: start, hydrate, memoized replay, assisted pause/signal, critic revision loop, death/retry, and channel push events. The second (`workflow-mcp.test.ts`) adds the MCP transport boundary using `InMemoryTransport`, wires a real `WorkflowRuntime` to `createBrainMcpServer`, sets `BRAIN_EXECUTOR_V2=1` via `vi.stubEnv`, and calls all three workflow tools.

Both files create the `workflow_runs` table inline using the DDL from `workflowRuntimeMigrationV1`. Infrastructure mocks (`createTask`, `dispatchTemplate`, `dispatchTask`) are declared with `vi.mock()` at module level. A `resolveAllAgents` utility drives workflow completion by polling `ctx.activeAgent` and calling `ctx.resolveAgent()` in a micro-task loop — matching the pattern in existing context tests. Minimal inline workflow fixtures keep individual test cases fast and assertions unambiguous, while the full `planningWorkflow` import is used only for the low-complexity E2E scenario.

## Files to Create/Modify

| Action | Path | Purpose |
|--------|------|---------|
| Create | `__tests__/modules/workflow/runtime/e2e.test.ts` | Runtime lifecycle E2E: start, hydrate, memoized replay, assisted, critic loop, death/retry, channel events, planningWorkflow |
| Create | `__tests__/integration/workflow-mcp.test.ts` | MCP tool boundary: `brain_workflow_start`/`status`/`signal` via `InMemoryTransport` |

No production files are modified; this is a test-only deliverable.

## API Shapes / Type Signatures

```typescript
// ── Shared setup (per file) ────────────────────────────────────────────────

/** Create workflow_runs table in a test DB — same DDL as workflowRuntimeMigrationV1 */
function createWorkflowRunsTable(db: BrainDB): void {
  db.rawDb.exec(`
    CREATE TABLE IF NOT EXISTS workflow_runs (
      id TEXT PRIMARY KEY,
      workflow_name TEXT NOT NULL,
      context JSON NOT NULL,
      status TEXT NOT NULL DEFAULT 'running'
        CHECK(status IN ('running', 'completed', 'failed', 'paused')),
      current_step TEXT,
      step_results JSON NOT NULL DEFAULT '{}',
      active_agent JSON,
      started_at TEXT NOT NULL,
      completed_at TEXT,
      error TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_workflow_runs_status ON workflow_runs(status);
  `);
}

// ── Inline workflow fixtures (e2e.test.ts) ─────────────────────────────────

/** Two-step workflow for fast lifecycle tests */
const minimalWorkflow: WorkflowFn = async (ctx) => {
  await ctx.dispatch('step-a', 'template-a');
  await ctx.dispatch('step-b', 'template-b');
};

/** Pauses at assisted step; verifies signal unblocks execution */
const assistedWorkflow: WorkflowFn = async (ctx) => {
  await ctx.dispatch('step-a', 'template-a');
  await ctx.assisted('review', 'template-review');
  await ctx.dispatch('step-b', 'template-b');
};

/** Critic → needs_revision → re-dispatch design → critic → finalize */
const criticLoopWorkflow: WorkflowFn = async (ctx) => {
  await ctx.dispatch('design', 'template-design');
  const critic = await ctx.dispatch('critic', 'template-critic');
  if (critic.signal === 'needs_revision') {
    await ctx.dispatch('design', 'template-design');
    await ctx.dispatch('critic', 'template-critic');
  }
  await ctx.dispatch('finalize', 'template-finalize');
};

// ── Test drive utility ─────────────────────────────────────────────────────

/**
 * Drives workflow to completion by polling activeRuns for the given runId,
 * calling ctx.resolveAgent(stepId, output) when activeAgent is set.
 * Exits after maxSteps to prevent infinite loops.
 */
async function resolveAllAgents(
  runtime: WorkflowRuntime,
  runId: string,
  outputFn?: (stepId: string) => string,  // default: `output for ${stepId}`
  maxSteps?: number                         // default: 20
): Promise<void>;

// ── MCP shim (workflow-mcp.test.ts) ───────────────────────────────────────

/**
 * Returns a minimal BrainServiceClass-shaped object with _workflowRuntime set,
 * so getV2Runtime() in mcp.ts can find it without BrainServiceClass.create().
 */
function makeServiceWithRuntime(
  db: BrainDB,
  config: BrainConfig,
  runtime: WorkflowRuntime
): Pick<BrainServiceClass, '_workflowRuntime'> & Record<string, unknown>;
```

## Data Flow

### Runtime E2E tests (`e2e.test.ts`)

1. `beforeEach`: `createTestDb()` → `createWorkflowRunsTable(db)` → construct `new WorkflowRuntime({ db, config })` → `runtime.register('minimal', minimalWorkflow)`.
2. `vi.mock()` at module level: `createTask` returns `{ ok: true, data: { display_id: 'TST-01.001' } }`, `dispatchTemplate` returns `{ ok: true, data: { rendered: 'prompt' } }`, `dispatchTask` returns `{ pid: 55555, taskId: 'TST-01.001', agentId: 'agent-mock', sessionId: 'sess-mock', model: 'sonnet', prompt: 'test' }`.
3. **Start/complete (R-01, R-10)**: `runtime.start('minimal', params)` → `resolveAllAgents(runtime, runId)` → `await runtime.waitForCompletion(runId)` → assert `getStatus(runId).status === 'completed'`.
4. **Memoization (R-02)**: Pre-seed `workflow_runs.step_results` in DB with a completed `step-a` result before calling `runtime.hydrate()` → drive remaining steps → assert `dispatchTask` called exactly once.
5. **Hydration (R-03)**: Insert a `workflow_runs` row with `status = 'running'`, partial `step_results`, call `runtime.hydrate()` → `resolveAllAgents` → assert `completed`.
6. **Assisted/signal (R-04)**: `runtime.start('assisted', params)` → after `step-a` resolves, assert `getStatus(runId).status === 'paused'` → call `runtime.signal(runId, 'review', { output: 'approved' })` → drive remaining steps → assert `completed`.
7. **Critic loop (R-05)**: Configure `dispatchTask` mock to return a `needs_revision` signal on first critic call → start `criticLoopWorkflow` → resolve all → assert `dispatchTask` called 5 times and final `completed`.
8. **Death/retry (R-06)**: Start workflow → hold at `step-a` (don't resolve) → call `ctx.handleAgentDeath(activeAgent)` once → assert `running`, retry count = 1 → call again → assert `failed`.
9. **Channel events (R-07)**: Construct runtime with `channelPush: vi.fn()` spy → run `minimalWorkflow` to completion → assert spy called twice with `step_complete` and once with `workflow_complete`.

### MCP tests (`workflow-mcp.test.ts`)

1. `beforeEach`: DB setup → `createWorkflowRunsTable(db)` → construct `WorkflowRuntime` → `runtime.register('minimal', minimalWorkflow)` → `vi.stubEnv('BRAIN_EXECUTOR_V2', '1')` → `makeServiceWithRuntime(db, config, runtime)` → `createBrainMcpServer(svc)` → wire `InMemoryTransport` → connect `Client`.
2. **Start (R-08)**: `client.callTool('brain_workflow_start', { workflow: 'minimal', project: 'TST', projectDir: '/tmp' })` → assert response includes `runtimeVersion: 'v2'` and a valid UUID `runId`.
3. **Status running**: `client.callTool('brain_workflow_status', { runId })` before agents resolved → assert `instance_status: 'running'` and `runtimeVersion: 'v2'`.
4. **Status completed**: `resolveAllAgents` → `brain_workflow_status` → assert `instance_status: 'completed'`.
5. **Signal (R-09)**: Start `assistedWorkflow` → resolve `step-a` → assert `paused` → `client.callTool('brain_workflow_signal', { runId, stepId: 'review', action: 'complete', output: 'ok' })` → drive remaining → assert `completed`.

## Key Decisions

| Decision | Chosen | Alternative | Rationale |
|----------|--------|-------------|-----------|
| File split | Two files (runtime + MCP) | One combined file | Runtime tests run without transport overhead; MCP tests can run independently; failure isolation is cleaner |
| Inline minimal workflow | `minimalWorkflow` defined in test | Import `planningWorkflow` for all cases | 2-step workflow makes assertions unambiguous; `planningWorkflow` used only for full E2E scenario |
| `resolveAllAgents` per-file | ~15-line helper defined in each file | Extract to `__tests__/helpers.ts` | Keeps helpers.ts stable; avoids coupling test infra to runtime internals |
| `vi.stubEnv` per describe | Scoped to MCP describe block | Global in `vitest.config` | Global env changes affect other test files; `vi.stubEnv` restores after each describe |
| `makeServiceWithRuntime` shim | Minimal object with `_workflowRuntime` | Full `BrainServiceClass.create()` | `create()` does config resolution + file I/O; shim tests MCP layer without startup complexity |
| DB per test | `createTestDb()` in `beforeEach` | Shared DB across describe | Shared DB accumulates `workflow_runs` rows, making status assertions ambiguous |

## Risks and Mitigations

- **`workflow_runs` table not in template DB**: `createWorkflowRunsTable()` runs `CREATE TABLE IF NOT EXISTS` in `beforeEach` — safe on any template version.
- **`resolveAllAgents` poll loop never terminates**: `maxSteps = 20` guard exits the loop; `waitForCompletion` times out under Vitest's 10s default if the workflow hangs. Sufficient for any workflow ≤ 10 steps.
- **`getV2Runtime` env check timing**: `vi.stubEnv` must run before `createBrainMcpServer()` in `beforeEach` — enforce with a comment in the test.
- **`_workflowRuntime` shim field renamed**: Assert `runtimeVersion: 'v2'` in all MCP responses — the test fails immediately if the field lookup breaks.
- **`activeRuns` not public**: `resolveAllAgents` needs to access the runtime's active `WorkflowContext` to call `resolveAgent`. Use `runtime.activeRuns.get(runId)?.ctx` — `activeRuns` getter is public on `WorkflowRuntime`.

## Scaffolding vs. Implementation

**Wave 1 (blocking — must exist before test bodies run):**
- `createWorkflowRunsTable` helper (per file)
- `vi.mock()` setup for `createTask`, `dispatchTemplate`, `dispatchTask`
- `resolveAllAgents` utility (per file)
- `beforeEach`/`afterEach` lifecycle
- `it.todo` stubs for all test cases

**Wave 2 (parallelizable — implement test bodies on scaffolding):**
- `e2e.test.ts`: start/complete (R-01)
- `e2e.test.ts`: memoized replay (R-02)
- `e2e.test.ts`: hydration (R-03)
- `e2e.test.ts`: assisted/signal (R-04)
- `e2e.test.ts`: critic revision loop (R-05)
- `e2e.test.ts`: death/retry (R-06)
- `e2e.test.ts`: channel push events (R-07)
- `e2e.test.ts`: full `planningWorkflow` E2E (R-10)
- `workflow-mcp.test.ts`: start/status/complete (R-08)
- `workflow-mcp.test.ts`: signal/unblock (R-09)

## PR Boundaries

- **Option A**: One PR with both test files.
- **Option B**: `e2e.test.ts` in one PR, `workflow-mcp.test.ts` as a follow-up.
- **Recommendation**: Option A. Both files are test-only additions; `@modelcontextprotocol/sdk` is already a dev dependency. Shipping together demonstrates complete runtime coverage from in-process through the MCP boundary in a single reviewable diff.
