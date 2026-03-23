import { describe, it, expect, vi } from 'vitest';
import { generateDashboardHtml } from '../../src/commands/dashboard.js';
import type { AuditReport } from '../../src/commands/audit.js';
import type { StatusCache } from '../../src/commands/dashboard.js';

const MOCK_TEMPLATE =
  '<!DOCTYPE html><html><head><title>Brain Dashboard</title></head><body><div id="root"></div></body></html>';

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    existsSync: (p: string) => {
      if (typeof p === 'string' && p.endsWith('index.html')) return true;
      return actual.existsSync(p);
    },
    readFileSync: (p: unknown, enc?: unknown) => {
      if (typeof p === 'string' && p.endsWith('index.html')) return MOCK_TEMPLATE;
      return actual.readFileSync(p as string, enc as string);
    },
  };
});

function makeAudit(overrides: Partial<AuditReport> = {}): AuditReport {
  return {
    generatedAt: '2026-03-14T12:00:00.000Z',
    schemaVersion: '12',
    notesDir: '/tmp/brain',
    notes: {
      total: 120,
      byModule: { knowledge: 80, pm: 30, sessions: 10 },
      byTier: { slow: 70, fast: 50 },
      byType: { note: 60, research: 30, task: 20, decision: 10 },
      staleCount: 2,
    },
    memories: {
      total: 200,
      active: 180,
      forgotten: 20,
      byCategory: { fact: 100, preference: 50, context: 50 },
    },
    search: {
      ftsCount: 120,
      trigramCount: 120,
      vectorCount: 450,
      embeddingModel: 'nomic-embed-text',
      embeddingDimensions: 768,
    },
    storage: {
      dbPath: '/tmp/test.db',
      dbSizeBytes: 1024000,
      chunkCount: 500,
      inboxPending: 3,
      inboxTotal: 8,
      feedCount: 2,
    },
    tasks: {
      total: 40,
      byStatus: { done: 15, 'in-progress': 10, pending: 15 },
    },
    relations: {
      total: 95,
      byType: { 'related-to': 40, parent: 30, informs: 25 },
    },
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
  it('returns valid HTML with title', () => {
    const html = generateDashboardHtml(makeAudit(), makeStatus());

    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('Brain Dashboard');
  });

  it('embeds audit data as valid JSON', () => {
    const audit = makeAudit();
    const html = generateDashboardHtml(audit, makeStatus());

    const auditMatch = html.match(/window\.__AUDIT__\s*=\s*(.+?);/);
    expect(auditMatch).not.toBeNull();
    const parsed = JSON.parse(auditMatch![1]);
    expect(parsed.notes.total).toBe(120);
    expect(parsed.generatedAt).toBe('2026-03-14T12:00:00.000Z');
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

  it('embeds dashboard data when provided', () => {
    const dashboard = {
      tasks: [
        {
          id: 'T-1',
          title: 'Test',
          col: 'ready',
          workstream: 'W-1',
          agent: null,
          branch: null,
          priority: 'high',
          deps: [],
          queueAge: null,
          pr: null,
        },
      ],
      agents: [],
      sessions: [],
      stageHistory: [],
      workstreams: {},
    };
    const html = generateDashboardHtml(makeAudit(), makeStatus(), dashboard);

    const dashMatch = html.match(/window\.__DASHBOARD__\s*=\s*(.+?);/);
    expect(dashMatch).not.toBeNull();
    const parsed = JSON.parse(dashMatch![1]);
    expect(parsed.tasks).toHaveLength(1);
    expect(parsed.tasks[0].id).toBe('T-1');
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
      notesDir: '</script><evil>',
    });
    const html = generateDashboardHtml(audit, makeStatus());

    expect(html).not.toContain('</script><evil>');
    expect(html).toContain('<\\/script>');
  });
});
