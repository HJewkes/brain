import { describe, expect, it } from 'vitest'
import {
  hitRate,
  precisionAtK,
  recallAtK,
  reciprocalRank,
  mrr,
  ndcgAtK,
  aggregateMetrics,
} from './metrics.js'

describe('hitRate', () => {
  it('returns 1 when a relevant item is in retrieved', () => {
    const retrieved = ['a', 'b', 'c']
    const relevant = new Set(['b'])
    expect(hitRate(retrieved, relevant)).toBe(1)
  })

  it('returns 0 when no relevant item is in retrieved', () => {
    const retrieved = ['a', 'b', 'c']
    const relevant = new Set(['x', 'y'])
    expect(hitRate(retrieved, relevant)).toBe(0)
  })

  it('returns 0 for empty retrieved list', () => {
    expect(hitRate([], new Set(['a']))).toBe(0)
  })

  it('returns 0 for empty relevant set', () => {
    expect(hitRate(['a', 'b'], new Set())).toBe(0)
  })
})

describe('precisionAtK', () => {
  it('returns correct precision with k=5 and 2 relevant in top-5', () => {
    const retrieved = ['a', 'b', 'c', 'd', 'e', 'f']
    const relevant = new Set(['a', 'c', 'f'])
    expect(precisionAtK(retrieved, relevant, 5)).toBeCloseTo(0.4)
  })

  it('returns 0 when no relevant items in top-k', () => {
    const retrieved = ['a', 'b', 'c']
    const relevant = new Set(['x'])
    expect(precisionAtK(retrieved, relevant, 3)).toBe(0)
  })

  it('handles k greater than retrieved length', () => {
    const retrieved = ['a', 'b']
    const relevant = new Set(['a'])
    expect(precisionAtK(retrieved, relevant, 5)).toBeCloseTo(0.2)
  })

  it('returns 0 for empty inputs', () => {
    expect(precisionAtK([], new Set(['a']), 5)).toBe(0)
    expect(precisionAtK(['a'], new Set(), 5)).toBe(0)
  })
})

describe('recallAtK', () => {
  it('returns correct recall with k=5 and 2 of 3 relevant retrieved', () => {
    const retrieved = ['a', 'b', 'c', 'd', 'e']
    const relevant = new Set(['a', 'c', 'x'])
    expect(recallAtK(retrieved, relevant, 5)).toBeCloseTo(2 / 3)
  })

  it('returns 1 when all relevant items retrieved', () => {
    const retrieved = ['a', 'b', 'c']
    const relevant = new Set(['a', 'b'])
    expect(recallAtK(retrieved, relevant, 3)).toBe(1)
  })

  it('returns 0 for empty relevant set', () => {
    expect(recallAtK(['a', 'b'], new Set(), 5)).toBe(0)
  })

  it('returns 0 for empty retrieved list', () => {
    expect(recallAtK([], new Set(['a']), 5)).toBe(0)
  })
})

describe('reciprocalRank', () => {
  it('returns 1/3 when first relevant is at position 3', () => {
    const retrieved = ['a', 'b', 'c', 'd']
    const relevant = new Set(['c'])
    expect(reciprocalRank(retrieved, relevant)).toBeCloseTo(1 / 3)
  })

  it('returns 1 when first relevant is at position 1', () => {
    const retrieved = ['a', 'b', 'c']
    const relevant = new Set(['a'])
    expect(reciprocalRank(retrieved, relevant)).toBe(1)
  })

  it('returns 0 when no relevant item found', () => {
    const retrieved = ['a', 'b', 'c']
    const relevant = new Set(['x'])
    expect(reciprocalRank(retrieved, relevant)).toBe(0)
  })

  it('returns 0 for empty inputs', () => {
    expect(reciprocalRank([], new Set(['a']))).toBe(0)
    expect(reciprocalRank(['a'], new Set())).toBe(0)
  })
})

describe('mrr', () => {
  it('returns average of reciprocal ranks across multiple queries', () => {
    const results = [
      { retrieved: ['a', 'b', 'c'], relevant: new Set(['a']) },
      { retrieved: ['x', 'y', 'z'], relevant: new Set(['y']) },
      { retrieved: ['p', 'q', 'r'], relevant: new Set(['r']) },
    ]
    // RRs: 1, 0.5, 0.333 -> mean = 1.833/3 ≈ 0.611
    expect(mrr(results)).toBeCloseTo((1 + 0.5 + 1 / 3) / 3)
  })

  it('returns 0 for empty results', () => {
    expect(mrr([])).toBe(0)
  })
})

describe('ndcgAtK', () => {
  it('scores 1.0 for ideal ranking (all relevant first)', () => {
    const retrieved = ['a', 'b', 'c', 'd', 'e']
    const relevant = new Set(['a', 'b'])
    expect(ndcgAtK(retrieved, relevant, 5)).toBeCloseTo(1.0)
  })

  it('scores less than 1.0 for non-ideal ranking', () => {
    const retrieved = ['x', 'a', 'y', 'b', 'z']
    const relevant = new Set(['a', 'b'])
    expect(ndcgAtK(retrieved, relevant, 5)).toBeLessThan(1.0)
    expect(ndcgAtK(retrieved, relevant, 5)).toBeGreaterThan(0)
  })

  it('returns 0 when no relevant items retrieved', () => {
    const retrieved = ['x', 'y', 'z']
    const relevant = new Set(['a', 'b'])
    expect(ndcgAtK(retrieved, relevant, 3)).toBe(0)
  })

  it('returns 0 for empty relevant set', () => {
    expect(ndcgAtK(['a', 'b'], new Set(), 5)).toBe(0)
  })

  it('returns 0 for empty retrieved list', () => {
    expect(ndcgAtK([], new Set(['a']), 5)).toBe(0)
  })
})

describe('aggregateMetrics', () => {
  it('returns all metric fields for 3 query results', () => {
    const results = [
      { retrieved: ['a', 'b', 'c', 'd', 'e'], relevant: new Set(['a', 'c']) },
      { retrieved: ['x', 'y', 'z', 'w', 'v'], relevant: new Set(['z']) },
      { retrieved: ['p', 'q', 'r', 's', 't'], relevant: new Set(['p', 'q', 'r']) },
    ]
    const metrics = aggregateMetrics(results, 5)

    expect(metrics).toHaveProperty('hitRate')
    expect(metrics).toHaveProperty('mrr')
    expect(metrics).toHaveProperty('precisionAtK')
    expect(metrics).toHaveProperty('recallAtK')
    expect(metrics).toHaveProperty('ndcgAtK')

    expect(metrics.hitRate).toBeGreaterThanOrEqual(0)
    expect(metrics.hitRate).toBeLessThanOrEqual(1)
    expect(metrics.mrr).toBeGreaterThan(0)
    expect(metrics.precisionAtK).toBeGreaterThan(0)
    expect(metrics.recallAtK).toBeGreaterThan(0)
    expect(metrics.ndcgAtK).toBeGreaterThan(0)
  })

  it('returns all zeros for empty results', () => {
    const metrics = aggregateMetrics([], 5)
    expect(metrics.hitRate).toBe(0)
    expect(metrics.mrr).toBe(0)
    expect(metrics.precisionAtK).toBe(0)
    expect(metrics.recallAtK).toBe(0)
    expect(metrics.ndcgAtK).toBe(0)
  })
})
