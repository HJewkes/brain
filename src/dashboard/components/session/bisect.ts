/** Binary search returning count of elements <= target. */
export function bisect(sortedMs: number[], targetMs: number): number {
  let lo = 0,
    hi = sortedMs.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (sortedMs[mid] <= targetMs) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
