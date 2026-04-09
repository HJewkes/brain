import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AgentRecord } from './types.js';
import { listAgents, getAgentContext } from './data.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AgentCostEntry {
  agentId: string;
  name: string;
  task: string | null;
  status: string;
  costUsd: number;
  durationMs: number;
  tokensInput: number;
  tokensOutput: number;
  createdAt: string;
  completedAt: string | null;
}

export interface CostSummary {
  totalCostUsd: number;
  totalDurationMs: number;
  totalTokensInput: number;
  totalTokensOutput: number;
  agentCount: number;
  entries: AgentCostEntry[];
}

export interface CostByPeriod {
  period: string;
  costUsd: number;
  agentCount: number;
}

export interface CostByWorkstream {
  workstream: string;
  costUsd: number;
  agentCount: number;
}

export interface BudgetAlert {
  level: 'info' | 'warning' | 'critical';
  message: string;
  currentSpend: number;
  threshold: number;
  period: string;
}

export interface BudgetThresholds {
  dailyWarnUsd?: number;
  dailyCriticalUsd?: number;
  weeklyWarnUsd?: number;
  weeklyCriticalUsd?: number;
}

// ---------------------------------------------------------------------------
// Data extraction
// ---------------------------------------------------------------------------

function extractCostEntry(db: unknown, agent: AgentRecord): AgentCostEntry {
  const claudeResult = getAgentContext(db, agent.id, 'claude_result') as
    | { total_cost_usd?: number; duration_ms?: number }
    | undefined;
  const tokensIn = (getAgentContext(db, agent.id, 'tokens_input') as number) ?? 0;
  const tokensOut = (getAgentContext(db, agent.id, 'tokens_output') as number) ?? 0;

  return {
    agentId: agent.id,
    name: agent.name,
    task: agent.brain_task,
    status: agent.status,
    costUsd: claudeResult?.total_cost_usd ?? 0,
    durationMs: claudeResult?.duration_ms ?? 0,
    tokensInput: tokensIn,
    tokensOutput: tokensOut,
    createdAt: agent.created_at,
    completedAt: agent.completed_at ?? null,
  };
}

/** Load cost entries for all agents, optionally filtered by date range. */
export function getAgentCostEntries(
  db: unknown,
  opts?: { since?: string; until?: string }
): AgentCostEntry[] {
  const agents = listAgents(db);
  const entries = agents.map((a) => extractCostEntry(db, a));

  return entries.filter((e) => {
    if (opts?.since && e.createdAt < opts.since) return false;
    if (opts?.until) {
      // If until is date-only (YYYY-MM-DD), include the entire day
      const bound = opts.until.length === 10 ? opts.until + 'T23:59:59.999Z' : opts.until;
      if (e.createdAt > bound) return false;
    }
    return true;
  });
}

// ---------------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------------

export function summarizeCosts(entries: AgentCostEntry[]): CostSummary {
  return {
    totalCostUsd: entries.reduce((s, e) => s + e.costUsd, 0),
    totalDurationMs: entries.reduce((s, e) => s + e.durationMs, 0),
    totalTokensInput: entries.reduce((s, e) => s + e.tokensInput, 0),
    totalTokensOutput: entries.reduce((s, e) => s + e.tokensOutput, 0),
    agentCount: entries.length,
    entries,
  };
}

function dateKey(iso: string, granularity: 'day' | 'week'): string {
  const d = new Date(iso);
  if (granularity === 'day') {
    return d.toISOString().slice(0, 10);
  }
  // ISO week: Monday-based
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(d);
  monday.setDate(diff);
  return `W${monday.toISOString().slice(0, 10)}`;
}

export function aggregateByPeriod(
  entries: AgentCostEntry[],
  granularity: 'day' | 'week' = 'day'
): CostByPeriod[] {
  const map = new Map<string, { costUsd: number; agentCount: number }>();

  for (const e of entries) {
    const key = dateKey(e.createdAt, granularity);
    const existing = map.get(key) ?? { costUsd: 0, agentCount: 0 };
    existing.costUsd += e.costUsd;
    existing.agentCount += 1;
    map.set(key, existing);
  }

  return [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([period, data]) => ({ period, ...data }));
}

