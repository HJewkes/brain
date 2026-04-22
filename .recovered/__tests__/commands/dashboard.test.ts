import { describe, it, expect } from 'vitest';
import { generateDashboardHtml } from '../../src/commands/dashboard.js';
import type { AuditReport } from '../../src/commands/audit.js';
import type { StatusCache } from '../../src/commands/dashboard.js';

function makeAudit(overrides: Partial<AuditReport> = {}): AuditReport {
  return {
    timestamp: '2026-03-14T12:00:00.000Z',
    database: { path: '/tmp/test.db', sizeBytes: 1024000, schemaVersion: 11 },
    notes: {
      total: 120,
      byModule: { knowledge: 80, pm: 30, sessions: 10 },
      byTier: { slow: 70, fast: 50 },
      byType: { note: 60, research: 30, task: 20, decision: 10 },
    },
    chunks: { total: 500, embedded: 450, pending: 50 },
    memories: {
      total: 200,
      active: 180,
      superseded: 20,
      byCategory: { fact: 100, preference: 50, context: 50 },
    },
    sessions: { total: 15, events: 320, chunks: 45 },
    agents: { total: 5, active: 2, completed: 3, worktrees: 1 },
    pm: {
      projects: 3,
      tasks: 40,
      tasksByStatus: { done: 15, 'in-progress': 10, pending: 15 },
    },
    search: { ftsEntries: 120, trigramEntries: 120, vectorRows: 450 },
    inbox: { total: 8, pending: 3, failed: 1, feeds: 2 },
    relations: {
      total: 95,
      byType: { 'related-to': 40, parent: 30, informs: 25 },
    },
    cache: { statusCachePath: '/tmp/.claude/status-cache/brain-state.json', statusCacheAge: 30 },
    config: { notesDir: '/tmp/brain', embedder: 'ollama' },
    ...overrides,
  };
}

function makeStatus(overrides: Partial<StatusCache> = {}): StatusCache {
  return {
    agents: [
      { name: 'agent-1', task: 'TSK-001', branch: 'feat/foo', status: 'active' },
      { name: 'agent-2', task: 'TSK-002', branch: 'fix/bar', status: 'completed' },
    ],
    sessions: { eventCount: 320, frictionCount: 5, prsCreated: 2 },
    ...overrides,
  };
}

describe('generateDashboardHtml', () => {
  it('returns valid HTML with required sections', () => {
    const html = generateDashboardHtml(makeAudit(), makeStatus());

    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('<title>Brain Dashboard</title>');
    expect(html).toContain('Brain Dashboard');
  });

  it('embeds audit data as valid JSON', () => {
    const audit = makeAudit();
    const html = generateDashboardHtml(audit, makeStatus());

    const auditMatch = html.match(/window\.__AUDIT__\s*=\s*(.+?);/);
    expect(auditMatch).not.toBeNull();
    const parsed = JSON.parse(auditMatch![1]);
    expect(parsed.notes.total).toBe(120);
    expect(parsed.database.schemaVersion).toBe(11);
  });

  it('embeds status cache as valid JSON', () => {
    const status = makeStatus();
    const html = generateDashboardHtml(makeAudit(), status);

    const statusMatch = html.match(/window\.__STATUS__\s*=\s*(.+?);/);
    expect(statusMatch).not.toBeNull();
    const parsed = JSON.parse(statusMatch![1]);
    expect(parsed.agents).toHaveLength(2);
    expect(parsed.sessions.prsCreated).toBe(2);
  });

  it('contains all dashboard sections', () => {
    const html = generateDashboardHtml(makeAudit(), makeStatus());

    expect(html).toContain('id="metric-notes"');
    expect(html).toContain('id="metric-memories"');
    expect(html).toContain('id="metric-sessions"');
    expect(html).toContain('id="metric-agents"');
    expect(html).toContain('id="notes-by-module"');
    expect(html).toContain('id="notes-by-type"');
    expect(html).toContain('id="task-burndown"');
    expect(html).toContain('id="agents-list"');
    expect(html).toContain('id="session-activity"');
    expect(html).toContain('id="search-health"');
    expect(html).toContain('id="storage-info"');
    expect(html).toContain('id="relations-summary"');
  });

  it('includes titan design system color tokens', () => {
    const html = generateDashboardHtml(makeAudit(), makeStatus());

    expect(html).toContain('--color-background-base: #1e1e2e');
    expect(html).toContain('--color-brand-primary: #89b4fa');
    expect(html).toContain('--color-status-success: #a6e3a1');
    expect(html).toContain('--color-data-1: #89b4fa');
  });

  it('handles empty status cache gracefully', () => {
    const html = generateDashboardHtml(makeAudit(), {});

    const statusMatch = html.match(/window\.__STATUS__\s*=\s*(.+?);/);
    expect(statusMatch).not.toBeNull();
    const parsed = JSON.parse(statusMatch![1]);
    expect(parsed).toEqual({});
  });

  it('escapes script-closing tags in JSON', () => {
    const audit = makeAudit({
      config: { notesDir: '</script><evil>', embedder: 'local' },
    });
    const html = generateDashboardHtml(audit, makeStatus());

    expect(html).not.toContain('</script><evil>');
    expect(html).toContain('<\\/script>');
  });
});
