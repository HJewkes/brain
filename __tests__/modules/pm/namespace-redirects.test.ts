import { describe, it, expect } from 'vitest';
import { checkNamespaceMismatch, detectEntityType } from '../../../src/modules/pm/engine/routing.js';

describe('namespace redirect detection', () => {
  describe('detectEntityType', () => {
    it('identifies task IDs (contain dot)', () => {
      expect(detectEntityType('VOLT-01.03')).toBe('task');
    });

    it('identifies workstream IDs (contain dash, no dot)', () => {
      expect(detectEntityType('VOLT-01')).toBe('workstream');
    });

    it('identifies project IDs (plain prefix)', () => {
      expect(detectEntityType('VOLT')).toBe('project');
    });
  });

  describe('checkNamespaceMismatch', () => {
    it('detects workstream ID used in task namespace', () => {
      const msg = checkNamespaceMismatch('VOLT-01', 'task');
      expect(msg).toContain('workstream, not a task');
      expect(msg).toContain('brain pm workstream show VOLT-01');
    });

    it('detects project ID used in task namespace', () => {
      const msg = checkNamespaceMismatch('VOLT', 'task');
      expect(msg).toContain('project, not a task');
      expect(msg).toContain('brain pm project show VOLT');
    });

    it('detects task ID used in workstream namespace', () => {
      const msg = checkNamespaceMismatch('VOLT-01.03', 'workstream');
      expect(msg).toContain('task, not a workstream');
      expect(msg).toContain('brain pm task show VOLT-01.03');
    });

    it('detects project ID used in workstream namespace', () => {
      const msg = checkNamespaceMismatch('VOLT', 'workstream');
      expect(msg).toContain('project, not a workstream');
      expect(msg).toContain('brain pm project show VOLT');
    });

    it('detects task ID used in project namespace', () => {
      const msg = checkNamespaceMismatch('VOLT-01.03', 'project');
      expect(msg).toContain('task, not a project');
      expect(msg).toContain('brain pm task show VOLT-01.03');
    });

    it('returns null for correct namespace', () => {
      expect(checkNamespaceMismatch('VOLT-01.03', 'task')).toBeNull();
      expect(checkNamespaceMismatch('VOLT-01', 'workstream')).toBeNull();
      expect(checkNamespaceMismatch('VOLT', 'project')).toBeNull();
    });
  });
});
