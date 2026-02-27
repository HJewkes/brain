import { describe, it, expect } from 'vitest';
import { ok, fail, pmError, formatError } from '../../../src/modules/pm/errors.js';
import type { PmErrorCode } from '../../../src/modules/pm/errors.js';

describe('PM errors', () => {
  describe('ok', () => {
    it('wraps data with ok: true', () => {
      const result = ok({ id: 'abc' });
      expect(result).toEqual({ ok: true, data: { id: 'abc' } });
    });

    it('wraps primitive data', () => {
      const result = ok(42);
      expect(result).toEqual({ ok: true, data: 42 });
    });

    it('wraps null data', () => {
      const result = ok(null);
      expect(result).toEqual({ ok: true, data: null });
    });
  });

  describe('fail', () => {
    it('produces ok: false with correct code and message', () => {
      const result = fail('NOT_FOUND', 'Task not found');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('NOT_FOUND');
        expect(result.error.message).toBe('Task not found');
        expect(result.error.error).toBe(true);
      }
    });

    it('includes details when provided', () => {
      const result = fail('INVALID_INPUT', 'Bad prefix', { prefix: 'toolong!' });
      if (!result.ok) {
        expect(result.error.details).toEqual({ prefix: 'toolong!' });
      }
    });

    it('omits details when not provided', () => {
      const result = fail('NOT_FOUND', 'Missing');
      if (!result.ok) {
        expect(result.error.details).toBeUndefined();
      }
    });
  });

  describe('pmError', () => {
    it('always has error: true', () => {
      const err = pmError('CYCLE_DETECTED', 'Cycle found');
      expect(err.error).toBe(true);
    });

    it('sets code and message', () => {
      const err = pmError('WIP_LIMIT', 'Too many in-progress tasks', { limit: 5 });
      expect(err.code).toBe('WIP_LIMIT');
      expect(err.message).toBe('Too many in-progress tasks');
      expect(err.details).toEqual({ limit: 5 });
    });

    it('omits details key when undefined', () => {
      const err = pmError('NOT_FOUND', 'Not found');
      expect('details' in err).toBe(false);
    });
  });

  describe('formatError', () => {
    it('outputs valid JSON in json mode', () => {
      const err = pmError('NOT_FOUND', 'Task WEB-01.03 not found');
      const output = formatError(err, true);
      const parsed = JSON.parse(output);
      expect(parsed.error).toBe(true);
      expect(parsed.code).toBe('NOT_FOUND');
      expect(parsed.message).toBe('Task WEB-01.03 not found');
    });

    it('outputs readable string in human mode', () => {
      const err = pmError('INVALID_TRANSITION', 'Cannot go from done to pending');
      const output = formatError(err, false);
      expect(output).toBe('Error [INVALID_TRANSITION]: Cannot go from done to pending');
    });

    it('includes details in JSON output', () => {
      const err = pmError('WIP_LIMIT', 'Limit exceeded', { current: 5, limit: 3 });
      const output = formatError(err, true);
      const parsed = JSON.parse(output);
      expect(parsed.details).toEqual({ current: 5, limit: 3 });
    });
  });

  describe('error codes', () => {
    it('all error codes are strings', () => {
      const codes: PmErrorCode[] = [
        'PROJECT_EXISTS',
        'NOT_FOUND',
        'INVALID_TRANSITION',
        'INVALID_CLAIM_TOKEN',
        'ALREADY_CLAIMED',
        'CYCLE_DETECTED',
        'NO_PROMPT',
        'HAS_DEPENDENTS',
        'WIP_LIMIT',
        'DUPLICATE_ID',
        'INVALID_INPUT',
      ];
      for (const code of codes) {
        expect(typeof code).toBe('string');
        const err = pmError(code, 'test');
        expect(err.code).toBe(code);
      }
    });
  });
});
