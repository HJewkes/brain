import Database from 'better-sqlite3';
import * as sqliteVec from 'sqlite-vec';
import type {
  NoteRecord,
  FileRecord,
  Chunk,
  Relation,
  InboxItem,
  InboxStatus,
  FeedRecord,
  MemoryEntry,
  MemoryHistoryEntry,
  NoteAccessEvent,
} from '../types.js';
import { NoteRepo } from './repos/note-repo.js';
import { MemoryRepo } from './repos/memory-repo.js';
import { CaptureRepo } from './repos/capture-repo.js';

export { sanitizeFtsQuery } from './repos/note-repo.js';

export interface CascadePreview {
  noteIds: string[];
  noteCount: number;
  memoryCount: number;
}

const SCHEMA_VERSION = 6;

export class BrainDB {
  private db: Database.Database;
  private vectorDimensions: number | null = null;
  private noteRepo: NoteRepo;
  private memoryRepo: MemoryRepo;
  private captureRepo: CaptureRepo;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    sqliteVec.load(this.db);
    this.migrate();
    this.noteRepo = new NoteRepo(this.db, (dims) => this.ensureVectorTable(dims));
    this.memoryRepo = new MemoryRepo(this.db);
    this.captureRepo = new CaptureRepo(this.db);
  }

  close(): void {
    this.db.close();
  }

  // --- Schema Migration ---

  private applyMigration(current: number, target: number, fn: () => void): void {
    if (current >= 1 && current < target) {
      fn();
      this.db.pragma(`user_version = ${target}`);
      this.setMetaValue('schema_version', String(target));
    }
  }

  private migrate(): void {
    const currentVersion = this.db.pragma('user_version', { simple: true }) as number;

    if (currentVersion < 1) {
      this.db.exec(this.schemaV1());
      this.db.pragma(`user_version = ${SCHEMA_VERSION}`);
      this.setMetaValue('schema_version', String(SCHEMA_VERSION));
    }
    this.applyMigration(currentVersion, 2, () =>
      this.db.exec('CREATE INDEX IF NOT EXISTS idx_chunks_note_id ON chunks(note_id)')
    );
    this.applyMigration(currentVersion, 3, () => this.migrateToV3());
    this.applyMigration(currentVersion, 4, () => this.db.exec(this.captureDDL()));
    this.applyMigration(currentVersion, 5, () => this.db.exec(this.memoryDDL()));
    this.applyMigration(currentVersion, 6, () => this.db.exec(this.noteAccessDDL()));

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

  private captureDDL(): string {
    return `
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
    `;
  }

  private memoryDDL(): string {
    return `
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

  private noteAccessDDL(): string {
    return `
      CREATE TABLE IF NOT EXISTS note_access (
        note_id    TEXT NOT NULL,
        event      TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_note_access_note ON note_access(note_id);
    `;
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

      ${this.captureDDL()}
      ${this.memoryDDL()}
      ${this.noteAccessDDL()}
    `;
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

  // --- Cross-repo Orchestration ---

  deleteNote(id: string): void {
    const txn = this.db.transaction(() => {
      this.memoryRepo.deleteMemoriesForNote(id);
      this.noteRepo.deleteChunksForNote(id);
      this.db.prepare('DELETE FROM notes_fts WHERE note_id = ?').run(id);
      this.db.prepare('DELETE FROM relations WHERE source_id = ? OR target_id = ?').run(id, id);
      this.db.prepare('DELETE FROM notes WHERE id = ?').run(id);
    });
    txn();
  }

  cascadeDeletePreview(noteId: string): CascadePreview {
    const descendants = this.noteRepo.getDescendants(noteId);
    const allIds = [noteId, ...descendants.map((d) => d.id)];
    let memoryCount = 0;
    for (const id of allIds) {
      memoryCount += this.memoryRepo.getMemoriesForNote(id).length;
    }
    return { noteIds: allIds, noteCount: allIds.length, memoryCount };
  }

  cascadeDelete(noteId: string): CascadePreview {
    const preview = this.cascadeDeletePreview(noteId);
    const descendants = this.noteRepo.getDescendants(noteId);
    const sorted = [...descendants].sort((a, b) => b.depth - a.depth);

    const txn = this.db.transaction(() => {
      for (const desc of sorted) {
        this.deleteNote(desc.id);
      }
      this.deleteNote(noteId);
    });
    txn();

    return preview;
  }

  // --- Note Delegates ---

  upsertNote(record: NoteRecord): NoteRecord { return this.noteRepo.upsertNote(record); }
  getNoteById(id: string): NoteRecord | null { return this.noteRepo.getNoteById(id); }
  getNotesByIds(ids: string[]): Map<string, NoteRecord> { return this.noteRepo.getNotesByIds(ids); }
  getAllNotes(): NoteRecord[] { return this.noteRepo.getAllNotes(); }
  getNoteCount(): number { return this.noteRepo.getNoteCount(); }
  getNoteByFilePath(filePath: string): NoteRecord | null { return this.noteRepo.getNoteByFilePath(filePath); }

  // --- File Delegates ---

  upsertFile(record: FileRecord): void { this.noteRepo.upsertFile(record); }
  getFile(path: string): FileRecord | null { return this.noteRepo.getFile(path); }
  getAllFiles(): Map<string, FileRecord> { return this.noteRepo.getAllFiles(); }
  deleteFile(path: string): void { this.noteRepo.deleteFile(path); }

  // --- Chunk Delegates ---

  upsertChunks(noteId: string, chunks: Chunk[], embeddings: Float32Array[]): void { this.noteRepo.upsertChunks(noteId, chunks, embeddings); }
  getChunksForNote(noteId: string): Chunk[] { return this.noteRepo.getChunksForNote(noteId); }
  getChunkCount(): number { return this.noteRepo.getChunkCount(); }
  deleteChunksForNote(noteId: string): void { this.noteRepo.deleteChunksForNote(noteId); }
  getChunkContent(chunkId: string): string { return this.noteRepo.getChunkContent(chunkId); }
  getFirstChunkForNote(noteId: string): { content: string; heading: string | null } | null { return this.noteRepo.getFirstChunkForNote(noteId); }
  getChunkHeading(chunkId: string | null, noteId: string): string | null { return this.noteRepo.getChunkHeading(chunkId, noteId); }

  // --- Relation Delegates ---

  upsertRelations(noteId: string, relations: Relation[]): void { this.noteRepo.upsertRelations(noteId, relations); }
  getRelationsFrom(noteId: string): Relation[] { return this.noteRepo.getRelationsFrom(noteId); }
  getRelationsTo(noteId: string): Relation[] { return this.noteRepo.getRelationsTo(noteId); }
  getRelationsBatch(ids: string[]): Map<string, { from: Relation[]; to: Relation[] }> { return this.noteRepo.getRelationsBatch(ids); }
  getDescendants(noteId: string, maxDepth?: number): Array<{ id: string; depth: number }> { return this.noteRepo.getDescendants(noteId, maxDepth); }

  // --- Access Delegates ---

  recordAccess(noteId: string, event: NoteAccessEvent): void { this.noteRepo.recordAccess(noteId, event); }
  getAccessCount(noteId: string): number { return this.noteRepo.getAccessCount(noteId); }
  getAccessCounts(noteIds: string[]): Map<string, number> { return this.noteRepo.getAccessCounts(noteIds); }

  // --- FTS Delegates ---

  upsertNoteFTS(noteId: string, title: string, summary: string, content: string): void { this.noteRepo.upsertNoteFTS(noteId, title, summary, content); }
  searchFTS(query: string, limit: number): Array<{ noteId: string; rank: number }> { return this.noteRepo.searchFTS(query, limit); }

  // --- Search Delegates ---

  searchVector(embedding: Float32Array, limit: number): Array<{ chunkId: string; noteId: string; distance: number }> { return this.noteRepo.searchVector(embedding, limit); }
  getFilteredNoteIds(filters: { tier?: string; category?: string; confidence?: string; since?: string; tags?: string[] }): Set<string> | null { return this.noteRepo.getFilteredNoteIds(filters); }

  // --- Memory Delegates ---

  addMemory(entry: MemoryEntry): void { this.memoryRepo.addMemory(entry); }
  getMemory(id: string): MemoryEntry | null { return this.memoryRepo.getMemory(id); }
  getMemoriesForNote(noteId: string): MemoryEntry[] { return this.memoryRepo.getMemoriesForNote(noteId); }
  getLatestMemories(containerTag?: string): MemoryEntry[] { return this.memoryRepo.getLatestMemories(containerTag); }
  getMemoryVersionChain(rootId: string): MemoryEntry[] { return this.memoryRepo.getMemoryVersionChain(rootId); }
  markMemorySuperseded(id: string): void { this.memoryRepo.markMemorySuperseded(id); }
  deleteMemoriesForNote(noteId: string): void { this.memoryRepo.deleteMemoriesForNote(noteId); }
  forgetExpiredMemories(): number { return this.memoryRepo.forgetExpiredMemories(); }
  getMemoriesSince(since: string, containerTag?: string): MemoryEntry[] { return this.memoryRepo.getMemoriesSince(since, containerTag); }
  getMemoryCount(): number { return this.memoryRepo.getMemoryCount(); }
  getMemoriesByIds(ids: string[]): Map<string, MemoryEntry> { return this.memoryRepo.getMemoriesByIds(ids); }
  addMemoryHistory(entry: Omit<MemoryHistoryEntry, 'id'>): void { this.memoryRepo.addMemoryHistory(entry); }
  getMemoryHistory(memoryId: string): MemoryHistoryEntry[] { return this.memoryRepo.getMemoryHistory(memoryId); }
  deleteMemoryVector(memoryId: string): void { this.memoryRepo.deleteMemoryVector(memoryId); }
  upsertMemoryVector(memoryId: string, embedding: Float32Array): void { this.memoryRepo.upsertMemoryVector(memoryId, embedding); }
  searchMemoryVectors(embedding: Float32Array, limit: number): Array<{ memoryId: string; distance: number }> { return this.memoryRepo.searchMemoryVectors(embedding, limit); }

  // --- Capture Delegates ---

  addInboxItem(item: InboxItem): void { this.captureRepo.addInboxItem(item); }
  getInboxItems(status?: InboxStatus): InboxItem[] { return this.captureRepo.getInboxItems(status); }
  getInboxItem(id: string): InboxItem | null { return this.captureRepo.getInboxItem(id); }
  updateInboxStatus(id: string, status: InboxStatus): void { this.captureRepo.updateInboxStatus(id, status); }
  deleteInboxItem(id: string): void { this.captureRepo.deleteInboxItem(id); }
  addFeed(feed: FeedRecord): void { this.captureRepo.addFeed(feed); }
  getFeeds(): FeedRecord[] { return this.captureRepo.getFeeds(); }
  getFeedById(id: string): FeedRecord | null { return this.captureRepo.getFeedById(id); }
  removeFeed(id: string): void { this.captureRepo.removeFeed(id); }
  updateFeedLastPolled(id: string, lastPolled: string): void { this.captureRepo.updateFeedLastPolled(id, lastPolled); }
}
