import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDb, makeNote, makeChunk, makeMemoryEntry, makeInboxItem, makeFeedRecord } from '../helpers.js';
import type { BrainDB } from '../../src/services/brain-db.js';
import type { BrainConfig } from '../../src/types.js';
import { collectAuditReport } from '../../src/commands/audit.js';

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
    expect(report.chunks.total).toBe(0);
    expect(report.memories.total).toBe(0);
    expect(report.inbox.total).toBe(0);
    expect(report.relations.total).toBe(0);
    expect(report.search.ftsEntries).toBe(0);
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
    expect(report.notes.byType['decision']).toBe(1);
    expect(report.notes.byType['task']).toBe(1);
  });

  it('counts chunks and embedding status', () => {
    db.upsertNote(makeNote({ id: 'n1' }));
    const chunk = makeChunk({ noteId: 'n1', id: 'c1' });
    db.upsertChunks('n1', [chunk]);

    const report = collectAuditReport(db, config);

    expect(report.chunks.total).toBe(1);
    expect(report.chunks.pending).toBe(1);
    expect(report.chunks.embedded).toBe(0);
  });

  it('counts memories with active/superseded breakdown', () => {
    db.upsertNote(makeNote({ id: 'n1' }));
    db.upsertMemory(makeMemoryEntry({
      id: 'm1', sourceNoteId: 'n1', category: 'fact',
    }));
    db.upsertMemory(makeMemoryEntry({
      id: 'm2', sourceNoteId: 'n1', category: 'fact',
    }));
    db.upsertMemory(makeMemoryEntry({
      id: 'm3', sourceNoteId: 'n1', category: 'preference',
    }));

    // Supersede m1
    db.upsertMemory({
      ...makeMemoryEntry({ id: 'm1', sourceNoteId: 'n1', category: 'fact' }),
    });
    // Manually set superseded via raw db
    const rawDb = (db as unknown as { db: import('better-sqlite3').Database }).db;
    rawDb.prepare('UPDATE memories SET superseded_by = ? WHERE id = ?').run('m2', 'm1');

    const report = collectAuditReport(db, config);

    expect(report.memories.total).toBe(3);
    expect(report.memories.superseded).toBe(1);
    expect(report.memories.active).toBe(2);
    expect(report.memories.byCategory['fact']).toBe(2);
    expect(report.memories.byCategory['preference']).toBe(1);
  });

  it('counts inbox items and feeds', () => {
    db.addInboxItem(makeInboxItem({ id: 'i1', status: 'pending' }));
    db.addInboxItem(makeInboxItem({ id: 'i2', status: 'failed' }));
    db.addInboxItem(makeInboxItem({ id: 'i3', status: 'processed' }));
    db.addFeed(makeFeedRecord({ id: 'f1' }));

    const report = collectAuditReport(db, config);

    expect(report.inbox.total).toBe(3);
    expect(report.inbox.pending).toBe(1);
    expect(report.inbox.failed).toBe(1);
    expect(report.inbox.feeds).toBe(1);
  });

  it('counts relations by type', () => {
    db.upsertNote(makeNote({ id: 'n1' }));
    db.upsertNote(makeNote({ id: 'n2' }));
    db.upsertNote(makeNote({ id: 'n3' }));
    db.setRelation('n1', 'n2', 'related-to');
    db.setRelation('n1', 'n3', 'parent');

    const report = collectAuditReport(db, config);

    expect(report.relations.total).toBe(2);
    expect(report.relations.byType['related-to']).toBe(1);
    expect(report.relations.byType['parent']).toBe(1);
  });

  it('counts PM projects and tasks with status breakdown', () => {
    db.upsertNote(makeNote({
      id: 'p1', module: 'pm', type: 'project',
      metadata: JSON.stringify({ display_id: 'PRJ-01' }),
    }));
    db.upsertNote(makeNote({
      id: 't1', module: 'pm', type: 'task',
      metadata: JSON.stringify({ display_id: 'PRJ-01-001', status: 'done' }),
    }));
    db.upsertNote(makeNote({
      id: 't2', module: 'pm', type: 'task',
      metadata: JSON.stringify({ display_id: 'PRJ-01-002', status: 'ready' }),
    }));
    db.upsertNote(makeNote({
      id: 't3', module: 'pm', type: 'task',
      metadata: JSON.stringify({ display_id: 'PRJ-01-003', status: 'ready' }),
    }));

    const report = collectAuditReport(db, config);

    expect(report.pm.projects).toBe(1);
    expect(report.pm.tasks).toBe(3);
    expect(report.pm.tasksByStatus['done']).toBe(1);
    expect(report.pm.tasksByStatus['ready']).toBe(2);
  });

  it('counts session notes', () => {
    db.upsertNote(makeNote({ id: 's1', module: 'sessions', type: 'session-log' }));
    db.upsertNote(makeNote({ id: 's2', module: 'sessions', type: 'session-log' }));

    const report = collectAuditReport(db, config);

    expect(report.sessions.total).toBe(2);
  });

  it('includes config and timestamp', () => {
    const report = collectAuditReport(db, config);

    expect(report.config.notesDir).toBe('/tmp/test-audit');
    expect(report.config.embedder).toBe('ollama');
    expect(report.timestamp).toBeTruthy();
    expect(report.database.path).toBe(dbPath);
  });

  it('handles missing optional tables gracefully', () => {
    // agents, session_events, session_chunks, worktree_allocations
    // may not exist — safeCount should return 0
    const report = collectAuditReport(db, config);

    expect(report.agents.total).toBeGreaterThanOrEqual(0);
    expect(report.sessions.events).toBeGreaterThanOrEqual(0);
    expect(report.sessions.chunks).toBeGreaterThanOrEqual(0);
    expect(report.agents.worktrees).toBeGreaterThanOrEqual(0);
  });
});
