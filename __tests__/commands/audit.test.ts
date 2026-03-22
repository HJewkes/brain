import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createTestDb, makeNote } from '../helpers.js';
import type { BrainDB } from '../../src/services/brain-db.js';
import type { BrainConfig } from '../../src/types.js';
import { collectAuditReport, collectDashboardData } from '../../src/commands/audit.js';

let db: BrainDB;
let dbPath: string;
let config: BrainConfig;

beforeEach(() => {
  ({ db, dbPath } = createTestDb());
  config = {
    notesDir: '/tmp/test-audit',
    dbPath,
    embedder: 'ollama',
    fusionWeights: { bm25: 0.3, vector: 0.7 },
  };
});

afterEach(() => {
  db.close();
});

describe('collectAuditReport', () => {
  it('returns zeroes for empty database', () => {
    const report = collectAuditReport(db, config);

    expect(report.notes.total).toBe(0);
    expect(report.memories.total).toBe(0);
    expect(report.tasks.total).toBe(0);
    expect(report.relations.total).toBe(0);
  });

  it('includes generatedAt and notesDir', () => {
    const report = collectAuditReport(db, config);

    expect(report.generatedAt).toBeTruthy();
    expect(report.notesDir).toBe('/tmp/test-audit');
  });

  it('counts notes by module, tier, and type', () => {
    db.upsertNote(makeNote({ id: 'n1', tier: 'slow', type: 'note', module: null }));
    db.upsertNote(makeNote({ id: 'n2', tier: 'slow', type: 'decision', module: null }));
    db.upsertNote(makeNote({ id: 'n3', tier: 'fast', type: 'note', module: 'pm' }));
    db.upsertNote(makeNote({ id: 'n4', tier: 'fast', type: 'task', module: 'pm' }));

    const report = collectAuditReport(db, config);

    expect(report.notes.total).toBe(4);
    expect(report.notes.byModule['knowledge']).toBe(2);
    expect(report.notes.byModule['pm']).toBe(2);
    expect(report.notes.byTier['slow']).toBe(2);
    expect(report.notes.byTier['fast']).toBe(2);
    expect(report.notes.byType['note']).toBe(2);
  });

  it('counts tasks by status', () => {
    db.upsertNote(
      makeNote({
        id: 't1',
        module: 'pm',
        type: 'task',
        status: 'done',
        metadata: JSON.stringify({ display_id: 'TST-01.01', status: 'done' }),
      })
    );
    db.upsertNote(
      makeNote({
        id: 't2',
        module: 'pm',
        type: 'task',
        status: 'pending',
        metadata: JSON.stringify({ display_id: 'TST-01.02', status: 'pending' }),
      })
    );

    const report = collectAuditReport(db, config);

    expect(report.tasks.total).toBe(2);
    expect(report.tasks.byStatus['done']).toBe(1);
    expect(report.tasks.byStatus['pending']).toBe(1);
  });

  it('reads task status from metadata, not note status field', () => {
    db.upsertNote(
      makeNote({
        id: 't1',
        module: 'pm',
        type: 'task',
        status: 'current',
        metadata: JSON.stringify({ display_id: 'TST-01.01', status: 'done' }),
      })
    );

    const report = collectAuditReport(db, config);

    expect(report.tasks.byStatus['done']).toBe(1);
    expect(report.tasks.byStatus['current']).toBeUndefined();
  });

  it('counts relations by type', () => {
    db.upsertNote(makeNote({ id: 'n1' }));
    db.upsertNote(makeNote({ id: 'n2' }));
    db.upsertRelations('n1', [{ sourceId: 'n1', targetId: 'n2', type: 'related-to' }]);

    const report = collectAuditReport(db, config);

    expect(report.relations.total).toBe(1);
    expect(report.relations.byType['related-to']).toBe(1);
  });

  it('includes search health', () => {
    const report = collectAuditReport(db, config);

    expect(report.search).toBeDefined();
    expect(report.search.ftsCount).toBeGreaterThanOrEqual(0);
  });

  it('includes storage info', () => {
    const report = collectAuditReport(db, config);

    expect(report.storage).toBeDefined();
    expect(report.storage.dbPath).toBe(dbPath);
  });
});

