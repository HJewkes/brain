import { describe, it, expect } from 'vitest';
import { computeCrossSessionAnalytics } from '../../../src/modules/sessions/analytics/cross-session.js';
import type { SessionMetadata } from '../../../src/modules/sessions/types.js';

function makeSession(overrides: Partial<SessionMetadata> = {}): SessionMetadata {
  return {
    session_id: `sess-${Math.random().toString(36).slice(2, 8)}`,
    display_id: 'SNS-001',
    project_dir: '/tmp/project',
    status: 'completed',
    started_at: '2026-03-01T10:00:00Z',
    duration_minutes: 60,
    error_rate: 0.05,
    tool_calls: 100,
    ...overrides,
  };
}

describe('computeCrossSessionAnalytics', () => {
  describe('empty input', () => {
    it('returns empty results for no sessions', () => {
      const result = computeCrossSessionAnalytics([]);

      expect(result.byCategory).toEqual([]);
      expect(result.byBranch).toEqual([]);
      expect(result.trends.errorRateTrend).toBe('stable');
      expect(result.trends.durationTrend).toBe('stable');
      expect(result.trends.sessionsPerDay).toBe(0);
    });
  });

  describe('byCategory', () => {
    it('groups sessions by branch prefix', () => {
      const sessions = [
        makeSession({
          branch: 'feat/login',
          duration_minutes: 30,
          error_rate: 0.1,
          tool_calls: 50,
        }),
        makeSession({
          branch: 'feat/signup',
          duration_minutes: 60,
          error_rate: 0.2,
          tool_calls: 100,
        }),
        makeSession({
          branch: 'fix/bug-123',
          duration_minutes: 20,
          error_rate: 0.05,
          tool_calls: 30,
        }),
      ];

      const result = computeCrossSessionAnalytics(sessions);

      const featCategory = result.byCategory.find((c) => c.category === 'feat');
      const fixCategory = result.byCategory.find((c) => c.category === 'fix');

      expect(featCategory?.sessionCount).toBe(2);
      expect(featCategory?.avgDurationMinutes).toBe(45);
      expect(featCategory?.avgErrorRate).toBeCloseTo(0.15);
      expect(featCategory?.avgToolCalls).toBe(75);
      expect(fixCategory?.sessionCount).toBe(1);
    });

    it('categorizes main branch separately', () => {
      const sessions = [makeSession({ branch: 'main' }), makeSession({ branch: 'main' })];

      const result = computeCrossSessionAnalytics(sessions);

      expect(result.byCategory).toHaveLength(1);
      expect(result.byCategory[0].category).toBe('main');
      expect(result.byCategory[0].sessionCount).toBe(2);
    });

    it('categorizes unknown prefixes as other', () => {
      const sessions = [makeSession({ branch: 'some-random-branch' })];

      const result = computeCrossSessionAnalytics(sessions);

      expect(result.byCategory[0].category).toBe('other');
    });

    it('categorizes sessions with no branch as unknown', () => {
      const sessions = [makeSession({ branch: undefined })];

      const result = computeCrossSessionAnalytics(sessions);

      expect(result.byCategory[0].category).toBe('unknown');
    });
  });

  describe('byBranch', () => {
    it('aggregates by exact branch name', () => {
      const sessions = [
        makeSession({ branch: 'feat/login', duration_minutes: 30 }),
        makeSession({ branch: 'feat/login', duration_minutes: 45 }),
        makeSession({ branch: 'main', duration_minutes: 10 }),
      ];

      const result = computeCrossSessionAnalytics(sessions);

      const login = result.byBranch.find((b) => b.branch === 'feat/login');
      const main = result.byBranch.find((b) => b.branch === 'main');

      expect(login?.sessionCount).toBe(2);
      expect(login?.totalDurationMinutes).toBe(75);
      expect(main?.sessionCount).toBe(1);
      expect(main?.totalDurationMinutes).toBe(10);
    });

    it('sorts by total duration descending', () => {
      const sessions = [
        makeSession({ branch: 'short', duration_minutes: 10 }),
        makeSession({ branch: 'long', duration_minutes: 200 }),
      ];

      const result = computeCrossSessionAnalytics(sessions);

      expect(result.byBranch[0].branch).toBe('long');
      expect(result.byBranch[1].branch).toBe('short');
    });
  });

  describe('trends', () => {
    it('detects improving error rate when second half is lower', () => {
      const sessions = [
        makeSession({ started_at: '2026-03-01T10:00:00Z', error_rate: 0.2 }),
        makeSession({ started_at: '2026-03-02T10:00:00Z', error_rate: 0.2 }),
        makeSession({ started_at: '2026-03-03T10:00:00Z', error_rate: 0.05 }),
        makeSession({ started_at: '2026-03-04T10:00:00Z', error_rate: 0.05 }),
      ];

      const result = computeCrossSessionAnalytics(sessions);

      expect(result.trends.errorRateTrend).toBe('improving');
    });

    it('detects degrading error rate when second half is higher', () => {
      const sessions = [
        makeSession({ started_at: '2026-03-01T10:00:00Z', error_rate: 0.02 }),
        makeSession({ started_at: '2026-03-02T10:00:00Z', error_rate: 0.02 }),
        makeSession({ started_at: '2026-03-03T10:00:00Z', error_rate: 0.2 }),
        makeSession({ started_at: '2026-03-04T10:00:00Z', error_rate: 0.2 }),
      ];

      const result = computeCrossSessionAnalytics(sessions);

      expect(result.trends.errorRateTrend).toBe('degrading');
    });

    it('detects stable when halves are similar', () => {
      const sessions = [
        makeSession({ started_at: '2026-03-01T10:00:00Z', error_rate: 0.1 }),
        makeSession({ started_at: '2026-03-02T10:00:00Z', error_rate: 0.1 }),
        makeSession({ started_at: '2026-03-03T10:00:00Z', error_rate: 0.1 }),
        makeSession({ started_at: '2026-03-04T10:00:00Z', error_rate: 0.1 }),
      ];

      const result = computeCrossSessionAnalytics(sessions);

      expect(result.trends.errorRateTrend).toBe('stable');
    });

    it('detects improving duration when second half is shorter', () => {
      const sessions = [
        makeSession({ started_at: '2026-03-01T10:00:00Z', duration_minutes: 120 }),
        makeSession({ started_at: '2026-03-02T10:00:00Z', duration_minutes: 120 }),
        makeSession({ started_at: '2026-03-03T10:00:00Z', duration_minutes: 30 }),
        makeSession({ started_at: '2026-03-04T10:00:00Z', duration_minutes: 30 }),
      ];

      const result = computeCrossSessionAnalytics(sessions);

      expect(result.trends.durationTrend).toBe('improving');
    });

    it('computes sessionsPerDay correctly', () => {
      const sessions = [
        makeSession({ started_at: '2026-03-01T10:00:00Z' }),
        makeSession({ started_at: '2026-03-03T10:00:00Z' }),
        makeSession({ started_at: '2026-03-05T10:00:00Z' }),
        makeSession({ started_at: '2026-03-07T10:00:00Z' }),
        makeSession({ started_at: '2026-03-09T10:00:00Z' }),
        makeSession({ started_at: '2026-03-11T10:00:00Z' }),
      ];

      const result = computeCrossSessionAnalytics(sessions);

      // 6 sessions over 10 days = 0.6/day
      expect(result.trends.sessionsPerDay).toBeCloseTo(0.6);
    });

    it('handles single session with sessionsPerDay of 1', () => {
      const sessions = [makeSession()];

      const result = computeCrossSessionAnalytics(sessions);

      // 1 session / 1 day (min) = 1
      expect(result.trends.sessionsPerDay).toBe(1);
    });
  });
});
