# Acceptance Criteria: Workflow Executor V2 E2E Tests

## Criteria

### AC-01: Minimal workflow runs to completion
**Given:** A real `BrainDB` with `workflow_runs` table created, and a `WorkflowRuntime` with `minimalWorkflow` registered  
**When:** `runtime.start('minimal', { project: 'TST', projectDir: '/tmp' })` is called, then `resolveAllAgents` drives both steps to completion  
**Then:** `runtime.getStatus(runId).status === 'completed'` and `stepResults` contains entries for both `step-a` and `step-b`

### AC-02: Memoized replay skips completed steps
**Given:** A `workflow_runs` row pre-seeded with `step_results` containing a completed `step-a` result  
**When:** `runtime.hydrate()` is called and `resolveAllAgents` drives the remaining step  
**Then:** `dispatchTask` is called exactly once (for `step-b` only); `createTask` is not called for `step-a`

### AC-03: Hydration resumes from first uncached step
**Given:** A `workflow_runs` row in DB with `status = 'running'`, `step_results` containing only `step-a:0`, and `current_step = 'step-b'`  
**When:** `runtime.hydrate()` is called, then `resolveAllAgents` drives the remaining step  
**Then:** `runtime.getStatus(runId).status === 'completed'` and `dispatchTask` is called exactly once (for `step-b`)

### AC-04: Assisted step pauses the workflow
**Given:** A `WorkflowRuntime` with `assistedWorkflow` registered  
**When:** `runtime.start('assisted', ...)` is called and `step-a` is resolved via `resolveAgent`  
**Then:** `runtime.getStatus(runId).status === 'paused'` before the signal is sent

### AC-05: Signal unblocks an assisted step
**Given:** A paused workflow (AC-04 precondition met)  
**When:** `runtime.signal(runId, 'review', { output: 'approved' })` is called, then `resolveAllAgents` drives `step-b`  
**Then:** `runtime.getStatus(runId).status === 'completed'` and the `review` step result contains the approved output

### AC-06: Critic revision loop re-dispatches design step
**Given:** A `criticLoopWorkflow` where the first critic call's `dispatchTask` mock returns output containing `needs_revision`  
**When:** `runtime.start('critic-loop', ...)` is called and all agents are resolved  
**Then:** `dispatchTask` is called 5 times total (design×2, critic×2, finalize×1) and final status is `completed`

### AC-07: Process supervision retries on first agent death
**Given:** A running `minimalWorkflow` with `step-a` active (not yet resolved)  
**When:** `ctx.handleAgentDeath(activeAgent)` is called once  
**Then:** `runtime.getStatus(runId).status === 'running'` and `dispatchTask` has been called twice total (original + retry)

### AC-08: Process supervision fails on second agent death
**Given:** A workflow that already retried once (AC-07 precondition)  
**When:** `ctx.handleAgentDeath(retriedAgent)` is called for the retried agent  
**Then:** `runtime.getStatus(runId).status === 'failed'` and the error field indicates agent death

### AC-09: Channel push emits step_complete events
**Given:** A `WorkflowRuntime` constructed with `channelPush: vi.fn()` spy  
**When:** A `minimalWorkflow` runs to completion (both steps resolved)  
**Then:** `channelPush` is called twice with `type: 'step_complete'` (once per step) and once with `type: 'workflow_complete'`; total call count = 3

### AC-10: Full planningWorkflow runs to completion
**Given:** A `WorkflowRuntime` with `planningWorkflow` registered and `complexity: 'low'` params  
**When:** `runtime.start('planning', { project: 'TST', projectDir: '/tmp', complexity: 'low' })` is called and all agents are resolved  
**Then:** `runtime.getStatus(runId).status === 'completed'` and `stepResults` contains entries for all steps in the low-complexity path (design, critic, spec-tests, decompose, implement, review)

### AC-11: MCP start tool returns runtimeVersion v2
**Given:** `BRAIN_EXECUTOR_V2=1` (via `vi.stubEnv`), a real `WorkflowRuntime` wired to `createBrainMcpServer` via `InMemoryTransport`  
**When:** `client.callTool('brain_workflow_start', { workflow: 'minimal', project: 'TST', projectDir: '/tmp' })` is called  
**Then:** The response content includes `runtimeVersion: 'v2'` and a valid UUID `runId`

### AC-12: MCP status tool reflects running state
**Given:** A workflow started via `brain_workflow_start` (AC-11 precondition), no agents resolved yet  
**When:** `client.callTool('brain_workflow_status', { runId })` is called  
**Then:** Response includes `instance_status: 'running'` and `runtimeVersion: 'v2'`

### AC-13: MCP status tool reflects completed state
**Given:** A workflow started via MCP with all agents resolved via `resolveAllAgents`  
**When:** `client.callTool('brain_workflow_status', { runId })` is called after completion  
**Then:** Response includes `instance_status: 'completed'`

### AC-14: MCP signal tool unblocks paused assisted workflow
**Given:** An `assistedWorkflow` started via MCP, paused after `step-a` completes  
**When:** `client.callTool('brain_workflow_signal', { runId, stepId: 'review', action: 'complete', output: 'approved' })` is called, then remaining agents resolved  
**Then:** Final `brain_workflow_status` call returns `instance_status: 'completed'`

---

## Edge Cases

### EC-01: Start with unknown workflow name
**Given:** A `WorkflowRuntime` with no workflows registered  
**When:** `runtime.start('nonexistent', params)` is called  
**Then:** The returned promise rejects and the `workflow_runs` row (if created) has `status = 'failed'`

### EC-02: Signal on non-paused workflow
**Given:** A running (not paused) workflow  
**When:** `runtime.signal(runId, 'some-step', { output: 'x' })` is called  
**Then:** The call throws or returns an error; the workflow status remains `running` and no step is skipped

### EC-03: Hydrate on completed run
**Given:** A `workflow_runs` row with `status = 'completed'`  
**When:** `runtime.hydrate()` is called  
**Then:** No new `RunningWorkflow` entry is created for that run; no agents are dispatched; status remains `completed`

### EC-04: resolveAllAgents with maxSteps guard
**Given:** A workflow whose mock never calls `resolveAgent` (infinite wait simulation)  
**When:** `resolveAllAgents(runtime, runId, undefined, 5)` is called with `maxSteps = 5`  
**Then:** The function returns after 5 iterations without throwing; the test can assert partial state

### EC-05: MCP status on nonexistent runId
**Given:** A valid MCP server with `BRAIN_EXECUTOR_V2=1`  
**When:** `client.callTool('brain_workflow_status', { runId: 'does-not-exist' })` is called  
**Then:** Response indicates error or `not_found`; no unhandled exception in the server

---

## Non-Functional

### NF-01: Test suite wall-clock time
Each `test()` case in `e2e.test.ts` completes within Vitest's default 10s timeout. The full file runs in under 60s. No artificial `sleep()` calls.

### NF-02: No global state leakage
`BRAIN_EXECUTOR_V2=1` in `workflow-mcp.test.ts` via `vi.stubEnv` must not affect other test files. Verified by running the full suite in parallel (`vitest run`) with no flakiness.

### NF-03: DB isolation per test
Each `beforeEach` creates a fresh `createTestDb()` instance. No `workflow_runs` rows from one test case are visible to another.
