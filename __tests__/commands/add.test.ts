import { describe, it, expect } from 'vitest';
import { addCommand } from '../../src/commands/add.js';

describe('add command', () => {
  it('exports a Commander command', () => {
    expect(addCommand.name()).toBe('add');
  });

  it('has --url option', () => {
    const opts = addCommand.options.map((o) => o.long);
    expect(opts).toContain('--url');
  });

  it('has all standard note options', () => {
    const opts = addCommand.options.map((o) => o.long);
    expect(opts).toContain('--title');
    expect(opts).toContain('--type');
    expect(opts).toContain('--tier');
    expect(opts).toContain('--tags');
  });
});
