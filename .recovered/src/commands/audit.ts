import { statSync } from 'node:fs';
import type { BrainDB } from '../services/brain-db.js';
import type { BrainConfig } from '../types.js';

export interface AuditNotes {
  total: number;
  byTier: Record<string, number>;
  byType: Record<string, number>;
  byModule: Record<string, number>;
  staleCount: number;
}

export interface AuditMemories {
  total: number;
  active: number;
  forgotten: number;
  byCategory: Record<string, number>;
}

export interface AuditSearch {
  ftsCount: number;
  trigramCount: number;
  vectorCount: number;
  embeddingModel: string | null;
  embeddingDimensions: number | null;
}

export interface AuditStorage {
  dbPath: string;
  dbSizeBytes: number;
  chunkCount: number;
  inboxPending: number;
  inboxTotal: number;
  feedCount: number;
}

export interface AuditTasks {
  total: number;
  byStatus: Record<string, number>;
}

export interface AuditRelations {
  byType: Record<string, number>;
  total: number;
}

export interface AuditReport {
  generatedAt: string;
  schemaVersion: string | null;
  notesDir: string;
  notes: AuditNotes;
  memories: AuditMemories;
  search: AuditSearch;
  storage: AuditStorage;
  tasks: AuditTasks;
  relations: AuditRelations;
}

function collectNotes(db: BrainDB): AuditNotes {
  const notes = db.getAllNotes();
  const byTier: Record<string, number> = {};
  const byType: Record<string, number> = {};
  const byModule: Record<string, number> = {};
  let staleCount = 0;
  const now = Date.now();

  for (const n of notes) {
    byTier[n.tier] = (byTier[n.tier] ?? 0) + 1;
    byType[n.type] = (byType[n.type] ?? 0) + 1;
    const mod = n.module ?? 'knowledge';
    byModule[mod] = (byModule[mod] ?? 0) + 1;

    if (n.lastReviewed && n.reviewInterval) {
      const days = parseFloat(n.reviewInterval) || 30;
      const due = new Date(n.lastReviewed).getTime() + days * 86_400_000;
      if (due < now) staleCount++;
    }
  }

  return { total: notes.length, byTier, byType, byModule, staleCount };
}

function collectMemories(db: BrainDB): AuditMemories {
  const all = db.getLatestMemories();
  const total = db.getMemoryCount();
  const byCategory: Record<string, number> = {};

  for (const m of all) {
    const cat = m.category ?? 'uncategorized';
    byCategory[cat] = (byCategory[cat] ?? 0) + 1;
  }

  return {
    total,
    active: all.length,
    forgotten: total - all.length,
    byCategory,
  };
}

function collectSearch(db: BrainDB): AuditSearch {
  const model = db.getEmbeddingModel();
  const tables = db.listTables();
  const hasFts = tables.includes('notes_fts');
  const hasTrigram = tables.includes('notes_fts_trigram');
  const hasVector = tables.includes('chunk_vectors');

  return {
    ftsCount: hasFts ? db.getNoteCount() : 0,
    trigramCount: hasTrigram ? db.getNoteCount() : 0,
    vectorCount: hasVector ? db.getChunkCount() : 0,
    embeddingModel: model?.model ?? null,
    embeddingDimensions: model?.dimensions ?? null,
  };
}

function collectStorage(db: BrainDB, config: BrainConfig): AuditStorage {
  let dbSizeBytes = 0;
  try {
    dbSizeBytes = statSync(config.dbPath).size;
  } catch {
    // DB might be :memory: in tests
  }

  const inboxAll = db.getInboxItems();
  const inboxPending = db.getInboxItems('pending');

  return {
    dbPath: config.dbPath,
    dbSizeBytes,
    chunkCount: db.getChunkCount(),
    inboxPending: inboxPending.length,
    inboxTotal: inboxAll.length,
    feedCount: db.getFeeds().length,
  };
}

function collectTasks(db: BrainDB): AuditTasks {
  const taskNotes = db.getModuleNoteIds({ module: 'pm', type: 'task' });
  const byStatus: Record<string, number> = {};
  const notesMap = db.getNotesByIds(taskNotes);

  for (const [, note] of notesMap) {
    const status = note.status ?? 'unknown';
    byStatus[status] = (byStatus[status] ?? 0) + 1;
  }

  return { total: taskNotes.length, byStatus };
}

function collectRelations(db: BrainDB): AuditRelations {
  const relations = db.getRelationsFiltered({});
  const byType: Record<string, number> = {};

  for (const r of relations) {
    byType[r.type] = (byType[r.type] ?? 0) + 1;
  }

  return { byType, total: relations.length };
}

export function collectAuditReport(db: BrainDB, config: BrainConfig): AuditReport {
  return {
    generatedAt: new Date().toISOString(),
    schemaVersion: db.getMetaValue('schema_version'),
    notesDir: config.notesDir,
    notes: collectNotes(db),
    memories: collectMemories(db),
    search: collectSearch(db),
    storage: collectStorage(db, config),
    tasks: collectTasks(db),
    relations: collectRelations(db),
  };
}
