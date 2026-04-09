import { describe, it, expect } from 'vitest';
import {
  summarizeCosts,
  aggregateByPeriod,
  aggregateByWorkstream,
  checkBudgetAlerts,
  type AgentCostEntry,
  type BudgetThresholds,
} from '../../../src/modules/agents/cost-aggregation.js';

function entry(overrides: Partial<AgentCostEntry> = {}): AgentCostEntry {
  return {
    agentId: 'a1',
    name: 'worker-1',
    task: 'VNM-45.01',
    status: 'completed',
    costUsd: 0.5,
    durationMs: 60_000,
    tokensInput: 10_000,
    tokensOutput: 5_000,
    createdAt: '2026-04-09T10:00:00Z',
    completedAt: '2026-04-09T10:01:00Z',
    ...overrides,
  };
}

describe('summarizeCosts', () => {
  it('returns zeros for empty entries', () => {
    const result = summarizeCosts([]);
    expect(result.totalCostUsd).toBe(0);
    expect(result.agentCount).toBe(0);
  });

  it('aggregates costs across entries', () => {
    const entries = [
      entry({ costUsd: 1.5, tokensInput: 100, tokensOutput: 50 }),
      entry({ agentId: 'a2', costUsd: 2.0, tokensInput: 200, tokensOutput: 100 }),
    ];
    const result = summarizeCosts(entries);
    expect(result.totalCostUsd).toBe(3.5);
    expect(result.agentCount).toBe(2);
    expect(result.totalTokensInput).toBe(300);
    expect(result.totalTokensOutput).toBe(150);
  });
});

describe('aggregateByPeriod', () => {
  it('groups by day', () => {
    const entries = [
      entry({ createdAt: '2026-04-08T10:00:00Z', costUsd: 1.0 }),
      entry({ createdAt: '2026-04-08T14:00:00Z', costUsd: 0.5 }),
      entry({ createdAt: '2026-04-09T10:00:00Z', costUsd: 2.0 }),
    ];
    const result = aggregateByPeriod(entries, 'day');
    expect(result).toHaveLength(2);
    expect(result[0].period).toBe('2026-04-08');
    expect(result[0].costUsd).toBe(1.5);
    expect(result[0].agentCount).toBe(2);
    expect(result[1].period).toBe('2026-04-09');
    expect(result[1].costUsd).toBe(2.0);
  });

  it('groups by week', () => {
    const entries = [
      entry({ createdAt: '2026-03-30T10:00:00Z', costUsd: 1.0 }),
      entry({ createdAt: '2026-04-08T10:00:00Z', costUsd: 2.0 }),
    ];
    const result = aggregateByPeriod(entries, 'week');
    expect(result.length).toBeGreaterThanOrEqual(2);
    expect(result.every((r) => r.period.startsWith('W'))).toBe(true);
  });

  it('returns empty for no entries', () => {
    expect(aggregateByPeriod([], 'day')).toEqual([]);
  });
});

describe('aggregateByWorkstream', () => {
  it('extracts workstream from task ID', () => {
    const entries = [
      entry({ task: 'VNM-45.01', costUsd: 1.0 }),
      entry({ task: 'VNM-45.02', costUsd: 2.0 }),
      entry({ task: 'VNM-12.03', costUsd: 0.5 }),
    ];
    const result = aggregateByWorkstream(entries);
    expect(result).toHaveLength(2);

    const vnm45 = result.find((r) => r.workstream === 'VNM-45');
    expect(vnm45?.costUsd).toBe(3.0);
    expect(vnm45?.agentCount).toBe(2);

    const vnm12 = result.find((r) => r.workstream === 'VNM-12');
    expect(vnm12?.costUsd).toBe(0.5);
  });

  it('labels unassigned agents', () => {
    const entries = [entry({ task: null, costUsd: 1.0 })];
    const result = aggregateByWorkstream(entries);
    expect(result[0].workstream).toBe('(unassigned)');
  });
});

describe('checkBudgetAlerts', () => {
  const today = new Date();
  const todayIso = today.toISOString();

  it('returns empty when no thresholds configured', () => {
    const entries = [entry({ createdAt: todayIso, costUsd: 100 })];
    expect(checkBudgetAlerts(entries, {})).toEqual([]);
  });

  it('returns warning when daily spend exceeds warn threshold', () => {
    const entries = [entry({ createdAt: todayIso, costUsd: 5.0 })];
    const thresholds: BudgetThresholds = { dailyWarnUsd: 3.0 };
    const alerts = checkBudgetAlerts(entries, thresholds);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].level).toBe('warning');
    expect(alerts[0].period).toBe('daily');
  });

  it('returns critical when daily spend exceeds critical threshold', () => {
    const entries = [entry({ createdAt: todayIso, costUsd: 10.0 })];
    const thresholds: BudgetThresholds = {
      dailyWarnUsd: 3.0,
      dailyCriticalUsd: 8.0,
    };
    const alerts = checkBudgetAlerts(entries, thresholds);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].level).toBe('critical');
  });

  it('returns weekly warning', () => {
    const entries = [entry({ createdAt: todayIso, costUsd: 20.0 })];
    const thresholds: BudgetThresholds = { weeklyWarnUsd: 15.0 };
    const alerts = checkBudgetAlerts(entries, thresholds);
    expect(alerts.some((a) => a.period === 'weekly' && a.level === 'warning')).toBe(true);
  });

  it('ignores old entries for daily threshold', () => {
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const entries = [entry({ createdAt: yesterday.toISOString(), costUsd: 100 })];
    const thresholds: BudgetThresholds = { dailyWarnUsd: 1.0 };
    const alerts = checkBudgetAlerts(entries, thresholds);
    const dailyAlerts = alerts.filter((a) => a.period === 'daily');
    expect(dailyAlerts).toHaveLength(0);
  });

  it('includes current-week entries on Sunday', () => {
    // Find next Sunday from today
    const sunday = new Date(today);
    sunday.setDate(sunday.getDate() + ((7 - sunday.getDay()) % 7) || 7);
    sunday.setHours(12, 0, 0, 0);
    // Monday of that week
    const monday = new Date(sunday);
    monday.setDate(monday.getDate() - 6);
    monday.setHours(10, 0, 0, 0);

    const entries = [entry({ createdAt: monday.toISOString(), costUsd: 20.0 })];
    const thresholds: BudgetThresholds = { weeklyWarnUsd: 15.0 };
    // Mock Date.now to return Sunday
    const origNow = Date.now;
    Date.now = () => sunday.getTime();
    const OrigDate = globalThis.Date;
    const MockDate = class extends OrigDate {
      constructor(...args: unknown[]) {
        if (args.length === 0) super(sunday.getTime());
        else super(...(args as [number]));
      }
    } as DateConstructor;
    globalThis.Date = MockDate;

    try {
      const alerts = checkBudgetAlerts(entries, thresholds);
      expect(alerts.some((a) => a.period === 'weekly')).toBe(true);
    } finally {
      globalThis.Date = OrigDate;
      Date.now = origNow;
    }
  });
});
