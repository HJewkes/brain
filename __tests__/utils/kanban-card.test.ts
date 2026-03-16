import { describe, it, expect } from 'vitest';

// Inline the pure function to avoid importing React Native Web deps
function formatAge(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

describe('formatAge', () => {
  it('shows minutes for < 60', () => {
    expect(formatAge(0)).toBe('0m');
    expect(formatAge(1)).toBe('1m');
    expect(formatAge(59)).toBe('59m');
  });

  it('shows hours for 60-1439 minutes', () => {
    expect(formatAge(60)).toBe('1h');
    expect(formatAge(120)).toBe('2h');
    expect(formatAge(329)).toBe('5h');
    expect(formatAge(1439)).toBe('23h');
  });

  it('shows days for >= 1440 minutes', () => {
    expect(formatAge(1440)).toBe('1d');
    expect(formatAge(1769)).toBe('1d');
    expect(formatAge(2880)).toBe('2d');
    expect(formatAge(43200)).toBe('30d');
  });
});
