/**
 * Session parser: cost computation, session/outcome classification, and derived signals.
 *
 * This module is pure and has no I/O — it operates on SessionAnalytics produced by
 * the AnalyticsAccumulator. Intended to be standalone and testable.
 */

import type { SessionAnalytics } from '../modules/sessions/types.js';

// ---------------------------------------------------------------------------
// Pricing table (USD per million tokens)
// ---------------------------------------------------------------------------

interface ModelPricing {
  input: number;
  output: number;
  cacheRead: number;
  cacheCreation: number;
}

const PRICING: Record<string, ModelPricing> = {
  'claude-opus-4-6': { input: 15, output: 75, cacheRead: 1.5, cacheCreation: 18.75 },
  'claude-opus-4-20250514': { input: 15, output: 75, cacheRead: 1.5, cacheCreation: 18.75 },
  'claude-sonnet-4-6': { input: 3, output: 15, cacheRead: 0.3, cacheCreation: 3.75 },
  'claude-sonnet-4-20250514': { input: 3, output: 15, cacheRead: 0.3, cacheCreation: 3.75 },
  'claude-haiku-4-5': { input: 0.8, output: 4, cacheRead: 0.08, cacheCreation: 1.0 },
  'claude-haiku-3-5-20241022': { input: 0.8, output: 4, cacheRead: 0.08, cacheCreation: 1.0 },
};

// Fallback for unknown models
const DEFAULT_PRICING = PRICING['claude-sonnet-4-20250514'];

function getPricing(model: string): ModelPricing {
  if (PRICING[model]) return PRICING[model];
  // Strip date suffixes for matching: claude-opus-4-20251020 -> claude-opus-4
  const base = model.replace(/-\d{8}$/, '');
  for (const [key, pricing] of Object.entries(PRICING)) {
    if (key.startsWith(base)) return pricing;
  }
  return DEFAULT_PRICING;
}

// ---------------------------------------------------------------------------
// Cost computation (F11)
// ---------------------------------------------------------------------------

export interface TurnTokens {
  model: string;
  input: number;
  output: number;
  cacheRead: number;
  cacheCreation: number;
}

/**
 * Computes estimated cost in USD from per-turn token breakdown.
 * Falls back to aggregate totals if no per-turn data.
 */
export function computeCostUsd(analytics: Pick<SessionAnalytics, 'tokens' | 'model'>): number {
  const { tokens, model } = analytics;
  const pricing = getPricing(model ?? '');

  const cost =
    (tokens.inputTokens / 1_000_000) * pricing.input +
    (tokens.outputTokens / 1_000_000) * pricing.output +
    (tokens.cacheReadTokens / 1_000_000) * pricing.cacheRead +
    (tokens.cacheCreationTokens / 1_000_000) * pricing.cacheCreation;

  return Math.round(cost * 10000) / 10000; // Round to 4 decimal places
}

/**
 * Computes per-model cost breakdown using modelCounts for allocation.
 */
export function computeCostByModel(analytics: SessionAnalytics): Record<string, number> {
  if (analytics.modelCounts.size === 0) {
    return { [analytics.model ?? 'unknown']: computeCostUsd(analytics) };
  }

  const total = computeCostUsd(analytics);
  const totalModelCalls = [...analytics.modelCounts.values()].reduce((a, b) => a + b, 0);
  const result: Record<string, number> = {};

  for (const [model, count] of analytics.modelCounts) {
    const fraction = totalModelCalls > 0 ? count / totalModelCalls : 0;
    result[model] = Math.round(total * fraction * 10000) / 10000;
  }

  return result;
}

// ---------------------------------------------------------------------------
// Cache hit rate (F01)
// ---------------------------------------------------------------------------

export function computeCacheHitRate(analytics: Pick<SessionAnalytics, 'tokens'>): number {
  const { inputTokens, cacheReadTokens, cacheCreationTokens } = analytics.tokens;
  const denominator = inputTokens + cacheReadTokens + cacheCreationTokens;
  if (denominator === 0) return 0;
  return Math.round((cacheReadTokens / denominator) * 10000) / 10000;
}

// ---------------------------------------------------------------------------
// Session type classification (spec section 2)
// ---------------------------------------------------------------------------

export type SessionType = 'implementation' | 'debugging' | 'exploration' | 'research' | 'review';

