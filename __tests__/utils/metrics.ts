export function hitRate(retrieved: string[], relevant: Set<string>): number {
  return retrieved.some((id) => relevant.has(id)) ? 1 : 0
}

export function precisionAtK(retrieved: string[], relevant: Set<string>, k: number): number {
  if (k === 0) return 0
  const topK = retrieved.slice(0, k)
  return topK.filter((id) => relevant.has(id)).length / k
}

export function recallAtK(retrieved: string[], relevant: Set<string>, k: number): number {
  if (relevant.size === 0) return 0
  const topK = retrieved.slice(0, k)
  return topK.filter((id) => relevant.has(id)).length / relevant.size
}

export function reciprocalRank(retrieved: string[], relevant: Set<string>): number {
  const index = retrieved.findIndex((id) => relevant.has(id))
  return index === -1 ? 0 : 1 / (index + 1)
}

export function mrr(
  allResults: Array<{ retrieved: string[]; relevant: Set<string> }>,
): number {
  if (allResults.length === 0) return 0
  const sum = allResults.reduce(
    (acc, { retrieved: r, relevant: rel }) => acc + reciprocalRank(r, rel),
    0,
  )
  return sum / allResults.length
}

export function ndcgAtK(retrieved: string[], relevant: Set<string>, k: number): number {
  if (relevant.size === 0 || retrieved.length === 0) return 0

  const topK = retrieved.slice(0, k)

  const dcg = topK.reduce((sum, id, i) => {
    const rel = relevant.has(id) ? 1 : 0
    return sum + rel / Math.log2(i + 2)
  }, 0)

  const idealCount = Math.min(relevant.size, k)
  const idcg = Array.from({ length: idealCount }).reduce<number>((sum, _, i) => {
    return sum + 1 / Math.log2(i + 2)
  }, 0)

  return idcg === 0 ? 0 : dcg / idcg
}

export function aggregateMetrics(
  allResults: Array<{ retrieved: string[]; relevant: Set<string> }>,
  k: number,
): { hitRate: number; mrr: number; precisionAtK: number; recallAtK: number; ndcgAtK: number } {
  if (allResults.length === 0) {
    return { hitRate: 0, mrr: 0, precisionAtK: 0, recallAtK: 0, ndcgAtK: 0 }
  }

  const n = allResults.length
  const avgHitRate = allResults.reduce(
    (sum, { retrieved: r, relevant: rel }) => sum + hitRate(r, rel),
    0,
  ) / n
  const avgMrr = mrr(allResults)
  const avgPrecision = allResults.reduce(
    (sum, { retrieved: r, relevant: rel }) => sum + precisionAtK(r, rel, k),
    0,
  ) / n
  const avgRecall = allResults.reduce(
    (sum, { retrieved: r, relevant: rel }) => sum + recallAtK(r, rel, k),
    0,
  ) / n
  const avgNdcg = allResults.reduce(
    (sum, { retrieved: r, relevant: rel }) => sum + ndcgAtK(r, rel, k),
    0,
  ) / n

  return {
    hitRate: avgHitRate,
    mrr: avgMrr,
    precisionAtK: avgPrecision,
    recallAtK: avgRecall,
    ndcgAtK: avgNdcg,
  }
}
