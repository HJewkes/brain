/**
 * Compute hotness score for a note based on access frequency and recency.
 * Formula: sigmoid(log1p(accessCount)) * exp(-decay * ageDays)
 * where decay = ln(2) / halfLifeDays (7-day half-life by default)
 */
export function computeHotnessScore(
  accessCount: number,
  ageDays: number,
  halfLifeDays: number = 7
): number {
  const decay = Math.LN2 / halfLifeDays;
  const frequency = sigmoid(Math.log1p(accessCount));
  const recency = Math.exp(-decay * Math.max(0, ageDays));
  return frequency * recency;
}

function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

/**
 * Compute age in days from a date string to now.
 */
export function ageDays(modifiedAt: string | null, now: Date = new Date()): number {
  if (!modifiedAt) return 365;
  const modified = new Date(modifiedAt);
  const diffMs = now.getTime() - modified.getTime();
  return Math.max(0, diffMs / (1000 * 60 * 60 * 24));
}