export function classifySessionType(analytics: SessionAnalytics): SessionType {
  const total = analytics.toolCalls.length;
  if (total === 0) return 'exploration';

  const counts = analytics.toolCallsByName;
  const get = (name: string) => counts[name] ?? 0;

  const writeEdit = get('Write') + get('Edit') + get('NotebookEdit');
  const readGrepGlob = get('Read') + get('Grep') + get('Glob');
  const bash = get('Bash');
  const webSearch = get('WebSearch') + get('WebFetch');

  const writeEditRatio = writeEdit / total;
  const readRatio = readGrepGlob / total;
  const bashRatio = bash / total;

  if ((webSearch > 0 || analytics.subagentCount > 2) && writeEditRatio < 0.15) {
    return 'research';
  }

  if (writeEditRatio > 0.3) {
    return 'implementation';
  }

  if (bashRatio > 0.4 && analytics.errorCount > 0) {
    return 'debugging';
  }

  if (analytics.errorRate > 0.15) {
    return 'debugging';
  }

  if (readRatio > 0.6 && writeEdit < 5) {
    return 'exploration';
  }

  if (readRatio > 0.5 && analytics.commitCount === 0) {
    return 'review';
  }

  return 'exploration';
}

// ---------------------------------------------------------------------------
// Outcome classification (spec section 2)
// ---------------------------------------------------------------------------

export type SessionOutcome = 'success' | 'partial' | 'abandoned' | 'error';

export function classifySessionOutcome(analytics: SessionAnalytics): SessionOutcome {
  const { durationMs, toolCalls, errors, prLinks, commitCount, filesWritten } = analytics;

  if (durationMs < 60_000 && toolCalls.length < 3) {
    return 'abandoned';
  }

  if (errors.length > 0 && errors.length / Math.max(toolCalls.length, 1) > 0.5) {
    return 'error';
  }

  if (commitCount > 0 || prLinks.length > 0) {
    return 'success';
  }

  if (toolCalls.length > 10 && filesWritten.length > 0) {
    return 'partial';
  }

  return 'abandoned';
}

// ---------------------------------------------------------------------------
// Error categorization (F07)
// ---------------------------------------------------------------------------

export type ErrorCategory =
  | 'permission_denied'
  | 'timeout'
  | 'file_not_found'
  | 'syntax_error'
  | 'test_failure'
  | 'git_conflict'
  | 'other';

const ERROR_CATEGORIES: Array<[ErrorCategory, RegExp]> = [
  ['git_conflict', /merge conflict|CONFLICT/i],
  ['permission_denied', /permission|denied|not allowed/i],
  ['timeout', /timeout|timed out|ETIMEDOUT/i],
  ['file_not_found', /ENOENT|no such file|not found/i],
  ['syntax_error', /SyntaxError|TypeError|cannot find module/i],
  ['test_failure', /FAIL\b|test.*failed|assertion/i],
];

export function categorizeError(message: string): ErrorCategory {
  for (const [category, pattern] of ERROR_CATEGORIES) {
    if (pattern.test(message)) return category;
  }
  return 'other';
}

export function computeErrorCategories(analytics: SessionAnalytics): Record<ErrorCategory, number> {
  const result: Record<ErrorCategory, number> = {
    permission_denied: 0,
    timeout: 0,
    file_not_found: 0,
    syntax_error: 0,
    test_failure: 0,
    git_conflict: 0,
    other: 0,
  };

  for (const err of analytics.errors) {
    const category = categorizeError(err.message);
    result[category]++;
  }

  return result;
}

// ---------------------------------------------------------------------------
// Tool domain classification (F03)
// ---------------------------------------------------------------------------

export type ToolDomain =
  | 'read'
  | 'write'
  | 'test'
  | 'git'
  | 'browser'
  | 'search'
  | 'agent'
  | 'bash';

export function classifyToolDomain(toolName: string, command?: string): ToolDomain {
  if (['Read', 'Glob', 'Grep'].includes(toolName)) return 'read';
  if (['Write', 'Edit', 'NotebookEdit'].includes(toolName)) return 'write';
  if (['Task', 'TaskCreate', 'TaskUpdate', 'TaskList'].includes(toolName)) return 'agent';
  if (['WebSearch', 'WebFetch'].includes(toolName)) return 'browser';
  if (toolName.startsWith('mcp__plugin_playwright')) return 'browser';

  if (toolName === 'Bash' && command) {
    if (/vitest|jest|pytest|npm test|yarn test/.test(command)) return 'test';
    if (/\bgit\s/.test(command)) return 'git';
  }

  return 'bash';
}

export function computeToolDomains(analytics: SessionAnalytics): ToolDomain[] {
  const domains = new Set<ToolDomain>();
  for (const tc of analytics.toolCalls) {
    const cmd = (tc.input as { command?: string }).command;
    domains.add(classifyToolDomain(tc.toolName, cmd));
  }
  return [...domains];
}

// ---------------------------------------------------------------------------
// Derived rich analytics (combined output)
// ---------------------------------------------------------------------------

