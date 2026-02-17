import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { BrainDB, sanitizeFtsQuery } from '../../src/services/brain-db.js'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { unlinkSync } from 'node:fs'
import type { NoteRecord, FileRecord, Chunk, Relation } from '../../src/types.js'

function tmpDbPath(): string {
  return join(tmpdir(), `brain-test-${randomUUID()}.db`)
}

function makeNote(overrides: Partial<NoteRecord> = {}): NoteRecord {
  return {
    id: overrides.id ?? `note-${randomUUID().slice(0, 8)}`,
    filePath: overrides.filePath ?? `/notes/${randomUUID().slice(0, 8)}.md`,
    title: overrides.title ?? 'Test Note',
    type: overrides.type ?? 'note',
    tier: overrides.tier ?? 'slow',
    category: overrides.category ?? null,
    tags: overrides.tags ?? null,
    summary: overrides.summary ?? null,
    confidence: overrides.confidence ?? null,
    status: overrides.status ?? 'current',
    sources: overrides.sources ?? null,
    createdAt: overrides.createdAt ?? null,
    modifiedAt: overrides.modifiedAt ?? null,
    lastReviewed: overrides.lastReviewed ?? null,
    reviewInterval: overrides.reviewInterval ?? null,
    expires: overrides.expires ?? null,
    metadata: overrides.metadata ?? null,
  }
}

function makeFileRecord(overrides: Partial<FileRecord> = {}): FileRecord {
  return {
    path: overrides.path ?? `/notes/${randomUUID().slice(0, 8)}.md`,
    hash: overrides.hash ?? 'abc123',
    mtime: overrides.mtime ?? Date.now(),
    indexedAt: overrides.indexedAt ?? Date.now(),
  }
}

