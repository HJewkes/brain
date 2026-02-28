import { describe, it, expect } from 'vitest';
import { resolveWorkstreamFilter } from '../../../../src/modules/pm/ids.js';

describe('task list --workstream display ID resolution', () => {
  it('resolves display ID to workstream number', () => {
    const result = resolveWorkstreamFilter('VOLT-06');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data).toBe(6);
  });

  it('accepts raw integer', () => {
    const result = resolveWorkstreamFilter('3');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data).toBe(3);
  });

  it('rejects invalid format with guidance', () => {
    const result = resolveWorkstreamFilter('not-valid');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain('workstream list');
    }
  });
});
