import { describe, it, expect } from 'vitest';
import { formatDuration } from '../../../src/modules/autoloop/engine/format-utils.js';

describe('formatDuration', () => {
  it('formats sub-minute durations as seconds', () => {
    expect(formatDuration(5000)).toBe('5s');
    expect(formatDuration(45_000)).toBe('45s');
  });

  it('formats exact minutes without remainder', () => {
    expect(formatDuration(60_000)).toBe('1m');
    expect(formatDuration(300_000)).toBe('5m');
  });

  it('formats minutes with seconds remainder', () => {
    expect(formatDuration(90_000)).toBe('1m 30s');
    expect(formatDuration(125_000)).toBe('2m 5s');
  });

  it('rounds milliseconds to nearest second', () => {
    expect(formatDuration(1499)).toBe('1s');
    expect(formatDuration(1500)).toBe('2s');
  });

  it('formats zero duration', () => {
    expect(formatDuration(0)).toBe('0s');
  });
});
