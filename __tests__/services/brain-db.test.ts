import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { BrainDB, sanitizeFtsQuery } from '../../src/services/brain-db.js';
import { unlinkSync } from 'node:fs';
import type { Chunk, Relation } from '../../src/types.js';
import { tmpDbPath, makeNote } from '../helpers.js';

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

  describe('deleteNote cascade', () => {
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

    it('deleteNote cascades to memories, vectors, and history', () => {
      db.ensureVectorTable(384);

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

      db.addMemory({
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
      });
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
});
