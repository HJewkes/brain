import { describe, it, expect } from 'vitest';
import {
  extractTerms,
  scoreTerm,
  levenshtein,
  maxEditDistance,
  findCorrection,
  correctQuery,
  type VocabEntry,
} from '../../src/services/vocabulary.js';

describe('extractTerms', () => {
  it('extracts lowercase terms from text', () => {
    const terms = extractTerms('Velocity-Based Training fundamentals and methods');
    expect(terms.has('velocity-based')).toBe(true);
    expect(terms.has('training')).toBe(true);
    expect(terms.has('fundamentals')).toBe(true);
    expect(terms.has('methods')).toBe(true);
  });

  it('filters stop words', () => {
    const terms = extractTerms('the quick and the lazy fox');
    expect(terms.has('the')).toBe(false);
    expect(terms.has('and')).toBe(false);
    expect(terms.has('quick')).toBe(true);
    expect(terms.has('lazy')).toBe(true);
  });

  it('filters terms shorter than 3 characters', () => {
    const terms = extractTerms('a is of to in velocity');
    expect(terms.size).toBe(1);
    expect(terms.has('velocity')).toBe(true);
  });

  it('handles empty text', () => {
    expect(extractTerms('').size).toBe(0);
  });

  it('handles identifier-like terms', () => {
    const terms = extractTerms('the BLE_protocol uses snake_case naming');
    expect(terms.has('ble_protocol')).toBe(true);
    expect(terms.has('snake_case')).toBe(true);
    expect(terms.has('naming')).toBe(true);
  });
});

describe('scoreTerm', () => {
  it('assigns higher IDF to rarer terms', () => {
    const commonScore = scoreTerm('common', 50, 100);
    const rareScore = scoreTerm('rare', 2, 100);
    expect(rareScore).toBeGreaterThan(commonScore);
  });

  it('gives length bonus for longer terms', () => {
    const shortScore = scoreTerm('abc', 10, 100);
    const longScore = scoreTerm('abcdefghij', 10, 100);
    expect(longScore).toBeGreaterThan(shortScore);
  });

  it('gives identifier bonus for snake_case terms', () => {
    const regularScore = scoreTerm('regular', 10, 100);
    const identScore = scoreTerm('snake_case', 10, 100);
    expect(identScore).toBeGreaterThan(regularScore);
  });

  it('handles zero total docs', () => {
    expect(scoreTerm('term', 0, 0)).toBeGreaterThan(0);
  });
});

describe('levenshtein', () => {
  it('returns 0 for identical strings', () => {
    expect(levenshtein('hello', 'hello')).toBe(0);
  });

  it('returns correct distance for substitution', () => {
    expect(levenshtein('cat', 'bat')).toBe(1);
  });

  it('returns correct distance for insertion', () => {
    expect(levenshtein('cat', 'cats')).toBe(1);
  });

  it('returns correct distance for deletion', () => {
    expect(levenshtein('cats', 'cat')).toBe(1);
  });

  it('handles empty strings', () => {
    expect(levenshtein('', 'abc')).toBe(3);
    expect(levenshtein('abc', '')).toBe(3);
    expect(levenshtein('', '')).toBe(0);
  });

  it('computes multi-edit distances', () => {
    expect(levenshtein('kitten', 'sitting')).toBe(3);
  });
});

describe('maxEditDistance', () => {
  it('returns 1 for short words (<=4 chars)', () => {
    expect(maxEditDistance(3)).toBe(1);
    expect(maxEditDistance(4)).toBe(1);
  });

  it('returns 2 for medium words (5-12 chars)', () => {
    expect(maxEditDistance(5)).toBe(2);
    expect(maxEditDistance(8)).toBe(2);
    expect(maxEditDistance(12)).toBe(2);
  });

  it('returns 3 for long words (>12 chars)', () => {
    expect(maxEditDistance(13)).toBe(3);
    expect(maxEditDistance(20)).toBe(3);
  });
});

describe('findCorrection', () => {
  const vocab: VocabEntry[] = [
    { term: 'velocity', docFrequency: 10, score: 3.0 },
    { term: 'training', docFrequency: 8, score: 2.5 },
    { term: 'threshold', docFrequency: 5, score: 3.5 },
    { term: 'bluetooth', docFrequency: 3, score: 4.0 },
  ];

  it('returns exact match unchanged', () => {
    expect(findCorrection('velocity', vocab)).toBe('velocity');
  });

  it('corrects single-character typo', () => {
    expect(findCorrection('velociry', vocab)).toBe('velocity');
  });

  it('corrects two-character typo in long word', () => {
    expect(findCorrection('bluatooth', vocab)).toBe('bluetooth');
  });

  it('returns original when no close match exists', () => {
    expect(findCorrection('xyzzy', vocab)).toBe('xyzzy');
  });

  it('prefers higher-scored term when distances are equal', () => {
    const ambiguousVocab: VocabEntry[] = [
      { term: 'fast', docFrequency: 10, score: 1.0 },
      { term: 'fist', docFrequency: 2, score: 5.0 },
    ];
    expect(findCorrection('fest', ambiguousVocab)).toBe('fist');
  });
});

describe('correctQuery', () => {
  const vocab: VocabEntry[] = [
    { term: 'velocity', docFrequency: 10, score: 3.0 },
    { term: 'training', docFrequency: 8, score: 2.5 },
    { term: 'bluetooth', docFrequency: 3, score: 4.0 },
  ];

  it('corrects misspelled terms in a query', () => {
    const { corrected, didCorrect } = correctQuery('velociry trainng', vocab);
    expect(corrected).toBe('velocity training');
    expect(didCorrect).toBe(true);
  });

  it('preserves correct terms', () => {
    const { corrected, didCorrect } = correctQuery('velocity training', vocab);
    expect(corrected).toBe('velocity training');
    expect(didCorrect).toBe(false);
  });

  it('preserves short terms without correction', () => {
    const { corrected } = correctQuery('a is velocity', vocab);
    expect(corrected).toContain('a');
    expect(corrected).toContain('is');
  });

  it('handles empty query', () => {
    const { corrected, didCorrect } = correctQuery('', vocab);
    expect(corrected).toBe('');
    expect(didCorrect).toBe(false);
  });
});
