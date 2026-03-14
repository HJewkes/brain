import { describe, it, expect, beforeEach } from 'vitest';
import { SearchThrottle } from '../../src/services/search-throttle.js';

describe('SearchThrottle', () => {
  let throttle: SearchThrottle;

  beforeEach(() => {
    throttle = new SearchThrottle('test-session');
  });

  describe('full tier (calls 1-3)', () => {
    it('allows first call with full tier', () => {
      const result = throttle.check();

      expect(result).toEqual({ allowed: true, tier: 'full' });
    });

    it('allows calls 1 through 3 with full tier', () => {
      for (let i = 0; i < 3; i++) {
        const result = throttle.check();
        expect(result.allowed).toBe(true);
        expect(result.tier).toBe('full');
        expect(result.maxResults).toBeUndefined();
        expect(result.message).toBeUndefined();
        throttle.record();
      }
    });
  });

  describe('reduced tier (calls 4-8)', () => {
    it('returns reduced tier on call 4', () => {
      for (let i = 0; i < 3; i++) throttle.record();

      const result = throttle.check();

      expect(result.allowed).toBe(true);
      expect(result.tier).toBe('reduced');
      expect(result.maxResults).toBe(3);
      expect(result.message).toBeDefined();
    });

    it('returns reduced tier through call 8', () => {
      for (let i = 0; i < 7; i++) throttle.record();

      const result = throttle.check();

      expect(result.allowed).toBe(true);
      expect(result.tier).toBe('reduced');
      expect(result.maxResults).toBe(3);
    });

    it('includes throttle warning message', () => {
      for (let i = 0; i < 3; i++) throttle.record();

      const result = throttle.check();

      expect(result.message).toContain('throttled');
    });
  });

  describe('blocked tier (calls 9+)', () => {
    it('blocks on call 9', () => {
      for (let i = 0; i < 8; i++) throttle.record();

      const result = throttle.check();

      expect(result.allowed).toBe(false);
      expect(result.tier).toBe('blocked');
      expect(result.message).toContain('blocked');
    });

    it('remains blocked on subsequent calls', () => {
      for (let i = 0; i < 15; i++) throttle.record();

      const result = throttle.check();

      expect(result.allowed).toBe(false);
      expect(result.tier).toBe('blocked');
    });
  });

  describe('boundary transitions', () => {
    it('transitions from full to reduced at call 4', () => {
      for (let i = 0; i < 2; i++) throttle.record();
      expect(throttle.check().tier).toBe('full');

      throttle.record(); // call 3 recorded, now at 3
      expect(throttle.check().tier).toBe('reduced');
    });

    it('transitions from reduced to blocked at call 9', () => {
      for (let i = 0; i < 7; i++) throttle.record();
      expect(throttle.check().tier).toBe('reduced');

      throttle.record(); // call 8 recorded, now at 8
      expect(throttle.check().tier).toBe('blocked');
    });
  });

  describe('reset', () => {
    it('resets call count to zero', () => {
      for (let i = 0; i < 10; i++) throttle.record();
      expect(throttle.check().tier).toBe('blocked');

      throttle.reset();

      expect(throttle.getCallCount()).toBe(0);
      expect(throttle.check().tier).toBe('full');
    });
  });

  describe('getCallCount', () => {
    it('returns 0 initially', () => {
      expect(throttle.getCallCount()).toBe(0);
    });

    it('increments accurately with each record call', () => {
      throttle.record();
      expect(throttle.getCallCount()).toBe(1);

      throttle.record();
      throttle.record();
      expect(throttle.getCallCount()).toBe(3);
    });

    it('returns 0 after reset', () => {
      throttle.record();
      throttle.record();
      throttle.reset();

      expect(throttle.getCallCount()).toBe(0);
    });
  });

  describe('sessionId', () => {
    it('stores the session id', () => {
      expect(throttle.getSessionId()).toBe('test-session');
    });

    it('allows undefined session id', () => {
      const noSession = new SearchThrottle();

      expect(noSession.getSessionId()).toBeUndefined();
    });
  });
});
