export type ThrottleTier = 'full' | 'reduced' | 'blocked';

export interface ThrottleResult {
  allowed: boolean;
  tier: ThrottleTier;
  message?: string;
  maxResults?: number;
}

const FULL_TIER_MAX = 3;
const REDUCED_TIER_MAX = 8;
const REDUCED_MAX_RESULTS = 3;

export class SearchThrottle {
  private callCount = 0;

  constructor(private sessionId?: string) {}

  check(): ThrottleResult {
    if (this.callCount < FULL_TIER_MAX) {
      return { allowed: true, tier: 'full' };
    }
    if (this.callCount < REDUCED_TIER_MAX) {
      return {
        allowed: true,
        tier: 'reduced',
        maxResults: REDUCED_MAX_RESULTS,
        message: `Search throttled: returning max ${REDUCED_MAX_RESULTS} results (call ${this.callCount + 1}). Consider refining your query.`,
      };
    }
    return {
      allowed: false,
      tier: 'blocked',
      message: 'Search blocked. Use batch mode.',
    };
  }

  record(): void {
    this.callCount++;
  }

  reset(): void {
    this.callCount = 0;
  }

  getCallCount(): number {
    return this.callCount;
  }

  getSessionId(): string | undefined {
    return this.sessionId;
  }
}
