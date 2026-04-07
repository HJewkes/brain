import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { EvalCorpus } from '../fixtures/corpus-types.js';
import type { EvalResult } from './harness.js';
import { setupEvalEnvironment, runEvalSuite } from './harness.js';
import {
  contextPrecision,
  contextRecall,
  contextRelevancy,
  aggregateRagasMetrics,
} from '../utils/ragas-metrics.js';

const K = 5;

const corpus: EvalCorpus = JSON.parse(
  readFileSync(resolve(__dirname, '../fixtures/eval-corpus.json'), 'utf-8')
);

let sharedEnv: Awaited<ReturnType<typeof setupEvalEnvironment>>;
let sharedResults: EvalResult[];

beforeAll(async () => {
  sharedEnv = await setupEvalEnvironment(corpus);
  sharedResults = await runEvalSuite(corpus, sharedEnv, { k: K });
}, 120_000);

afterAll(async () => {
  await sharedEnv?.cleanup();
});

describe('RAGAS retrieval metrics', () => {
  test('context_precision@5 (Average Precision)', () => {
    const scores = sharedResults.map((r) => contextPrecision(r.retrieved, r.relevant));
    const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
    console.log(`RAGAS context_precision@${K}: ${avg.toFixed(3)}`);
    expect(avg).toBeGreaterThan(0);
  });

  test('context_recall@5', () => {
    const scores = sharedResults.map((r) => contextRecall(r.retrieved, r.relevant));
    const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
    console.log(`RAGAS context_recall@${K}: ${avg.toFixed(3)}`);
    expect(avg).toBeGreaterThan(0);
  });

  test('context_relevancy@5', () => {
    const scores = sharedResults.map((r) => contextRelevancy(r.retrieved, r.relevant));
    const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
    console.log(`RAGAS context_relevancy@${K}: ${avg.toFixed(3)}`);
    expect(avg).toBeGreaterThan(0);
  });
});

describe('RAGAS metrics by query type', () => {
  for (const queryType of ['factual', 'semantic', 'multi-hop'] as const) {
    test(`${queryType}: context_precision@5`, () => {
      const subset = sharedResults.filter((r) => r.queryType === queryType);
      if (subset.length === 0) return;

      const scores = subset.map((r) => contextPrecision(r.retrieved, r.relevant));
      const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
      console.log(
        `RAGAS ${queryType} context_precision@${K}: ${avg.toFixed(3)} (${subset.length} queries)`
      );
      expect(avg).toBeGreaterThanOrEqual(0);
    });
  }
});

describe('RAGAS aggregate summary', () => {
  test('prints aggregate RAGAS metrics', () => {
    const forMetrics = sharedResults.map((r) => ({
      retrieved: r.retrieved,
      relevant: r.relevant,
    }));
    const agg = aggregateRagasMetrics(forMetrics);

    console.log('\n=== RAGAS Aggregate Metrics ===');
    console.log(`  context_precision@${K}: ${agg.contextPrecision.toFixed(3)}`);
    console.log(`  context_recall@${K}:    ${agg.contextRecall.toFixed(3)}`);
    console.log(`  context_relevancy@${K}: ${agg.contextRelevancy.toFixed(3)}`);

    expect(agg.contextPrecision).toBeGreaterThan(0);
    expect(agg.contextRecall).toBeGreaterThan(0);
    expect(agg.contextRelevancy).toBeGreaterThan(0);
  });
});
