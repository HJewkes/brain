import Database from 'better-sqlite3';
import type {
  MemoryEntry,
  MemoryHistoryEntry,
  MemoryEvent,
  MemoryRelationType,
} from '../../types.js';

interface MemoryRow {
  id: string;
  memory: string;
  source_note_id: string;
  source_chunk_id: string | null;
  container_tag: string;
  is_latest: number;
  parent_memory_id: string | null;
  root_memory_id: string | null;
  relation_type: string | null;
  valid_at: string | null;
  invalid_at: string | null;
  forget_after: string | null;
  is_forgotten: number;
  is_inference: number;
  created_at: string;
}

interface MemoryHistoryRow {
  id: number;
  memory_id: string;
  event: string;
  old_memory: string | null;
  new_memory: string | null;
  actor: string;
  created_at: string;
}

function rowToMemoryEntry(row: MemoryRow): MemoryEntry {
  return {
    id: row.id,
    memory: row.memory,
    sourceNoteId: row.source_note_id,
    sourceChunkId: row.source_chunk_id,
    containerTag: row.container_tag,
    isLatest: row.is_latest === 1,
    parentMemoryId: row.parent_memory_id,
    rootMemoryId: row.root_memory_id,
    relationType: row.relation_type as MemoryRelationType | null,
    validAt: row.valid_at,
    invalidAt: row.invalid_at,
    forgetAfter: row.forget_after,
    isForgotten: row.is_forgotten === 1,
    isInference: row.is_inference === 1,
    createdAt: row.created_at,
  };
}

function rowToMemoryHistory(row: MemoryHistoryRow): MemoryHistoryEntry {
  return {
    id: row.id,
    memoryId: row.memory_id,
    event: row.event as MemoryEvent,
    oldMemory: row.old_memory,
    newMemory: row.new_memory,
    actor: row.actor,
    createdAt: row.created_at,
  };
}

export class MemoryRepo {
  constructor(private db: Database.Database) {}

