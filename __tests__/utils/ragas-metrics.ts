/**
 * RAGAS (Retrieval-Augmented Generation Assessment) metrics for evaluating
 * retrieval quality. Ported to TypeScript from the RAGAS framework.
 *
 * Retrieval metrics (no LLM required):
 * - contextPrecision: Average Precision — rewards relevant items ranked higher
 * - contextRecall: fraction of ground-truth items found in retrieved results
 * - contextRelevancy: ratio of relevant items to total retrieved (precision)
 *
 * @see https://docs.ragas.io/en/latest/concepts/metrics/
 */

/**
 * Context Precision (Average Precision).
 *
 * For each relevant item at rank k, compute precision@k,
 * then average over all relevant items. This rewards systems
 * that place relevant items earlier in the ranked list.
 *
 * AP = (1/|relevant|) * sum_{k: item_k is relevant}(precision@k)
 */
export function contextPrecision(retrieved: string[], relevant: Set<string>): number {
  if (relevant.size === 0 || retrieved.length === 0) return 0;

  let relevantSoFar = 0;
  let sumPrecision = 0;

  for (let i = 0; i < retrieved.length; i++) {
    if (relevant.has(retrieved[i])) {
      relevantSoFar++;
      sumPrecision += relevantSoFar / (i + 1);
    }
  }

  return relevantSoFar === 0 ? 0 : sumPrecision / relevant.size;
}

/**
 * Context Recall.
 *
 * Fraction of ground-truth relevant items that appear anywhere
 * in the retrieved list. Unlike recall@k, this checks the full
 * retrieved list without a k cutoff (pass a sliced array for @k).
 */
export function contextRecall(retrieved: string[], relevant: Set<string>): number {
  if (relevant.size === 0) return 0;

  const retrievedSet = new Set(retrieved);
  let found = 0;
  for (const id of relevant) {
    if (retrievedSet.has(id)) found++;
  }

  return found / relevant.size;
}

/**
 * Context Relevancy (precision).
 *
 * Ratio of relevant items to total items in the retrieved list.
 * Penalizes retrieving too many irrelevant items.
 */
export function contextRelevancy(retrieved: string[], relevant: Set<string>): number {
  if (retrieved.length === 0) return 0;

  const hits = retrieved.filter((id) => relevant.has(id)).length;
  return hits / retrieved.length;
}

export interface RagasRetrievalMetrics {
  contextPrecision: number;
  contextRecall: number;
  contextRelevancy: number;
}

/**
 * Compute all RAGAS retrieval metrics for a single query.
 */
export function ragasRetrievalMetrics(
  retrieved: string[],
  relevant: Set<string>
): RagasRetrievalMetrics {
  return {
    contextPrecision: contextPrecision(retrieved, relevant),
    contextRecall: contextRecall(retrieved, relevant),
    contextRelevancy: contextRelevancy(retrieved, relevant),
  };
}

/**
 * Aggregate RAGAS retrieval metrics across multiple queries.
 */
export function aggregateRagasMetrics(
  results: Array<{ retrieved: string[]; relevant: Set<string> }>
): RagasRetrievalMetrics {
  if (results.length === 0) {
    return { contextPrecision: 0, contextRecall: 0, contextRelevancy: 0 };
  }

  const n = results.length;

  const avgPrecision =
    results.reduce((sum, r) => sum + contextPrecision(r.retrieved, r.relevant), 0) / n;
  const avgRecall = results.reduce((sum, r) => sum + contextRecall(r.retrieved, r.relevant), 0) / n;
  const avgRelevancy =
    results.reduce((sum, r) => sum + contextRelevancy(r.retrieved, r.relevant), 0) / n;

  return {
    contextPrecision: avgPrecision,
    contextRecall: avgRecall,
    contextRelevancy: avgRelevancy,
  };
}
