import type { SessionAnalytics, SessionAnalyticsExt } from '../types.js';

export function computeSessionAnalyticsExt(analytics: SessionAnalytics): SessionAnalyticsExt {
  const toolErrors = new Map<string, number>();
  const toolCounts = new Map<string, number>();
  for (const tc of analytics.toolCalls) {
    toolCounts.set(tc.toolName, (toolCounts.get(tc.toolName) ?? 0) + 1);
    if (tc.outcome === 'error') {
      toolErrors.set(tc.toolName, (toolErrors.get(tc.toolName) ?? 0) + 1);
    }
  }

  const top_tools = [...toolCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([name, count]) => ({
      name,
      count,
      error_rate: (toolErrors.get(name) ?? 0) / count,
    }));

  const frictionByKind = new Map<string, number>();
  for (const s of analytics.frictionSignals) {
    frictionByKind.set(s.kind, (frictionByKind.get(s.kind) ?? 0) + 1);
  }
  const friction_categories = [...frictionByKind.entries()].map(([category, count]) => ({
    category,
    count,
  }));

  const mainChainCalls = analytics.toolCalls.filter((tc) => !tc.isSidechain).length;
  const totalCalls = analytics.toolCalls.length;
  const delegation_ratio = totalCalls > 0 ? (totalCalls - mainChainCalls) / totalCalls : 0;

  const context_pressure =
    analytics.compactionCount > 0
      ? analytics.compactionCount / Math.max(analytics.assistantTurns, 1)
      : 0;

  return {
    top_tools,
    friction_categories,
    delegation_ratio,
    context_pressure,
  };
}
