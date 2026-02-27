import { describe, it, expect } from 'vitest';
import { estimateCost } from '../../../src/modules/pm/data/cost.js';
import { makeActivity } from '../../helpers.js';

describe('estimateCost', () => {
  it('returns zero summary for empty activities', () => {
    const result = estimateCost([]);

    expect(result.totalTokens).toBe(0);
    expect(result.estimatedCost).toBe(0);
    expect(Object.keys(result.byModel)).toHaveLength(0);
    expect(Object.keys(result.byCategory)).toHaveLength(0);
  });

  it('calculates cost for opus model', () => {
    const activities = [
      makeActivity({
        metadata: JSON.stringify({ tokens: 1_000_000, model: 'opus', category: 'implementation' }),
      }),
    ];

    const result = estimateCost(activities);

    expect(result.totalTokens).toBe(1_000_000);
    expect(result.estimatedCost).toBe(15.0);
    expect(result.byModel['opus']).toEqual({ tokens: 1_000_000, cost: 15.0 });
  });

  it('calculates cost for sonnet model', () => {
    const activities = [
      makeActivity({
        metadata: JSON.stringify({ tokens: 1_000_000, model: 'sonnet', category: 'review' }),
      }),
    ];

    const result = estimateCost(activities);

    expect(result.totalTokens).toBe(1_000_000);
    expect(result.estimatedCost).toBe(3.0);
    expect(result.byModel['sonnet']).toEqual({ tokens: 1_000_000, cost: 3.0 });
  });

  it('calculates cost for haiku model', () => {
    const activities = [
      makeActivity({
        metadata: JSON.stringify({ tokens: 1_000_000, model: 'haiku', category: 'validation' }),
      }),
    ];

    const result = estimateCost(activities);

    expect(result.totalTokens).toBe(1_000_000);
    expect(result.estimatedCost).toBe(0.25);
    expect(result.byModel['haiku']).toEqual({ tokens: 1_000_000, cost: 0.25 });
  });

  it('aggregates across multiple activities and models', () => {
    const activities = [
      makeActivity({
        metadata: JSON.stringify({ tokens: 500_000, model: 'opus', category: 'implementation' }),
      }),
      makeActivity({
        metadata: JSON.stringify({ tokens: 200_000, model: 'sonnet', category: 'review' }),
      }),
      makeActivity({
        metadata: JSON.stringify({ tokens: 300_000, model: 'opus', category: 'implementation' }),
      }),
    ];

    const result = estimateCost(activities);

    expect(result.totalTokens).toBe(1_000_000);
    expect(result.byModel['opus'].tokens).toBe(800_000);
    expect(result.byModel['sonnet'].tokens).toBe(200_000);
    expect(result.byCategory['implementation'].tokens).toBe(800_000);
    expect(result.byCategory['review'].tokens).toBe(200_000);
  });

  it('skips activities with no tokens', () => {
    const activities = [
      makeActivity({ metadata: JSON.stringify({ model: 'opus' }) }),
      makeActivity({ metadata: null }),
      makeActivity({
        metadata: JSON.stringify({ tokens: 100_000, model: 'haiku', category: 'test' }),
      }),
    ];

    const result = estimateCost(activities);

    expect(result.totalTokens).toBe(100_000);
    expect(Object.keys(result.byModel)).toHaveLength(1);
    expect(result.byModel['haiku']).toBeDefined();
  });

  it('uses default pricing for unknown models', () => {
    const activities = [
      makeActivity({
        metadata: JSON.stringify({ tokens: 1_000_000, model: 'custom-model', category: 'test' }),
      }),
    ];

    const result = estimateCost(activities);

    expect(result.totalTokens).toBe(1_000_000);
    expect(result.estimatedCost).toBe(3.0);
  });

  it('falls back to activityType when no category in metadata', () => {
    const activities = [
      makeActivity({
        activityType: 'task_execution',
        metadata: JSON.stringify({ tokens: 50_000, model: 'sonnet' }),
      }),
    ];

    const result = estimateCost(activities);

    expect(result.byCategory['task_execution']).toBeDefined();
    expect(result.byCategory['task_execution'].tokens).toBe(50_000);
  });

  it('matches model names containing known prefixes', () => {
    const activities = [
      makeActivity({
        metadata: JSON.stringify({ tokens: 1_000_000, model: 'claude-opus-4-latest' }),
      }),
    ];

    const result = estimateCost(activities);

    expect(result.estimatedCost).toBe(15.0);
  });
});
