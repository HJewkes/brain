import { describe, it, expect } from 'vitest';
import { replaceFrontmatterField } from '../../src/utils.js';

const doc = (fields: string, body = '') => `---\n${fields}\n---\n${body}`;

describe('replaceFrontmatterField', () => {
  it('replaces an existing field value', () => {
    const input = doc('status: draft\ntitle: hello');
    const result = replaceFrontmatterField(input, 'status', 'done');
    expect(result).toContain('status: done');
    expect(result).not.toContain('draft');
  });

  it('inserts a new field when not present', () => {
    const input = doc('title: hello');
    const result = replaceFrontmatterField(input, 'status', 'draft');
    expect(result).toContain('status: draft');
    expect(result).toContain('title: hello');
  });

  it('returns content unchanged when no frontmatter closing fence', () => {
    const input = '---\ntitle: hello\nno closing fence';
    expect(replaceFrontmatterField(input, 'status', 'done')).toBe(input);
  });

  it('quotes values containing spaces', () => {
    const input = doc('status: draft');
    const result = replaceFrontmatterField(input, 'status', 'in progress');
    expect(result).toContain('status: "in progress"');
  });

  it('quotes date-like values', () => {
    const input = doc('title: hello');
    const result = replaceFrontmatterField(input, 'due', '2026-03-13');
    expect(result).toContain('due: "2026-03-13"');
  });

  it('does not double-quote already single-quoted values', () => {
    const input = doc('title: hello');
    const result = replaceFrontmatterField(input, 'name', "'my value'");
    expect(result).toContain("name: 'my value'");
    expect(result).not.toContain('"\'');
  });

  it('does not double-quote already double-quoted values', () => {
    const input = doc('title: hello');
    const result = replaceFrontmatterField(input, 'name', '"my value"');
    expect(result).toContain('name: "my value"');
  });

  it('removes field when value is empty and field exists', () => {
    const input = doc('status: draft\ntitle: hello');
    const result = replaceFrontmatterField(input, 'status', '');
    expect(result).not.toContain('status');
    expect(result).toContain('title: hello');
  });

  it('returns content unchanged when value is empty and field does not exist', () => {
    const input = doc('title: hello');
    const result = replaceFrontmatterField(input, 'status', '');
    expect(result).toBe(input);
  });

  it('preserves body content after frontmatter', () => {
    const input = doc('status: draft', 'Some body text here');
    const result = replaceFrontmatterField(input, 'status', 'done');
    expect(result).toContain('Some body text here');
  });

  it('does not quote simple values without spaces', () => {
    const input = doc('title: hello');
    const result = replaceFrontmatterField(input, 'status', 'done');
    expect(result).toContain('status: done');
    expect(result).not.toContain('"done"');
  });
});
