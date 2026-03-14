import { describe, it, expect } from 'vitest';
import { computeHotnessScore, ageDays } from '../../src/services/hotness.js';

describe('computeHotnessScore', () => {
  it('returns ~0.5 for zero access and zero age', () => {
    const score = computeHotnessScore(0, 0);
    // sigmoid(log1p(0)) = sigmoid(0) = 0.5, exp(0) = 1.0
    expect(score).toBeCloseTo(0.5, 5);
  });

  it('returns high score for high access and zero age', () => {
    const score = computeHotnessScore(100, 0);
    // sigmoid(log1p(100)) ≈ sigmoid(4.62) ≈ 0.99, recency = 1.0
    expect(score).toBeGreaterThan(0.95);
  });

  it('returns low score for high access and old age', () => {
    const score = computeHotnessScore(100, 60);
    // recency = exp(-ln2/7 * 60) ≈ 0.0027
    expect(score).toBeLessThan(0.01);
  });

  it('returns very low score for zero access and old age', () => {
    const score = computeHotnessScore(0, 60);
    // sigmoid(0) = 0.5, recency ≈ 0.0027
    expect(score).toBeLessThan(0.005);
  });

  it('halves recency at the half-life boundary', () => {
    const atZero = computeHotnessScore(10, 0, 7);
    const atHalfLife = computeHotnessScore(10, 7, 7);
    expect(atHalfLife).toBeCloseTo(atZero / 2, 5);
  });

  it('respects custom half-life', () => {
    const atZero = computeHotnessScore(5, 0, 14);
    const atHalfLife = computeHotnessScore(5, 14, 14);
    expect(atHalfLife).toBeCloseTo(atZero / 2, 5);
  });

  it('clamps negative age to zero', () => {
    const score = computeHotnessScore(10, -5);
    const atZero = computeHotnessScore(10, 0);
    expect(score).toBeCloseTo(atZero, 5);
  });
});

describe('ageDays', () => {
  it('returns 365 for null modifiedAt', () => {
    expect(ageDays(null)).toBe(365);
  });

  it('returns ~0 for today', () => {
    const now = new Date();
    const result = ageDays(now.toISOString(), now);
    expect(result).toBeCloseTo(0, 3);
  });

  it('returns ~7 for a week ago', () => {
    const now = new Date('2026-03-13T12:00:00Z');
    const weekAgo = new Date('2026-03-06T12:00:00Z');
    const result = ageDays(weekAgo.toISOString(), now);
    expect(result).toBeCloseTo(7, 3);
  });

  it('returns 0 for future dates', () => {
    const now = new Date('2026-03-13T12:00:00Z');
    const future = new Date('2026-03-20T12:00:00Z');
    const result = ageDays(future.toISOString(), now);
    expect(result).toBe(0);
  });
});
