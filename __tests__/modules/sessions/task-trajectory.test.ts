import { describe, it, expect } from 'vitest';
import { computeTaskTypeTrajectory } from '../../../src/modules/sessions/analytics/task-trajectory.js';
import type { SessionMetadata } from '../../../src/modules/sessions/types.js';

function makeSession(overrides: Partial<SessionMetadata> = {}): SessionMetadata {
  return {
    session_id: 'sess-1',
    display_id: 'SNS-001',
    project_dir: '/test',
    status: 'completed',
    started_at: '2026-01-01T00:00:00Z',
    tool_calls: 20,
    error_rate: 0.05,
    commits: ['abc123'],
    duration_minutes: 60,
    ...overrides,
  };
}

const noCategory = (): null => null;

describe('computeTaskTypeTrajectory', () => {
  describe('empty input', () => {
    it('returns empty report for zero sessions', () => {
      const report = computeTaskTypeTrajectory([], noCategory);
      expect(report.trajectories).toHaveLength(0);
      expect(report.degradedTypes).toHaveLength(0);
    });
  });

  describe('task type grouping', () => {
    it('groups sessions by task category', () => {
      const categoryMap = new Map([
        ['VNM-01.01', 'implementation'],
        ['VNM-02.01', 'research'],
      ]);
      const sessions = [
        makeSession({ session_id: 's1', tasks_worked: ['VNM-01.01'] }),
        makeSession({ session_id: 's2', tasks_worked: ['VNM-02.01'] }),
        makeSession({ session_id: 's3', tasks_worked: ['VNM-01.01'] }),
      ];

      const report = computeTaskTypeTrajectory(sessions, (id) => categoryMap.get(id) ?? null);
      const types = report.trajectories.map((t) => t.taskType);
      expect(types).toContain('implementation');
      expect(types).toContain('research');
    });

    it('uses dominant category when session spans multiple task types', () => {
      const categoryMap = new Map([
        ['VNM-01.01', 'implementation'],
        ['VNM-01.02', 'implementation'],
        ['VNM-02.01', 'research'],
      ]);
      const session = makeSession({
        tasks_worked: ['VNM-01.01', 'VNM-01.02', 'VNM-02.01'],
      });

      const report = computeTaskTypeTrajectory([session], (id) => categoryMap.get(id) ?? null);
      expect(report.trajectories[0].taskType).toBe('implementation');
    });

    it('assigns unknown when no task refs present', () => {
      const session = makeSession({ tasks_worked: [] });
      const report = computeTaskTypeTrajectory([session], noCategory);
      expect(report.trajectories[0].taskType).toBe('unknown');
    });

    it('assigns unknown when category lookup returns null', () => {
      const session = makeSession({ tasks_worked: ['VNM-99.01'] });
      const report = computeTaskTypeTrajectory([session], () => null);
      expect(report.trajectories[0].taskType).toBe('unknown');
    });

    it('considers both tasks_worked and tasks_completed for category', () => {
      const categoryMap = new Map([['VNM-01.01', 'testing']]);
      const session = makeSession({
        tasks_worked: [],
        tasks_completed: ['VNM-01.01'],
      });
      const report = computeTaskTypeTrajectory([session], (id) => categoryMap.get(id) ?? null);
      expect(report.trajectories[0].taskType).toBe('testing');
    });
  });

  describe('norm computation', () => {
    it('computes correct averages', () => {
      const categoryMap = new Map([['VNM-01.01', 'implementation']]);
      const sessions = [
        makeSession({
          session_id: 's1',
          tasks_worked: ['VNM-01.01'],
          tool_calls: 10,
          error_rate: 0.1,
          duration_minutes: 30,
          commits: ['a'],
        }),
        makeSession({
          session_id: 's2',
          tasks_worked: ['VNM-01.01'],
          tool_calls: 30,
          error_rate: 0.3,
          duration_minutes: 90,
          commits: ['b', 'c'],
        }),
      ];

      const report = computeTaskTypeTrajectory(sessions, (id) => categoryMap.get(id) ?? null);
      const impl = report.trajectories.find((t) => t.taskType === 'implementation')!;
      expect(impl.norm.sampleSize).toBe(2);
      expect(impl.norm.avgToolCalls).toBe(20);
      expect(impl.norm.avgErrorRate).toBeCloseTo(0.2);
      expect(impl.norm.avgDurationMinutes).toBe(60);
    });

    it('computes efficiency as 0 when no commits', () => {
      const categoryMap = new Map([['VNM-01.01', 'implementation']]);
      const session = makeSession({
        tasks_worked: ['VNM-01.01'],
        tool_calls: 50,
        commits: [],
      });

      const report = computeTaskTypeTrajectory([session], (id) => categoryMap.get(id) ?? null);
      const norm = report.trajectories[0].norm;
      expect(norm.avgEfficiency).toBe(0);
    });

    it('caps efficiency at 1.0 for very few tool calls', () => {
      const categoryMap = new Map([['VNM-01.01', 'implementation']]);
      const session = makeSession({
        tasks_worked: ['VNM-01.01'],
        tool_calls: 5,
        commits: ['a'],
      });

      const report = computeTaskTypeTrajectory([session], (id) => categoryMap.get(id) ?? null);
      expect(report.trajectories[0].norm.avgEfficiency).toBe(1);
    });
  });

  describe('trend detection', () => {
    it('detects degrading error rate', () => {
      const categoryMap = new Map([['VNM-01.01', 'implementation']]);
      const sessions = [
        makeSession({
          session_id: 's1',
          started_at: '2026-01-01T00:00:00Z',
          tasks_worked: ['VNM-01.01'],
          error_rate: 0.05,
        }),
        makeSession({
          session_id: 's2',
          started_at: '2026-01-02T00:00:00Z',
          tasks_worked: ['VNM-01.01'],
          error_rate: 0.05,
        }),
        makeSession({
          session_id: 's3',
          started_at: '2026-01-03T00:00:00Z',
          tasks_worked: ['VNM-01.01'],
          error_rate: 0.5,
        }),
        makeSession({
          session_id: 's4',
          started_at: '2026-01-04T00:00:00Z',
          tasks_worked: ['VNM-01.01'],
          error_rate: 0.5,
        }),
      ];

      const report = computeTaskTypeTrajectory(sessions, (id) => categoryMap.get(id) ?? null);
      const impl = report.trajectories[0];
      expect(impl.errorRateTrend).toBe('degrading');
    });

    it('detects improving error rate', () => {
      const categoryMap = new Map([['VNM-01.01', 'implementation']]);
      const sessions = [
        makeSession({
          session_id: 's1',
          started_at: '2026-01-01T00:00:00Z',
          tasks_worked: ['VNM-01.01'],
          error_rate: 0.5,
        }),
        makeSession({
          session_id: 's2',
          started_at: '2026-01-02T00:00:00Z',
          tasks_worked: ['VNM-01.01'],
          error_rate: 0.5,
        }),
        makeSession({
          session_id: 's3',
          started_at: '2026-01-03T00:00:00Z',
          tasks_worked: ['VNM-01.01'],
          error_rate: 0.05,
        }),
        makeSession({
          session_id: 's4',
          started_at: '2026-01-04T00:00:00Z',
          tasks_worked: ['VNM-01.01'],
          error_rate: 0.05,
        }),
      ];

      const report = computeTaskTypeTrajectory(sessions, (id) => categoryMap.get(id) ?? null);
      const impl = report.trajectories[0];
      expect(impl.errorRateTrend).toBe('improving');
    });

    it('returns stable when error rate unchanged', () => {
      const categoryMap = new Map([['VNM-01.01', 'implementation']]);
      const sessions = [
        makeSession({
          session_id: 's1',
          started_at: '2026-01-01T00:00:00Z',
          tasks_worked: ['VNM-01.01'],
          error_rate: 0.1,
        }),
        makeSession({
          session_id: 's2',
          started_at: '2026-01-02T00:00:00Z',
          tasks_worked: ['VNM-01.01'],
          error_rate: 0.1,
        }),
      ];

      const report = computeTaskTypeTrajectory(sessions, (id) => categoryMap.get(id) ?? null);
      expect(report.trajectories[0].errorRateTrend).toBe('stable');
    });
  });

  describe('degradation detection', () => {
    it('includes types with degrading error rate in degradedTypes', () => {
      const categoryMap = new Map([
        ['VNM-01.01', 'implementation'],
        ['VNM-02.01', 'research'],
      ]);
      // implementation: error rate rises (old: 0.05, new: 0.6)
      // research: stable
      const sessions = [
        makeSession({
          session_id: 's1',
          started_at: '2026-01-01T00:00:00Z',
          tasks_worked: ['VNM-01.01'],
          error_rate: 0.05,
        }),
        makeSession({
          session_id: 's2',
          started_at: '2026-01-02T00:00:00Z',
          tasks_worked: ['VNM-01.01'],
          error_rate: 0.6,
        }),
        makeSession({
          session_id: 's3',
          started_at: '2026-01-01T00:00:00Z',
          tasks_worked: ['VNM-02.01'],
          error_rate: 0.1,
        }),
        makeSession({
          session_id: 's4',
          started_at: '2026-01-02T00:00:00Z',
          tasks_worked: ['VNM-02.01'],
          error_rate: 0.1,
        }),
      ];

      const report = computeTaskTypeTrajectory(sessions, (id) => categoryMap.get(id) ?? null);
      expect(report.degradedTypes).toContain('implementation');
      expect(report.degradedTypes).not.toContain('research');
    });

    it('returns no degradedTypes when all trends are stable or improving', () => {
      const categoryMap = new Map([['VNM-01.01', 'implementation']]);
      const sessions = [
        makeSession({
          session_id: 's1',
          tasks_worked: ['VNM-01.01'],
          error_rate: 0.1,
        }),
        makeSession({
          session_id: 's2',
          tasks_worked: ['VNM-01.01'],
          error_rate: 0.1,
        }),
      ];

      const report = computeTaskTypeTrajectory(sessions, (id) => categoryMap.get(id) ?? null);
      expect(report.degradedTypes).toHaveLength(0);
    });
  });

  describe('ordering', () => {
    it('sorts trajectories by sample size descending', () => {
      const categoryMap = new Map([
        ['VNM-01.01', 'implementation'],
        ['VNM-02.01', 'research'],
      ]);
      const sessions = [
        makeSession({ session_id: 's1', tasks_worked: ['VNM-01.01'] }),
        makeSession({ session_id: 's2', tasks_worked: ['VNM-01.01'] }),
        makeSession({ session_id: 's3', tasks_worked: ['VNM-01.01'] }),
        makeSession({ session_id: 's4', tasks_worked: ['VNM-02.01'] }),
      ];

      const report = computeTaskTypeTrajectory(sessions, (id) => categoryMap.get(id) ?? null);
      expect(report.trajectories[0].taskType).toBe('implementation');
      expect(report.trajectories[0].norm.sampleSize).toBe(3);
    });
  });
});