export interface RichSessionAnalytics {
  // Pass-through core fields
  sessionId: string;
  slug: string | null;
  projectDir: string;
  gitBranch: string | null;
  model: string | null;
  claudeVersion: string | null;
  startTime: string;
  endTime: string;
  durationMs: number;
  durationMinutes: number;
  userTurns: number;
  assistantTurns: number;
  compactionCount: number;
  compactionTimestamps: string[];
  logicalParentUuid: string | null;
  hookPreventionCount: number;
  thinkingBlockCount: number;
  planPresent: boolean;
  permissionMode: string | null;
  serviceTier: string | null;
  gitCommandCount: number;
  commitCount: number;
  subagentCount: number;

  // Token / cost
  tokensInput: number;
  tokensOutput: number;
  tokensCacheRead: number;
  tokensCacheCreation: number;
  cacheHitRate: number;
  costUsd: number;

  // Models
  modelPrimary: string | null;
  modelsUsed: string[];

  // Tools
  toolCalls: number;
  toolErrors: number;
  toolErrorRate: number;
  toolBreakdown: Record<string, number>;
  toolDomains: ToolDomain[];

  // Files
  filesTouched: string[];
  filesWritten: string[];
  filesReadCount: number;
  filesWrittenCount: number;

  // Git / PR
  prLinks: PrLink[];

  // Tasks
  taskRefs: string[];

  // Skills
  skillUsage: Record<string, number>;

  // Error categories
  errorCategories: Record<ErrorCategory, number>;

  // Classification
  sessionType: SessionType;
  outcome: SessionOutcome;
}

export interface PrLink {
  number: number;
  url: string;
  repo: string;
  timestamp?: string;
}

export function deriveRichAnalytics(analytics: SessionAnalytics): RichSessionAnalytics {
  const modelPrimary = pickPrimaryModel(analytics.modelCounts, analytics.model);
  const modelsUsed =
    analytics.modelCounts.size > 0
      ? [...analytics.modelCounts.keys()]
      : analytics.model
        ? [analytics.model]
        : [];

  const filesTouched = [...analytics.filesTouched.keys()];
  const filesReadCount = filesTouched.filter((p) => {
    const ops = analytics.filesTouched.get(p);
    return ops?.has('Read') ?? false;
  }).length;

  return {
    sessionId: analytics.sessionId,
    slug: analytics.slug,
    projectDir: analytics.projectDir,
    gitBranch: analytics.gitBranch,
    model: analytics.model,
    claudeVersion: analytics.claudeVersion,
    startTime: analytics.startTime,
    endTime: analytics.endTime,
    durationMs: analytics.durationMs,
    durationMinutes: Math.round(analytics.durationMs / 60_000),
    userTurns: analytics.userTurns,
    assistantTurns: analytics.assistantTurns,
    compactionCount: analytics.compactionCount,
    compactionTimestamps: analytics.compactionTimestamps,
    logicalParentUuid: analytics.logicalParentUuid,
    hookPreventionCount: analytics.hookPreventionCount,
    thinkingBlockCount: analytics.thinkingBlockCount,
    planPresent: analytics.planPresent,
    permissionMode: analytics.permissionMode,
    serviceTier: analytics.serviceTier,
    gitCommandCount: analytics.gitCommandCount,
    commitCount: analytics.commitCount,
    subagentCount: analytics.subagentCount,

    tokensInput: analytics.tokens.inputTokens,
    tokensOutput: analytics.tokens.outputTokens,
    tokensCacheRead: analytics.tokens.cacheReadTokens,
    tokensCacheCreation: analytics.tokens.cacheCreationTokens,
    cacheHitRate: computeCacheHitRate(analytics),
    costUsd: computeCostUsd(analytics),

    modelPrimary,
    modelsUsed,

    toolCalls: analytics.toolCalls.length,
    toolErrors: analytics.errorCount,
    toolErrorRate: analytics.errorRate,
    toolBreakdown: analytics.toolCallsByName,
    toolDomains: computeToolDomains(analytics),

    filesTouched,
    filesWritten: analytics.filesWritten,
    filesReadCount,
    filesWrittenCount: analytics.filesWritten.length,

    prLinks: analytics.prLinks,

    taskRefs: analytics.taskRefs,

    skillUsage: Object.fromEntries(analytics.skillUsage),

    errorCategories: computeErrorCategories(analytics),

    sessionType: classifySessionType(analytics),
    outcome: classifySessionOutcome(analytics),
  };
}

function pickPrimaryModel(
  modelCounts: Map<string, number>,
  fallback: string | null
): string | null {
  if (modelCounts.size === 0) return fallback;
  let best: string | null = null;
  let bestCount = 0;
  for (const [model, count] of modelCounts) {
    if (count > bestCount) {
      best = model;
      bestCount = count;
    }
  }
  return best;
}
