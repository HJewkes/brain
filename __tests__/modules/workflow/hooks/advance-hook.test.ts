import { describe, it, expect } from 'vitest';
import type { HookInput, HookConfig } from '../../../../src/hooks/types.js';

import { advanceHook } from '../../../../src/modules/workflow/hooks/advance-hook.js';

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
  it('has correct metadata (name, event, priority)', () => {
    expect(advanceHook.name).toBe('workflow:advance');
    expect(advanceHook.event).toBe('agent-done');
    expect(advanceHook.priority).toBe(80);
    expect(advanceHook.enabled({} as HookConfig)).toBe(true);
  });

  it('returns hookAllow unconditionally (V2 runtime handles advancement in-process)', () => {
    const result = advanceHook.run(makeInput({ agent_id: 'agent-1' }), config);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('');
  });

  it('returns hookAllow when no agent_id in input', () => {
    const result = advanceHook.run(makeInput({}), config);
    expect(result.exitCode).toBe(0);
  });
});
