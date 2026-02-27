import type { ActivityRecord } from '../../../types.js';

export interface CostSummary {
  totalTokens: number;
  estimatedCost: number;
  byModel: Record<string, { tokens: number; cost: number }>;
  byCategory: Record<string, { tokens: number; cost: number }>;
}

const MODEL_PRICING: Record<string, number> = {
  opus: 15.0,
  'claude-opus': 15.0,
  'claude-opus-4': 15.0,
  sonnet: 3.0,
  'claude-sonnet': 3.0,
  'claude-sonnet-4': 3.0,
  haiku: 0.25,
  'claude-haiku': 0.25,
  'claude-haiku-3.5': 0.25,
};

const DEFAULT_COST_PER_MILLION = 3.0;

function costPerMillion(model: string): number {
  const lower = model.toLowerCase();
  if (MODEL_PRICING[lower] !== undefined) {
    return MODEL_PRICING[lower];
  }
  for (const [key, price] of Object.entries(MODEL_PRICING)) {
    if (lower.includes(key)) {
      return price;
    }
  }
  return DEFAULT_COST_PER_MILLION;
}

interface ActivityMeta {
  tokens?: number;
  model?: string;
  category?: string;
}

function parseActivityMeta(activity: ActivityRecord): ActivityMeta {
  if (!activity.metadata) return {};
  try {
    return JSON.parse(activity.metadata) as ActivityMeta;
  } catch {
    return {};
  }
}

export function estimateCost(activities: ActivityRecord[]): CostSummary {
  const summary: CostSummary = {
    totalTokens: 0,
    estimatedCost: 0,
    byModel: {},
    byCategory: {},
  };

  for (const activity of activities) {
    const meta = parseActivityMeta(activity);
    const tokens = meta.tokens ?? 0;
    if (tokens === 0) continue;

    const model = meta.model ?? 'unknown';
    const category = meta.category ?? activity.activityType ?? 'other';
    const pricePerMillion = costPerMillion(model);
    const cost = (tokens / 1_000_000) * pricePerMillion;

    summary.totalTokens += tokens;
    summary.estimatedCost += cost;

    if (!summary.byModel[model]) {
      summary.byModel[model] = { tokens: 0, cost: 0 };
    }
    summary.byModel[model].tokens += tokens;
    summary.byModel[model].cost += cost;

    if (!summary.byCategory[category]) {
      summary.byCategory[category] = { tokens: 0, cost: 0 };
    }
    summary.byCategory[category].tokens += tokens;
    summary.byCategory[category].cost += cost;
  }

  summary.estimatedCost = Math.round(summary.estimatedCost * 1_000_000) / 1_000_000;
  for (const entry of Object.values(summary.byModel)) {
    entry.cost = Math.round(entry.cost * 1_000_000) / 1_000_000;
  }
  for (const entry of Object.values(summary.byCategory)) {
    entry.cost = Math.round(entry.cost * 1_000_000) / 1_000_000;
  }

  return summary;
}
