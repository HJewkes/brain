import { describe, it, expect } from 'vitest';
import {
  resolveTemplate,
  listTemplateNames,
  listTemplates,
  extractVariables,
  renderTemplate,
} from '../../../src/modules/workflow/engine/templates.js';

describe('template resolver', () => {
  it('lists all bundled templates', () => {
    const names = listTemplateNames();
    expect(names).toContain('implementation-compact');
    expect(names).toContain('review-agent');
    expect(names).toContain('ops');
    expect(names.length).toBe(17);
  });

  it('resolves template by name without extension', () => {
    const result = resolveTemplate('implementation-compact');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.name).toBe('implementation-compact');
    expect(result.data.content).toContain('{{TASK_ID}}');
    expect(result.data.variables).toContain('TASK_ID');
  });

  it('resolves template by name with .md extension', () => {
    const result = resolveTemplate('ops.md');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.name).toBe('ops');
  });

  it('returns NOT_FOUND for unknown template', () => {
    const result = resolveTemplate('nonexistent');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('NOT_FOUND');
      expect(result.error.message).toContain('Available:');
    }
  });

  it('extracts variables from content', () => {
    const vars = extractVariables('Hello {{NAME}}, your {{ROLE}} is ready. {{NAME}} again.');
    expect(vars).toEqual(['NAME', 'ROLE']);
  });

  it('extracts variables from real template', () => {
    const result = resolveTemplate('implementation-compact');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.variables).toContain('REPO_PATH');
    expect(result.data.variables).toContain('BRANCH_NAME');
    expect(result.data.variables).toContain('TEST_CMD');
  });

  it('renders template with variable substitution', () => {
    const result = renderTemplate('implementation-compact', {
      TASK_ID: 'SDK-01.01',
      REPO_PATH: '/path/to/repo',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toContain('SDK-01.01');
    expect(result.data).toContain('/path/to/repo');
    expect(result.data).not.toContain('{{TASK_ID}}');
  });

  it('leaves unfilled variables as placeholders', () => {
    const result = renderTemplate('implementation-compact', { TASK_ID: 'X-01.01' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toContain('X-01.01');
    expect(result.data).toContain('{{REPO_PATH}}');
  });

  it('listTemplates returns info for all templates', () => {
    const templates = listTemplates();
    expect(templates.length).toBe(17);
    for (const t of templates) {
      expect(t.name).toBeTruthy();
      expect(t.content.length).toBeGreaterThan(0);
    }
  });
});
