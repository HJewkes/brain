import { describe, test, expect } from 'vitest';

import { suggestVerificationSteps, extractAcceptanceCriteria } from '../../../src/modules/pm/commands/verify.js';
import type { TaskCategory } from '../../../src/modules/pm/types.js';

describe('suggestVerificationSteps', () => {
  test('returns steps for known category: implementation', () => {
    const steps = suggestVerificationSteps('implementation');
    expect(steps).toBeDefined();
    expect(Array.isArray(steps)).toBe(true);
    expect(steps.length).toBeGreaterThan(0);
  });

  test('returns steps for known category: testing', () => {
    const steps = suggestVerificationSteps('testing');
    expect(steps).toBeDefined();
    expect(steps.length).toBeGreaterThan(0);
  });

  test('returns steps for known category: design', () => {
    const steps = suggestVerificationSteps('design');
    expect(steps).toBeDefined();
    expect(steps.length).toBeGreaterThan(0);
  });

  test('returns default steps for unknown category', () => {
    const steps = suggestVerificationSteps('unknown-category' as TaskCategory);
    expect(steps).toBeDefined();
    expect(Array.isArray(steps)).toBe(true);
    expect(steps.length).toBeGreaterThan(0);
    expect(steps[0]).toContain('Verify');
  });

  test('all known categories return non-empty arrays', () => {
    const categories: TaskCategory[] = [
      'implementation', 'testing', 'documentation', 'research',
      'review', 'infrastructure', 'configuration', 'migration', 'design',
    ];
    for (const cat of categories) {
      const steps = suggestVerificationSteps(cat);
      expect(steps).toBeDefined();
      expect(steps.length).toBeGreaterThan(0);
    }
  });
});

describe('extractAcceptanceCriteria', () => {
  test('extracts AC items from markdown body with dash bullets', () => {
    const body = [
      'Some description here.',
      '',
      '## Acceptance Criteria',
      '- All tests pass',
      '- No type errors',
      '- Feature X works correctly',
      '',
      '## Notes',
      'Some other section.',
    ].join('\n');

    const ac = extractAcceptanceCriteria(body);
    expect(ac).toEqual([
      'All tests pass',
      'No type errors',
      'Feature X works correctly',
    ]);
  });

  test('extracts AC items with asterisk bullets', () => {
    const body = [
      '## Acceptance Criteria',
      '* First criterion',
      '* Second criterion',
    ].join('\n');

    const ac = extractAcceptanceCriteria(body);
    expect(ac).toEqual(['First criterion', 'Second criterion']);
  });

  test('returns empty array when no AC section exists', () => {
    const body = 'Just a plain description with no acceptance criteria section.';
    const ac = extractAcceptanceCriteria(body);
    expect(ac).toEqual([]);
  });

  test('returns empty array for empty body', () => {
    expect(extractAcceptanceCriteria('')).toEqual([]);
  });

  test('handles AC heading without ## prefix', () => {
    const body = [
      'Acceptance Criteria:',
      '- Step one',
      '- Step two',
    ].join('\n');

    const ac = extractAcceptanceCriteria(body);
    expect(ac).toEqual(['Step one', 'Step two']);
  });

  test('ignores blank lines between AC items', () => {
    const body = [
      '## Acceptance Criteria',
      '- First item',
      '- Second item',
      '',
      'Some trailing text',
    ].join('\n');

    const ac = extractAcceptanceCriteria(body);
    expect(ac).toEqual(['First item', 'Second item']);
  });
});
