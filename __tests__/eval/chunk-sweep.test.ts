import { describe, test, beforeAll, afterAll, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { EvalCorpus } from '../fixtures/corpus-types.js'
import { setupEvalEnvironment, runEvalSuite } from './harness.js'
import type { EvalEnvironment } from './harness.js'
import { aggregateMetrics } from '../utils/metrics.js'

const K = 5

const corpus: EvalCorpus = JSON.parse(
  readFileSync(resolve(__dirname, '../fixtures/eval-corpus.json'), 'utf-8'),
)

const CHUNK_CONFIGS = [
  { size: 128, overlap: 0 },
  { size: 128, overlap: 16 },
  { size: 256, overlap: 0 },
  { size: 256, overlap: 32 },
  { size: 512, overlap: 0 },
  { size: 512, overlap: 51 },
] as const

describe('chunk size sweep — DISCOVERY (log, no hard assertions)', () => {
  const sweepResults: Array<{
    config: { size: number; overlap: number }
    metrics: ReturnType<typeof aggregateMetrics>
  }> = []

  for (const config of CHUNK_CONFIGS) {
    describe(`chunk_size=${config.size}, overlap=${config.overlap}`, () => {
      let env: EvalEnvironment

      beforeAll(async () => {
        env = await setupEvalEnvironment(corpus, { chunkSize: config.size })
      }, 120_000)

      afterAll(() => {
        env.cleanup()
      })

      test('compute and log metrics', async () => {
        const results = await runEvalSuite(corpus, env, { k: K })
        const forMetrics = results.map((r) => ({
          retrieved: r.retrieved,
          relevant: r.relevant,
        }))
        const metrics = aggregateMetrics(forMetrics, K)
        sweepResults.push({ config, metrics })

        console.log(`\n--- chunk_size=${config.size}, overlap=${config.overlap} ---`)
        console.log(`  hit_rate@${K}:    ${metrics.hitRate.toFixed(3)}`)
        console.log(`  MRR@${K}:         ${metrics.mrr.toFixed(3)}`)
        console.log(`  recall@${K}:      ${metrics.recallAtK.toFixed(3)}`)
        console.log(`  precision@${K}:   ${metrics.precisionAtK.toFixed(3)}`)
        console.log(`  NDCG@${K}:        ${metrics.ndcgAtK.toFixed(3)}`)

        // Discovery: just verify pipeline runs without crash
        expect(metrics.hitRate).toBeGreaterThanOrEqual(0)
      })
    })
  }

  test('summary table', () => {
    console.log('\n=== Chunk Size Sweep Summary ===')
    console.log('Size | Overlap | hit_rate | MRR    | recall | precision | NDCG')
    console.log('-----|---------|----------|--------|--------|-----------|------')
    for (const { config, metrics } of sweepResults) {
      console.log(
        `${String(config.size).padStart(4)} | ${String(config.overlap).padStart(7)} | ${metrics.hitRate.toFixed(3).padStart(8)} | ${metrics.mrr.toFixed(3).padStart(6)} | ${metrics.recallAtK.toFixed(3).padStart(6)} | ${metrics.precisionAtK.toFixed(3).padStart(9)} | ${metrics.ndcgAtK.toFixed(3).padStart(5)}`,
      )
    }
    expect(sweepResults.length).toBe(CHUNK_CONFIGS.length)
  })
})
