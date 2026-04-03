import { describe, it, expect, beforeEach, vi } from 'vitest';
import { frictionHook, getBuffer, clearBuffer } from '../../src/hooks/checks/friction.js';
import type { HookInput, HookConfig } from '../../src/hooks/types.js';

function makeInput(tool: string, error = false): HookInput {
  return {
    event: 'pre-tool-use',
    raw: '',
    parsed: { tool, ...(error ? { error: true } : {}) },
    cwd: '/tmp',
  };
}

const config = {} as HookConfig;

describe('frictionHook', () => {
  beforeEach(() => {
    clearBuffer();
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  it('has correct metadata', () => {
    expect(frictionHook.name).toBe('friction');
    expect(frictionHook.event).toBe('pre-tool-use');
    expect(frictionHook.priority).toBe(90);
    expect(frictionHook.enabled({} as HookConfig)).toBe(true);
  });

  it('allows normal tool usage without warnings', () => {
    const result1 = frictionHook.run(makeInput('Read'), config);
    const result2 = frictionHook.run(makeInput('Write'), config);
    const result3 = frictionHook.run(makeInput('Bash'), config);

    expect(result1.exitCode).toBe(0);
    expect(result2.exitCode).toBe(0);
    expect(result3.exitCode).toBe(0);
    expect(result1.stdout).toBe('');
    expect(process.stderr.write).not.toHaveBeenCalled();
  });

  it('detects repeated failures of same tool (3+)', () => {
    frictionHook.run(makeInput('Bash', true), config);
    frictionHook.run(makeInput('Bash', true), config);
    const result = frictionHook.run(makeInput('Bash', true), config);

    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.additionalContext).toContain('Bash');
    expect(parsed.additionalContext).toContain('failed 3 times');
    expect(process.stderr.write).toHaveBeenCalled();
  });

  it('does not warn for failures below threshold', () => {
    frictionHook.run(makeInput('Bash', true), config);
    const result = frictionHook.run(makeInput('Bash', true), config);

    expect(result.stdout).toBe('');
    expect(process.stderr.write).not.toHaveBeenCalled();
  });

  it('detects rapid consecutive retries', () => {
    frictionHook.run(makeInput('Edit', true), config);
    frictionHook.run(makeInput('Edit', true), config);
    const result = frictionHook.run(makeInput('Edit', true), config);

    const parsed = JSON.parse(result.stdout);
    expect(parsed.additionalContext).toContain('Edit');
    expect(parsed.additionalContext).toContain('consecutively');
  });

  it('does not flag mixed tool failures as rapid retries', () => {
    frictionHook.run(makeInput('Bash', true), config);
    frictionHook.run(makeInput('Edit', true), config);
    const result = frictionHook.run(makeInput('Read', true), config);

    expect(result.stdout).toBe('');
  });

  it('does not flag consecutive successes as friction', () => {
    for (let i = 0; i < 5; i++) {
      frictionHook.run(makeInput('Read'), config);
    }
    const result = frictionHook.run(makeInput('Read'), config);

    expect(result.stdout).toBe('');
    expect(process.stderr.write).not.toHaveBeenCalled();
  });

  it('tracks events in ring buffer', () => {
    frictionHook.run(makeInput('Read'), config);
    frictionHook.run(makeInput('Write'), config);

    const buffer = getBuffer();
    expect(buffer).toHaveLength(2);
    expect(buffer[0].toolName).toBe('Read');
    expect(buffer[1].toolName).toBe('Write');
  });

  it('caps ring buffer at 20 entries', () => {
    for (let i = 0; i < 25; i++) {
      frictionHook.run(makeInput(`tool-${i}`), config);
    }

    const buffer = getBuffer();
    expect(buffer).toHaveLength(20);
    expect(buffer[0].toolName).toBe('tool-5');
    expect(buffer[19].toolName).toBe('tool-24');
  });

  it('clears old failures when buffer overflows', () => {
    frictionHook.run(makeInput('Bash', true), config);
    frictionHook.run(makeInput('Bash', true), config);

    // Fill buffer with 20 successful calls to push errors out
    for (let i = 0; i < 20; i++) {
      frictionHook.run(makeInput(`ok-${i}`), config);
    }

    // Now a single error should not trigger warning
    const result = frictionHook.run(makeInput('Bash', true), config);
    expect(result.stdout).toBe('');
  });

  it('uses exitCode=2 as error signal', () => {
    for (let i = 0; i < 3; i++) {
      frictionHook.run(
        {
          event: 'pre-tool-use',
          raw: '',
          parsed: { tool: 'Bash', exitCode: 2 },
          cwd: '/tmp',
        },
        config
      );
    }

    const buffer = getBuffer();
    expect(buffer.every((e) => e.outcome === 'error')).toBe(true);
  });

  it('falls back to parsed.name for tool name', () => {
    frictionHook.run(
      { event: 'pre-tool-use', raw: '', parsed: { name: 'MyTool' }, cwd: '/tmp' },
      config
    );

    expect(getBuffer()[0].toolName).toBe('MyTool');
  });
});
