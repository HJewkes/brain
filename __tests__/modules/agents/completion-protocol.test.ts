import { describe, it, expect } from 'vitest';
import {
  parseCompletionMessage,
  isCompletionMessage,
} from '../../../src/modules/agents/completion-protocol.js';

describe('parseCompletionMessage', () => {
  it('parses DONE with task ID and summary', () => {
    const result = parseCompletionMessage('DONE VNM-12.02 Added render-prompt subcommand');
    expect(result).toEqual({
      status: 'done',
      taskId: 'VNM-12.02',
      summary: 'Added render-prompt subcommand',
    });
  });

  it('parses DONE with task ID only', () => {
    const result = parseCompletionMessage('DONE VNM-12.02');
    expect(result).toEqual({
      status: 'done',
      taskId: 'VNM-12.02',
      summary: '',
    });
  });

  it('parses FAILED with task ID and reason', () => {
    const result = parseCompletionMessage('FAILED VNM-12.03 Merge conflict in file-ownership.ts');
    expect(result).toEqual({
      status: 'failed',
      taskId: 'VNM-12.03',
      summary: 'Merge conflict in file-ownership.ts',
    });
  });

  it('parses multiline summary', () => {
    const result = parseCompletionMessage('DONE VNM-01.01 Line 1\nLine 2\nLine 3');
    expect(result).not.toBeNull();
    expect(result!.summary).toBe('Line 1\nLine 2\nLine 3');
  });

  it('handles leading/trailing whitespace', () => {
    const result = parseCompletionMessage('  DONE VNM-12.02 Summary  ');
    expect(result).not.toBeNull();
    expect(result!.taskId).toBe('VNM-12.02');
    expect(result!.summary).toBe('Summary');
  });

  it('returns null for unrecognized format', () => {
    expect(parseCompletionMessage('Hello world')).toBeNull();
    expect(parseCompletionMessage('')).toBeNull();
    expect(parseCompletionMessage('COMPLETE VNM-12.02')).toBeNull();
  });

  it('returns null for DONE/FAILED without task ID', () => {
    expect(parseCompletionMessage('DONE')).toBeNull();
    expect(parseCompletionMessage('FAILED')).toBeNull();
  });
});

describe('isCompletionMessage', () => {
  it('returns true for DONE messages', () => {
    expect(isCompletionMessage('DONE VNM-12.02 summary')).toBe(true);
  });

  it('returns true for FAILED messages', () => {
    expect(isCompletionMessage('FAILED VNM-12.02 reason')).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(isCompletionMessage('done VNM-12.02')).toBe(true);
    expect(isCompletionMessage('Failed VNM-12.02')).toBe(true);
  });

  it('returns false for non-protocol messages', () => {
    expect(isCompletionMessage('Hello coordinator')).toBe(false);
    expect(isCompletionMessage('The task is done')).toBe(false);
    expect(isCompletionMessage('')).toBe(false);
  });
});
