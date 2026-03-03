import { describe, it, expect } from 'vitest';
import {
  levenshtein,
  fuzzyMatch,
  resolveUnknownCommand,
  KNOWN_COMMANDS,
  HELP_GROUPS,
} from '../../../src/modules/pm/engine/command-resolution.js';

describe('command resolution - Tier 1: fuzzy match', () => {
  it('corrects "taks" to "task"', () => {
    expect(fuzzyMatch('taks')).toBe('task');
  });

  it('corrects "wavs" to "waves"', () => {
    expect(fuzzyMatch('wavs')).toBe('waves');
  });

  it('corrects "disptch" to "dispatch"', () => {
    expect(fuzzyMatch('disptch')).toBe('dispatch');
  });

  it('returns null for distant strings', () => {
    expect(fuzzyMatch('xyzabc')).toBeNull();
  });

  it('exact match returns itself', () => {
    expect(fuzzyMatch('task')).toBe('task');
  });

  it('handles case-insensitive input', () => {
    expect(fuzzyMatch('TASK')).toBe('task');
  });

  it('corrects "contxt" to "context"', () => {
    expect(fuzzyMatch('contxt')).toBe('context');
  });
});

describe('command resolution - levenshtein', () => {
  it('identical strings have distance 0', () => {
    expect(levenshtein('abc', 'abc')).toBe(0);
  });

  it('single deletion has distance 1', () => {
    expect(levenshtein('abc', 'ab')).toBe(1);
  });

  it('single insertion has distance 1', () => {
    expect(levenshtein('ab', 'abc')).toBe(1);
  });

  it('single substitution has distance 1', () => {
    expect(levenshtein('abc', 'axc')).toBe(1);
  });

  it('empty vs non-empty is length of non-empty', () => {
    expect(levenshtein('', 'abc')).toBe(3);
    expect(levenshtein('abc', '')).toBe(3);
  });
});

describe('command resolution - Tier 3: help menu', () => {
  it('help groups cover all major command categories', () => {
    expect(Object.keys(HELP_GROUPS).length).toBeGreaterThanOrEqual(6);
  });

  it('each group has at least 2 commands', () => {
    for (const [, cmds] of Object.entries(HELP_GROUPS)) {
      expect(cmds.length).toBeGreaterThanOrEqual(2);
    }
  });

  it('known commands list includes core commands', () => {
    expect(KNOWN_COMMANDS).toContain('task');
    expect(KNOWN_COMMANDS).toContain('workstream');
    expect(KNOWN_COMMANDS).toContain('project');
    expect(KNOWN_COMMANDS).toContain('dispatch');
    expect(KNOWN_COMMANDS).toContain('list');
  });
});

describe('resolveUnknownCommand', () => {
  it('returns tier 1 for close match', async () => {
    const result = await resolveUnknownCommand('taks');
    expect(result.tier).toBe(1);
    expect(result.suggestion).toBe('task');
    expect(result.message).toContain('Did you mean');
  });

  it('returns tier 3 for distant string without db', async () => {
    const result = await resolveUnknownCommand('dependencies');
    expect(result.tier).toBe(3);
    expect(result.message).toContain('Available commands');
    expect(result.message).toContain('Planning');
  });

  it('skips tier 2 when db/embedder not provided', async () => {
    const result = await resolveUnknownCommand('something-very-far');
    expect(result.tier).toBe(3);
  });
});
