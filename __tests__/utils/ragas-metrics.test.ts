import { describe, it, expect } from 'vitest';
import {
  contextPrecision,
  contextRecall,
  contextRelevancy,
  ragasRetrievalMetrics,
  aggregateRagasMetrics,
} from './ragas-metrics.js';

describe('contextPrecision (Average Precision)', () => {
  it('returns 1.0 when all relevant items are at the top', () => {
    const retrieved = ['a', 'b', 'c', 'd', 'e'];
    const relevant = new Set(['a', 'b']);
    expect(contextPrecision(retrieved, relevant)).toBeCloseTo(1.0);
  });

  it('penalizes relevant items ranked lower', () => {
    const retrieved = ['x', 'a', 'y', 'b', 'z'];
    const relevant = new Set(['a', 'b']);
    expect(contextPrecision(retrieved, relevant)).toBeCloseTo(0.5);
  });

  it('returns 0 when no relevant items are retrieved', () => {
    const retrieved = ['x', 'y', 'z'];
    const relevant = new Set(['a', 'b']);
    expect(contextPrecision(retrieved, relevant)).toBe(0);
  });

  it('returns 0 for empty retrieved list', () => {
    expect(contextPrecision([], new Set(['a']))).toBe(0);
  });

  it('returns 0 for empty relevant set', () => {
    expect(contextPrecision(['a', 'b'], new Set())).toBe(0);
  });

  it('handles single relevant item at rank 1', () => {
    const retrieved = ['a', 'b', 'c'];
    const relevant = new Set(['a']);
    expect(contextPrecision(retrieved, relevant)).toBeCloseTo(1.0);
  });

  it('handles single relevant item at last rank', () => {
    const retrieved = ['x', 'y', 'a'];
    const relevant = new Set(['a']);
    expect(contextPrecision(retrieved, relevant)).toBeCloseTo(1 / 3);
  });
});

describe('contextRecall', () => {
  it('returns 1.0 when all relevant items are retrieved', () => {
    const retrieved = ['a', 'b', 'c'];
    const relevant = new Set(['a', 'b']);
    expect(contextRecall(retrieved, relevant)).toBeCloseTo(1.0);
  });

  it('returns 0.5 when half of relevant items are retrieved', () => {
    const retrieved = ['a', 'x', 'y'];
    const relevant = new Set(['a', 'b']);
    expect(contextRecall(retrieved, relevant)).toBeCloseTo(0.5);
  });

  it('returns 0 when no relevant items are retrieved', () => {
    const retrieved = ['x', 'y', 'z'];
    const relevant = new Set(['a', 'b']);
    expect(contextRecall(retrieved, relevant)).toBe(0);
  });

  it('returns 0 for empty relevant set', () => {
    expect(contextRecall(['a'], new Set())).toBe(0);
  });

  it('returns 0 for empty retrieved list', () => {
    expect(contextRecall([], new Set(['a']))).toBe(0);
  });
});

describe('contextRelevancy', () => {
  it('returns 1.0 when all retrieved items are relevant', () => {
    const retrieved = ['a', 'b'];
    const relevant = new Set(['a', 'b', 'c']);
    expect(contextRelevancy(retrieved, relevant)).toBeCloseTo(1.0);
  });

  it('returns 0.4 when 2 of 5 retrieved items are relevant', () => {
    const retrieved = ['a', 'x', 'b', 'y', 'z'];
    const relevant = new Set(['a', 'b']);
    expect(contextRelevancy(retrieved, relevant)).toBeCloseTo(0.4);
  });

  it('returns 0 for empty retrieved list', () => {
    expect(contextRelevancy([], new Set(['a']))).toBe(0);
  });

  it('returns 0 when no retrieved items are relevant', () => {
    const retrieved = ['x', 'y', 'z'];
    const relevant = new Set(['a', 'b']);
    expect(contextRelevancy(retrieved, relevant)).toBe(0);
  });
});

describe('ragasRetrievalMetrics', () => {
  it('computes all three metrics for a single query', () => {
    const retrieved = ['a', 'x', 'b', 'y', 'z'];
    const relevant = new Set(['a', 'b']);

    const metrics = ragasRetrievalMetrics(retrieved, relevant);

    expect(metrics.contextPrecision).toBeCloseTo(0.5 * (1 + 2 / 3));
    expect(metrics.contextRecall).toBeCloseTo(1.0);
    expect(metrics.contextRelevancy).toBeCloseTo(0.4);
  });
});

describe('aggregateRagasMetrics', () => {
  it('averages metrics across multiple queries', () => {
    const results = [
      { retrieved: ['a', 'b'], relevant: new Set(['a', 'b']) },
      { retrieved: ['x', 'y'], relevant: new Set(['a', 'b']) },
    ];

    const agg = aggregateRagasMetrics(results);

    expect(agg.contextPrecision).toBeCloseTo(0.5);
    expect(agg.contextRecall).toBeCloseTo(0.5);
    expect(agg.contextRelevancy).toBeCloseTo(0.5);
  });

  it('returns zeros for empty input', () => {
    const agg = aggregateRagasMetrics([]);
    expect(agg.contextPrecision).toBe(0);
    expect(agg.contextRecall).toBe(0);
    expect(agg.contextRelevancy).toBe(0);
  });
});
