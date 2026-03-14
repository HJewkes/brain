import { describe, it, expect } from 'vitest';
import { resolveFormat, isJsonFormat } from '../../src/commands/format.js';

describe('resolveFormat', () => {
  it('returns json when opts.json is true', () => {
    expect(resolveFormat({ json: true })).toBe('json');
  });

  it('returns plain when no flags set', () => {
    expect(resolveFormat({})).toBe('plain');
  });

  it('returns json when opts.format is json', () => {
    expect(resolveFormat({ format: 'json' })).toBe('json');
  });

  it('returns plain when opts.format is plain', () => {
    expect(resolveFormat({ format: 'plain' })).toBe('plain');
  });

  it('format flag takes priority over json flag', () => {
    expect(resolveFormat({ json: true, format: 'plain' })).toBe('plain');
  });

  it('picks up parent format from cmd', () => {
    const cmd = { parent: { opts: () => ({ format: 'json' }) } };
    expect(resolveFormat({}, cmd)).toBe('json');
  });

  it('local opts override parent format', () => {
    const cmd = { parent: { opts: () => ({ format: 'json' }) } };
    expect(resolveFormat({ format: 'plain' }, cmd)).toBe('plain');
  });

  it('handles null parent gracefully', () => {
    const cmd = { parent: null };
    expect(resolveFormat({}, cmd)).toBe('plain');
  });
});

describe('isJsonFormat', () => {
  it('returns true for json format', () => {
    expect(isJsonFormat({ json: true })).toBe(true);
  });

  it('returns false for plain format', () => {
    expect(isJsonFormat({})).toBe(false);
  });

  it('returns true when parent has format json', () => {
    const cmd = { parent: { opts: () => ({ format: 'json' }) } };
    expect(isJsonFormat({}, cmd)).toBe(true);
  });
});
