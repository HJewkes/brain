import { describe, it, expect } from 'vitest';
import { parseSessionRef } from '../../../src/modules/sessions/engine/resolve-ref.js';

describe('parseSessionRef', () => {
  it('recognises a lowercase UUID', () => {
    const raw = '550e8400-e29b-41d4-a716-446655440000';

    const result = parseSessionRef(raw);

    expect(result).toEqual({ type: 'uuid', sessionId: raw });
  });

  it('recognises an uppercase UUID', () => {
    const raw = '550E8400-E29B-41D4-A716-446655440000';

    const result = parseSessionRef(raw);

    expect(result).toEqual({ type: 'uuid', sessionId: raw });
  });

  it('recognises a display ID (SNS-001)', () => {
    const result = parseSessionRef('SNS-001');

    expect(result).toEqual({ type: 'display_id', displayId: 'SNS-001' });
  });

  it('normalises a lowercase display ID to uppercase', () => {
    const result = parseSessionRef('sns-042');

    expect(result).toEqual({ type: 'display_id', displayId: 'SNS-042' });
  });

  it('recognises a display ID with more than three digits', () => {
    const result = parseSessionRef('SNS-1234');

    expect(result).toEqual({ type: 'display_id', displayId: 'SNS-1234' });
  });

  it('recognises a PM task ID (VNM-08.04)', () => {
    const result = parseSessionRef('VNM-08.04');

    expect(result).toEqual({ type: 'task', taskId: 'VNM-08.04' });
  });

  it('recognises a PM task ID with a longer numeric suffix', () => {
    const result = parseSessionRef('ABC-01.001');

    expect(result).toEqual({ type: 'task', taskId: 'ABC-01.001' });
  });

  it('recognises "yesterday" case-insensitively', () => {
    expect(parseSessionRef('yesterday')).toEqual({ type: 'yesterday' });
    expect(parseSessionRef('YESTERDAY')).toEqual({ type: 'yesterday' });
    expect(parseSessionRef('Yesterday')).toEqual({ type: 'yesterday' });
  });

  it('recognises "last" case-insensitively', () => {
    expect(parseSessionRef('last')).toEqual({ type: 'last' });
    expect(parseSessionRef('LAST')).toEqual({ type: 'last' });
    expect(parseSessionRef('Last')).toEqual({ type: 'last' });
  });

  it('falls back to keyword for generic text', () => {
    const result = parseSessionRef('implement search feature');

    expect(result).toEqual({ type: 'keyword', query: 'implement search feature' });
  });

  it('falls back to keyword for a partial UUID-like string', () => {
    // Does not have all four groups so should not match UUID
    const result = parseSessionRef('550e8400-e29b-41d4');

    expect(result).toEqual({ type: 'keyword', query: '550e8400-e29b-41d4' });
  });

  it('falls back to keyword for an SNS prefix without the required digit count', () => {
    // SNS-01 has only two digits — below the three-digit minimum
    const result = parseSessionRef('SNS-01');

    expect(result).toEqual({ type: 'keyword', query: 'SNS-01' });
  });
});
