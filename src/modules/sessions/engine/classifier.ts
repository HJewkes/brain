import type { SessionAnalytics } from '../types.js';

export interface SessionClassification {
  sessionType: 'implementation' | 'debugging' | 'review' | 'research' | 'planning' | 'mixed';
  outcome: 'success' | 'partial' | 'abandoned' | 'unknown';
  costUsd: number;
}

// Claude pricing per million tokens (USD)
const PRICING: Record<
  string,
  { input: number; output: number; cacheRead: number; cacheWrite: number }
> = {
  opus: { input: 15, output: 75, cacheRead: 1.5, cacheWrite: 18.75 },
  sonnet: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  haiku: { input: 0.8, output: 4, cacheRead: 0.08, cacheWrite: 1 },
};

const WRITE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit']);
const BASH_TEST_PATTERN = /\b(jest|vitest|pytest|npm test|go test|cargo test|rspec)\b/i;

export function classifySession(analytics: SessionAnalytics): SessionClassification {
  return {
    sessionType: classifyType(analytics),
    outcome: classifyOutcome(analytics),
    costUsd: computeCost(analytics),
  };
}

function classifyType(
  analytics: SessionAnalytics
): 'implementation' | 'debugging' | 'review' | 'research' | 'planning' | 'mixed' {
  const total = analytics.toolCalls.length;
  if (total === 0) return 'planning';

  const counts = analytics.toolCallsByName;
  const writeCount = [...WRITE_TOOLS].reduce((sum, t) => sum + (counts[t] ?? 0), 0);
  const writeFraction = writeCount / total;

  if (writeFraction > 0.3) return 'implementation';

  const hasWebTools = (counts['WebSearch'] ?? 0) + (counts['WebFetch'] ?? 0) > 0;
  const agentFraction = ((counts['Task'] ?? 0) + (counts['TaskCreate'] ?? 0)) / total;
  if (hasWebTools || agentFraction > 0.3) return 'research';

  const bashCalls = analytics.toolCalls.filter((tc) => tc.toolName === 'Bash');
  const hasTestBash = bashCalls.some((tc) =>
    BASH_TEST_PATTERN.test((tc.input.command as string) ?? '')
  );
  if (analytics.errorRate > 0.15 || hasTestBash) return 'debugging';

  const readTools = new Set(['Read', 'Grep', 'Glob', 'Search']);
  const readCount = [...readTools].reduce((sum, t) => sum + (counts[t] ?? 0), 0);
  const readFraction = readCount / total;
  if (readFraction > 0.5 && writeFraction < 0.1) return 'review';

  const thinkingRatio = analytics.thinkingBlockCount / (analytics.assistantTurns || 1);
  if (total < 10 && thinkingRatio > 0.3) return 'planning';

  return 'mixed';
}

function classifyOutcome(
  analytics: SessionAnalytics
): 'success' | 'partial' | 'abandoned' | 'unknown' {
  const total = analytics.toolCalls.length;

  if (total === 0 && analytics.userTurns < 2) return 'unknown';
  if (total < 5 || analytics.errorRate > 0.3) return 'abandoned';

  const tasksCompleted = analytics.taskRefs.length; // approximation; real completed count from links
  if (analytics.errorRate < 0.05 && tasksCompleted > 0) return 'success';
  if (total > 10) return 'partial';

  return 'unknown';
}

function computeCost(analytics: SessionAnalytics): number {
  const model = (analytics.model ?? '').toLowerCase();
  const tier = model.includes('haiku') ? 'haiku' : model.includes('sonnet') ? 'sonnet' : 'opus';
  const p = PRICING[tier];
  const { inputTokens, outputTokens, cacheCreationTokens, cacheReadTokens } = analytics.tokens;

  return (
    (inputTokens * p.input +
      outputTokens * p.output +
      cacheCreationTokens * p.cacheWrite +
      cacheReadTokens * p.cacheRead) /
    1_000_000
  );
}
