import Database from 'better-sqlite3'
import * as sqliteVec from 'sqlite-vec'
import type {
  NoteRecord,
  FileRecord,
  Chunk,
  Relation,
} from '../types.js'

const SCHEMA_VERSION = 1
const VECTOR_DIMENSIONS = 384

interface FTSResult {
  noteId: string
  rank: number
}

export class BrainDB {
  private db: Database.Database

  constructor(dbPath: string) {
    this.db = new Database(dbPath)
    this.db.pragma('journal_mode = WAL')
    this.db.pragma('foreign_keys = ON')
    sqliteVec.load(this.db)
    this.migrate()
  }

  close(): void {
    this.db.close()
  }

  // --- Schema Migration ---

  private migrate(): void {
    const currentVersion = this.db.pragma('user_version', { simple: true }) as number

    if (currentVersion < 1) {
      this.db.exec(this.schemaV1())
      this.db.pragma(`user_version = ${SCHEMA_VERSION}`)
      this.setMetaValue('schema_version', '1')
    }
  }

  private schemaV1(): string {
    return `
      CREATE TABLE IF NOT EXISTS files (
        path        TEXT PRIMARY KEY,
        hash        TEXT NOT NULL,
        mtime       INTEGER NOT NULL,
        indexed_at  INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS notes (
        id            TEXT PRIMARY KEY,
        file_path     TEXT NOT NULL UNIQUE,
        title         TEXT NOT NULL,
        type          TEXT NOT NULL,
        tier          TEXT NOT NULL,
        category      TEXT,
        tags          TEXT,
        summary       TEXT,
        confidence    TEXT,
        status        TEXT DEFAULT 'current',
        sources       TEXT,
        created_at    TEXT,
        modified_at   TEXT,
        last_reviewed TEXT,
        review_interval TEXT,
        expires       TEXT,
        metadata      TEXT
      );

      CREATE TABLE IF NOT EXISTS relations (
        source_id   TEXT NOT NULL,
        target_id   TEXT NOT NULL,
        type        TEXT NOT NULL,
        created_at  INTEGER NOT NULL,
        PRIMARY KEY (source_id, target_id, type)
      );

      CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
        note_id UNINDEXED,
        title,
        summary,
        content,
        tokenize='unicode61'
      );

      CREATE TABLE IF NOT EXISTS chunks (
        id          TEXT PRIMARY KEY,
        note_id     TEXT NOT NULL,
        heading     TEXT,
        content     TEXT NOT NULL,
        token_count INTEGER,
        chunk_type  TEXT DEFAULT 'section',
        FOREIGN KEY (note_id) REFERENCES notes(id)
      );

      CREATE VIRTUAL TABLE IF NOT EXISTS chunk_vectors USING vec0(
        chunk_id TEXT PRIMARY KEY,
        embedding float[${VECTOR_DIMENSIONS}]
      );

      CREATE TABLE IF NOT EXISTS db_meta (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `
  }

  // --- Meta ---

  setMetaValue(key: string, value: string): void {
    this.db
      .prepare('INSERT OR REPLACE INTO db_meta (key, value) VALUES (?, ?)')
      .run(key, value)
  }

  getMetaValue(key: string): string | null {
    const row = this.db
      .prepare('SELECT value FROM db_meta WHERE key = ?')
      .get(key) as { value: string } | undefined
    return row?.value ?? null
  }

  // --- Embedding Model ---

  setEmbeddingModel(model: string, dimensions: number): void {
    this.setMetaValue('embedding_model', model)
    this.setMetaValue('embedding_dimensions', String(dimensions))
  }

  getEmbeddingModel(): { model: string; dimensions: number } | null {
    const model = this.getMetaValue('embedding_model')
    const dims = this.getMetaValue('embedding_dimensions')
    if (!model || !dims) return null
    return { model, dimensions: Number(dims) }
  }

  checkModelMatch(model: string): void {
    const stored = this.getEmbeddingModel()
    if (!stored) return
    if (stored.model !== model) {
      throw new Error(
        `Embedding model mismatch: DB uses "${stored.model}" but "${model}" was requested. Re-index with --force to switch models.`,
      )
    }
  }

  // --- Table Introspection ---

  listTables(): string[] {
    const rows = this.db
      .prepare("SELECT name FROM sqlite_master WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%'")
      .all() as { name: string }[]
    return rows.map((r) => r.name)
  }

  // --- Note CRUD ---

  upsertNote(record: NoteRecord): NoteRecord {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO notes
          (id, file_path, title, type, tier, category, tags, summary, confidence, status, sources, created_at, modified_at, last_reviewed, review_interval, expires, metadata)
        VALUES
          (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
        record.metadata,
      )
    return record
  }

  getNoteById(id: string): NoteRecord | null {
    const row = this.db
      .prepare('SELECT * FROM notes WHERE id = ?')
      .get(id) as NoteRow | undefined
    return row ? rowToNoteRecord(row) : null
  }

  getAllNotes(): NoteRecord[] {
    const rows = this.db
      .prepare('SELECT * FROM notes')
      .all() as NoteRow[]
    return rows.map(rowToNoteRecord)
  }

  deleteNote(id: string): void {
    const txn = this.db.transaction(() => {
      this.deleteChunksForNote(id)
      this.db.prepare('DELETE FROM notes_fts WHERE note_id = ?').run(id)
      this.db.prepare('DELETE FROM relations WHERE source_id = ? OR target_id = ?').run(id, id)
      this.db.prepare('DELETE FROM notes WHERE id = ?').run(id)
    })
    txn()
  }

  // --- File Tracking ---

