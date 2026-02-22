import Database from 'better-sqlite3';
import type {
  NoteRecord,
  FileRecord,
  Chunk,
  Relation,
  ChunkType,
  CutType,
} from '../../types.js';

interface FTSResult {
  noteId: string;
  rank: number;
}

export class NoteRepo {
  constructor(
    private db: Database.Database,
    private ensureVectorTable: (dimensions: number) => void
  ) {}

  // --- Note CRUD ---

  upsertNote(record: NoteRecord): NoteRecord {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO notes
          (id, file_path, title, type, tier, category, tags, summary, confidence, status, sources, created_at, modified_at, last_reviewed, review_interval, expires, metadata)
        VALUES
          (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        record.id,
        record.filePath,
        record.title,
        record.type,
        record.tier,
        record.category,
        record.tags,
        record.summary,
        record.confidence,
        record.status,
        record.sources,
        record.createdAt,
        record.modifiedAt,
        record.lastReviewed,
        record.reviewInterval,
        record.expires,
        record.metadata
      );
    return record;
  }

  getNoteById(id: string): NoteRecord | null {
    const row = this.db.prepare('SELECT * FROM notes WHERE id = ?').get(id) as NoteRow | undefined;
    return row ? rowToNoteRecord(row) : null;
  }

  getNotesByIds(ids: string[]): Map<string, NoteRecord> {
    if (ids.length === 0) return new Map();
    const placeholders = ids.map(() => '?').join(',');
    const rows = this.db
      .prepare(`SELECT * FROM notes WHERE id IN (${placeholders})`)
      .all(...ids) as NoteRow[];
    const map = new Map<string, NoteRecord>();
    for (const row of rows) {
      map.set(row.id, rowToNoteRecord(row));
    }
    return map;
  }

  getAllNotes(): NoteRecord[] {
    const rows = this.db.prepare('SELECT * FROM notes').all() as NoteRow[];
    return rows.map(rowToNoteRecord);
  }

  getNoteCount(): number {
    const row = this.db.prepare('SELECT COUNT(*) as count FROM notes').get() as { count: number };
    return row.count;
  }

  getNoteByFilePath(filePath: string): NoteRecord | null {
    const row = this.db.prepare('SELECT * FROM notes WHERE file_path = ?').get(filePath) as
      | NoteRow
      | undefined;
    return row ? rowToNoteRecord(row) : null;
  }

  // --- File Tracking ---

  upsertFile(record: FileRecord): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO files (path, hash, mtime, indexed_at)
         VALUES (?, ?, ?, ?)`
      )
      .run(record.path, record.hash, record.mtime, record.indexedAt);
  }

  getFile(path: string): FileRecord | null {
    const row = this.db.prepare('SELECT * FROM files WHERE path = ?').get(path) as
      | FileRow
      | undefined;
    return row ? rowToFileRecord(row) : null;
  }

  getAllFiles(): Map<string, FileRecord> {
    const rows = this.db.prepare('SELECT * FROM files').all() as FileRow[];
    const map = new Map<string, FileRecord>();
    for (const row of rows) {
      const rec = rowToFileRecord(row);
      map.set(rec.path, rec);
    }
    return map;
  }

  deleteFile(path: string): void {
    this.db.prepare('DELETE FROM files WHERE path = ?').run(path);
  }

  // --- Chunk + Vector Operations ---

  upsertChunks(noteId: string, chunks: Chunk[], embeddings: Float32Array[]): void {
    if (embeddings.length > 0) {
      this.ensureVectorTable(embeddings[0].length);
    }
    this.deleteChunksForNote(noteId);

    const insertChunk = this.db.prepare(
      `INSERT INTO chunks (id, note_id, heading, heading_ancestry, content, token_count, chunk_type, cut_type, position)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const insertVector = this.db.prepare(
      `INSERT INTO chunk_vectors (chunk_id, embedding)
       VALUES (?, ?)`
    );