describe('collectDashboardData', () => {
  it('returns empty arrays for empty database', () => {
    const data = collectDashboardData(db, config);

    expect(data.tasks).toEqual([]);
    expect(data.agents).toEqual([]);
    expect(data.sessions).toEqual([]);
    expect(data.stageHistory).toEqual([]);
    expect(data.workstreams).toEqual({});
  });

  it('collects tasks with column assignment', () => {
    db.upsertNote(
      makeNote({
        id: 't1',
        module: 'pm',
        type: 'task',
        metadata: JSON.stringify({
          display_id: 'TST-01.01',
          title: 'Test task',
          status: 'done',
          project: 'TST',
          workstream: 1,
          priority: 'high',
        }),
      })
    );

    const data = collectDashboardData(db, config);

    expect(data.tasks).toHaveLength(1);
    expect(data.tasks[0].id).toBe('TST-01.01');
    expect(data.tasks[0].col).toBe('done');
    expect(data.tasks[0].priority).toBe('high');
  });

  it('populates deps from relations table', () => {
    db.upsertNote(
      makeNote({
        id: 't1',
        module: 'pm',
        type: 'task',
        metadata: JSON.stringify({
          display_id: 'TST-01.01',
          title: 'First',
          status: 'pending',
          project: 'TST',
          workstream: 1,
          priority: 'high',
        }),
      })
    );
    db.upsertNote(
      makeNote({
        id: 't2',
        module: 'pm',
        type: 'task',
        metadata: JSON.stringify({
          display_id: 'TST-01.02',
          title: 'Second',
          status: 'pending',
          project: 'TST',
          workstream: 1,
          priority: 'medium',
        }),
      })
    );
    db.upsertRelations('t2', [{ sourceId: 't2', targetId: 't1', type: 'depends_on' }]);

    const data = collectDashboardData(db, config);

    const t2 = data.tasks.find((t) => t.id === 'TST-01.02');
    expect(t2?.deps).toEqual(['TST-01.01']);
  });

  it('assigns blocked column for tasks with unmet deps from relations', () => {
    db.upsertNote(
      makeNote({
        id: 't1',
        module: 'pm',
        type: 'task',
        metadata: JSON.stringify({
          display_id: 'TST-01.01',
          title: 'First',
          status: 'pending',
          project: 'TST',
          workstream: 1,
          priority: 'high',
        }),
      })
    );
    db.upsertNote(
      makeNote({
        id: 't2',
        module: 'pm',
        type: 'task',
        metadata: JSON.stringify({
          display_id: 'TST-01.02',
          title: 'Second',
          status: 'pending',
          project: 'TST',
          workstream: 1,
          priority: 'medium',
        }),
      })
    );
    db.upsertRelations('t2', [{ sourceId: 't2', targetId: 't1', type: 'depends_on' }]);

    const data = collectDashboardData(db, config);

    const t2 = data.tasks.find((t) => t.id === 'TST-01.02');
    expect(t2?.col).toBe('blocked');
  });

  it('assigns ready column when deps are all done', () => {
    db.upsertNote(
      makeNote({
        id: 't1',
        module: 'pm',
        type: 'task',
        metadata: JSON.stringify({
          display_id: 'TST-01.01',
          title: 'First',
          status: 'done',
          project: 'TST',
          workstream: 1,
          priority: 'high',
        }),
      })
    );
    db.upsertNote(
      makeNote({
        id: 't2',
        module: 'pm',
        type: 'task',
        metadata: JSON.stringify({
          display_id: 'TST-01.02',
          title: 'Second',
          status: 'pending',
          project: 'TST',
          workstream: 1,
          priority: 'medium',
        }),
      })
    );
    db.upsertRelations('t2', [{ sourceId: 't2', targetId: 't1', type: 'depends_on' }]);

    const data = collectDashboardData(db, config);

    const t2 = data.tasks.find((t) => t.id === 'TST-01.02');
    expect(t2?.col).toBe('ready');
    expect(t2?.deps).toEqual(['TST-01.01']);
  });

  it('parses session events from L2 timeline notes', () => {
    const sessDir = join(tmpdir(), `brain-test-sess-${Date.now()}`);
    const l2Dir = join(sessDir, 'modules', 'sessions', 'SNS-TEST');
    mkdirSync(l2Dir, { recursive: true });

    writeFileSync(
      join(l2Dir, 'l2-timeline.md'),
      [
        '# Session Timeline',
        '',
        '## Tool Call Log',
        '',
        '- 19:32:36 Bash (225ms)',
        '- 19:32:37 Read (881ms)',
        '- 19:32:43 Edit ERROR (265ms)',
        '- 19:33:18 Bash (3425ms)',
        '',
        '## Metadata',
        '',
        '- Session ID: test-123',
      ].join('\n')
    );

    const sessConfig = { ...config, notesDir: sessDir };
    db.upsertNote(
      makeNote({
        id: 's1',
        module: 'sessions',
        type: 'session',
        metadata: JSON.stringify({
          session_id: 'test-123',
          display_id: 'SNS-TEST',
          status: 'completed',
          started_at: '2026-03-14T19:30:00Z',
          tokens_input: 100,
          tokens_output: 500,
          tool_calls: 4,
          error_count: 1,
        }),
      })
    );

    const data = collectDashboardData(db, sessConfig);
    const session = data.sessions.find((s) => s.displayId === 'SNS-TEST');

    expect(session).toBeDefined();
    expect(session!.events).toHaveLength(4);
    expect(session!.events![0]).toMatchObject({ toolName: 'Bash', outcome: 'success' });
    expect(session!.events![2]).toMatchObject({ toolName: 'Edit', outcome: 'error' });
    expect(session!.events![3]).toMatchObject({ toolName: 'Bash', durationMs: 3425 });

    rmSync(sessDir, { recursive: true, force: true });
  });

  it('returns empty events when no L2 timeline exists', () => {
    db.upsertNote(
      makeNote({
        id: 's1',
        module: 'sessions',
        type: 'session',
        metadata: JSON.stringify({
          session_id: 'no-timeline',
          display_id: 'SNS-NOPE',
          status: 'completed',
          started_at: '2026-03-14T10:00:00Z',
          tokens_input: 0,
          tokens_output: 0,
          tool_calls: 0,
          error_count: 0,
        }),
      })
    );

    const data = collectDashboardData(db, config);
    const session = data.sessions.find((s) => s.displayId === 'SNS-NOPE');

    expect(session).toBeDefined();
    expect(session!.events).toEqual([]);
  });
});
