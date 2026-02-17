import { describe, test, expect, beforeAll, afterAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { EvalCorpus } from '../fixtures/corpus-types.js'
import type { EvalResult } from './harness.js'
import { setupEvalEnvironment, runEvalSuite } from './harness.js'
import { aggregateMetrics, hitRate, precisionAtK, recallAtK, reciprocalRank, ndcgAtK } from '../utils/metrics.js'

const K = 5

const corpus: EvalCorpus = JSON.parse(
  readFileSync(resolve(__dirname, '../fixtures/eval-corpus.json'), 'utf-8'),
)

let sharedEnv: Awaited<ReturnType<typeof setupEvalEnvironment>>
let sharedResults: EvalResult[]

beforeAll(async () => {
  sharedEnv = await setupEvalEnvironment(corpus)
  sharedResults = await runEvalSuite(corpus, sharedEnv, { k: K })
}, 120_000)

afterAll(() => {
  sharedEnv.cleanup()
})

describe('hybrid search: retrieval quality', () => {
  test('hit_rate@5 >= 0.80 (CI gate)', () => {
    const hits = sharedResults.map((r) => hitRate(r.retrieved, r.relevant))
    const avg = hits.reduce((a, b) => a + b, 0) / hits.length
    console.log(`hit_rate@${K}: ${avg.toFixed(3)}`)
    expect(avg).toBeGreaterThanOrEqual(0.80)
  })

  test('MRR@5 (reporting)', () => {
    const rrs = sharedResults.map((r) => reciprocalRank(r.retrieved, r.relevant))
    const avg = rrs.reduce((a, b) => a + b, 0) / rrs.length
    console.log(`MRR@${K}: ${avg.toFixed(3)}`)
    expect(avg).toBeGreaterThan(0)
  })

  test('recall@5 (reporting)', () => {
    const recalls = sharedResults.map((r) => recallAtK(r.retrieved, r.relevant, K))
    const avg = recalls.reduce((a, b) => a + b, 0) / recalls.length
    console.log(`recall@${K}: ${avg.toFixed(3)}`)
    expect(avg).toBeGreaterThan(0)
  })

  test('precision@5 (reporting)', () => {
    const precisions = sharedResults.map((r) => precisionAtK(r.retrieved, r.relevant, K))
    const avg = precisions.reduce((a, b) => a + b, 0) / precisions.length
    console.log(`precision@${K}: ${avg.toFixed(3)}`)
    expect(avg).toBeGreaterThan(0)
  })

  test('NDCG@5 (reporting)', () => {
    const ndcgs = sharedResults.map((r) => ndcgAtK(r.retrieved, r.relevant, K))
    const avg = ndcgs.reduce((a, b) => a + b, 0) / ndcgs.length
    console.log(`NDCG@${K}: ${avg.toFixed(3)}`)
    expect(avg).toBeGreaterThan(0)
  })
})

describe('search quality by query type', () => {
  test('factual queries: hit_rate@5', () => {
    const factual = sharedResults.filter((r) => r.queryType === 'factual')
    const hits = factual.map((r) => hitRate(r.retrieved, r.relevant))
    const avg = hits.reduce((a, b) => a + b, 0) / hits.length
    console.log(`factual hit_rate@${K}: ${avg.toFixed(3)} (${factual.length} queries)`)
    expect(avg).toBeGreaterThan(0)
  })

  test('semantic queries: hit_rate@5', () => {
    const semantic = sharedResults.filter((r) => r.queryType === 'semantic')
    const hits = semantic.map((r) => hitRate(r.retrieved, r.relevant))
    const avg = hits.reduce((a, b) => a + b, 0) / hits.length
    console.log(`semantic hit_rate@${K}: ${avg.toFixed(3)} (${semantic.length} queries)`)
    expect(avg).toBeGreaterThan(0)
  })

  test('multi-hop queries: hit_rate@5', () => {
    const multiHop = sharedResults.filter((r) => r.queryType === 'multi-hop')
    const hits = multiHop.map((r) => hitRate(r.retrieved, r.relevant))
    const avg = hits.reduce((a, b) => a + b, 0) / hits.length
    console.log(`multi-hop hit_rate@${K}: ${avg.toFixed(3)} (${multiHop.length} queries)`)
    expect(avg).toBeGreaterThan(0)
  })

  test('aggregate metrics summary', () => {
    const allForMetrics = sharedResults.map((r) => ({
      retrieved: r.retrieved,
      relevant: r.relevant,
    }))
    const agg = aggregateMetrics(allForMetrics, K)

    console.log('\n=== Aggregate Metrics ===')
    console.log(`  hit_rate@${K}:    ${agg.hitRate.toFixed(3)}`)
    console.log(`  MRR@${K}:         ${agg.mrr.toFixed(3)}`)
    console.log(`  precision@${K}:   ${agg.precisionAtK.toFixed(3)}`)
    console.log(`  recall@${K}:      ${agg.recallAtK.toFixed(3)}`)
    console.log(`  NDCG@${K}:        ${agg.ndcgAtK.toFixed(3)}`)
    expect(agg.hitRate).toBeGreaterThan(0)
  })
})
