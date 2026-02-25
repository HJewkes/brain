import { describe, it, expect } from 'vitest';
import { ingestCommand } from '../../src/commands/ingest.js';

describe('ingest command', () => {
  it('exports a Commander command', () => {
    expect(ingestCommand.name()).toBe('ingest');
  });

  it('has --urls option', () => {
    const opts = ingestCommand.options.map((o) => o.long);
    expect(opts).toContain('--urls');
  });

  it('has --url and --source options', () => {
    const opts = ingestCommand.options.map((o) => o.long);
    expect(opts).toContain('--url');
    expect(opts).toContain('--source');
  });
});
