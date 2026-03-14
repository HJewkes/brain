import { describe, it, expect } from 'vitest';
import {
  renderTemplate,
  findUnfilledPlaceholders,
} from '../../../src/modules/agents/template-renderer.js';

describe('renderTemplate', () => {
  it('fills simple placeholders', () => {
    const template = 'Task: {TASK_ID} — {TITLE}';
    const result = renderTemplate(template, { TASK_ID: 'VNM-12.02', TITLE: 'Add feature' });
    expect(result).toBe('Task: VNM-12.02 — Add feature');
  });

  it('fills repeated placeholders', () => {
    const template = '{TASK_ID} start\n{TASK_ID} end';
    const result = renderTemplate(template, { TASK_ID: 'X-01.01' });
    expect(result).toBe('X-01.01 start\nX-01.01 end');
  });

  it('throws when a variable is undefined and placeholder remains', () => {
    const template = 'Hello {NAME}';
    expect(() => renderTemplate(template, { NAME: undefined, OTHER: 'val' })).toThrow(
      'Unfilled placeholders: {NAME}'
    );
  });

  it('throws on unfilled ALL_CAPS placeholders', () => {
    const template = 'Task: {TASK_ID} with {UNKNOWN}';
    expect(() => renderTemplate(template, { TASK_ID: 'VNM-01.01' })).toThrow(
      'Unfilled placeholders: {UNKNOWN}'
    );
  });

  it('allows lowercase/mixed-case braces (not treated as placeholders)', () => {
    const template = 'Code: {foo} and {Bar}';
    const result = renderTemplate(template, {});
    expect(result).toBe('Code: {foo} and {Bar}');
  });

  it('handles empty template', () => {
    const result = renderTemplate('', {});
    expect(result).toBe('');
  });

  it('handles template with no placeholders', () => {
    const result = renderTemplate('Just plain text', { TASK_ID: 'X' });
    expect(result).toBe('Just plain text');
  });
});

describe('findUnfilledPlaceholders', () => {
  it('finds ALL_CAPS placeholders', () => {
    const text = '{TASK_ID} and {TITLE} and {TASK_ID}';
    const result = findUnfilledPlaceholders(text);
    expect(result).toEqual(['{TASK_ID}', '{TITLE}']);
  });

  it('returns empty for no placeholders', () => {
    expect(findUnfilledPlaceholders('no placeholders here')).toEqual([]);
  });

  it('ignores lowercase braces', () => {
    expect(findUnfilledPlaceholders('{foo} {bar}')).toEqual([]);
  });

  it('matches single-letter caps', () => {
    expect(findUnfilledPlaceholders('{X}')).toEqual(['{X}']);
  });
});
