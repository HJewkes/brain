import type { SearchResult } from '../types.js';

const DEFAULT_MODEL = 'Xenova/ms-marco-MiniLM-L-6-v2';

type TextClassificationPipeline = (
  inputs: [string, string][],
  options?: Record<string, unknown>
) => Promise<Array<{ label: string; score: number }>>;

let cachedPipeline: TextClassificationPipeline | null = null;

async function getPipeline(): Promise<TextClassificationPipeline> {
  if (cachedPipeline) return cachedPipeline;
  const { pipeline } = await import('@huggingface/transformers');
  cachedPipeline = (await pipeline('text-classification', DEFAULT_MODEL, {
    dtype: 'q8',
  })) as unknown as TextClassificationPipeline;
  return cachedPipeline;
}

export async function rerank(
  query: string,
  results: SearchResult[],
  topK?: number
): Promise<SearchResult[]> {
  if (results.length <= 1) return results;

  const classifier = await getPipeline();
  const pairs: [string, string][] = results.map((r) => [query, r.excerpt]);
  const scores = await classifier(pairs, { top_k: 1 });

  const scored = results.map((result, i) => ({
    result,
    rerankScore: scores[i].score,
  }));

  scored.sort((a, b) => b.rerankScore - a.rerankScore);

  const limit = topK ?? results.length;
  return scored.slice(0, limit).map(({ result, rerankScore }) => ({
    ...result,
    score: rerankScore,
  }));
}
