import { describe, test, beforeAll, afterAll, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { EvalCorpus } from '../fixtures/corpus-types.js';
import { setupEvalEnvironment, runEvalSuite } from './harness.js';
import { aggregateMetrics, hitRate } from '../utils/metrics.js';

const K = 5;

const corpus: EvalCorpus = JSON.parse(
  readFileSync(resolve(__dirname, '../fixtures/eval-corpus.json'), 'utf-8')
);

const WEIGHT_CONFIGS = [
  { bm25: 0.0, vector: 1.0, label: 'pure vector' },
  { bm25: 0.2, vector: 0.8, label: '20/80' },
  { bm25: 0.3, vector: 0.7, label: '30/70 (current)' },
  { bm25: 0.4, vector: 0.6, label: '40/60' },
  { bm25: 0.5, vector: 0.5, label: 'equal' },
  { bm25: 0.7, vector: 0.3, label: '70/30' },
  { bm25: 1.0, vector: 0.0, label: 'pure BM25' },
] as const;

describe('fusion weight sweep — DISCOVERY (log, no hard assertions)', () => {
  let env: Awaited<ReturnType<typeof setupEvalEnvironment>>;

  beforeAll(async () => {
    env = await setupEvalEnvironment(corpus);
  }, 120_000);

  afterAll(async () => {
    await env?.cleanup();
  });

  const sweepResults: Array<{
    config: (typeof WEIGHT_CONFIGS)[number];
    overall: ReturnType<typeof aggregateMetrics>;
    byType: Record<string, { hitRate: number; count: number }>;
  }> = [];

  for (const config of WEIGHT_CONFIGS) {
    test(`bm25=${config.bm25}, vector=${config.vector} (${config.label})`, async () => {
      const results = await runEvalSuite(corpus, env, {
        k: K,
        fusionWeights: { bm25: config.bm25, vector: config.vector },
      });

      const forMetrics = results.map((r) => ({
        retrieved: r.retrieved,
        relevant: r.relevant,
      }));
      const overall = aggregateMetrics(forMetrics, K);

      // Break down by query type
      const byType: Record<string, { hitRate: number; count: number }> = {};
      for (const queryType of ['factual', 'semantic', 'multi-hop']) {
        const typed = results.filter((r) => r.queryType === queryType);
        if (typed.length === 0) continue;
        const hits = typed.map((r) => hitRate(r.retrieved, r.relevant));
        byType[queryType] = {
          hitRate: hits.reduce((a, b) => a + b, 0) / hits.length,
          count: typed.length,
        };
      }

      sweepResults.push({ config, overall, byType });

      console.log(`\n--- ${config.label} (bm25=${config.bm25}, vector=${config.vector}) ---`);
      console.log(`  overall hit_rate@${K}: ${overall.hitRate.toFixed(3)}`);
      console.log(`  overall MRR@${K}:      ${overall.mrr.toFixed(3)}`);
      for (const [type, data] of Object.entries(byType)) {
        console.log(`  ${type} hit_rate@${K}: ${data.hitRate.toFixed(3)} (${data.count} queries)`);
      }

      expect(overall.hitRate).toBeGreaterThanOrEqual(0);
    });
  }

  test('summary table', () => {
    console.log('\n=== Fusion Weight Sweep Summary ===');
    console.log(
      'Label            | BM25 | Vec  | hit_rate | MRR    | factual | semantic | multi-hop'
    );
    console.log(
      '-----------------|------|------|----------|--------|---------|----------|-----------'
    );
    for (const { config, overall, byType } of sweepResults) {
      const f = byType['factual']?.hitRate.toFixed(3) ?? 'N/A';
      const s = byType['semantic']?.hitRate.toFixed(3) ?? 'N/A';
      const m = byType['multi-hop']?.hitRate.toFixed(3) ?? 'N/A';
      console.log(
        `${config.label.padEnd(17)}| ${config.bm25.toFixed(1).padStart(4)} | ${config.vector.toFixed(1).padStart(4)} | ${overall.hitRate.toFixed(3).padStart(8)} | ${overall.mrr.toFixed(3).padStart(6)} | ${f.padStart(7)} | ${s.padStart(8)} | ${m.padStart(9)}`
      );
    }
    expect(sweepResults.length).toBe(WEIGHT_CONFIGS.length);
  });
});
