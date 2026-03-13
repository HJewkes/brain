import { describe, it, expect } from 'vitest';
import { HookRegistry } from '../../src/hooks/registry.js';
import { DEFAULT_HOOK_CONFIG } from '../../src/hooks/config.js';
import type { HookHandler, HookInput, HookConfig } from '../../src/hooks/types.js';
import { hookAllow, hookBlock, hookAllowJson } from '../../src/hooks/types.js';

function makeInput(event: string, parsed: Record<string, unknown> = {}): HookInput {
  return { event: event as HookInput['event'], raw: '', parsed, cwd: '/test' };
}

function makeHandler(overrides: Partial<HookHandler> = {}): HookHandler {
  return {
    name: 'test',
    event: 'pre-tool-use',
    priority: 50,
    enabled: () => true,
    run: () => hookAllow(),
    ...overrides,
  };
}

describe('HookRegistry', () => {
  it('dispatches to handlers matching event', () => {
    const registry = new HookRegistry();
    let called = false;
    registry.register(
      makeHandler({
        event: 'pre-tool-use',
        run: () => {
          called = true;
          return hookAllow();
        },
      })
    );

    registry.dispatch('pre-tool-use', makeInput('pre-tool-use'), DEFAULT_HOOK_CONFIG);
    expect(called).toBe(true);
  });

  it('skips handlers for different events', () => {
    const registry = new HookRegistry();
    let called = false;
    registry.register(
      makeHandler({
        event: 'task-completed',
        run: () => {
          called = true;
          return hookAllow();
        },
      })
    );

    registry.dispatch('pre-tool-use', makeInput('pre-tool-use'), DEFAULT_HOOK_CONFIG);
    expect(called).toBe(false);
  });

  it('skips disabled handlers', () => {
    const registry = new HookRegistry();
    let called = false;
    registry.register(
      makeHandler({
        enabled: () => false,
        run: () => {
          called = true;
          return hookAllow();
        },
      })
    );

    registry.dispatch('pre-tool-use', makeInput('pre-tool-use'), DEFAULT_HOOK_CONFIG);
    expect(called).toBe(false);
  });

  it('returns first block result and stops', () => {
    const registry = new HookRegistry();
    const calls: string[] = [];

    registry.register(
      makeHandler({
        name: 'first',
        priority: 10,
        run: () => {
          calls.push('first');
          return hookBlock('blocked by first');
        },
      })
    );
    registry.register(
      makeHandler({
        name: 'second',
        priority: 20,
        run: () => {
          calls.push('second');
          return hookAllow();
        },
      })
    );

    const result = registry.dispatch(
      'pre-tool-use',
      makeInput('pre-tool-use'),
      DEFAULT_HOOK_CONFIG
    );
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('blocked by first');
    expect(calls).toEqual(['first']);
  });

  it('does not run subsequent handlers after a block', () => {
    const registry = new HookRegistry();
    let secondRan = false;

    registry.register(makeHandler({ name: 'a', priority: 10, run: () => hookBlock('blocked') }));
    registry.register(
      makeHandler({
        name: 'b',
        priority: 20,
        run: () => {
          secondRan = true;
          return hookAllow();
        },
      })
    );

    registry.dispatch('pre-tool-use', makeInput('pre-tool-use'), DEFAULT_HOOK_CONFIG);
    expect(secondRan).toBe(false);
  });

  it('aggregates context from multiple allow results', () => {
    const registry = new HookRegistry();

    registry.register(
      makeHandler({
        name: 'a',
        priority: 10,
        run: () => hookAllowJson('context A'),
      })
    );
    registry.register(
      makeHandler({
        name: 'b',
        priority: 20,
        run: () => hookAllowJson('context B'),
      })
    );

    const result = registry.dispatch(
      'pre-tool-use',
      makeInput('pre-tool-use'),
      DEFAULT_HOOK_CONFIG
    );
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout) as { additionalContext: string };
    expect(parsed.additionalContext).toContain('context A');
    expect(parsed.additionalContext).toContain('context B');
  });

  it('returns plain allow with empty stdout when all handlers allow with no context', () => {
    const registry = new HookRegistry();

    registry.register(makeHandler({ name: 'a', run: () => hookAllow() }));
    registry.register(makeHandler({ name: 'b', run: () => hookAllow() }));

    const result = registry.dispatch(
      'pre-tool-use',
      makeInput('pre-tool-use'),
      DEFAULT_HOOK_CONFIG
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('');
  });

  it('runs handlers in priority order (ascending)', () => {
    const registry = new HookRegistry();
    const order: number[] = [];

    registry.register(
      makeHandler({
        priority: 30,
        run: () => {
          order.push(30);
          return hookAllow();
        },
      })
    );
    registry.register(
      makeHandler({
        priority: 10,
        run: () => {
          order.push(10);
          return hookAllow();
        },
      })
    );
    registry.register(
      makeHandler({
        priority: 20,
        run: () => {
          order.push(20);
          return hookAllow();
        },
      })
    );

    registry.dispatch('pre-tool-use', makeInput('pre-tool-use'), DEFAULT_HOOK_CONFIG);
    expect(order).toEqual([10, 20, 30]);
  });

  it('returns allow with empty stdout when no handlers match', () => {
    const registry = new HookRegistry();
    const result = registry.dispatch(
      'pre-tool-use',
      makeInput('pre-tool-use'),
      DEFAULT_HOOK_CONFIG
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('');
  });

  it('getHandlers returns all handlers for a specific event', () => {
    const registry = new HookRegistry();
    registry.register(makeHandler({ name: 'a', event: 'pre-tool-use' }));
    registry.register(makeHandler({ name: 'b', event: 'task-completed' }));
    registry.register(makeHandler({ name: 'c', event: 'pre-tool-use' }));

    expect(registry.getHandlers('pre-tool-use')).toHaveLength(2);
    expect(registry.getHandlers('task-completed')).toHaveLength(1);
    expect(registry.getHandlers()).toHaveLength(3);
  });

  it('getHandlers returns all handlers when called without event', () => {
    const registry = new HookRegistry();
    registry.register(makeHandler({ name: 'a', event: 'pre-tool-use' }));
    registry.register(makeHandler({ name: 'b', event: 'prompt-submit' }));

    expect(registry.getHandlers()).toHaveLength(2);
  });

  it('passes config to the enabled predicate', () => {
    const registry = new HookRegistry();
    const seenConfigs: HookConfig[] = [];

    registry.register(
      makeHandler({
        enabled: (cfg) => {
          seenConfigs.push(cfg);
          return true;
        },
      })
    );

    const customConfig: HookConfig = {
      ...DEFAULT_HOOK_CONFIG,
      enforcement: { ...DEFAULT_HOOK_CONFIG.enforcement, wipLimit: 7 },
    };
    registry.dispatch('pre-tool-use', makeInput('pre-tool-use'), customConfig);
    expect(seenConfigs[0].enforcement.wipLimit).toBe(7);
  });

  it('passes config to the run function', () => {
    const registry = new HookRegistry();
    const seenConfigs: HookConfig[] = [];

    registry.register(
      makeHandler({
        run: (_, cfg) => {
          seenConfigs.push(cfg);
          return hookAllow();
        },
      })
    );

    const customConfig: HookConfig = {
      ...DEFAULT_HOOK_CONFIG,
      enforcement: { ...DEFAULT_HOOK_CONFIG.enforcement, wipLimit: 3 },
    };
    registry.dispatch('pre-tool-use', makeInput('pre-tool-use'), customConfig);
    expect(seenConfigs[0].enforcement.wipLimit).toBe(3);
  });

  it('preserves insertion order for equal-priority handlers', () => {
    const registry = new HookRegistry();
    const order: string[] = [];

    registry.register(
      makeHandler({
        name: 'x',
        priority: 50,
        run: () => {
          order.push('x');
          return hookAllow();
        },
      })
    );
    registry.register(
      makeHandler({
        name: 'y',
        priority: 50,
        run: () => {
          order.push('y');
          return hookAllow();
        },
      })
    );
    registry.register(
      makeHandler({
        name: 'z',
        priority: 50,
        run: () => {
          order.push('z');
          return hookAllow();
        },
      })
    );

    registry.dispatch('pre-tool-use', makeInput('pre-tool-use'), DEFAULT_HOOK_CONFIG);
    expect(order).toEqual(['x', 'y', 'z']);
  });
});
