import { describe, test, expect } from 'vitest';

import { suggestVerificationSteps } from '../../../src/modules/pm/commands/verify.js';
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
