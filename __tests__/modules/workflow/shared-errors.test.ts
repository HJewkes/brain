import { describe, test, expect } from 'vitest';
import { ok, fail } from '../../../src/errors.js';
import type { Result } from '../../../src/errors.js';

// --- AC-01b: Shared Error Infrastructure ---

describe('shared Result type', () => {
  test('AC-01b: ok() wraps data with ok: true', () => {
    const result: Result<{ id: string }> = ok({ id: 'abc' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toEqual({ id: 'abc' });
    }
  });

  test('AC-01b: fail() produces ok: false with code and message', () => {
    const result: Result<never> = fail('NOT_FOUND', 'Resource not found');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('NOT_FOUND');
      expect(result.error.message).toBe('Resource not found');
    }
  });

  test('AC-01b: fail() includes details when provided', () => {
    const result = fail('INVALID_INPUT', 'Bad data', { field: 'name' });
    if (!result.ok) {
      expect(result.error.details).toEqual({ field: 'name' });
    }
  });

  test('AC-01b: Result type is generic and works with any data type', () => {
    const numResult: Result<number> = ok(42);
    expect(numResult.ok).toBe(true);
    if (numResult.ok) {
      expect(numResult.data).toBe(42);
    }

    const arrResult: Result<string[]> = ok(['a', 'b']);
    expect(arrResult.ok).toBe(true);
    if (arrResult.ok) {
      expect(arrResult.data).toEqual(['a', 'b']);
    }
  });
});

// Verify PM module still works with shared type
describe('PM errors backward compatibility', () => {
  test('AC-01b: PM ok/fail helpers still function correctly', async () => {
    const pmErrors = await import('../../../src/modules/pm/errors.js');
    const result = pmErrors.ok({ display_id: 'TST-01.01' });
    expect(result.ok).toBe(true);

    const failure = pmErrors.fail('NOT_FOUND', 'Task not found');
    expect(failure.ok).toBe(false);
  });
});