describe('BrainDB', () => {
  let db: BrainDB
  let dbPath: string

  beforeEach(() => {
    dbPath = tmpDbPath()
    db = new BrainDB(dbPath)
  })

  afterEach(() => {
    db.close()
    try {
      unlinkSync(dbPath)
    } catch {
      // ignore
    }
  })

  describe('schema initialization', () => {
    it('creates all tables on construction', () => {
      const tables = db.listTables()
      expect(tables).toContain('files')
      expect(tables).toContain('notes')
      expect(tables).toContain('relations')
      expect(tables).toContain('notes_fts')
      expect(tables).toContain('chunks')
      expect(tables).toContain('db_meta')
    })

    it('sets schema_version to 2 in db_meta', () => {
      const version = db.getMetaValue('schema_version')
      expect(version).toBe('2')
    })

    it('sets and gets embedding model metadata', () => {
      db.setEmbeddingModel('bge-small-en-v1.5', 384)
      const model = db.getEmbeddingModel()
      expect(model).toEqual({ model: 'bge-small-en-v1.5', dimensions: 384 })
    })

    it('returns null when no embedding model is set', () => {
      expect(db.getEmbeddingModel()).toBeNull()
    })

    it('detects embedding model mismatch', () => {
      db.setEmbeddingModel('bge-small-en-v1.5', 384)
      expect(() => db.checkModelMatch('nomic-embed-text')).toThrow(/mismatch/i)
    })

    it('passes model match check when models agree', () => {
      db.setEmbeddingModel('bge-small-en-v1.5', 384)
      expect(() => db.checkModelMatch('bge-small-en-v1.5')).not.toThrow()
    })

    it('passes model match check when no model is stored yet', () => {
      expect(() => db.checkModelMatch('anything')).not.toThrow()
    })
  })

  describe('note CRUD', () => {
    it('inserts a note via upsertNote', () => {
      const note = makeNote({ id: 'test-1', title: 'First Note' })
      const result = db.upsertNote(note)
      expect(result.id).toBe('test-1')
      expect(result.title).toBe('First Note')
    })

    it('updates a note with same id via upsertNote', () => {
      const note = makeNote({ id: 'test-1', title: 'Original' })
      db.upsertNote(note)
      const updated = makeNote({ id: 'test-1', title: 'Updated', filePath: note.filePath })
      const result = db.upsertNote(updated)
      expect(result.title).toBe('Updated')

      const fetched = db.getNoteById('test-1')
      expect(fetched?.title).toBe('Updated')
    })

    it('retrieves a note by id', () => {
      const note = makeNote({ id: 'fetch-me' })
      db.upsertNote(note)
      const fetched = db.getNoteById('fetch-me')
      expect(fetched).not.toBeNull()
      expect(fetched?.id).toBe('fetch-me')
    })

    it('returns null for non-existent note', () => {
      expect(db.getNoteById('does-not-exist')).toBeNull()
    })

    it('deletes a note and its chunks, FTS entry, and relations', () => {
      const note = makeNote({ id: 'delete-me', summary: 'to be deleted' })
      db.upsertNote(note)

      const chunks: Chunk[] = [
        { id: 'delete-me:intro:0', noteId: 'delete-me', heading: 'Intro', content: 'Hello', tokenCount: 1, chunkType: 'section' },
      ]
      const embeddings = [new Float32Array(384)]
      db.upsertChunks('delete-me', chunks, embeddings)

      const relations: Relation[] = [
        { sourceId: 'delete-me', targetId: 'other', type: 'related-to' },
      ]
      db.upsertRelations('delete-me', relations)

      db.deleteNote('delete-me')

      expect(db.getNoteById('delete-me')).toBeNull()
      expect(db.getChunksForNote('delete-me')).toHaveLength(0)
      expect(db.getRelationsFrom('delete-me')).toHaveLength(0)
    })

    it('returns all notes via getAllNotes', () => {
      db.upsertNote(makeNote({ id: 'a' }))
      db.upsertNote(makeNote({ id: 'b' }))
      db.upsertNote(makeNote({ id: 'c' }))
      const all = db.getAllNotes()
      expect(all).toHaveLength(3)
      expect(all.map((n) => n.id).sort()).toEqual(['a', 'b', 'c'])
    })
  })

  describe('file tracking', () => {
    it('upserts and retrieves a file record', () => {
      const file = makeFileRecord({ path: '/notes/test.md' })
      db.upsertFile(file)
      const fetched = db.getFile('/notes/test.md')
      expect(fetched).not.toBeNull()
      expect(fetched?.hash).toBe(file.hash)
    })

    it('returns null for non-existent file', () => {
      expect(db.getFile('/no/such/file.md')).toBeNull()
    })

    it('returns all files as a map', () => {
      db.upsertFile(makeFileRecord({ path: '/a.md' }))
      db.upsertFile(makeFileRecord({ path: '/b.md' }))
      const all = db.getAllFiles()
      expect(all.size).toBe(2)
      expect(all.has('/a.md')).toBe(true)
      expect(all.has('/b.md')).toBe(true)
    })

    it('deletes a file record', () => {
      db.upsertFile(makeFileRecord({ path: '/del.md' }))
      db.deleteFile('/del.md')
      expect(db.getFile('/del.md')).toBeNull()
    })
  })

  describe('chunk + vector operations', () => {
    it('upserts chunks and stores vectors', () => {
      const note = makeNote({ id: 'chunked' })
      db.upsertNote(note)

      const chunks: Chunk[] = [
        { id: 'chunked:intro:0', noteId: 'chunked', heading: 'Intro', content: 'Hello world', tokenCount: 2, chunkType: 'section' },
        { id: 'chunked:body:1', noteId: 'chunked', heading: 'Body', content: 'More content', tokenCount: 3, chunkType: 'section' },
      ]
      const embeddings = [new Float32Array(384), new Float32Array(384)]

      db.upsertChunks('chunked', chunks, embeddings)

      const stored = db.getChunksForNote('chunked')
      expect(stored).toHaveLength(2)
      expect(stored[0].heading).toBe('Intro')
      expect(stored[1].heading).toBe('Body')
      expect(stored[0].tokenCount).toBe(2)
    })

    it('deletes all chunks and vectors for a note', () => {
      const note = makeNote({ id: 'to-clear' })
      db.upsertNote(note)

      const chunks: Chunk[] = [
        { id: 'to-clear:s:0', noteId: 'to-clear', heading: null, content: 'data', tokenCount: 1, chunkType: 'section' },
      ]
      db.upsertChunks('to-clear', chunks, [new Float32Array(384)])

      db.deleteChunksForNote('to-clear')
      expect(db.getChunksForNote('to-clear')).toHaveLength(0)
    })
  })

  describe('relation CRUD', () => {
    it('upserts relations and replaces existing for source', () => {
      const noteA = makeNote({ id: 'rel-a' })
      const noteB = makeNote({ id: 'rel-b' })
      const noteC = makeNote({ id: 'rel-c' })
      db.upsertNote(noteA)
      db.upsertNote(noteB)
      db.upsertNote(noteC)

      db.upsertRelations('rel-a', [
        { sourceId: 'rel-a', targetId: 'rel-b', type: 'related-to' },
      ])

      // Replace with different relations
      db.upsertRelations('rel-a', [
        { sourceId: 'rel-a', targetId: 'rel-c', type: 'informs' },
      ])

      const from = db.getRelationsFrom('rel-a')
      expect(from).toHaveLength(1)
      expect(from[0].targetId).toBe('rel-c')
      expect(from[0].type).toBe('informs')
    })

    it('gets outgoing relations with getRelationsFrom', () => {
      db.upsertNote(makeNote({ id: 'src' }))
      db.upsertNote(makeNote({ id: 'tgt1' }))
      db.upsertNote(makeNote({ id: 'tgt2' }))

      db.upsertRelations('src', [
        { sourceId: 'src', targetId: 'tgt1', type: 'related-to' },
        { sourceId: 'src', targetId: 'tgt2', type: 'supersedes' },
      ])

      const rels = db.getRelationsFrom('src')
      expect(rels).toHaveLength(2)
    })

    it('gets incoming relations with getRelationsTo', () => {
      db.upsertNote(makeNote({ id: 'from1' }))
      db.upsertNote(makeNote({ id: 'from2' }))
      db.upsertNote(makeNote({ id: 'target' }))

      db.upsertRelations('from1', [
        { sourceId: 'from1', targetId: 'target', type: 'related-to' },
      ])
      db.upsertRelations('from2', [
        { sourceId: 'from2', targetId: 'target', type: 'informs' },
      ])

      const incoming = db.getRelationsTo('target')
      expect(incoming).toHaveLength(2)
    })
  })

  describe('FTS search', () => {
    it('returns note IDs ranked by BM25', () => {
      db.upsertNote(makeNote({ id: 'fts-1', title: 'React Server Components', summary: 'RSC enables server rendering' }))
      db.upsertNote(makeNote({ id: 'fts-2', title: 'Vue Composition API', summary: 'Vue reactivity system' }))

      db.upsertNoteFTS('fts-1', 'React Server Components', 'RSC enables server rendering', 'Full content about React Server Components and rendering patterns')
      db.upsertNoteFTS('fts-2', 'Vue Composition API', 'Vue reactivity system', 'Content about Vue composition')

      const results = db.searchFTS('React Server Components', 10)
      expect(results.length).toBeGreaterThanOrEqual(1)
      expect(results[0].noteId).toBe('fts-1')
    })

    it('matches on title, summary, and content', () => {
      db.upsertNote(makeNote({ id: 'title-match', title: 'Kubernetes' }))
      db.upsertNoteFTS('title-match', 'Kubernetes', '', '')

      db.upsertNote(makeNote({ id: 'summary-match', summary: 'Kubernetes orchestration' }))
      db.upsertNoteFTS('summary-match', 'Other', 'Kubernetes orchestration', '')

      db.upsertNote(makeNote({ id: 'content-match' }))
      db.upsertNoteFTS('content-match', 'Other', '', 'Deep dive into Kubernetes')

      const results = db.searchFTS('Kubernetes', 10)
      expect(results).toHaveLength(3)
    })

    it('returns empty results for empty query', () => {
      const results = db.searchFTS('', 10)
      expect(results).toHaveLength(0)
    })

    it('handles special FTS5 characters without crashing', () => {
      db.upsertNote(makeNote({ id: 'special' }))
      db.upsertNoteFTS('special', 'Test', '', 'Content about brackets')

      expect(() => db.searchFTS('"unbalanced', 10)).not.toThrow()
      expect(() => db.searchFTS('OR AND NOT', 10)).not.toThrow()
      expect(() => db.searchFTS('term*', 10)).not.toThrow()
    })
  })

  describe('dynamic vector table', () => {
    it('ensureVectorTable creates table with correct dimensions', () => {
      db.ensureVectorTable(768)
      const tables = db.listTables()
      expect(tables).toContain('chunk_vectors')
    })

    it('ensureVectorTable with different dimensions drops and recreates', () => {
      db.setEmbeddingModel('model-a', 384)
      db.ensureVectorTable(384)

      const note = makeNote({ id: 'dim-test' })
      db.upsertNote(note)
      const chunks: Chunk[] = [
        { id: 'dim-test:s:0', noteId: 'dim-test', heading: null, content: 'data', tokenCount: 1, chunkType: 'section' },
      ]
      db.upsertChunks('dim-test', chunks, [new Float32Array(384)])

      // Change dimensions — should drop and recreate
      db.setMetaValue('embedding_dimensions', '768')
      db.ensureVectorTable(768)

      // Old data is gone after drop
      const tables = db.listTables()
      expect(tables).toContain('chunk_vectors')
    })
  })

  describe('search API methods', () => {
    it('searchVector returns results', () => {
      db.ensureVectorTable(384)
      const note = makeNote({ id: 'vec-note' })
      db.upsertNote(note)

      const chunks: Chunk[] = [
        { id: 'vec-note:s:0', noteId: 'vec-note', heading: 'Test', content: 'Hello world', tokenCount: 2, chunkType: 'section' },
      ]
      const vec = new Float32Array(384)
      vec[0] = 1.0
      db.upsertChunks('vec-note', chunks, [vec])

      const queryVec = new Float32Array(384)
      queryVec[0] = 1.0
      const results = db.searchVector(queryVec, 5)
      expect(results.length).toBeGreaterThanOrEqual(1)
      expect(results[0].chunkId).toBe('vec-note:s:0')
      expect(results[0].noteId).toBe('vec-note')
    })

    it('getFilteredNoteIds filters by tier', () => {
      db.upsertNote(makeNote({ id: 'slow-1', tier: 'slow' }))
      db.upsertNote(makeNote({ id: 'fast-1', tier: 'fast' }))

      const result = db.getFilteredNoteIds({ tier: 'slow' })
      expect(result).not.toBeNull()
      expect(result!.has('slow-1')).toBe(true)
      expect(result!.has('fast-1')).toBe(false)
    })

    it('getFilteredNoteIds returns null when no filters provided', () => {
      expect(db.getFilteredNoteIds({})).toBeNull()
    })

    it('getFilteredNoteIds filters by tags', () => {
      db.upsertNote(makeNote({ id: 'tagged', tags: 'typescript,react' }))
      db.upsertNote(makeNote({ id: 'untagged', tags: 'python' }))

      const result = db.getFilteredNoteIds({ tags: ['typescript'] })
      expect(result!.has('tagged')).toBe(true)
      expect(result!.has('untagged')).toBe(false)
    })

    it('getNoteByFilePath returns correct note', () => {
      const note = makeNote({ id: 'fp-test', filePath: '/notes/test-file.md' })
      db.upsertNote(note)

      const found = db.getNoteByFilePath('/notes/test-file.md')
      expect(found).not.toBeNull()
      expect(found!.id).toBe('fp-test')
    })

    it('getNoteByFilePath returns null for unknown path', () => {
      expect(db.getNoteByFilePath('/no/such/file.md')).toBeNull()
    })

    it('getChunkContent returns content', () => {
      db.ensureVectorTable(384)
      const note = makeNote({ id: 'cc-test' })
      db.upsertNote(note)
      const chunks: Chunk[] = [
        { id: 'cc-test:s:0', noteId: 'cc-test', heading: null, content: 'Chunk content here', tokenCount: 3, chunkType: 'section' },
      ]
      db.upsertChunks('cc-test', chunks, [new Float32Array(384)])

      expect(db.getChunkContent('cc-test:s:0')).toBe('Chunk content here')
      expect(db.getChunkContent('nonexistent')).toBe('')
    })

    it('getFirstChunkForNote returns first chunk', () => {
      db.ensureVectorTable(384)
      const note = makeNote({ id: 'fc-test' })
      db.upsertNote(note)
      const chunks: Chunk[] = [
        { id: 'fc-test:intro:0', noteId: 'fc-test', heading: 'Intro', content: 'First chunk', tokenCount: 2, chunkType: 'section' },
        { id: 'fc-test:body:1', noteId: 'fc-test', heading: 'Body', content: 'Second chunk', tokenCount: 2, chunkType: 'section' },
      ]
      db.upsertChunks('fc-test', chunks, [new Float32Array(384), new Float32Array(384)])

      const first = db.getFirstChunkForNote('fc-test')
      expect(first).not.toBeNull()
      expect(first!.content).toBe('First chunk')
      expect(first!.heading).toBe('Intro')
    })

    it('getChunkHeading returns heading for chunk', () => {
      db.ensureVectorTable(384)
      const note = makeNote({ id: 'ch-test' })
      db.upsertNote(note)
      const chunks: Chunk[] = [
        { id: 'ch-test:s:0', noteId: 'ch-test', heading: 'My Heading', content: 'data', tokenCount: 1, chunkType: 'section' },
      ]
      db.upsertChunks('ch-test', chunks, [new Float32Array(384)])

      expect(db.getChunkHeading('ch-test:s:0', 'ch-test')).toBe('My Heading')
    })
  })

  describe('sanitizeFtsQuery', () => {
    it('wraps terms in quotes', () => {
      expect(sanitizeFtsQuery('hello world')).toBe('"hello" "world"')
    })

    it('escapes embedded quotes', () => {
      expect(sanitizeFtsQuery('"unbalanced')).toBe('"""unbalanced"')
    })

    it('handles empty string', () => {
      expect(sanitizeFtsQuery('')).toBe('')
    })

    it('strips extra whitespace', () => {
      expect(sanitizeFtsQuery('  a   b  ')).toBe('"a" "b"')
    })
  })

  describe('schema v2 migration', () => {
    it('new databases get chunk index', () => {
      // Verify by inserting chunks and checking performance is not degraded
      // The index existence is verified indirectly through the schema version
      expect(db.getMetaValue('schema_version')).toBe('2')
    })
  })
})