export function aggregateByWorkstream(entries: AgentCostEntry[]): CostByWorkstream[] {
  const map = new Map<string, { costUsd: number; agentCount: number }>();

  for (const e of entries) {
    const ws = extractWorkstream(e.task);
    const existing = map.get(ws) ?? { costUsd: 0, agentCount: 0 };
    existing.costUsd += e.costUsd;
    existing.agentCount += 1;
    map.set(ws, existing);
  }

  return [...map.entries()]
    .sort(([, a], [, b]) => b.costUsd - a.costUsd)
    .map(([workstream, data]) => ({ workstream, ...data }));
}

function extractWorkstream(task: string | null): string {
  if (!task) return '(unassigned)';
  // Task IDs like "VNM-45.28" -> workstream "VNM-45"
  const match = task.match(/^([A-Z]+-\d+)\./);
  return match ? match[1] : task;
}

// ---------------------------------------------------------------------------
// Budget alerts
// ---------------------------------------------------------------------------

export function checkBudgetAlerts(
  entries: AgentCostEntry[],
  thresholds: BudgetThresholds
): BudgetAlert[] {
  const alerts: BudgetAlert[] = [];
  const now = new Date();

  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  const todayEntries = entries.filter((e) => new Date(e.createdAt) >= todayStart);
  const dailySpend = todayEntries.reduce((s, e) => s + e.costUsd, 0);

  const weekStart = new Date(now);
  const dow = weekStart.getDay();
  weekStart.setDate(weekStart.getDate() - dow + (dow === 0 ? -6 : 1));
  weekStart.setHours(0, 0, 0, 0);
  const weekEntries = entries.filter((e) => new Date(e.createdAt) >= weekStart);
  const weeklySpend = weekEntries.reduce((s, e) => s + e.costUsd, 0);

  if (thresholds.dailyCriticalUsd && dailySpend >= thresholds.dailyCriticalUsd) {
    alerts.push({
      level: 'critical',
      message: `Daily spend $${dailySpend.toFixed(2)} exceeds critical threshold $${thresholds.dailyCriticalUsd.toFixed(2)}`,
      currentSpend: dailySpend,
      threshold: thresholds.dailyCriticalUsd,
      period: 'daily',
    });
  } else if (thresholds.dailyWarnUsd && dailySpend >= thresholds.dailyWarnUsd) {
    alerts.push({
      level: 'warning',
      message: `Daily spend $${dailySpend.toFixed(2)} exceeds warning threshold $${thresholds.dailyWarnUsd.toFixed(2)}`,
      currentSpend: dailySpend,
      threshold: thresholds.dailyWarnUsd,
      period: 'daily',
    });
  }

  if (thresholds.weeklyCriticalUsd && weeklySpend >= thresholds.weeklyCriticalUsd) {
    alerts.push({
      level: 'critical',
      message: `Weekly spend $${weeklySpend.toFixed(2)} exceeds critical threshold $${thresholds.weeklyCriticalUsd.toFixed(2)}`,
      currentSpend: weeklySpend,
      threshold: thresholds.weeklyCriticalUsd,
      period: 'weekly',
    });
  } else if (thresholds.weeklyWarnUsd && weeklySpend >= thresholds.weeklyWarnUsd) {
    alerts.push({
      level: 'warning',
      message: `Weekly spend $${weeklySpend.toFixed(2)} exceeds warning threshold $${thresholds.weeklyWarnUsd.toFixed(2)}`,
      currentSpend: weeklySpend,
      threshold: thresholds.weeklyWarnUsd,
      period: 'weekly',
    });
  }

  return alerts;
}

/** Load budget thresholds from ao.config.json. */
export function loadBudgetThresholds(cwd?: string): BudgetThresholds {
  const configPath = join(cwd ?? process.cwd(), 'ao.config.json');

  try {
    const raw = JSON.parse(readFileSync(configPath, 'utf-8')) as Record<string, unknown>;
    const budget = raw.budgetAlerts as BudgetThresholds | undefined;
    return budget ?? {};
  } catch {
    return {};
  }
}
