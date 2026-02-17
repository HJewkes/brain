import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { scanForChanges, hashContent } from '../../src/services/file-scanner.js'
import type { FileRecord } from '../../src/types.js'
import { mkdtemp, writeFile, mkdir, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

let tempDir: string

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'brain-scanner-'))
})

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true })
})

describe('hashContent', () => {
  it('returns a hex SHA-256 hash', () => {
    const hash = hashContent('hello world')
    expect(hash).toMatch(/^[a-f0-9]{64}$/)
  })

  it('returns different hashes for different content', () => {
    expect(hashContent('a')).not.toBe(hashContent('b'))
  })

  it('returns same hash for same content', () => {
    expect(hashContent('test')).toBe(hashContent('test'))
  })
})

describe('scanForChanges', () => {
  describe('empty directory', () => {
    it('returns empty change set with empty knownFiles', async () => {
      const result = await scanForChanges(tempDir, new Map())
      expect(result).toEqual({
        new: [],
        modified: [],
        deleted: [],
        unchanged: 0,
      })
    })
  })

  describe('new files', () => {
    it('detects all markdown files as new when knownFiles is empty', async () => {
      await writeFile(join(tempDir, 'one.md'), '# One')
      await writeFile(join(tempDir, 'two.md'), '# Two')
      await writeFile(join(tempDir, 'three.md'), '# Three')

      const result = await scanForChanges(tempDir, new Map())

      expect(result.new).toHaveLength(3)
      expect(result.modified).toHaveLength(0)
      expect(result.deleted).toHaveLength(0)
      expect(result.unchanged).toBe(0)

      const paths = result.new.map((f) => f.path).sort()
      expect(paths).toEqual([
        join(tempDir, 'one.md'),
        join(tempDir, 'three.md'),
        join(tempDir, 'two.md'),
      ])

      for (const entry of result.new) {
        expect(entry.hash).toMatch(/^[a-f0-9]{64}$/)
        expect(entry.mtime).toBeGreaterThan(0)
      }
    })

    it('detects new files in subdirectories', async () => {
      await mkdir(join(tempDir, 'sub'), { recursive: true })
      await writeFile(join(tempDir, 'sub', 'nested.md'), '# Nested')

      const result = await scanForChanges(tempDir, new Map())
      expect(result.new).toHaveLength(1)
      expect(result.new[0].path).toBe(join(tempDir, 'sub', 'nested.md'))
    })
  })

  describe('modified files', () => {
    it('detects file with changed content as modified', async () => {
      const filePath = join(tempDir, 'note.md')
      await writeFile(filePath, 'original content')
      const fileStat = await stat(filePath)
      const oldHash = hashContent('original content')

      const knownFiles = new Map<string, FileRecord>([
        [
          filePath,
          {
            path: filePath,
            hash: oldHash,
            mtime: fileStat.mtimeMs - 1000, // older mtime to trigger hash check
            indexedAt: Date.now(),
          },
        ],
      ])

      // Rewrite with new content and ensure different mtime
      await writeFile(filePath, 'updated content')

      const result = await scanForChanges(tempDir, knownFiles)
      expect(result.modified).toHaveLength(1)
      expect(result.modified[0].path).toBe(filePath)
      expect(result.modified[0].hash).toBe(hashContent('updated content'))
      expect(result.new).toHaveLength(0)
      expect(result.deleted).toHaveLength(0)
    })

    it('treats file as unchanged when content hash matches despite mtime change', async () => {
      const filePath = join(tempDir, 'note.md')
      const content = 'same content'
      await writeFile(filePath, content)
      const fileStat = await stat(filePath)
      const hash = hashContent(content)

      const knownFiles = new Map<string, FileRecord>([
        [
          filePath,
          {
            path: filePath,
            hash,
            mtime: fileStat.mtimeMs - 1000, // different mtime
            indexedAt: Date.now(),
          },
        ],
      ])

      const result = await scanForChanges(tempDir, knownFiles)
      expect(result.modified).toHaveLength(0)
      expect(result.new).toHaveLength(0)
      expect(result.deleted).toHaveLength(0)
      expect(result.unchanged).toBe(1)
    })
  })

  describe('deleted files', () => {
    it('detects files in knownFiles but not on disk as deleted', async () => {
      const missingPath = join(tempDir, 'gone.md')
      const knownFiles = new Map<string, FileRecord>([
        [
          missingPath,
          {
            path: missingPath,
            hash: 'abc123',
            mtime: 1000,
            indexedAt: Date.now(),
          },
        ],
      ])

      const result = await scanForChanges(tempDir, knownFiles)
      expect(result.deleted).toEqual([missingPath])
    })
  })

  describe('mtime fast-path', () => {
    it('skips hash computation when mtime is unchanged', async () => {
      const filePath = join(tempDir, 'stable.md')
      await writeFile(filePath, 'stable content')
      const fileStat = await stat(filePath)

      const knownFiles = new Map<string, FileRecord>([
        [
          filePath,
          {
            path: filePath,
            hash: hashContent('stable content'),
            mtime: fileStat.mtimeMs,
            indexedAt: Date.now(),
          },
        ],
      ])

      const result = await scanForChanges(tempDir, knownFiles)
      expect(result.unchanged).toBe(1)
      expect(result.new).toHaveLength(0)
      expect(result.modified).toHaveLength(0)
      expect(result.deleted).toHaveLength(0)
    })
  })

  describe('glob filtering', () => {
    it('only picks up .md files', async () => {
      await writeFile(join(tempDir, 'note.md'), '# Note')
      await writeFile(join(tempDir, 'readme.txt'), 'Not a note')
      await writeFile(join(tempDir, 'script.js'), 'console.log("hi")')

      const result = await scanForChanges(tempDir, new Map())
      expect(result.new).toHaveLength(1)
      expect(result.new[0].path).toBe(join(tempDir, 'note.md'))
    })

    it('ignores node_modules and .git directories', async () => {
      await mkdir(join(tempDir, 'node_modules'), { recursive: true })
      await writeFile(join(tempDir, 'node_modules', 'dep.md'), '# Dep')
      await mkdir(join(tempDir, '.git'), { recursive: true })
      await writeFile(join(tempDir, '.git', 'info.md'), '# Git')
      await writeFile(join(tempDir, 'real.md'), '# Real')

      const result = await scanForChanges(tempDir, new Map())
      expect(result.new).toHaveLength(1)
      expect(result.new[0].path).toBe(join(tempDir, 'real.md'))
    })
  })

  describe('mixed scenario', () => {
    it('correctly categorizes new, modified, deleted, and unchanged files', async () => {
      // Set up files on disk
      const newFile = join(tempDir, 'new.md')
      const modifiedFile = join(tempDir, 'modified.md')
      const unchangedFile = join(tempDir, 'unchanged.md')
      const deletedFile = join(tempDir, 'deleted.md') // won't exist on disk

      await writeFile(newFile, '# New')
      await writeFile(modifiedFile, 'modified content')
      await writeFile(unchangedFile, 'unchanged content')

      const unchangedStat = await stat(unchangedFile)

      const knownFiles = new Map<string, FileRecord>([
        [
          modifiedFile,
          {
            path: modifiedFile,
            hash: hashContent('old content'),
            mtime: 0, // force hash check
            indexedAt: Date.now(),
          },
        ],
        [
          unchangedFile,
          {
            path: unchangedFile,
            hash: hashContent('unchanged content'),
            mtime: unchangedStat.mtimeMs,
            indexedAt: Date.now(),
          },
        ],
        [
          deletedFile,
          {
            path: deletedFile,
            hash: 'whatever',
            mtime: 1000,
            indexedAt: Date.now(),
          },
        ],
      ])

      const result = await scanForChanges(tempDir, knownFiles)
      expect(result.new).toHaveLength(1)
      expect(result.new[0].path).toBe(newFile)
      expect(result.modified).toHaveLength(1)
      expect(result.modified[0].path).toBe(modifiedFile)
      expect(result.deleted).toEqual([deletedFile])
      expect(result.unchanged).toBe(1)
    })
  })
})