  addMemory(entry: MemoryEntry): void {
    this.db
      .prepare(
        `INSERT INTO memory_entries
          (id, memory, source_note_id, source_chunk_id, container_tag,
           is_latest, parent_memory_id, root_memory_id, relation_type,
           valid_at, invalid_at, forget_after, is_forgotten, is_inference, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        entry.id,
        entry.memory,
        entry.sourceNoteId,
        entry.sourceChunkId,
        entry.containerTag,
        entry.isLatest ? 1 : 0,
        entry.parentMemoryId,
        entry.rootMemoryId,
        entry.relationType,
        entry.validAt,
        entry.invalidAt,
        entry.forgetAfter,
        entry.isForgotten ? 1 : 0,
        entry.isInference ? 1 : 0,
        entry.createdAt
      );
  }

  getMemory(id: string): MemoryEntry | null {
    const row = this.db.prepare('SELECT * FROM memory_entries WHERE id = ?').get(id) as
      | MemoryRow
      | undefined;
    return row ? rowToMemoryEntry(row) : null;
  }

  getMemoriesForNote(noteId: string): MemoryEntry[] {
    const rows = this.db
      .prepare('SELECT * FROM memory_entries WHERE source_note_id = ? AND is_latest = 1 ORDER BY created_at')
      .all(noteId) as MemoryRow[];
    return rows.map(rowToMemoryEntry);
  }

  // TODO: collapse containerTag branching into single parameterized query
  // (same pattern duplicated in getMemoriesSince)
  getLatestMemories(containerTag?: string): MemoryEntry[] {
    if (containerTag) {
      const rows = this.db
        .prepare(
          'SELECT * FROM memory_entries WHERE is_latest = 1 AND is_forgotten = 0 AND container_tag = ? ORDER BY created_at DESC'
        )
        .all(containerTag) as MemoryRow[];
      return rows.map(rowToMemoryEntry);
    }
    const rows = this.db
      .prepare(
        'SELECT * FROM memory_entries WHERE is_latest = 1 AND is_forgotten = 0 ORDER BY created_at DESC'
      )
      .all() as MemoryRow[];
    return rows.map(rowToMemoryEntry);
  }

  getMemoryVersionChain(rootId: string): MemoryEntry[] {
    const rows = this.db
      .prepare(
        'SELECT * FROM memory_entries WHERE root_memory_id = ? OR id = ? ORDER BY created_at'
      )
      .all(rootId, rootId) as MemoryRow[];
    return rows.map(rowToMemoryEntry);
  }

  markMemorySuperseded(id: string): void {
    this.db.prepare('UPDATE memory_entries SET is_latest = 0 WHERE id = ?').run(id);
  }

  deleteMemoriesForNote(noteId: string): void {
    const memoryIds = this.db
      .prepare('SELECT id FROM memory_entries WHERE source_note_id = ?')
      .all(noteId) as { id: string }[];

    if (memoryIds.length > 0) {
      const deleteVector = this.db.prepare('DELETE FROM memory_vectors WHERE memory_id = ?');
      const deleteHistory = this.db.prepare('DELETE FROM memory_history WHERE memory_id = ?');
      const txn = this.db.transaction(() => {
        for (const { id } of memoryIds) {
          deleteVector.run(id);
          deleteHistory.run(id);
        }
      });
      txn();
    }

    this.db.prepare('DELETE FROM memory_entries WHERE source_note_id = ?').run(noteId);
  }

  forgetExpiredMemories(): number {
    const now = new Date().toISOString();
    const expired = this.db
      .prepare(
        'SELECT id, memory FROM memory_entries WHERE forget_after IS NOT NULL AND forget_after <= ? AND is_forgotten = 0 AND is_latest = 1'
      )
      .all(now) as { id: string; memory: string }[];

    if (expired.length === 0) return 0;

    const update = this.db.prepare(
      'UPDATE memory_entries SET is_forgotten = 1 WHERE id = ?'
    );
    const insertHistory = this.db.prepare(
      `INSERT INTO memory_history (memory_id, event, old_memory, new_memory, actor, created_at)
       VALUES (?, 'forget', ?, NULL, 'system', ?)`
    );

    const txn = this.db.transaction(() => {
      for (const { id, memory } of expired) {
        update.run(id);
        insertHistory.run(id, memory, now);
      }
    });
    txn();

    return expired.length;
  }

  getMemoriesSince(since: string, containerTag?: string): MemoryEntry[] {
    if (containerTag) {
      const rows = this.db
        .prepare(
          'SELECT * FROM memory_entries WHERE created_at >= ? AND container_tag = ? AND is_latest = 1 ORDER BY created_at DESC'
        )
        .all(since, containerTag) as MemoryRow[];
      return rows.map(rowToMemoryEntry);
    }
    const rows = this.db
      .prepare(
        'SELECT * FROM memory_entries WHERE created_at >= ? AND is_latest = 1 ORDER BY created_at DESC'
      )
      .all(since) as MemoryRow[];
    return rows.map(rowToMemoryEntry);
  }

  getMemoryCount(): number {
    const row = this.db
      .prepare('SELECT COUNT(*) as count FROM memory_entries WHERE is_latest = 1 AND is_forgotten = 0')
      .get() as { count: number };
    return row.count;
  }

  getMemoriesByIds(ids: string[]): Map<string, MemoryEntry> {
    if (ids.length === 0) return new Map();
    const placeholders = ids.map(() => '?').join(',');
    const rows = this.db
      .prepare(`SELECT * FROM memory_entries WHERE id IN (${placeholders})`)
      .all(...ids) as MemoryRow[];
    const map = new Map<string, MemoryEntry>();
    for (const row of rows) {
      map.set(row.id, rowToMemoryEntry(row));
    }
    return map;
  }

  addMemoryHistory(entry: Omit<MemoryHistoryEntry, 'id'>): void {
    this.db
      .prepare(
        `INSERT INTO memory_history (memory_id, event, old_memory, new_memory, actor, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(
        entry.memoryId,
        entry.event,
        entry.oldMemory,
        entry.newMemory,
        entry.actor,
        entry.createdAt
      );
  }

  getMemoryHistory(memoryId: string): MemoryHistoryEntry[] {
    const rows = this.db
      .prepare('SELECT * FROM memory_history WHERE memory_id = ? ORDER BY created_at')
      .all(memoryId) as MemoryHistoryRow[];
    return rows.map(rowToMemoryHistory);
  }

  deleteMemoryVector(memoryId: string): void {
    this.db.prepare('DELETE FROM memory_vectors WHERE memory_id = ?').run(memoryId);
  }

  upsertMemoryVector(memoryId: string, embedding: Float32Array): void {
    this.db.prepare('DELETE FROM memory_vectors WHERE memory_id = ?').run(memoryId);
    this.db
      .prepare('INSERT INTO memory_vectors (memory_id, embedding) VALUES (?, ?)')
      .run(memoryId, Buffer.from(embedding.buffer));
  }

  searchMemoryVectors(
    embedding: Float32Array,
    limit: number
  ): Array<{ memoryId: string; distance: number }> {
    try {
      return this.db
        .prepare(
          `SELECT memory_id as memoryId, distance
           FROM memory_vectors
           WHERE embedding MATCH ? AND k = ?
           ORDER BY distance`
        )
        .all(Buffer.from(embedding.buffer), limit) as Array<{
        memoryId: string;
        distance: number;
      }>;
    } catch {
      return [];
    }
  }
}
