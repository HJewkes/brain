import { randomUUID } from 'node:crypto';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { BrainDB, sanitizeFtsQuery } from '../../src/services/brain-db.js';
import { unlinkSync } from 'node:fs';
import type { FileRecord, Chunk, Relation } from '../../src/types.js';
import { tmpDbPath, makeNote, makeChunk } from '../helpers.js';

function makeFileRecord(overrides: Partial<FileRecord> = {}): FileRecord {
  return {
    path: overrides.path ?? `/notes/${randomUUID().slice(0, 8)}.md`,
    hash: overrides.hash ?? 'abc123',
    mtime: overrides.mtime ?? Date.now(),
    indexedAt: overrides.indexedAt ?? Date.now(),
  };
}

describe('BrainDB', () => {
  let db: BrainDB;
  let dbPath: string;

  beforeEach(() => {
    dbPath = tmpDbPath();
    db = new BrainDB(dbPath);
  });

  afterEach(() => {
    db.close();
    try {
      unlinkSync(dbPath);
    } catch {
      // ignore
    }
  });

  describe('schema initialization', () => {
    it('creates all tables on construction', () => {
      const tables = db.listTables();
      expect(tables).toContain('files');
      expect(tables).toContain('notes');
      expect(tables).toContain('relations');
      expect(tables).toContain('notes_fts');
      expect(tables).toContain('chunks');
      expect(tables).toContain('db_meta');
    });

    it('sets schema_version to 5 in db_meta', () => {
      const version = db.getMetaValue('schema_version');
      expect(version).toBe('5');
    });

    it('sets and gets embedding model metadata', () => {
      db.setEmbeddingModel('bge-small-en-v1.5', 384);
      const model = db.getEmbeddingModel();
      expect(model).toEqual({ model: 'bge-small-en-v1.5', dimensions: 384 });
    });

    it('returns null when no embedding model is set', () => {
      expect(db.getEmbeddingModel()).toBeNull();
    });

    it('detects embedding model mismatch', () => {
      db.setEmbeddingModel('bge-small-en-v1.5', 384);
      expect(() => db.checkModelMatch('nomic-embed-text')).toThrow(/mismatch/i);
    });

    it('passes model match check when models agree', () => {
      db.setEmbeddingModel('bge-small-en-v1.5', 384);
      expect(() => db.checkModelMatch('bge-small-en-v1.5')).not.toThrow();
    });

    it('passes model match check when no model is stored yet', () => {
      expect(() => db.checkModelMatch('anything')).not.toThrow();
    });
  });

  describe('note CRUD', () => {
    it('inserts a note via upsertNote', () => {
      const note = makeNote({ id: 'test-1', title: 'First Note' });
      const result = db.upsertNote(note);
      expect(result.id).toBe('test-1');
      expect(result.title).toBe('First Note');
    });

    it('updates a note with same id via upsertNote', () => {
      const note = makeNote({ id: 'test-1', title: 'Original' });
      db.upsertNote(note);
      const updated = makeNote({ id: 'test-1', title: 'Updated', filePath: note.filePath });
      const result = db.upsertNote(updated);
      expect(result.title).toBe('Updated');

      const fetched = db.getNoteById('test-1');
      expect(fetched?.title).toBe('Updated');
    });

    it('retrieves a note by id', () => {
      const note = makeNote({ id: 'fetch-me' });
      db.upsertNote(note);
      const fetched = db.getNoteById('fetch-me');
      expect(fetched).not.toBeNull();
      expect(fetched?.id).toBe('fetch-me');
    });

    it('returns null for non-existent note', () => {
      expect(db.getNoteById('does-not-exist')).toBeNull();
    });

    it('deletes a note and its chunks, FTS entry, and relations', () => {
      const note = makeNote({ id: 'delete-me', summary: 'to be deleted' });
      db.upsertNote(note);

      const chunks: Chunk[] = [
        {
          id: 'delete-me:intro:0',
          noteId: 'delete-me',
          heading: 'Intro',
          headingAncestry: null,
          content: 'Hello',
          tokenCount: 1,
          chunkType: 'section',
          cutType: 'heading_boundary',
          position: 0,
        },
      ];
      const embeddings = [new Float32Array(384)];
      db.upsertChunks('delete-me', chunks, embeddings);

      const relations: Relation[] = [
        { sourceId: 'delete-me', targetId: 'other', type: 'related-to' },
      ];
      db.upsertRelations('delete-me', relations);

      db.deleteNote('delete-me');

      expect(db.getNoteById('delete-me')).toBeNull();
      expect(db.getChunksForNote('delete-me')).toHaveLength(0);
      expect(db.getRelationsFrom('delete-me')).toHaveLength(0);
    });

    it('returns all notes via getAllNotes', () => {
      db.upsertNote(makeNote({ id: 'a' }));
      db.upsertNote(makeNote({ id: 'b' }));
      db.upsertNote(makeNote({ id: 'c' }));
      const all = db.getAllNotes();
      expect(all).toHaveLength(3);
      expect(all.map((n) => n.id).sort()).toEqual(['a', 'b', 'c']);
    });
  });

  describe('file tracking', () => {
    it('upserts and retrieves a file record', () => {
      const file = makeFileRecord({ path: '/notes/test.md' });
      db.upsertFile(file);
      const fetched = db.getFile('/notes/test.md');
      expect(fetched).not.toBeNull();
      expect(fetched?.hash).toBe(file.hash);
    });

    it('returns null for non-existent file', () => {
      expect(db.getFile('/no/such/file.md')).toBeNull();
    });

    it('returns all files as a map', () => {
      db.upsertFile(makeFileRecord({ path: '/a.md' }));
      db.upsertFile(makeFileRecord({ path: '/b.md' }));
      const all = db.getAllFiles();
      expect(all.size).toBe(2);
      expect(all.has('/a.md')).toBe(true);
      expect(all.has('/b.md')).toBe(true);
    });

    it('deletes a file record', () => {
      db.upsertFile(makeFileRecord({ path: '/del.md' }));
      db.deleteFile('/del.md');
      expect(db.getFile('/del.md')).toBeNull();
    });
  });

  describe('chunk + vector operations', () => {
    it('upserts chunks and stores vectors', () => {
      const note = makeNote({ id: 'chunked' });
      db.upsertNote(note);

      const chunks: Chunk[] = [
        makeChunk({ id: 'chunked:intro:0', noteId: 'chunked', heading: 'Intro', content: 'Hello world', tokenCount: 2, position: 0 }),
        makeChunk({ id: 'chunked:body:1', noteId: 'chunked', heading: 'Body', content: 'More content', tokenCount: 3, position: 1 }),
      ];
      const embeddings = [new Float32Array(384), new Float32Array(384)];

      db.upsertChunks('chunked', chunks, embeddings);

      const stored = db.getChunksForNote('chunked');
      expect(stored).toHaveLength(2);
      expect(stored[0].heading).toBe('Intro');
      expect(stored[1].heading).toBe('Body');
      expect(stored[0].tokenCount).toBe(2);
    });

    it('deletes all chunks and vectors for a note', () => {
      const note = makeNote({ id: 'to-clear' });
      db.upsertNote(note);

      const chunks: Chunk[] = [
        makeChunk({ id: 'to-clear:s:0', noteId: 'to-clear', content: 'data', tokenCount: 1 }),
      ];
      db.upsertChunks('to-clear', chunks, [new Float32Array(384)]);

      db.deleteChunksForNote('to-clear');
      expect(db.getChunksForNote('to-clear')).toHaveLength(0);
    });
  });

  describe('relation CRUD', () => {
    it('upserts relations and replaces existing for source', () => {
      const noteA = makeNote({ id: 'rel-a' });
      const noteB = makeNote({ id: 'rel-b' });
      const noteC = makeNote({ id: 'rel-c' });
      db.upsertNote(noteA);
      db.upsertNote(noteB);
      db.upsertNote(noteC);

      db.upsertRelations('rel-a', [{ sourceId: 'rel-a', targetId: 'rel-b', type: 'related-to' }]);

      // Replace with different relations
      db.upsertRelations('rel-a', [{ sourceId: 'rel-a', targetId: 'rel-c', type: 'informs' }]);

      const from = db.getRelationsFrom('rel-a');
      expect(from).toHaveLength(1);
      expect(from[0].targetId).toBe('rel-c');
      expect(from[0].type).toBe('informs');
    });

    it('gets outgoing relations with getRelationsFrom', () => {
      db.upsertNote(makeNote({ id: 'src' }));
      db.upsertNote(makeNote({ id: 'tgt1' }));
      db.upsertNote(makeNote({ id: 'tgt2' }));

      db.upsertRelations('src', [
        { sourceId: 'src', targetId: 'tgt1', type: 'related-to' },
        { sourceId: 'src', targetId: 'tgt2', type: 'supersedes' },
      ]);

      const rels = db.getRelationsFrom('src');
      expect(rels).toHaveLength(2);
    });

    it('gets incoming relations with getRelationsTo', () => {
      db.upsertNote(makeNote({ id: 'from1' }));
      db.upsertNote(makeNote({ id: 'from2' }));
      db.upsertNote(makeNote({ id: 'target' }));

      db.upsertRelations('from1', [{ sourceId: 'from1', targetId: 'target', type: 'related-to' }]);
      db.upsertRelations('from2', [{ sourceId: 'from2', targetId: 'target', type: 'informs' }]);

      const incoming = db.getRelationsTo('target');
      expect(incoming).toHaveLength(2);
    });
  });

  describe('FTS search', () => {
    it('returns note IDs ranked by BM25', () => {
      db.upsertNote(
        makeNote({
          id: 'fts-1',
          title: 'React Server Components',
          summary: 'RSC enables server rendering',
        })
      );
      db.upsertNote(
        makeNote({ id: 'fts-2', title: 'Vue Composition API', summary: 'Vue reactivity system' })
      );

      db.upsertNoteFTS(
        'fts-1',
        'React Server Components',
        'RSC enables server rendering',
        'Full content about React Server Components and rendering patterns'
      );
      db.upsertNoteFTS(
        'fts-2',
        'Vue Composition API',
        'Vue reactivity system',
        'Content about Vue composition'
      );

      const results = db.searchFTS('React Server Components', 10);
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results[0].noteId).toBe('fts-1');
    });

    it('matches on title, summary, and content', () => {
      db.upsertNote(makeNote({ id: 'title-match', title: 'Kubernetes' }));
      db.upsertNoteFTS('title-match', 'Kubernetes', '', '');

      db.upsertNote(makeNote({ id: 'summary-match', summary: 'Kubernetes orchestration' }));
      db.upsertNoteFTS('summary-match', 'Other', 'Kubernetes orchestration', '');

      db.upsertNote(makeNote({ id: 'content-match' }));
      db.upsertNoteFTS('content-match', 'Other', '', 'Deep dive into Kubernetes');

      const results = db.searchFTS('Kubernetes', 10);
      expect(results).toHaveLength(3);
    });

    it('returns empty results for empty query', () => {
      const results = db.searchFTS('', 10);
      expect(results).toHaveLength(0);
    });

    it('handles special FTS5 characters without crashing', () => {
      db.upsertNote(makeNote({ id: 'special' }));
      db.upsertNoteFTS('special', 'Test', '', 'Content about brackets');

      expect(() => db.searchFTS('"unbalanced', 10)).not.toThrow();
      expect(() => db.searchFTS('OR AND NOT', 10)).not.toThrow();
      expect(() => db.searchFTS('term*', 10)).not.toThrow();
    });
  });

  describe('dynamic vector table', () => {
    it('ensureVectorTable creates table with correct dimensions', () => {
      db.ensureVectorTable(768);
      const tables = db.listTables();
      expect(tables).toContain('chunk_vectors');
    });

    it('ensureVectorTable with different dimensions drops and recreates', () => {
      db.setEmbeddingModel('model-a', 384);
      db.ensureVectorTable(384);

      const note = makeNote({ id: 'dim-test' });
      db.upsertNote(note);
      const chunks: Chunk[] = [
        makeChunk({ id: 'dim-test:s:0', noteId: 'dim-test', content: 'data', tokenCount: 1 }),
      ];
      db.upsertChunks('dim-test', chunks, [new Float32Array(384)]);

      // Change dimensions — should drop and recreate
      db.setMetaValue('embedding_dimensions', '768');
      db.ensureVectorTable(768);

      // Old data is gone after drop
      const tables = db.listTables();
      expect(tables).toContain('chunk_vectors');
    });
  });

  describe('search API methods', () => {
    it('searchVector returns results', () => {
      db.ensureVectorTable(384);
      const note = makeNote({ id: 'vec-note' });
      db.upsertNote(note);

      const chunks: Chunk[] = [
        makeChunk({ id: 'vec-note:s:0', noteId: 'vec-note', heading: 'Test', content: 'Hello world', tokenCount: 2 }),
      ];
      const vec = new Float32Array(384);
      vec[0] = 1.0;
      db.upsertChunks('vec-note', chunks, [vec]);

      const queryVec = new Float32Array(384);
      queryVec[0] = 1.0;
      const results = db.searchVector(queryVec, 5);
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results[0].chunkId).toBe('vec-note:s:0');
      expect(results[0].noteId).toBe('vec-note');
    });

    it('getFilteredNoteIds filters by tier', () => {
      db.upsertNote(makeNote({ id: 'slow-1', tier: 'slow' }));
      db.upsertNote(makeNote({ id: 'fast-1', tier: 'fast' }));

      const result = db.getFilteredNoteIds({ tier: 'slow' });
      expect(result).not.toBeNull();
      expect(result!.has('slow-1')).toBe(true);
      expect(result!.has('fast-1')).toBe(false);
    });

    it('getFilteredNoteIds returns null when no filters provided', () => {
      expect(db.getFilteredNoteIds({})).toBeNull();
    });

    it('getFilteredNoteIds filters by tags', () => {
      db.upsertNote(makeNote({ id: 'tagged', tags: 'typescript,react' }));
      db.upsertNote(makeNote({ id: 'untagged', tags: 'python' }));

      const result = db.getFilteredNoteIds({ tags: ['typescript'] });
      expect(result!.has('tagged')).toBe(true);
      expect(result!.has('untagged')).toBe(false);
    });

    it('getNoteByFilePath returns correct note', () => {
      const note = makeNote({ id: 'fp-test', filePath: '/notes/test-file.md' });
      db.upsertNote(note);

      const found = db.getNoteByFilePath('/notes/test-file.md');
      expect(found).not.toBeNull();
      expect(found!.id).toBe('fp-test');
    });

    it('getNoteByFilePath returns null for unknown path', () => {
      expect(db.getNoteByFilePath('/no/such/file.md')).toBeNull();
    });

    it('getChunkContent returns content', () => {
      db.ensureVectorTable(384);
      const note = makeNote({ id: 'cc-test' });
      db.upsertNote(note);
      const chunks: Chunk[] = [
        makeChunk({ id: 'cc-test:s:0', noteId: 'cc-test', content: 'Chunk content here', tokenCount: 3 }),
      ];
      db.upsertChunks('cc-test', chunks, [new Float32Array(384)]);

      expect(db.getChunkContent('cc-test:s:0')).toBe('Chunk content here');
      expect(db.getChunkContent('nonexistent')).toBe('');
    });

    it('getFirstChunkForNote returns first chunk', () => {
      db.ensureVectorTable(384);
      const note = makeNote({ id: 'fc-test' });
      db.upsertNote(note);
      const chunks: Chunk[] = [
        makeChunk({ id: 'fc-test:intro:0', noteId: 'fc-test', heading: 'Intro', content: 'First chunk', tokenCount: 2, position: 0 }),
        makeChunk({ id: 'fc-test:body:1', noteId: 'fc-test', heading: 'Body', content: 'Second chunk', tokenCount: 2, position: 1 }),
      ];
      db.upsertChunks('fc-test', chunks, [new Float32Array(384), new Float32Array(384)]);

      const first = db.getFirstChunkForNote('fc-test');
      expect(first).not.toBeNull();
      expect(first!.content).toBe('First chunk');
      expect(first!.heading).toBe('Intro');
    });

    it('getChunkHeading returns heading for chunk', () => {
      db.ensureVectorTable(384);
      const note = makeNote({ id: 'ch-test' });
      db.upsertNote(note);
      const chunks: Chunk[] = [
        makeChunk({ id: 'ch-test:s:0', noteId: 'ch-test', heading: 'My Heading', content: 'data', tokenCount: 1 }),
      ];
      db.upsertChunks('ch-test', chunks, [new Float32Array(384)]);

      expect(db.getChunkHeading('ch-test:s:0', 'ch-test')).toBe('My Heading');
    });
  });

  describe('sanitizeFtsQuery', () => {
    it('wraps terms in quotes', () => {
      expect(sanitizeFtsQuery('hello world')).toBe('"hello" "world"');
    });

    it('escapes embedded quotes', () => {
      expect(sanitizeFtsQuery('"unbalanced')).toBe('"""unbalanced"');
    });

    it('handles empty string', () => {
      expect(sanitizeFtsQuery('')).toBe('');
    });

    it('strips extra whitespace', () => {
      expect(sanitizeFtsQuery('  a   b  ')).toBe('"a" "b"');
    });
  });

  describe('schema v5 migration', () => {
    it('new databases get latest schema version', () => {
      expect(db.getMetaValue('schema_version')).toBe('5');
    });

    it('creates inbox table', () => {
      expect(db.listTables()).toContain('inbox');
    });

    it('creates feeds table', () => {
      expect(db.listTables()).toContain('feeds');
    });

    it('creates memory_entries table', () => {
      expect(db.listTables()).toContain('memory_entries');
    });

    it('creates memory_history table', () => {
      expect(db.listTables()).toContain('memory_history');
    });
  });

  describe('inbox CRUD', () => {
    const makeItem = (overrides: Partial<import('../../src/types.js').InboxItem> = {}): import('../../src/types.js').InboxItem => ({
      id: 'test-inbox-1',
      content: 'Some captured thought',
      title: null,
      source: 'cli',
      sourceUrl: null,
      sourceMeta: null,
      status: 'pending',
      createdAt: '2026-01-01T00:00:00Z',
      processedAt: null,
      ...overrides,
    });

    it('adds and retrieves inbox items', () => {
      db.addInboxItem(makeItem());
      const items = db.getInboxItems();
      expect(items).toHaveLength(1);
      expect(items[0].content).toBe('Some captured thought');
      expect(items[0].status).toBe('pending');
    });

    it('filters by status', () => {
      db.addInboxItem(makeItem({ id: 'a', status: 'pending' }));
      db.addInboxItem(makeItem({ id: 'b', status: 'indexed' }));
      expect(db.getInboxItems('pending')).toHaveLength(1);
      expect(db.getInboxItems('indexed')).toHaveLength(1);
    });

    it('gets single item by id', () => {
      db.addInboxItem(makeItem());
      expect(db.getInboxItem('test-inbox-1')).not.toBeNull();
      expect(db.getInboxItem('nonexistent')).toBeNull();
    });

    it('updates status with processed_at for terminal states', () => {
      db.addInboxItem(makeItem());
      db.updateInboxStatus('test-inbox-1', 'indexed');
      const item = db.getInboxItem('test-inbox-1')!;
      expect(item.status).toBe('indexed');
      expect(item.processedAt).not.toBeNull();
    });

    it('deletes inbox items', () => {
      db.addInboxItem(makeItem());
      db.deleteInboxItem('test-inbox-1');
      expect(db.getInboxItem('test-inbox-1')).toBeNull();
    });
  });

  describe('feed CRUD', () => {
    const makeFeed = (overrides: Partial<import('../../src/types.js').FeedRecord> = {}): import('../../src/types.js').FeedRecord => ({
      id: 'feed-1',
      url: 'https://example.com/feed.xml',
      name: 'Example Feed',
      containerTag: 'default',
      filterPrompt: null,
      lastPolled: null,
      createdAt: '2026-01-01T00:00:00Z',
      ...overrides,
    });

    it('adds and lists feeds', () => {
      db.addFeed(makeFeed());
      const feeds = db.getFeeds();
      expect(feeds).toHaveLength(1);
      expect(feeds[0].name).toBe('Example Feed');
    });

    it('gets feed by id', () => {
      db.addFeed(makeFeed());
      expect(db.getFeedById('feed-1')).not.toBeNull();
      expect(db.getFeedById('nonexistent')).toBeNull();
    });

    it('enforces unique URLs', () => {
      db.addFeed(makeFeed());
      expect(() => db.addFeed(makeFeed({ id: 'feed-2' }))).toThrow();
    });

    it('removes feeds', () => {
      db.addFeed(makeFeed());
      db.removeFeed('feed-1');
      expect(db.getFeeds()).toHaveLength(0);
    });

    it('updates last polled timestamp', () => {
      db.addFeed(makeFeed());
      db.updateFeedLastPolled('feed-1', '2026-02-01T00:00:00Z');
      const feed = db.getFeedById('feed-1')!;
      expect(feed.lastPolled).toBe('2026-02-01T00:00:00Z');
    });
  });

  describe('memory CRUD', () => {
    const makeMemory = (overrides: Partial<import('../../src/types.js').MemoryEntry> = {}): import('../../src/types.js').MemoryEntry => ({
      id: 'mem-1',
      memory: 'TypeScript uses structural typing',
      sourceNoteId: 'test-note',
      sourceChunkId: null,
      containerTag: 'default',
      isLatest: true,
      parentMemoryId: null,
      rootMemoryId: null,
      relationType: null,
      validAt: '2026-01-01T00:00:00Z',
      invalidAt: null,
      forgetAfter: null,
      isForgotten: false,
      isInference: false,
      createdAt: '2026-01-01T00:00:00Z',
      ...overrides,
    });

    beforeEach(() => {
      db.upsertNote({
        id: 'test-note',
        filePath: '/tmp/test.md',
        title: 'Test',
        type: 'note',
        tier: 'slow',
        category: null,
        tags: null,
        summary: null,
        confidence: null,
        status: 'current',
        sources: null,
        createdAt: null,
        modifiedAt: null,
        lastReviewed: null,
        reviewInterval: null,
        expires: null,
        metadata: null,
      });
    });

    it('adds and retrieves a memory', () => {
      db.addMemory(makeMemory());
      const mem = db.getMemory('mem-1');
      expect(mem).not.toBeNull();
      expect(mem!.memory).toBe('TypeScript uses structural typing');
      expect(mem!.isLatest).toBe(true);
      expect(mem!.isForgotten).toBe(false);
    });

    it('gets memories for a note', () => {
      db.addMemory(makeMemory({ id: 'mem-1' }));
      db.addMemory(makeMemory({ id: 'mem-2', memory: 'Second fact' }));
      const memories = db.getMemoriesForNote('test-note');
      expect(memories).toHaveLength(2);
    });

    it('gets latest memories filtered by container', () => {
      db.addMemory(makeMemory({ id: 'mem-1', containerTag: 'project-a' }));
      db.addMemory(makeMemory({ id: 'mem-2', containerTag: 'project-b' }));
      expect(db.getLatestMemories('project-a')).toHaveLength(1);
      expect(db.getLatestMemories()).toHaveLength(2);
    });

    it('marks memory as superseded', () => {
      db.addMemory(makeMemory());
      db.markMemorySuperseded('mem-1');
      const mem = db.getMemory('mem-1')!;
      expect(mem.isLatest).toBe(false);
    });

    it('tracks version chain', () => {
      db.addMemory(makeMemory({ id: 'root' }));
      db.markMemorySuperseded('root');
      db.addMemory(makeMemory({
        id: 'v2',
        memory: 'Updated fact',
        parentMemoryId: 'root',
        rootMemoryId: 'root',
        relationType: 'updates',
      }));
      const chain = db.getMemoryVersionChain('root');
      expect(chain).toHaveLength(2);
      expect(chain[0].id).toBe('root');
      expect(chain[1].id).toBe('v2');
    });

    it('deletes memories for a note including vectors and history', () => {
      db.ensureVectorTable(384);
      db.addMemory(makeMemory());
      db.upsertMemoryVector('mem-1', new Float32Array(384));
      db.addMemoryHistory({
        memoryId: 'mem-1',
        event: 'add',
        oldMemory: null,
        newMemory: 'TypeScript uses structural typing',
        actor: 'extractor',
        createdAt: '2026-01-01T00:00:00Z',
      });

      db.deleteMemoriesForNote('test-note');

      expect(db.getMemoriesForNote('test-note')).toHaveLength(0);
      expect(db.getMemory('mem-1')).toBeNull();
      expect(db.getMemoryHistory('mem-1')).toHaveLength(0);
      expect(db.searchMemoryVectors(new Float32Array(384), 10)).toHaveLength(0);
    });

    it('deleteNote cascades to memories, vectors, and history', () => {
      db.ensureVectorTable(384);
      db.addMemory(makeMemory());
      db.upsertMemoryVector('mem-1', new Float32Array(384));
      db.addMemoryHistory({
        memoryId: 'mem-1',
        event: 'add',
        oldMemory: null,
        newMemory: 'TypeScript uses structural typing',
        actor: 'extractor',
        createdAt: '2026-01-01T00:00:00Z',
      });

      db.deleteNote('test-note');

      expect(db.getNoteById('test-note')).toBeNull();
      expect(db.getMemory('mem-1')).toBeNull();
      expect(db.getMemoryHistory('mem-1')).toHaveLength(0);
      expect(db.searchMemoryVectors(new Float32Array(384), 10)).toHaveLength(0);
    });

    it('counts active memories', () => {
      db.addMemory(makeMemory({ id: 'mem-1' }));
      db.addMemory(makeMemory({ id: 'mem-2', isForgotten: true }));
      expect(db.getMemoryCount()).toBe(1);
    });

    it('records and retrieves history', () => {
      db.addMemory(makeMemory());
      db.addMemoryHistory({
        memoryId: 'mem-1',
        event: 'add',
        oldMemory: null,
        newMemory: 'TypeScript uses structural typing',
        actor: 'extractor',
        createdAt: '2026-01-01T00:00:00Z',
      });
      const history = db.getMemoryHistory('mem-1');
      expect(history).toHaveLength(1);
      expect(history[0].event).toBe('add');
      expect(history[0].newMemory).toBe('TypeScript uses structural typing');
    });

    it('forgets expired memories', () => {
      const past = '2020-01-01T00:00:00Z';
      db.addMemory(makeMemory({ id: 'expiring', forgetAfter: past }));
      db.addMemory(makeMemory({ id: 'permanent' }));

      const forgotten = db.forgetExpiredMemories();
      expect(forgotten).toBe(1);

      const mem = db.getMemory('expiring')!;
      expect(mem.isForgotten).toBe(true);
      expect(db.getMemoryCount()).toBe(1);
    });

    it('does not forget future-dated memories', () => {
      const future = '2099-01-01T00:00:00Z';
      db.addMemory(makeMemory({ id: 'future', forgetAfter: future }));

      const forgotten = db.forgetExpiredMemories();
      expect(forgotten).toBe(0);
      expect(db.getMemory('future')!.isForgotten).toBe(false);
    });

    it('queries memories since a date', () => {
      db.addMemory(makeMemory({ id: 'old', createdAt: '2025-01-01T00:00:00Z' }));
      db.addMemory(makeMemory({ id: 'recent', createdAt: '2026-02-01T00:00:00Z' }));

      const since = db.getMemoriesSince('2026-01-01T00:00:00Z');
      expect(since).toHaveLength(1);
      expect(since[0].id).toBe('recent');
    });

    it('queries memories since a date filtered by container', () => {
      db.addMemory(makeMemory({ id: 'm1', createdAt: '2026-02-01T00:00:00Z', containerTag: 'a' }));
      db.addMemory(makeMemory({ id: 'm2', createdAt: '2026-02-01T00:00:00Z', containerTag: 'b' }));

      const filtered = db.getMemoriesSince('2026-01-01T00:00:00Z', 'a');
      expect(filtered).toHaveLength(1);
      expect(filtered[0].containerTag).toBe('a');
    });

    it('upsertMemoryVector + searchMemoryVectors round-trip', () => {
      db.ensureVectorTable(384);
      db.addMemory(makeMemory({ id: 'mv-1' }));
      db.addMemory(makeMemory({ id: 'mv-2' }));

      const vec1 = new Float32Array(384);
      vec1[0] = 1.0;
      const vec2 = new Float32Array(384);
      vec2[1] = 1.0;

      db.upsertMemoryVector('mv-1', vec1);
      db.upsertMemoryVector('mv-2', vec2);

      const results = db.searchMemoryVectors(vec1, 5);
      expect(results.length).toBe(2);
      expect(results[0].memoryId).toBe('mv-1');
      expect(results[0].distance).toBeLessThan(results[1].distance);
    });

    it('upsertMemoryVector replaces existing vector', () => {
      db.ensureVectorTable(384);
      db.addMemory(makeMemory({ id: 'mv-replace' }));

      const vec1 = new Float32Array(384);
      vec1[0] = 1.0;
      db.upsertMemoryVector('mv-replace', vec1);

      const vec2 = new Float32Array(384);
      vec2[1] = 1.0;
      db.upsertMemoryVector('mv-replace', vec2);

      const results = db.searchMemoryVectors(vec2, 5);
      expect(results).toHaveLength(1);
      expect(results[0].memoryId).toBe('mv-replace');
    });

    it('getMemoriesByIds returns batch of memories', () => {
      db.addMemory(makeMemory({ id: 'batch-1', memory: 'Fact one' }));
      db.addMemory(makeMemory({ id: 'batch-2', memory: 'Fact two' }));
      db.addMemory(makeMemory({ id: 'batch-3', memory: 'Fact three' }));

      const result = db.getMemoriesByIds(['batch-1', 'batch-3']);
      expect(result.size).toBe(2);
      expect(result.get('batch-1')?.memory).toBe('Fact one');
      expect(result.get('batch-3')?.memory).toBe('Fact three');
      expect(result.has('batch-2')).toBe(false);
    });

    it('getMemoriesByIds returns empty map for empty input', () => {
      const result = db.getMemoriesByIds([]);
      expect(result.size).toBe(0);
    });

    it('getMemoriesByIds ignores non-existent ids', () => {
      db.addMemory(makeMemory({ id: 'exists' }));
      const result = db.getMemoriesByIds(['exists', 'does-not-exist']);
      expect(result.size).toBe(1);
      expect(result.has('exists')).toBe(true);
    });
  });
});
