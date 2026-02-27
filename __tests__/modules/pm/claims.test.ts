import { describe, test, expect } from 'vitest';
import {
  generateClaim,
  validateClaimToken,
  isClaimStale,
  isClaimActive,
} from '../../../src/modules/pm/engine/claims.js';
import type { TaskMetadata } from '../../../src/modules/pm/types.js';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function makeTaskMetadata(overrides: Partial<TaskMetadata> = {}): TaskMetadata {
  return {
    display_id: 'WEB-01-001',
    project: 'WEB',
    workstream: 1,
    number: 1,
    status: 'claimed',
    mode: 'auto',
    category: 'implementation',
    priority: 'medium',
    ...overrides,
  };
}

describe('generateClaim', () => {
  test('returns a valid UUID token', () => {
    const claim = generateClaim();
    expect(claim.token).toMatch(UUID_REGEX);
  });

  test('returns an ISO timestamp for claimedAt', () => {
    const claim = generateClaim();
    const parsed = new Date(claim.claimedAt);
    expect(parsed.toISOString()).toBe(claim.claimedAt);
  });

  test('generates unique tokens on each call', () => {
    const a = generateClaim();
    const b = generateClaim();
    expect(a.token).not.toBe(b.token);
  });
});

describe('validateClaimToken', () => {
  test('matching tokens return ok', () => {
    const token = 'abc-123';
    const result = validateClaimToken(token, token);
    expect(result.ok).toBe(true);
  });

  test('mismatched tokens return INVALID_CLAIM_TOKEN', () => {
    const result = validateClaimToken('expected', 'wrong');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('INVALID_CLAIM_TOKEN');
    }
  });
});

describe('isClaimStale', () => {
  const baseTime = new Date('2025-06-01T12:00:00Z');

  test('within default timeout returns false', () => {
    const claimedAt = new Date('2025-06-01T11:55:00Z').toISOString();
    expect(isClaimStale(claimedAt, undefined, baseTime)).toBe(false);
  });

  test('past default timeout returns true', () => {
    const claimedAt = new Date('2025-06-01T11:49:00Z').toISOString();
    expect(isClaimStale(claimedAt, undefined, baseTime)).toBe(true);
  });

  test('exactly at timeout boundary returns false', () => {
    const tenMinMs = 10 * 60 * 1000;
    const claimedAt = new Date(baseTime.getTime() - tenMinMs).toISOString();
    expect(isClaimStale(claimedAt, undefined, baseTime)).toBe(false);
  });

  test('custom timeout is respected', () => {
    const claimedAt = new Date('2025-06-01T11:58:00Z').toISOString();
    const oneMinMs = 60 * 1000;
    expect(isClaimStale(claimedAt, oneMinMs, baseTime)).toBe(true);
  });

  test('custom long timeout keeps claim fresh', () => {
    const claimedAt = new Date('2025-06-01T11:00:00Z').toISOString();
    const twoHoursMs = 2 * 60 * 60 * 1000;
    expect(isClaimStale(claimedAt, twoHoursMs, baseTime)).toBe(false);
  });
});

describe('isClaimActive', () => {
  const now = new Date('2025-06-01T12:00:00Z');

  test('active claim with valid token and fresh timestamp returns true', () => {
    const meta = makeTaskMetadata({
      claim_token: 'some-token',
      claimed_at: new Date('2025-06-01T11:55:00Z').toISOString(),
    });
    expect(isClaimActive(meta, now)).toBe(true);
  });

  test('stale claim returns false', () => {
    const meta = makeTaskMetadata({
      claim_token: 'some-token',
      claimed_at: new Date('2025-06-01T11:40:00Z').toISOString(),
    });
    expect(isClaimActive(meta, now)).toBe(false);
  });

  test('no claim token returns false', () => {
    const meta = makeTaskMetadata({ claim_token: undefined, claimed_at: undefined });
    expect(isClaimActive(meta, now)).toBe(false);
  });

  test('claim token without claimed_at returns false', () => {
    const meta = makeTaskMetadata({ claim_token: 'some-token', claimed_at: undefined });
    expect(isClaimActive(meta, now)).toBe(false);
  });
});
