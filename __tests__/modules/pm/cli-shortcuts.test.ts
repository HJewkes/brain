import { describe, it, expect } from 'vitest';
import { detectEntityType } from '../../../src/modules/pm/index.js';
import type { EntityType } from '../../../src/modules/pm/index.js';

describe('detectEntityType', () => {
  it('detects task IDs (contain dot)', () => {
    expect(detectEntityType('VOLT-01.03')).toBe('task');
    expect(detectEntityType('WEB-02.15')).toBe('task');
  });

  it('detects workstream IDs (contain dash, no dot)', () => {
    expect(detectEntityType('VOLT-01')).toBe('workstream');
    expect(detectEntityType('WEB-02')).toBe('workstream');
  });

  it('detects project IDs (no special chars)', () => {
    expect(detectEntityType('VOLT')).toBe('project');
    expect(detectEntityType('WEB')).toBe('project');
  });

  it('prioritizes dot over dash for task detection', () => {
    // A task ID like VOLT-01.03 has both dot and dash
    const result: EntityType = detectEntityType('VOLT-01.03');
    expect(result).toBe('task');
  });
});