    const txn = this.db.transaction(() => {
      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        insertChunk.run(
          chunk.id,
          noteId,
          chunk.heading,
          chunk.headingAncestry,
          chunk.content,
          chunk.tokenCount,
          chunk.chunkType,
          chunk.cutType,
          chunk.position
        );
        insertVector.run(chunk.id, Buffer.from(embeddings[i].buffer));
      }
    });
    txn();
  }

  getChunksForNote(noteId: string): Chunk[] {
    const rows = this.db
      .prepare('SELECT * FROM chunks WHERE note_id = ? ORDER BY rowid')
      .all(noteId) as ChunkRow[];
    return rows.map(rowToChunk);
  }

  getChunkCount(): number {
    const row = this.db.prepare('SELECT COUNT(*) as count FROM chunks').get() as { count: number };
    return row.count;
  }

  deleteChunksForNote(noteId: string): void {
    const chunkIds = this.db.prepare('SELECT id FROM chunks WHERE note_id = ?').all(noteId) as {
      id: string;
    }[];

    if (chunkIds.length > 0) {
      const deleteVec = this.db.prepare('DELETE FROM chunk_vectors WHERE chunk_id = ?');
      const txn = this.db.transaction(() => {
        for (const { id } of chunkIds) {
          deleteVec.run(id);
        }
      });
      txn();
    }

    this.db.prepare('DELETE FROM chunks WHERE note_id = ?').run(noteId);
  }

  getChunkContent(chunkId: string): string {
    const row = this.db.prepare('SELECT content FROM chunks WHERE id = ?').get(chunkId) as
      | { content: string }
      | undefined;
    return row?.content ?? '';
  }

  getFirstChunkForNote(noteId: string): { content: string; heading: string | null } | null {
    const row = this.db
      .prepare('SELECT content, heading FROM chunks WHERE note_id = ? ORDER BY rowid LIMIT 1')
      .get(noteId) as { content: string; heading: string | null } | undefined;
    return row ?? null;
  }

  getChunkHeading(chunkId: string | null, noteId: string): string | null {
    if (chunkId) {
      const row = this.db.prepare('SELECT heading FROM chunks WHERE id = ?').get(chunkId) as
        | { heading: string | null }
        | undefined;
      if (row?.heading) return row.heading;
    }
    const row = this.db
      .prepare('SELECT heading FROM chunks WHERE note_id = ? ORDER BY rowid LIMIT 1')
      .get(noteId) as { heading: string | null } | undefined;
    return row?.heading ?? null;
  }

  // --- Relations ---

  upsertRelations(noteId: string, relations: Relation[]): void {
    const txn = this.db.transaction(() => {
      this.db.prepare('DELETE FROM relations WHERE source_id = ?').run(noteId);
      const insert = this.db.prepare(
        `INSERT INTO relations (source_id, target_id, type, created_at)
         VALUES (?, ?, ?, ?)`
      );
      for (const rel of relations) {
        insert.run(rel.sourceId, rel.targetId, rel.type, Date.now());
      }
    });
    txn();
  }

  getRelationsFrom(noteId: string): Relation[] {
    const rows = this.db
      .prepare('SELECT source_id, target_id, type FROM relations WHERE source_id = ?')
      .all(noteId) as RelationRow[];
    return rows.map(rowToRelation);
  }

  getRelationsTo(noteId: string): Relation[] {
    const rows = this.db
      .prepare('SELECT source_id, target_id, type FROM relations WHERE target_id = ?')
      .all(noteId) as RelationRow[];
    return rows.map(rowToRelation);
  }

  getRelationsBatch(ids: string[]): Map<string, { from: Relation[]; to: Relation[] }> {
    if (ids.length === 0) return new Map();
    const result = new Map<string, { from: Relation[]; to: Relation[] }>();
    for (const id of ids) {
      result.set(id, { from: [], to: [] });
    }
    const placeholders = ids.map(() => '?').join(',');
    const rows = this.db
      .prepare(
        `SELECT source_id, target_id, type FROM relations WHERE source_id IN (${placeholders}) OR target_id IN (${placeholders})`
      )
      .all(...ids, ...ids) as RelationRow[];
    for (const row of rows) {
      const rel = rowToRelation(row);
      result.get(rel.sourceId)?.from.push(rel);
      result.get(rel.targetId)?.to.push(rel);
    }
    return result;
  }

  // --- FTS ---

  upsertNoteFTS(noteId: string, title: string, summary: string, content: string): void {
    this.db.prepare('DELETE FROM notes_fts WHERE note_id = ?').run(noteId);
    this.db
      .prepare('INSERT INTO notes_fts (note_id, title, summary, content) VALUES (?, ?, ?, ?)')
      .run(noteId, title, summary, content);
  }

  searchFTS(query: string, limit: number): FTSResult[] {
    if (!query.trim()) return [];
    const sanitized = sanitizeFtsQuery(query);
    if (!sanitized) return [];
    const rows = this.db
      .prepare(
        `SELECT note_id as noteId, rank
         FROM notes_fts
         WHERE notes_fts MATCH ?
         ORDER BY rank
         LIMIT ?`
      )
      .all(sanitized, limit) as FTSResult[];
    return rows;
  }

  // --- Search ---

  searchVector(
    embedding: Float32Array,
    limit: number
  ): Array<{ chunkId: string; noteId: string; distance: number }> {
    try {
      return this.db
        .prepare(
          `SELECT cv.chunk_id as chunkId, c.note_id as noteId, cv.distance
         FROM chunk_vectors cv
         JOIN chunks c ON c.id = cv.chunk_id
         WHERE embedding MATCH ? AND k = ?
         ORDER BY distance`
        )
        .all(Buffer.from(embedding.buffer), limit) as Array<{
        chunkId: string;
        noteId: string;
        distance: number;
      }>;
    } catch {
      return [];
    }
  }

  getFilteredNoteIds(filters: {
    tier?: string;
    category?: string;
    confidence?: string;
    since?: string;
    tags?: string[];
  }): Set<string> | null {
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (filters.tier) {
      conditions.push('tier = ?');
      params.push(filters.tier);
    }
    if (filters.category) {
      conditions.push('category = ?');
      params.push(filters.category);
    }
    if (filters.confidence) {
      conditions.push('confidence = ?');
      params.push(filters.confidence);
    }
    if (filters.since) {
      conditions.push('modified_at >= ?');
      params.push(filters.since);
    }
    if (filters.tags?.length) {
      conditions.push(`(${filters.tags.map(() => "',' || tags || ',' LIKE '%,' || ? || ',%'").join(' AND ')})`);
      for (const tag of filters.tags) params.push(tag);
    }
    if (conditions.length === 0) return null;
    const rows = this.db
      .prepare(`SELECT id FROM notes WHERE ${conditions.join(' AND ')}`)
      .all(...params) as { id: string }[];
    return new Set(rows.map((r) => r.id));
  }
}

