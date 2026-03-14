import { describe, it, expect } from 'vitest';
import { formatOutput } from '../../src/services/output-formatter.js';
import { resolveFormat } from '../../src/commands/format.js';

describe('output-formatter', () => {
  const sampleData = [
    { name: 'Alice', age: 30, role: 'engineer' },
    { name: 'Bob', age: 25, role: 'designer' },
  ];

  describe('formatOutput - json', () => {
    it('produces indented JSON', () => {
      const result = formatOutput(sampleData, 'json');
      const parsed = JSON.parse(result);

      expect(parsed).toEqual(sampleData);
      expect(result).toContain('\n');
    });

    it('handles empty array', () => {
      const result = formatOutput([], 'json');
      expect(result).toBe('[]');
    });
  });

  describe('formatOutput - table', () => {
    it('renders column-aligned table with headers', () => {
      const result = formatOutput(sampleData, 'table');
      const lines = result.split('\n');

      expect(lines.length).toBe(4);
      expect(lines[0]).toContain('name');
      expect(lines[0]).toContain('age');
      expect(lines[0]).toContain('role');
      expect(lines[1]).toMatch(/^-+\s+-+\s+-+$/);
      expect(lines[2]).toContain('Alice');
      expect(lines[3]).toContain('Bob');
    });

    it('returns empty string for empty array', () => {
      expect(formatOutput([], 'table')).toBe('');
    });

    it('respects columns option', () => {
      const result = formatOutput(sampleData, 'table', { columns: ['name', 'role'] });
      const header = result.split('\n')[0];

      expect(header).toContain('name');
      expect(header).toContain('role');
      expect(header).not.toContain('age');
    });

    it('handles values wider than headers', () => {
      const data = [{ label: 'a very long label value here' }];
      const result = formatOutput(data, 'table');
      const lines = result.split('\n');

      expect(lines[1].length).toBeGreaterThanOrEqual('a very long label value here'.length);
    });

    it('handles null and undefined values', () => {
      const data = [{ a: null, b: undefined, c: 'ok' }];
      const result = formatOutput(data, 'table');

      expect(result).toContain('ok');
    });
  });

  describe('formatOutput - plain', () => {
    it('renders key-value pairs per row', () => {
      const result = formatOutput(sampleData, 'plain');
      const lines = result.split('\n');

      expect(lines.length).toBe(2);
      expect(lines[0]).toContain('name: Alice');
      expect(lines[0]).toContain('age: 30');
      expect(lines[1]).toContain('name: Bob');
    });

    it('handles empty array', () => {
      expect(formatOutput([], 'plain')).toBe('');
    });
  });

  describe('resolveFormat', () => {
    it('defaults to plain', () => {
      expect(resolveFormat({})).toBe('plain');
    });

    it('respects --format json', () => {
      expect(resolveFormat({ format: 'json' })).toBe('json');
    });

    it('respects --format table', () => {
      expect(resolveFormat({ format: 'table' })).toBe('table');
    });

    it('respects --format plain', () => {
      expect(resolveFormat({ format: 'plain' })).toBe('plain');
    });

    it('treats --json as --format json for backward compat', () => {
      expect(resolveFormat({ json: true })).toBe('json');
    });

    it('--format takes precedence over --json', () => {
      expect(resolveFormat({ json: true, format: 'plain' })).toBe('plain');
    });

    it('inherits format from parent command', () => {
      const cmd = { parent: { opts: () => ({ format: 'json' }) } };
      expect(resolveFormat({}, cmd)).toBe('json');
    });

    it('inherits table format from parent command', () => {
      const cmd = { parent: { opts: () => ({ format: 'table' }) } };
      expect(resolveFormat({}, cmd)).toBe('table');
    });

    it('local option overrides parent', () => {
      const cmd = { parent: { opts: () => ({ format: 'json' }) } };
      expect(resolveFormat({ format: 'plain' }, cmd)).toBe('plain');
    });
  });
});
