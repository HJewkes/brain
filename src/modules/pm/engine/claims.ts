import { randomUUID } from 'node:crypto';
import type { TaskMetadata } from '../types.js';
import type { Result } from '../errors.js';
import { ok, fail } from '../errors.js';

const DEFAULT_CLAIM_TIMEOUT_MS = 10 * 60 * 1000;

export interface ClaimResult {
  token: string;
  claimedAt: string;
}

export function generateClaim(): ClaimResult {
  return {
    token: randomUUID(),
    claimedAt: new Date().toISOString(),
  };
}

export function validateClaimToken(expected: string, provided: string): Result<void> {
  if (expected === provided) {
    return ok(undefined);
  }
  return fail('INVALID_CLAIM_TOKEN', 'Claim token does not match', {
    expected,
    provided,
  });
}

export function isClaimStale(
  claimedAt: string,
  timeoutMs: number = DEFAULT_CLAIM_TIMEOUT_MS,
  now: Date = new Date()
): boolean {
  const claimedTime = new Date(claimedAt).getTime();
  return now.getTime() - claimedTime > timeoutMs;
}

export function isClaimActive(metadata: TaskMetadata, now: Date = new Date()): boolean {
  if (!metadata.claim_token || !metadata.claimed_at) {
    return false;
  }
  return !isClaimStale(metadata.claimed_at, DEFAULT_CLAIM_TIMEOUT_MS, now);
}