  upsertFile(record: FileRecord): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO files (path, hash, mtime, indexed_at)
         VALUES (?, ?, ?, ?)`,
      )
      .run(record.path, record.hash, record.mtime, record.indexedAt)
  }

  getFile(path: string): FileRecord | null {
    const row = this.db
      .prepare('SELECT * FROM files WHERE path = ?')
      .get(path) as FileRow | undefined
    return row ? rowToFileRecord(row) : null
  }

  getAllFiles(): Map<string, FileRecord> {
    const rows = this.db
      .prepare('SELECT * FROM files')
      .all() as FileRow[]
    const map = new Map<string, FileRecord>()
    for (const row of rows) {
      const rec = rowToFileRecord(row)
      map.set(rec.path, rec)
    }
    return map
  }

  deleteFile(path: string): void {
    this.db.prepare('DELETE FROM files WHERE path = ?').run(path)
  }

  // --- Chunk + Vector Operations ---

  upsertChunks(noteId: string, chunks: Chunk[], embeddings: Float32Array[]): void {
    this.deleteChunksForNote(noteId)

    const insertChunk = this.db.prepare(
      `INSERT INTO chunks (id, note_id, heading, content, token_count, chunk_type)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    const insertVector = this.db.prepare(
      `INSERT INTO chunk_vectors (chunk_id, embedding)
       VALUES (?, ?)`,
    )

    const txn = this.db.transaction(() => {
      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i]
        insertChunk.run(
          chunk.id,
          noteId,
          chunk.heading,
          chunk.content,
          chunk.tokenCount,
          chunk.chunkType,
        )
        insertVector.run(
          chunk.id,
          Buffer.from(embeddings[i].buffer),
        )
      }
    })
    txn()
  }

  getChunksForNote(noteId: string): Chunk[] {
    const rows = this.db
      .prepare('SELECT * FROM chunks WHERE note_id = ? ORDER BY rowid')
      .all(noteId) as ChunkRow[]
    return rows.map(rowToChunk)
  }

  deleteChunksForNote(noteId: string): void {
    const chunkIds = this.db
      .prepare('SELECT id FROM chunks WHERE note_id = ?')
      .all(noteId) as { id: string }[]

    if (chunkIds.length > 0) {
      const deleteVec = this.db.prepare('DELETE FROM chunk_vectors WHERE chunk_id = ?')
      const txn = this.db.transaction(() => {
        for (const { id } of chunkIds) {
          deleteVec.run(id)
        }
      })
      txn()
    }

    this.db.prepare('DELETE FROM chunks WHERE note_id = ?').run(noteId)
  }

  // --- Relations ---

  upsertRelations(noteId: string, relations: Relation[]): void {
    const txn = this.db.transaction(() => {
      this.db.prepare('DELETE FROM relations WHERE source_id = ?').run(noteId)
      const insert = this.db.prepare(
        `INSERT INTO relations (source_id, target_id, type, created_at)
         VALUES (?, ?, ?, ?)`,
      )
      for (const rel of relations) {
        insert.run(rel.sourceId, rel.targetId, rel.type, Date.now())
      }
    })
    txn()
  }

  getRelationsFrom(noteId: string): Relation[] {
    const rows = this.db
      .prepare('SELECT source_id, target_id, type FROM relations WHERE source_id = ?')
      .all(noteId) as RelationRow[]
    return rows.map(rowToRelation)
  }

  getRelationsTo(noteId: string): Relation[] {
    const rows = this.db
      .prepare('SELECT source_id, target_id, type FROM relations WHERE target_id = ?')
      .all(noteId) as RelationRow[]
    return rows.map(rowToRelation)
  }

  // --- FTS ---

  upsertNoteFTS(noteId: string, title: string, summary: string, content: string): void {
    this.db.prepare('DELETE FROM notes_fts WHERE note_id = ?').run(noteId)
    this.db
      .prepare('INSERT INTO notes_fts (note_id, title, summary, content) VALUES (?, ?, ?, ?)')
      .run(noteId, title, summary, content)
  }

  searchFTS(query: string, limit: number): FTSResult[] {
    if (!query.trim()) return []
    const rows = this.db
      .prepare(
        `SELECT note_id as noteId, rank
         FROM notes_fts
         WHERE notes_fts MATCH ?
         ORDER BY rank
         LIMIT ?`,
      )
      .all(query, limit) as FTSResult[]
    return rows
  }
}

// --- Row Types (snake_case from SQLite) ---

interface NoteRow {
  id: string
  file_path: string
  title: string
  type: string
  tier: string
  category: string | null
  tags: string | null
  summary: string | null
  confidence: string | null
  status: string
  sources: string | null
  created_at: string | null
  modified_at: string | null
  last_reviewed: string | null
  review_interval: string | null
  expires: string | null
  metadata: string | null
}

interface FileRow {
  path: string
  hash: string
  mtime: number
  indexed_at: number
}

interface ChunkRow {
  id: string
  note_id: string
  heading: string | null
  content: string
  token_count: number
  chunk_type: string
}

interface RelationRow {
  source_id: string
  target_id: string
  type: string
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
  }
}

function rowToFileRecord(row: FileRow): FileRecord {
  return {
    path: row.path,
    hash: row.hash,
    mtime: row.mtime,
    indexedAt: row.indexed_at,
  }
}

function rowToChunk(row: ChunkRow): Chunk {
  return {
    id: row.id,
    noteId: row.note_id,
    heading: row.heading,
    content: row.content,
    tokenCount: row.token_count,
    chunkType: row.chunk_type as Chunk['chunkType'],
  }
}

function rowToRelation(row: RelationRow): Relation {
  return {
    sourceId: row.source_id,
    targetId: row.target_id,
    type: row.type as Relation['type'],
  }
}
