import { describe, it, expect } from 'vitest';
import { smartTruncate } from '../../src/services/truncation.js';

describe('smartTruncate', () => {
  it('returns input unchanged when under maxBytes', () => {
    const input = 'short text';
    const result = smartTruncate(input, { maxBytes: 1000 });
    expect(result.text).toBe(input);
    expect(result.truncated).toBe(false);
    expect(result.originalLines).toBe(1);
    expect(result.omittedLines).toBe(0);
  });

  it('returns empty string unchanged', () => {
    const result = smartTruncate('', { maxBytes: 100 });
    expect(result.text).toBe('');
    expect(result.truncated).toBe(false);
    expect(result.originalLines).toBe(1);
    expect(result.omittedLines).toBe(0);
  });

  it('returns single-line input unchanged when under limit', () => {
    const input = 'just one line';
    const result = smartTruncate(input, { maxBytes: 1000 });
    expect(result.text).toBe(input);
    expect(result.truncated).toBe(false);
  });

  it('truncates and inserts separator when over maxBytes', () => {
    const lines = Array.from({ length: 100 }, (_, i) => `line ${i + 1}`);
    const input = lines.join('\n');
    const result = smartTruncate(input, { maxBytes: 300 });

    expect(result.truncated).toBe(true);
    expect(result.text).toContain('lines omitted');
    expect(result.originalLines).toBe(100);
    expect(result.omittedLines).toBeGreaterThan(0);
    expect(Buffer.byteLength(result.text, 'utf-8')).toBeLessThanOrEqual(300);
  });

  it('preserves 60/40 head/tail ratio', () => {
    const lines = Array.from({ length: 100 }, (_, i) => `L${i}`);
    const input = lines.join('\n');
    const result = smartTruncate(input, { maxBytes: 200 });

    expect(result.truncated).toBe(true);
    const parts = result.text.split(/\n--- \d+ lines omitted ---\n/);
    expect(parts.length).toBe(2);
    const headLines = parts[0].split('\n').length;
    const tailLines = parts[1].split('\n').length;
    expect(headLines).toBeGreaterThanOrEqual(tailLines);
  });

  it('separator includes omitted line count', () => {
    const lines = Array.from({ length: 50 }, (_, i) => `line ${i}`);
    const input = lines.join('\n');
    const result = smartTruncate(input, { maxBytes: 200 });

    expect(result.truncated).toBe(true);
    const match = result.text.match(/--- (\d+) lines omitted ---/);
    expect(match).not.toBeNull();
    expect(Number(match![1])).toBe(result.omittedLines);
  });

  it('respects custom headRatio of 0.5', () => {
    const lines = Array.from({ length: 100 }, (_, i) => `L${i}`);
    const input = lines.join('\n');
    const result = smartTruncate(input, { maxBytes: 200, headRatio: 0.5 });

    expect(result.truncated).toBe(true);
    const parts = result.text.split(/\n--- \d+ lines omitted ---\n/);
    expect(parts.length).toBe(2);
    const headLines = parts[0].split('\n').length;
    const tailLines = parts[1].split('\n').length;
    // With 0.5 ratio, head and tail should be roughly equal
    expect(Math.abs(headLines - tailLines)).toBeLessThanOrEqual(headLines * 0.5);
  });

  it('uses custom separator when provided', () => {
    const lines = Array.from({ length: 50 }, (_, i) => `line ${i}`);
    const input = lines.join('\n');
    const result = smartTruncate(input, { maxBytes: 200, separator: '\n[...]\n' });

    expect(result.truncated).toBe(true);
    expect(result.text).toContain('[...]');
    expect(result.text).not.toContain('lines omitted');
  });

  it('handles unicode content with correct byte counting', () => {
    // Each emoji is 4 bytes in UTF-8
    const lines = Array.from({ length: 20 }, (_, i) => `\u{1F600} line ${i}`);
    const input = lines.join('\n');
    const inputBytes = Buffer.byteLength(input, 'utf-8');
    const cap = Math.floor(inputBytes * 0.5);

    const result = smartTruncate(input, { maxBytes: cap });
    expect(result.truncated).toBe(true);
    expect(Buffer.byteLength(result.text, 'utf-8')).toBeLessThanOrEqual(cap);
  });

  it('handles very small maxBytes by returning at least first and last line', () => {
    const lines = Array.from({ length: 10 }, (_, i) => `line ${i}`);
    const input = lines.join('\n');
    const result = smartTruncate(input, { maxBytes: 60 });

    expect(result.truncated).toBe(true);
    expect(result.text).toContain('line 0');
    expect(result.text).toContain('line 9');
    expect(result.omittedLines).toBeGreaterThan(0);
  });

  it('output never exceeds maxBytes', () => {
    const lines = Array.from({ length: 200 }, (_, i) => `data row ${i}: ${'x'.repeat(50)}`);
    const input = lines.join('\n');
    const cap = 2000;
    const result = smartTruncate(input, { maxBytes: cap });

    expect(result.truncated).toBe(true);
    expect(Buffer.byteLength(result.text, 'utf-8')).toBeLessThanOrEqual(cap);
  });

  it('reports correct originalLines count', () => {
    const lines = Array.from({ length: 42 }, (_, i) => `line ${i}`);
    const input = lines.join('\n');
    const result = smartTruncate(input, { maxBytes: 100 });

    expect(result.originalLines).toBe(42);
  });
});
