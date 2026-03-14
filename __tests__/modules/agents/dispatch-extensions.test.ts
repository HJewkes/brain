import { describe, it, expect, beforeEach } from 'vitest';
import {
  registerDispatchExtension,
  getRegisteredExtensions,
  clearExtensions,
} from '../../../src/modules/agents/dispatch-extensions.js';
import type { DispatchExtension } from '../../../src/modules/agents/dispatch-extensions.js';

beforeEach(() => {
  clearExtensions();
});

describe('dispatch extension registry', () => {
  it('starts empty', () => {
    expect(getRegisteredExtensions()).toHaveLength(0);
  });

  it('registers an extension', () => {
    const ext: DispatchExtension = {
      name: 'test',
      compute: () => 'data',
      format: (data) => `formatted: ${data}`,
    };

    registerDispatchExtension(ext);

    expect(getRegisteredExtensions()).toHaveLength(1);
    expect(getRegisteredExtensions()[0].name).toBe('test');
  });

  it('preserves registration order', () => {
    registerDispatchExtension({ name: 'alpha', compute: () => undefined, format: () => null });
    registerDispatchExtension({ name: 'beta', compute: () => undefined, format: () => null });
    registerDispatchExtension({ name: 'gamma', compute: () => undefined, format: () => null });

    const names = getRegisteredExtensions().map((e) => e.name);

    expect(names).toEqual(['alpha', 'beta', 'gamma']);
  });

  it('clears all extensions', () => {
    registerDispatchExtension({ name: 'test', compute: () => undefined, format: () => null });

    clearExtensions();

    expect(getRegisteredExtensions()).toHaveLength(0);
  });

  it('returns readonly array', () => {
    const exts = getRegisteredExtensions();

    expect(Object.isFrozen(exts)).toBe(false);
    expect(Array.isArray(exts)).toBe(true);
  });

  it('extension compute and format round-trip', () => {
    const ext: DispatchExtension = {
      name: 'greeting',
      compute: (input) => `hello ${input.taskDisplayId}`,
      format: (data) => `--- Greeting ---\n${data}`,
    };

    registerDispatchExtension(ext);

    const data = ext.compute({ db: {} as never, taskDisplayId: 'VNM-01.01' });
    const formatted = ext.format(data, 'VNM-01.01');

    expect(data).toBe('hello VNM-01.01');
    expect(formatted).toBe('--- Greeting ---\nhello VNM-01.01');
  });
});
