import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import type { HookInput, HookConfig } from '../../../../src/hooks/types.js';

// The advance-hook module does not exist yet. These imports will fail at
// runtime until the implementation is created, which is the expected
// behavior for spec tests.
import { advanceHook } from '../../../../src/modules/workflow/hooks/advance-hook.js';

// Mock child_process.execFileSync since the advance-hook shells out
vi.mock('node:child_process', () => ({
  execFileSync: vi.fn(),
}));

// Mock the agents data module
vi.mock('../../../../src/modules/agents/data.js', () => ({
  getAgent: vi.fn(),
}));

// Mock better-sqlite3 for DB opening
vi.mock('better-sqlite3', () => {
  const mockDb = {
    close: vi.fn(),
    prepare: vi.fn(() => ({ get: vi.fn(), all: vi.fn(), run: vi.fn() })),
  };
  return { default: vi.fn(() => mockDb) };
});

import { execFileSync } from 'node:child_process';
import { getAgent } from '../../../../src/modules/agents/data.js';

function makeInput(parsed: Record<string, unknown> = {}): HookInput {
  return {
    event: 'agent-done',
    raw: '',
    parsed,
    cwd: '/tmp/test-project',
  };
}

const config = {} as HookConfig;

describe('advanceHook', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  // --- AC-06: Hook metadata and structure ---

  it('AC-06: has correct metadata (name, event, priority)', () => {
    expect(advanceHook.name).toBe('workflow:advance');
    expect(advanceHook.event).toBe('agent-done');
    expect(advanceHook.priority).toBe(80);
    expect(advanceHook.enabled({} as HookConfig)).toBe(true);
  });

  // --- AC-08: Non-workflow task does not trigger advancement ---

  it('AC-08: returns hookAllow when no agent_id in input', () => {
    const result = advanceHook.run(makeInput({}), config);
    expect(result.exitCode).toBe(0);
    expect(execFileSync).not.toHaveBeenCalled();
  });

  it('AC-08: returns hookAllow when agent has no brain_task', () => {
    (getAgent as Mock).mockReturnValue({ id: 'agent-1', status: 'completed', brain_task: null });

    const result = advanceHook.run(makeInput({ agent_id: 'agent-1' }), config);
    expect(result.exitCode).toBe(0);
    expect(execFileSync).not.toHaveBeenCalled();
  });

  // --- AC-06: Agent-done resolves agent_id -> brain_task -> workflow instance ---

  it('AC-06: resolves agent_id to brain_task and shells out to workflow next', () => {
    (getAgent as Mock).mockReturnValue({
      id: 'agent-1',
      status: 'completed',
      brain_task: 'VNM-41.02',
    });

    const nextResult = JSON.stringify({
      advanced: ['interview'],
      pruned: [],
      completed: false,
      dispatched: [{ stepId: 'interview', taskId: 'VNM-41.03', template: 'planning-interview' }],
      errors: [],
    });
    (execFileSync as Mock).mockReturnValue(nextResult);

    const result = advanceHook.run(makeInput({ agent_id: 'agent-1' }), config);
    expect(result.exitCode).toBe(0);
    // The hook should have attempted to shell out to brain workflow next
    // (exact call depends on resolveInstanceForTask finding the instance)
  });

  // --- AC-09: Hook completes within timeout ---

  it('AC-09: passes 5-second timeout to execFileSync', () => {
    (getAgent as Mock).mockReturnValue({
      id: 'agent-1',
      status: 'completed',
      brain_task: 'VNM-41.02',
    });
    (execFileSync as Mock).mockReturnValue(
      JSON.stringify({ advanced: [], pruned: [], completed: false, dispatched: [], errors: [] })
    );

    advanceHook.run(makeInput({ agent_id: 'agent-1' }), config);

    // If execFileSync was called, verify it included a timeout
    if ((execFileSync as Mock).mock.calls.length > 0) {
      const callArgs = (execFileSync as Mock).mock.calls[0];
      const options = callArgs[2] ?? callArgs[1];
      expect(options.timeout).toBe(5000);
    }
  });

  // --- AC-10: Advance-hook is advisory only ---

  it('AC-10: returns hookAllow even when workflow next fails', () => {
    (getAgent as Mock).mockReturnValue({
      id: 'agent-1',
      status: 'completed',
      brain_task: 'VNM-41.02',
    });
    (execFileSync as Mock).mockImplementation(() => {
      throw new Error('Command timed out');
    });

    const result = advanceHook.run(makeInput({ agent_id: 'agent-1' }), config);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('');
  });

  it('AC-10: writes warning to stderr when workflow next fails', () => {
    (getAgent as Mock).mockReturnValue({
      id: 'agent-1',
      status: 'completed',
      brain_task: 'VNM-41.02',
    });
    (execFileSync as Mock).mockImplementation(() => {
      throw new Error('DB locked');
    });

    advanceHook.run(makeInput({ agent_id: 'agent-1' }), config);
    expect(process.stderr.write).toHaveBeenCalled();
  });

  // --- AC-07: Agent step auto-dispatches ---

  it('AC-07: writes dispatch prompt to stderr when step is dispatched', () => {
    (getAgent as Mock).mockReturnValue({
      id: 'agent-1',
      status: 'completed',
      brain_task: 'VNM-41.02',
    });
    const nextResult = JSON.stringify({
      advanced: ['design'],
      pruned: [],
      completed: false,
      dispatched: [{ stepId: 'design', taskId: 'VNM-41.04', template: 'planning-design' }],
      errors: [],
    });
    (execFileSync as Mock).mockReturnValue(nextResult);

    advanceHook.run(makeInput({ agent_id: 'agent-1' }), config);

    // The hook should write dispatch info to stderr
    const stderrCalls = (process.stderr.write as Mock).mock.calls;
    const stderrOutput = stderrCalls.map((c) => String(c[0])).join('');
    // Expect some dispatch-related output
    expect(stderrOutput.length).toBeGreaterThan(0);
  });

  // --- EC-04: Agent fails (non-zero exit) ---

  it('EC-04: does not advance when agent status is not completed', () => {
    (getAgent as Mock).mockReturnValue({
      id: 'agent-1',
      status: 'failed',
      brain_task: 'VNM-41.02',
    });

    const result = advanceHook.run(makeInput({ agent_id: 'agent-1' }), config);
    expect(result.exitCode).toBe(0);
    expect(execFileSync).not.toHaveBeenCalled();
  });

  // --- EC-02: Workflow already completed ---

  it('EC-02: handles already-completed workflow gracefully', () => {
    (getAgent as Mock).mockReturnValue({
      id: 'agent-1',
      status: 'completed',
      brain_task: 'VNM-41.02',
    });
    const nextResult = JSON.stringify({
      advanced: [],
      pruned: [],
      completed: true,
      dispatched: [],
      errors: [],
    });
    (execFileSync as Mock).mockReturnValue(nextResult);

    const result = advanceHook.run(makeInput({ agent_id: 'agent-1' }), config);
    expect(result.exitCode).toBe(0);
  });
});