// --- FTS Helpers ---

export function sanitizeFtsQuery(query: string): string {
  return query
    .split(/\s+/)
    .filter(Boolean)
    .map((term) => `"${term.replace(/"/g, '""')}"`)
    .join(' ');
}

// --- Row Types (snake_case from SQLite) ---

interface NoteRow {
  id: string;
  file_path: string;
  title: string;
  type: string;
  tier: string;
  category: string | null;
  tags: string | null;
  summary: string | null;
  confidence: string | null;
  status: string;
  sources: string | null;
  created_at: string | null;
  modified_at: string | null;
  last_reviewed: string | null;
  review_interval: string | null;
  expires: string | null;
  metadata: string | null;
}

interface FileRow {
  path: string;
  hash: string;
  mtime: number;
  indexed_at: number;
}

interface ChunkRow {
  id: string;
  note_id: string;
  heading: string | null;
  heading_ancestry: string | null;
  content: string;
  token_count: number;
  chunk_type: string;
  cut_type: string;
  position: number;
}

interface RelationRow {
  source_id: string;
  target_id: string;
  type: string;
}

// --- Row Mappers ---

function rowToNoteRecord(row: NoteRow): NoteRecord {
  return {
    id: row.id,
    filePath: row.file_path,
    title: row.title,
    type: row.type as NoteRecord['type'],
    tier: row.tier as NoteRecord['tier'],
    category: row.category,
    tags: row.tags,
    summary: row.summary,
    confidence: row.confidence as NoteRecord['confidence'],
    status: (row.status ?? 'current') as NoteRecord['status'],
    sources: row.sources,
    createdAt: row.created_at,
    modifiedAt: row.modified_at,
    lastReviewed: row.last_reviewed,
    reviewInterval: row.review_interval,
    expires: row.expires,
    metadata: row.metadata,
  };
}

function rowToFileRecord(row: FileRow): FileRecord {
  return {
    path: row.path,
    hash: row.hash,
    mtime: row.mtime,
    indexedAt: row.indexed_at,
  };
}

function rowToChunk(row: ChunkRow): Chunk {
  return {
    id: row.id,
    noteId: row.note_id,
    heading: row.heading,
    headingAncestry: row.heading_ancestry,
    content: row.content,
    tokenCount: row.token_count,
    chunkType: (row.chunk_type ?? 'section') as ChunkType,
    cutType: (row.cut_type ?? 'heading_boundary') as CutType,
    position: row.position ?? 0,
  };
}

function rowToRelation(row: RelationRow): Relation {
  return {
    sourceId: row.source_id,
    targetId: row.target_id,
    type: row.type as Relation['type'],
  };
}
