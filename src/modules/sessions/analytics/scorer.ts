import type { SessionAnalytics } from '../types.js';

export interface SessionQualityScore {
  /** Composite quality score 0–100 (higher = better) */
  overall: number;
  /**
   * Efficacy: work shipped per tool call.
   * 0–1; higher = fewer tool calls needed per commit.
   * Reference baseline: 20 tool calls per commit.
   */
  efficiency: number;
  /**
   * Reliability: inverse error rate.
   * 0–1; higher = fewer tool-call errors.
   */
  reliability: number;
  /**
   * Assurance: low friction density.
   * 0–1; higher = fewer friction signals per tool call.
   */
  assurance: number;
  /**
   * Steadiness: inverse retry rate.
   * 0–1; higher = fewer error-loop / repeated-tool retries.
   */
  steadiness: number;
  /** Raw unnormalized signals */
  raw: {
    toolCallCount: number;
    /** Number of git commits made (proxy for completed work units) */
    commitCount: number;
    taskRefCount: number;
    errorRate: number;
    frictionSignalCount: number;
    /** error_loop + consecutive_identical_tool friction counts */
    retryCount: number;
    hookPreventionCount: number;
  };
}

/**
 * Ideal tool calls per unit of completed work (one commit).
 * Sessions below this ratio score near 1.0 for efficiency.
 */
const REFERENCE_TOOLS_PER_COMMIT = 20;

/**
 * Scale factors for normalising density metrics to 0–1.
 * A friction density of 1/FRICTION_SCALE → score of 0.
 */
const FRICTION_DENSITY_SCALE = 5;
const RETRY_DENSITY_SCALE = 5;

function clamp(value: number, min = 0, max = 1): number {
  return Math.max(min, Math.min(max, value));
}

function scoreEfficiency(toolCallCount: number, commitCount: number): number {
  if (toolCallCount === 0) return 0;
  if (commitCount === 0) return 0;
  const toolsPerCommit = toolCallCount / commitCount;
  // Linear: at or below reference → 1.0; degrades proportionally above.
  return clamp(REFERENCE_TOOLS_PER_COMMIT / toolsPerCommit);
}

function scoreReliability(errorRate: number): number {
  return clamp(1 - errorRate);
}

function scoreAssurance(frictionSignalCount: number, toolCallCount: number): number {
  if (toolCallCount === 0) return frictionSignalCount === 0 ? 1 : 0;
  const density = frictionSignalCount / toolCallCount;
  return clamp(1 - density * FRICTION_DENSITY_SCALE);
}

function scoreSteadiness(retryCount: number, toolCallCount: number): number {
  if (toolCallCount === 0) return retryCount === 0 ? 1 : 0;
  const retryRate = retryCount / toolCallCount;
  return clamp(1 - retryRate * RETRY_DENSITY_SCALE);
}

function countRetries(analytics: SessionAnalytics): number {
  return analytics.frictionSignals.filter(
    (s) => s.kind === 'error_loop' || s.kind === 'consecutive_identical_tool'
  ).length;
}

/**
 * Produce a heuristic quality score for a session.
 *
 * Dimensions are aligned to the CLEAR framework:
 *   - efficiency   → Efficacy (work done per effort)
 *   - reliability  → Reliability (error-free execution)
 *   - assurance    → Assurance (low friction density)
 *   - steadiness   → Reliability (retry / loop avoidance)
 *
 * Cost and Latency are captured in raw signals for future LLM-as-judge use.
 */
export function scoreSessionQuality(analytics: SessionAnalytics): SessionQualityScore {
  const toolCallCount = analytics.toolCalls.length;
  const commitCount = analytics.commitCount;
  const taskRefCount = analytics.taskRefs.length;
  const frictionSignalCount = analytics.frictionSignals.length;
  const retryCount = countRetries(analytics);

  const efficiency = scoreEfficiency(toolCallCount, commitCount);
  const reliability = scoreReliability(analytics.errorRate);
  const assurance = scoreAssurance(frictionSignalCount, toolCallCount);
  const steadiness = scoreSteadiness(retryCount, toolCallCount);

  // Weighted composite — efficacy counts most, then reliability, assurance, steadiness.
  const overall = Math.round(
    (efficiency * 0.35 + reliability * 0.3 + assurance * 0.2 + steadiness * 0.15) * 100
  );

  return {
    overall,
    efficiency,
    reliability,
    assurance,
    steadiness,
    raw: {
      toolCallCount,
      commitCount,
      taskRefCount,
      errorRate: analytics.errorRate,
      frictionSignalCount,
      retryCount,
      hookPreventionCount: analytics.hookPreventionCount,
    },
  };
}
