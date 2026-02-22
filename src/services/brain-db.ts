import Database from 'better-sqlite3';
import * as sqliteVec from 'sqlite-vec';
import type {
  NoteRecord,
  FileRecord,
  Chunk,
  Relation,
  ChunkType,
  CutType,
  InboxItem,
  InboxSource,
  InboxStatus,
  FeedRecord,
  MemoryEntry,
  MemoryHistoryEntry,
  MemoryEvent,
  MemoryRelationType,
} from '../types.js';

const SCHEMA_VERSION = 5;

interface FTSResult {
  noteId: string;
  rank: number;
}

export class BrainDB {
  private db: Database.Database;
  private vectorDimensions: number | null = null;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    sqliteVec.load(this.db);
    this.migrate();
  }

  close(): void {
    this.db.close();
  }

  // --- Schema Migration ---

  private migrate(): void {
    const currentVersion = this.db.pragma('user_version', { simple: true }) as number;

    if (currentVersion < 1) {
      this.db.exec(this.schemaV1());
      this.db.pragma(`user_version = ${SCHEMA_VERSION}`);
      this.setMetaValue('schema_version', String(SCHEMA_VERSION));
    }
    if (currentVersion >= 1 && currentVersion < 2) {
      this.db.exec('CREATE INDEX IF NOT EXISTS idx_chunks_note_id ON chunks(note_id)');
      this.db.pragma('user_version = 2');
      this.setMetaValue('schema_version', '2');
    }
    if (currentVersion >= 1 && currentVersion < 3) {
      this.migrateToV3();
      this.db.pragma('user_version = 3');
      this.setMetaValue('schema_version', '3');
    }
    if (currentVersion >= 1 && currentVersion < 4) {
      this.migrateToV4();
      this.db.pragma('user_version = 4');
      this.setMetaValue('schema_version', '4');
    }
    if (currentVersion >= 1 && currentVersion < 5) {
      this.migrateToV5();
      this.db.pragma('user_version = 5');
      this.setMetaValue('schema_version', '5');
    }

    const dims = this.getMetaValue('embedding_dimensions');
    if (dims) {
      this.ensureVectorTable(Number(dims));
    }
  }

  ensureVectorTable(dimensions: number): void {
    if (this.vectorDimensions === dimensions) return;

    const existing = this.getMetaValue('embedding_dimensions');
    if (existing && Number(existing) !== dimensions) {
      this.db.exec('DROP TABLE IF EXISTS chunk_vectors');
      this.db.exec('DROP TABLE IF EXISTS memory_vectors');
    }

    this.db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS chunk_vectors USING vec0(
        chunk_id TEXT PRIMARY KEY,
        embedding float[${dimensions}]
      )
    `);
    this.db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS memory_vectors USING vec0(
        memory_id TEXT PRIMARY KEY,
        embedding float[${dimensions}]
      )
    `);
    this.vectorDimensions = dimensions;
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
        id                TEXT PRIMARY KEY,
        note_id           TEXT NOT NULL,
        heading           TEXT,
        heading_ancestry  TEXT,
        content           TEXT NOT NULL,
        token_count       INTEGER,
        chunk_type        TEXT DEFAULT 'section',
        cut_type          TEXT DEFAULT 'heading_boundary',
        position          INTEGER DEFAULT 0,
        FOREIGN KEY (note_id) REFERENCES notes(id)
      );

      CREATE INDEX IF NOT EXISTS idx_chunks_note_id ON chunks(note_id);

      CREATE TABLE IF NOT EXISTS db_meta (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS inbox (
        id            TEXT PRIMARY KEY,
        content       TEXT NOT NULL,
        title         TEXT,
        source        TEXT NOT NULL DEFAULT 'cli',
        source_url    TEXT,
        source_meta   TEXT,
        status        TEXT NOT NULL DEFAULT 'pending',
        created_at    TEXT NOT NULL,
        processed_at  TEXT
      );

      CREATE TABLE IF NOT EXISTS feeds (
        id            TEXT PRIMARY KEY,
        url           TEXT NOT NULL UNIQUE,
        name          TEXT NOT NULL,
        container_tag TEXT NOT NULL DEFAULT 'default',
        filter_prompt TEXT,
        last_polled   TEXT,
        created_at    TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS memory_entries (
        id                TEXT PRIMARY KEY,
        memory            TEXT NOT NULL,
        source_note_id    TEXT NOT NULL,
        source_chunk_id   TEXT,
        container_tag     TEXT NOT NULL DEFAULT 'default',
        is_latest         INTEGER NOT NULL DEFAULT 1,
        parent_memory_id  TEXT,
        root_memory_id    TEXT,
        relation_type     TEXT,
        valid_at          TEXT,
        invalid_at        TEXT,
        forget_after      TEXT,
        is_forgotten      INTEGER NOT NULL DEFAULT 0,
        is_inference      INTEGER NOT NULL DEFAULT 0,
        created_at        TEXT NOT NULL,
        FOREIGN KEY (source_note_id) REFERENCES notes(id)
      );

      CREATE INDEX IF NOT EXISTS idx_memory_source ON memory_entries(source_note_id);
      CREATE INDEX IF NOT EXISTS idx_memory_latest ON memory_entries(is_latest) WHERE is_latest = 1;
      CREATE INDEX IF NOT EXISTS idx_memory_container ON memory_entries(container_tag);

      CREATE TABLE IF NOT EXISTS memory_history (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        memory_id   TEXT NOT NULL,
        event       TEXT NOT NULL,
        old_memory  TEXT,
        new_memory  TEXT,
        actor       TEXT NOT NULL DEFAULT 'system',
        created_at  TEXT NOT NULL,
        FOREIGN KEY (memory_id) REFERENCES memory_entries(id)
      );

      CREATE INDEX IF NOT EXISTS idx_memory_history_memory ON memory_history(memory_id);
    `;
  }

  private migrateToV4(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS inbox (
        id            TEXT PRIMARY KEY,
        content       TEXT NOT NULL,
        title         TEXT,
        source        TEXT NOT NULL DEFAULT 'cli',
        source_url    TEXT,
        source_meta   TEXT,
        status        TEXT NOT NULL DEFAULT 'pending',
        created_at    TEXT NOT NULL,
        processed_at  TEXT
      );

      CREATE TABLE IF NOT EXISTS feeds (
        id            TEXT PRIMARY KEY,
        url           TEXT NOT NULL UNIQUE,
        name          TEXT NOT NULL,
        container_tag TEXT NOT NULL DEFAULT 'default',
        filter_prompt TEXT,
        last_polled   TEXT,
        created_at    TEXT NOT NULL
      );
    `);
  }

  private migrateToV5(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memory_entries (
        id                TEXT PRIMARY KEY,
        memory            TEXT NOT NULL,
        source_note_id    TEXT NOT NULL,
        source_chunk_id   TEXT,
        container_tag     TEXT NOT NULL DEFAULT 'default',
        is_latest         INTEGER NOT NULL DEFAULT 1,
        parent_memory_id  TEXT,
        root_memory_id    TEXT,
        relation_type     TEXT,
        valid_at          TEXT,
        invalid_at        TEXT,
        forget_after      TEXT,
        is_forgotten      INTEGER NOT NULL DEFAULT 0,
        is_inference      INTEGER NOT NULL DEFAULT 0,
        created_at        TEXT NOT NULL,
        FOREIGN KEY (source_note_id) REFERENCES notes(id)
      );

      CREATE INDEX IF NOT EXISTS idx_memory_source ON memory_entries(source_note_id);
      CREATE INDEX IF NOT EXISTS idx_memory_latest ON memory_entries(is_latest) WHERE is_latest = 1;
      CREATE INDEX IF NOT EXISTS idx_memory_container ON memory_entries(container_tag);

      CREATE TABLE IF NOT EXISTS memory_history (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        memory_id   TEXT NOT NULL,
        event       TEXT NOT NULL,
        old_memory  TEXT,
        new_memory  TEXT,
        actor       TEXT NOT NULL DEFAULT 'system',
        created_at  TEXT NOT NULL,
        FOREIGN KEY (memory_id) REFERENCES memory_entries(id)
      );

      CREATE INDEX IF NOT EXISTS idx_memory_history_memory ON memory_history(memory_id);
    `);
  }

  private migrateToV3(): void {
    const columns = this.db.pragma('table_info(chunks)') as { name: string }[];
    const columnNames = new Set(columns.map((c) => c.name));

    if (!columnNames.has('heading_ancestry')) {
      this.db.exec('ALTER TABLE chunks ADD COLUMN heading_ancestry TEXT');
    }
    if (!columnNames.has('cut_type')) {
      this.db.exec("ALTER TABLE chunks ADD COLUMN cut_type TEXT DEFAULT 'heading_boundary'");
    }
    if (!columnNames.has('position')) {
      this.db.exec('ALTER TABLE chunks ADD COLUMN position INTEGER DEFAULT 0');
    }
  }

  // --- Meta ---

  setMetaValue(key: string, value: string): void {
    this.db.prepare('INSERT OR REPLACE INTO db_meta (key, value) VALUES (?, ?)').run(key, value);
  }

  getMetaValue(key: string): string | null {
    const row = this.db.prepare('SELECT value FROM db_meta WHERE key = ?').get(key) as
      | { value: string }
      | undefined;
    return row?.value ?? null;
  }

  // --- Embedding Model ---

  setEmbeddingModel(model: string, dimensions: number): void {
    this.setMetaValue('embedding_model', model);
    this.setMetaValue('embedding_dimensions', String(dimensions));
    this.ensureVectorTable(dimensions);
  }

  getEmbeddingModel(): { model: string; dimensions: number } | null {
    const model = this.getMetaValue('embedding_model');
    const dims = this.getMetaValue('embedding_dimensions');
    if (!model || !dims) return null;
    return { model, dimensions: Number(dims) };
  }

  checkModelMatch(model: string): void {
    const stored = this.getEmbeddingModel();
    if (!stored) return;
    if (stored.model !== model) {
      throw new Error(
        `Embedding model mismatch: DB uses "${stored.model}" but "${model}" was requested. Re-index with --force to switch models.`
      );
    }
  }

  // --- Table Introspection ---

  listTables(): string[] {
    const rows = this.db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%'"
      )
      .all() as { name: string }[];
    return rows.map((r) => r.name);
  }

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

  getAllNotes(): NoteRecord[] {
    const rows = this.db.prepare('SELECT * FROM notes').all() as NoteRow[];
    return rows.map(rowToNoteRecord);
  }

  getNoteCount(): number {
    const row = this.db.prepare('SELECT COUNT(*) as count FROM notes').get() as { count: number };
    return row.count;
  }

  deleteNote(id: string): void {
    const txn = this.db.transaction(() => {
      this.deleteMemoriesForNote(id);
      this.deleteChunksForNote(id);
      this.db.prepare('DELETE FROM notes_fts WHERE note_id = ?').run(id);
      this.db.prepare('DELETE FROM relations WHERE source_id = ? OR target_id = ?').run(id, id);
      this.db.prepare('DELETE FROM notes WHERE id = ?').run(id);
    });
    txn();
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

  // --- Search API ---

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
      conditions.push(`(${filters.tags.map(() => 'tags LIKE ?').join(' AND ')})`);
      for (const tag of filters.tags) params.push(`%${tag}%`);
    }
    if (conditions.length === 0) return null;
    const rows = this.db
      .prepare(`SELECT id FROM notes WHERE ${conditions.join(' AND ')}`)
      .all(...params) as { id: string }[];
    return new Set(rows.map((r) => r.id));
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

  getNoteByFilePath(filePath: string): NoteRecord | null {
    const row = this.db.prepare('SELECT * FROM notes WHERE file_path = ?').get(filePath) as
      | NoteRow
      | undefined;
    return row ? rowToNoteRecord(row) : null;
  }

  // --- Inbox ---

  addInboxItem(item: InboxItem): void {
    this.db
      .prepare(
        `INSERT INTO inbox (id, content, title, source, source_url, source_meta, status, created_at, processed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        item.id,
        item.content,
        item.title,
        item.source,
        item.sourceUrl,
        item.sourceMeta,
        item.status,
        item.createdAt,
        item.processedAt
      );
  }

  getInboxItems(status?: InboxStatus): InboxItem[] {
    if (status) {
      const rows = this.db
        .prepare('SELECT * FROM inbox WHERE status = ? ORDER BY created_at DESC')
        .all(status) as InboxRow[];
      return rows.map(rowToInboxItem);
    }
    const rows = this.db
      .prepare('SELECT * FROM inbox ORDER BY created_at DESC')
      .all() as InboxRow[];
    return rows.map(rowToInboxItem);
  }

  getInboxItem(id: string): InboxItem | null {
    const row = this.db.prepare('SELECT * FROM inbox WHERE id = ?').get(id) as
      | InboxRow
      | undefined;
    return row ? rowToInboxItem(row) : null;
  }

  updateInboxStatus(id: string, status: InboxStatus): void {
    const processedAt = status === 'indexed' || status === 'failed' ? new Date().toISOString() : null;
    this.db
      .prepare('UPDATE inbox SET status = ?, processed_at = COALESCE(?, processed_at) WHERE id = ?')
      .run(status, processedAt, id);
  }

  deleteInboxItem(id: string): void {
    this.db.prepare('DELETE FROM inbox WHERE id = ?').run(id);
  }

  // --- Feeds ---

  addFeed(feed: FeedRecord): void {
    this.db
      .prepare(
        `INSERT INTO feeds (id, url, name, container_tag, filter_prompt, last_polled, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        feed.id,
        feed.url,
        feed.name,
        feed.containerTag,
        feed.filterPrompt,
        feed.lastPolled,
        feed.createdAt
      );
  }

  getFeeds(): FeedRecord[] {
    const rows = this.db.prepare('SELECT * FROM feeds ORDER BY name').all() as FeedRow[];
    return rows.map(rowToFeedRecord);
  }

  getFeedById(id: string): FeedRecord | null {
    const row = this.db.prepare('SELECT * FROM feeds WHERE id = ?').get(id) as
      | FeedRow
      | undefined;
    return row ? rowToFeedRecord(row) : null;
  }

  removeFeed(id: string): void {
    this.db.prepare('DELETE FROM feeds WHERE id = ?').run(id);
  }

  updateFeedLastPolled(id: string, lastPolled: string): void {
    this.db.prepare('UPDATE feeds SET last_polled = ? WHERE id = ?').run(lastPolled, id);
  }

  // --- Memories ---

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

  getMemoryHistory(memoryId: string): MemoryHistoryEntry[] {
    const rows = this.db
      .prepare('SELECT * FROM memory_history WHERE memory_id = ? ORDER BY created_at')
      .all(memoryId) as MemoryHistoryRow[];
    return rows.map(rowToMemoryHistory);
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

interface InboxRow {
  id: string;
  content: string;
  title: string | null;
  source: string;
  source_url: string | null;
  source_meta: string | null;
  status: string;
  created_at: string;
  processed_at: string | null;
}

interface FeedRow {
  id: string;
  url: string;
  name: string;
  container_tag: string;
  filter_prompt: string | null;
  last_polled: string | null;
  created_at: string;
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

function rowToInboxItem(row: InboxRow): InboxItem {
  return {
    id: row.id,
    content: row.content,
    title: row.title,
    source: row.source as InboxSource,
    sourceUrl: row.source_url,
    sourceMeta: row.source_meta,
    status: row.status as InboxStatus,
    createdAt: row.created_at,
    processedAt: row.processed_at,
  };
}

function rowToFeedRecord(row: FeedRow): FeedRecord {
  return {
    id: row.id,
    url: row.url,
    name: row.name,
    containerTag: row.container_tag,
    filterPrompt: row.filter_prompt,
    lastPolled: row.last_polled,
    createdAt: row.created_at,
  };
}
