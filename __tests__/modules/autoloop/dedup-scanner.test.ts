import { describe, it, expect } from 'vitest';
import { cosineSimilarity } from '../../../src/modules/autoloop/engine/dedup-scanner.js';

describe('cosineSimilarity', () => {
  it('returns 1.0 for identical vectors', () => {
    const v = [1, 2, 3, 4, 5];
    expect(cosineSimilarity(v, v)).toBeCloseTo(1.0);
  });

  it('returns 0.0 for orthogonal vectors', () => {
    const a = [1, 0, 0];
    const b = [0, 1, 0];
    expect(cosineSimilarity(a, b)).toBeCloseTo(0.0);
  });

  it('returns -1.0 for opposite vectors', () => {
    const a = [1, 0, 0];
    const b = [-1, 0, 0];
    expect(cosineSimilarity(a, b)).toBeCloseTo(-1.0);
  });

  it('returns correct similarity for arbitrary vectors', () => {
    const a = [1, 2, 3];
    const b = [4, 5, 6];
    // dot=32, normA=14, normB=77 → 32/sqrt(14*77) ≈ 0.9746
    expect(cosineSimilarity(a, b)).toBeCloseTo(0.9746, 3);
  });

  it('handles zero vectors gracefully', () => {
    const a = [0, 0, 0];
    const b = [1, 2, 3];
    const sim = cosineSimilarity(a, b);
    expect(Number.isFinite(sim)).toBe(true);
  });

  it('is symmetric', () => {
    const a = [1, 3, -2, 4];
    const b = [2, -1, 5, 3];
    expect(cosineSimilarity(a, b)).toBeCloseTo(cosineSimilarity(b, a));
  });
});
