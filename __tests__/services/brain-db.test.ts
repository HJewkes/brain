import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { BrainDB, sanitizeFtsQuery } from '../../src/services/brain-db.js';
import { unlinkSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
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

    it('sets schema_version to 12 in db_meta', () => {
      const version = db.getMetaValue('schema_version');
      expect(version).toBe('12');
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
      expect(db.getMetaValue('schema_version')).toBe('12');
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
          contentType: 'prose',
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
        category: null,
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

  describe('schema V6 migration', () => {
    it('creates note_access table', () => {
      const tables = db.listTables();
      expect(tables).toContain('note_access');
    });

    it('sets schema_version to 12', () => {
      expect(db.getMetaValue('schema_version')).toBe('12');
    });

    it('stores derived-from relation type', () => {
      db.upsertNote(makeNote({ id: 'parent-note', filePath: '/test/parent.md', title: 'Parent' }));
      db.upsertNote(
        makeNote({
          id: 'child-note',
          filePath: '/test/child.md',
          title: 'Child',
          type: 'research',
          tier: 'fast',
        })
      );

      db.upsertRelations('child-note', [
        { sourceId: 'child-note', targetId: 'parent-note', type: 'derived-from' },
      ]);

      const rels = db.getRelationsFrom('child-note');
      expect(rels).toHaveLength(1);
      expect(rels[0].type).toBe('derived-from');
      expect(rels[0].targetId).toBe('parent-note');
    });
  });

  describe('cascadeDelete', () => {
    beforeEach(() => {
      for (const id of ['initiative', 'child1', 'child2', 'grandchild1']) {
        db.upsertNote(
          makeNote({
            id,
            filePath: `/test/${id}.md`,
            title: id,
            type: 'research',
            tier: 'fast',
          })
        );
      }
      db.upsertRelations('child1', [
        { sourceId: 'child1', targetId: 'initiative', type: 'derived-from' },
      ]);
      db.upsertRelations('child2', [
        { sourceId: 'child2', targetId: 'initiative', type: 'derived-from' },
      ]);
      db.upsertRelations('grandchild1', [
        { sourceId: 'grandchild1', targetId: 'child1', type: 'derived-from' },
      ]);
    });

    it('returns preview of affected notes', () => {
      const preview = db.cascadeDeletePreview('initiative');
      expect(preview.noteIds).toContain('child1');
      expect(preview.noteIds).toContain('child2');
      expect(preview.noteIds).toContain('grandchild1');
      expect(preview.noteIds).toContain('initiative');
      expect(preview.noteCount).toBe(4);
    });

    it('deletes all descendants and the root', () => {
      db.cascadeDelete('initiative');
      expect(db.getNoteById('initiative')).toBeNull();
      expect(db.getNoteById('child1')).toBeNull();
      expect(db.getNoteById('child2')).toBeNull();
      expect(db.getNoteById('grandchild1')).toBeNull();
    });

    it('deletes a leaf node without affecting siblings', () => {
      db.cascadeDelete('grandchild1');
      expect(db.getNoteById('grandchild1')).toBeNull();
      expect(db.getNoteById('child1')).not.toBeNull();
      expect(db.getNoteById('initiative')).not.toBeNull();
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

  describe('cascadeArchive', () => {
    const tmpDir = join(tmpdir(), `brain-archive-test-${Date.now()}`);
    const archiveDir = join(tmpDir, '.archive');

    beforeEach(() => {
      mkdirSync(tmpDir, { recursive: true });
      const initPath = join(tmpDir, 'research', 'initiative.md');
      mkdirSync(dirname(initPath), { recursive: true });
      writeFileSync(
        initPath,
        '---\nid: initiative\ntitle: "Init"\ntype: research\ntier: fast\n---\nContent'
      );

      const childPath = join(tmpDir, 'research', 'child1.md');
      writeFileSync(
        childPath,
        '---\nid: child1\ntitle: "Child"\ntype: research\ntier: fast\n---\nChild content'
      );

      for (const [id, fp] of [
        ['initiative', initPath],
        ['child1', childPath],
      ] as const) {
        db.upsertNote({
          id,
          filePath: fp,
          title: id,
          type: 'research',
          tier: 'fast',
          category: null,
          tags: null,
          summary: null,
          confidence: null,
          status: 'current',
          sources: null,
          createdAt: '2026-01-01',
          modifiedAt: '2026-01-01',
          lastReviewed: null,
          reviewInterval: null,
          expires: null,
          metadata: null,
        });
      }
      db.upsertRelations('child1', [
        { sourceId: 'child1', targetId: 'initiative', type: 'derived-from' },
      ]);
    });

    afterEach(() => {
      rmSync(tmpDir, { recursive: true, force: true });
    });

    it('moves root note file to archive directory', () => {
      db.cascadeArchive('initiative', tmpDir);
      expect(existsSync(join(archiveDir, 'research', 'initiative.md'))).toBe(true);
      expect(existsSync(join(tmpDir, 'research', 'initiative.md'))).toBe(false);
    });

    it('sets root note status to archived in DB', () => {
      db.cascadeArchive('initiative', tmpDir);
      const note = db.getNoteById('initiative');
      expect(note).not.toBeNull();
      expect(note!.status).toBe('archived');
    });

    it('removes root note from search index', () => {
      db.cascadeArchive('initiative', tmpDir);
      const chunks = db.getChunksForNote('initiative');
      expect(chunks).toHaveLength(0);
    });

    it('adds orphaned_from to child frontmatter', () => {
      db.cascadeArchive('initiative', tmpDir);
      const childContent = readFileSync(join(tmpDir, 'research', 'child1.md'), 'utf-8');
      expect(childContent).toContain('orphaned_from: initiative');
    });

    it('keeps child note live and indexed', () => {
      db.cascadeArchive('initiative', tmpDir);
      const child = db.getNoteById('child1');
      expect(child).not.toBeNull();
      expect(child!.status).toBe('current');
    });
  });
});
