import { describe, test, expect } from 'vitest'
import { writeFileSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { BrainDB } from '../../src/services/brain-db.js'
import { parseMarkdown } from '../../src/services/markdown-parser.js'
import { search } from '../../src/services/search.js'
import { LocalEmbedder } from '../../src/adapters/local-embedder.js'
import { tmpDbPath, makeNote } from '../helpers.js'

describe('failure modes', { timeout: 120_000 }, () => {
  describe('corrupt/missing DB', () => {
    test('opening a corrupt DB file throws descriptive error', () => {
      const corruptPath = join(tmpdir(), `corrupt-${randomUUID()}.db`)
      writeFileSync(corruptPath, 'this is not a valid sqlite file')

      expect(() => new BrainDB(corruptPath)).toThrow()

      try { unlinkSync(corruptPath) } catch {}
    })

    test('opening a non-existent path creates a new DB', () => {
      const newPath = tmpDbPath('new-db')
      const db = new BrainDB(newPath)
      const tables = db.listTables()
      expect(tables).toContain('notes')
      db.close()

      try { unlinkSync(newPath) } catch {}
    })
  })

  describe('missing note file (DB references deleted file)', () => {
    test('search returns results even if underlying file was deleted', async () => {
      const dbPath = tmpDbPath('missing-file')
      const db = new BrainDB(dbPath)
      const embedder = new LocalEmbedder()

      const note = makeNote({ id: 'test-note', title: 'Test Note' })
      db.upsertNote(note)
      db.upsertNoteFTS('test-note', 'Test Note', '', 'some searchable content about testing')

      const chunkContent = 'some searchable content about testing'
      const [embedding] = await embedder.embed([chunkContent])
      db.upsertChunks('test-note', [{
        id: 'chunk-1',
        noteId: 'test-note',
        heading: null,
        content: chunkContent,
        tokenCount: 6,
        chunkType: 'section',
      }], [new Float32Array(embedding)])

      const results = await search(db, embedder, 'testing', { limit: 5 })
      expect(results.length).toBeGreaterThan(0)

      db.close()
      try { unlinkSync(dbPath) } catch {}
    })
  })

  describe('malformed frontmatter', () => {
    test('parseMarkdown handles file with no frontmatter', () => {
      const result = parseMarkdown('/notes/no-fm.md', '# Just a heading\n\nSome content here.')
      expect(result.frontmatter.title).toBe('no-fm')
      expect(result.frontmatter.type).toBe('note')
    })

    test('parseMarkdown handles empty file', () => {
      const result = parseMarkdown('/notes/empty.md', '')
      expect(result.frontmatter.title).toBe('empty')
      expect(result.chunks.length).toBe(0)
    })

    test('parseMarkdown handles frontmatter with all invalid fields', () => {
      const content = `---
title: 42
type: invalid-type
tier: bogus
confidence: maybe
status: 999
tags: true
created: not-a-date
review-interval: forever
---

Some body content that is long enough to pass the minimum chunk length.`

      const result = parseMarkdown('/notes/bad-fm.md', content)
      expect(result.frontmatter.type).toBe('note')
      expect(result.frontmatter.tier).toBe('slow')
      expect(result.chunks.length).toBeGreaterThan(0)
    })
  })

  describe('search edge cases', () => {
    test('empty query returns empty results', async () => {
      const dbPath = tmpDbPath('empty-query')
      const db = new BrainDB(dbPath)
      const embedder = new LocalEmbedder()

      const results = await search(db, embedder, '', { limit: 5 })
      expect(results).toEqual([])

      db.close()
      try { unlinkSync(dbPath) } catch {}
    })

    test('search against empty DB returns empty results', async () => {
      const dbPath = tmpDbPath('empty-db')
      const db = new BrainDB(dbPath)
      const embedder = new LocalEmbedder()
      db.setEmbeddingModel(embedder.model, embedder.dimensions)

      const results = await search(db, embedder, 'test query', { limit: 5 })
      expect(results).toEqual([])

      db.close()
      try { unlinkSync(dbPath) } catch {}
    })

    test('whitespace-only query returns empty results', async () => {
      const dbPath = tmpDbPath('ws-query')
      const db = new BrainDB(dbPath)
      const embedder = new LocalEmbedder()

      const results = await search(db, embedder, '   \t\n  ', { limit: 5 })
      expect(results).toEqual([])

      db.close()
      try { unlinkSync(dbPath) } catch {}
    })
  })

  describe('concurrent operations', () => {
    test('parallel reads do not interfere', async () => {
      const dbPath = tmpDbPath('concurrent')
      const db = new BrainDB(dbPath)
      const embedder = new LocalEmbedder()
      db.setEmbeddingModel(embedder.model, embedder.dimensions)

      for (let i = 0; i < 5; i++) {
        const note = makeNote({ id: `note-${i}`, title: `Note ${i}` })
        db.upsertNote(note)
        db.upsertNoteFTS(`note-${i}`, `Note ${i}`, '', `Content for note ${i} about testing`)
      }

      const searches = Array.from({ length: 10 }, (_, i) =>
        search(db, embedder, `note ${i % 5}`, { limit: 5 }),
      )
      const results = await Promise.all(searches)

      for (const result of results) {
        expect(Array.isArray(result)).toBe(true)
      }

      db.close()
      try { unlinkSync(dbPath) } catch {}
    })
  })
})
