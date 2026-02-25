import { describe, it, expect } from 'vitest';
import { lineageCommand } from '../../src/commands/lineage.js';

describe('lineage command', () => {
  it('exports a Commander command', () => {
    expect(lineageCommand.name()).toBe('lineage');
  });

  it('has tree, delete, and archive subcommands', () => {
    const subcommands = lineageCommand.commands.map((c) => c.name());
    expect(subcommands).toContain('tree');
    expect(subcommands).toContain('delete');
    expect(subcommands).toContain('archive');
  });
});
