import { describe, test, beforeAll, afterAll, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { EvalCorpus } from '../fixtures/corpus-types.js'
import { setupEvalEnvironment, runEvalSuite } from './harness.js'
import type { EvalResult } from './harness.js'

const K = 5

const corpus: EvalCorpus = JSON.parse(
  readFileSync(resolve(__dirname, '../fixtures/eval-corpus.json'), 'utf-8'),
)

describe('relevance threshold calibration', () => {
  let env: Awaited<ReturnType<typeof setupEvalEnvironment>>
  let onTopicResults: EvalResult[]
  let offTopicMaxScores: number[]

  beforeAll(async () => {
    env = await setupEvalEnvironment(corpus)

    // Run on-topic queries (from corpus ground truth)
    onTopicResults = await runEvalSuite(corpus, env, { k: K })

    // Run off-topic queries manually through the harness's search
    // The harness exposes the DB and embedder for direct search calls
    offTopicMaxScores = []
    for (const queryText of corpus.offTopicQueries) {
      const results = await env.search(queryText, K)
      const maxScore = results.length > 0 ? results[0].score : 0
      offTopicMaxScores.push(maxScore)
    }
  }, 120_000)

  afterAll(() => {
    env.cleanup()
  })

  test('off-topic score distribution', () => {
    const max = Math.max(...offTopicMaxScores)
    const min = Math.min(...offTopicMaxScores)
    const avg = offTopicMaxScores.reduce((a, b) => a + b, 0) / offTopicMaxScores.length

    console.log('\n=== Off-Topic Score Distribution ===')
    console.log(`  count: ${offTopicMaxScores.length}`)
    console.log(`  max:   ${max.toFixed(6)}`)
    console.log(`  min:   ${min.toFixed(6)}`)
    console.log(`  avg:   ${avg.toFixed(6)}`)

    expect(offTopicMaxScores.length).toBe(corpus.offTopicQueries.length)
  })

  test('on-topic score distribution (correct results only)', () => {
    // For on-topic: look at the score of the first correct result
    const correctScores: number[] = []
    for (const result of onTopicResults) {
      const correctIdx = result.retrieved.findIndex((id) => result.relevant.has(id))
      if (correctIdx >= 0 && correctIdx < result.scores.length) {
        correctScores.push(result.scores[correctIdx])
      }
    }

    const max = Math.max(...correctScores)
    const min = Math.min(...correctScores)
    const avg = correctScores.reduce((a, b) => a + b, 0) / correctScores.length

    console.log('\n=== On-Topic Score Distribution (correct hits) ===')
    console.log(`  count: ${correctScores.length}`)
    console.log(`  max:   ${max.toFixed(6)}`)
    console.log(`  min:   ${min.toFixed(6)}`)
    console.log(`  avg:   ${avg.toFixed(6)}`)

    expect(correctScores.length).toBeGreaterThan(0)
  })

  test('score separation analysis', () => {
    const offTopicMax = Math.max(...offTopicMaxScores)

    const correctScores: number[] = []
    for (const result of onTopicResults) {
      const correctIdx = result.retrieved.findIndex((id) => result.relevant.has(id))
      if (correctIdx >= 0 && correctIdx < result.scores.length) {
        correctScores.push(result.scores[correctIdx])
      }
    }
    const onTopicMin = Math.min(...correctScores)

    const gap = onTopicMin - offTopicMax
    const separable = gap > 0

    console.log('\n=== Score Separation ===')
    console.log(`  off-topic max score:  ${offTopicMax.toFixed(6)}`)
    console.log(`  on-topic min score:   ${onTopicMin.toFixed(6)}`)
    console.log(`  gap:                  ${gap.toFixed(6)}`)
    console.log(`  separable:            ${separable}`)

    if (separable) {
      const threshold = offTopicMax + gap * 0.5
      console.log(`  suggested threshold:  ${threshold.toFixed(6)}`)
    } else {
      console.log('  WARNING: Distributions overlap — threshold filtering will have false positives/negatives')
      const p50OffTopic = offTopicMaxScores.sort((a, b) => a - b)[Math.floor(offTopicMaxScores.length * 0.5)]
      console.log(`  off-topic p50:        ${p50OffTopic.toFixed(6)}`)
    }

    // No hard assertion — just analysis
    expect(true).toBe(true)
  })
})
