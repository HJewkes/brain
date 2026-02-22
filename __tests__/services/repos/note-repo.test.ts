import { randomUUID } from 'node:crypto';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { BrainDB } from '../../../src/services/brain-db.js';
import { unlinkSync } from 'node:fs';
import type { FileRecord, Chunk } from '../../../src/types.js';
import { tmpDbPath, makeNote, makeChunk } from '../../helpers.js';

function makeFileRecord(overrides: Partial<FileRecord> = {}): FileRecord {
  return {
    path: overrides.path ?? `/notes/${randomUUID().slice(0, 8)}.md`,
    hash: overrides.hash ?? 'abc123',
    mtime: overrides.mtime ?? Date.now(),
    indexedAt: overrides.indexedAt ?? Date.now(),
  };
}

describe('NoteRepo', () => {
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

  describe('batch methods', () => {
    it('getNotesByIds returns batch of notes', () => {
      db.upsertNote(makeNote({ id: 'bn-1', title: 'Note One' }));
      db.upsertNote(makeNote({ id: 'bn-2', title: 'Note Two' }));
      db.upsertNote(makeNote({ id: 'bn-3', title: 'Note Three' }));

      const result = db.getNotesByIds(['bn-1', 'bn-3']);
      expect(result.size).toBe(2);
      expect(result.get('bn-1')?.title).toBe('Note One');
      expect(result.get('bn-3')?.title).toBe('Note Three');
      expect(result.has('bn-2')).toBe(false);
    });

    it('getNotesByIds returns empty map for empty input', () => {
      expect(db.getNotesByIds([]).size).toBe(0);
    });

    it('getNotesByIds ignores non-existent ids', () => {
      db.upsertNote(makeNote({ id: 'exists' }));
      const result = db.getNotesByIds(['exists', 'nope']);
      expect(result.size).toBe(1);
    });

    it('getRelationsBatch returns from/to for each id', () => {
      db.upsertNote(makeNote({ id: 'rb-a' }));
      db.upsertNote(makeNote({ id: 'rb-b' }));
      db.upsertNote(makeNote({ id: 'rb-c' }));

      db.upsertRelations('rb-a', [
        { sourceId: 'rb-a', targetId: 'rb-b', type: 'related-to' },
      ]);
      db.upsertRelations('rb-b', [
        { sourceId: 'rb-b', targetId: 'rb-c', type: 'informs' },
      ]);

      const batch = db.getRelationsBatch(['rb-a', 'rb-b']);
      expect(batch.get('rb-a')?.from).toHaveLength(1);
      expect(batch.get('rb-a')?.to).toHaveLength(0);
      expect(batch.get('rb-b')?.from).toHaveLength(1);
      expect(batch.get('rb-b')?.to).toHaveLength(1);
    });

    it('getRelationsBatch returns empty map for empty input', () => {
      expect(db.getRelationsBatch([]).size).toBe(0);
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

    it('getFilteredNoteIds does not match substring tags', () => {
      db.upsertNote(makeNote({ id: 'ai-note', tags: 'ai,ml' }));
      db.upsertNote(makeNote({ id: 'railway-note', tags: 'railway' }));

      const result = db.getFilteredNoteIds({ tags: ['ai'] });
      expect(result!.has('ai-note')).toBe(true);
      expect(result!.has('railway-note')).toBe(false);
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
});
