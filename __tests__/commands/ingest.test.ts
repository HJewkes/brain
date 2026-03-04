import { describe, it, expect } from 'vitest';
import { importCommand } from '../../src/commands/import.js';

describe('import command (replaces ingest)', () => {
  it('exports a Commander command named import', () => {
    expect(importCommand.name()).toBe('import');
  });

  it('has --urls option', () => {
    const opts = importCommand.options.map((o) => o.long);
    expect(opts).toContain('--urls');
  });

  it('has --source and --quiet and --json options', () => {
    const opts = importCommand.options.map((o) => o.long);
    expect(opts).toContain('--source');
    expect(opts).toContain('--quiet');
    expect(opts).toContain('--json');
  });

  it('accepts paths as arguments', () => {
    const args = importCommand.registeredArguments;
    expect(args.length).toBeGreaterThan(0);
    expect(args[0].name()).toBe('paths');
  });
});
