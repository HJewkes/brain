import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { execSync } from 'node:child_process'
import {
  mkdtempSync,
  rmSync,
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
} from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import envPaths from 'env-paths'

const PROJECT_ROOT = join(import.meta.dirname, '..', '..')
const CLI = `npx tsx ${join(PROJECT_ROOT, 'src', 'cli.ts')}`
const paths = envPaths('brain', { suffix: '' })
const CONFIG_PATH = join(paths.config, 'config.json')

let tmpDir: string
let notesDir: string
let dbPath: string
let savedConfig: string | null = null

function run(cmd: string, options?: { input?: string }): string {
  return execSync(cmd, {
    cwd: PROJECT_ROOT,
    encoding: 'utf-8',
    timeout: 30_000,
    input: options?.input,
    env: { ...process.env, NODE_NO_WARNINGS: '1' },
  }).trim()
}

beforeAll(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'brain-integration-'))
  notesDir = join(tmpDir, 'notes')
  dbPath = join(tmpDir, 'brain.db')

  if (existsSync(CONFIG_PATH)) {
    savedConfig = readFileSync(CONFIG_PATH, 'utf-8')
  }

  mkdirSync(paths.config, { recursive: true })
  writeFileSync(
    CONFIG_PATH,
    JSON.stringify({
      notesDir,
      dbPath,
      embedder: 'local',
      fusionWeights: { bm25: 0.3, vector: 0.7 },
    }),
  )
})

afterAll(() => {
  if (savedConfig !== null) {
    writeFileSync(CONFIG_PATH, savedConfig)
  } else if (existsSync(CONFIG_PATH)) {
    rmSync(CONFIG_PATH)
  }
  rmSync(tmpDir, { recursive: true, force: true })
})

describe('CLI integration', () => {
  it('init creates directory structure and database', () => {
    const output = run(`${CLI} init --notes-dir "${notesDir}" --json`)
    const result = JSON.parse(output)

    expect(result.notesDir).toBe(notesDir)
    expect(result.dbPath).toBe(dbPath)
    expect(result.embedder).toBe('local')
    expect(existsSync(notesDir)).toBe(true)
    expect(existsSync(join(notesDir, 'notes'))).toBe(true)
    expect(existsSync(join(notesDir, 'decisions'))).toBe(true)
    expect(existsSync(join(notesDir, 'research'))).toBe(true)
    expect(existsSync(join(notesDir, '_templates'))).toBe(true)
    expect(existsSync(dbPath)).toBe(true)
  })

  it('add creates a note file from stdin', () => {
    const content = [
      '---',
      'id: test-note-one',
      'title: Test Note One',
      'type: note',
      'tier: slow',
      'tags: [testing, integration]',
      'summary: A test note for integration testing',
      'confidence: high',
      'status: current',
      'created: "2024-01-01"',
      'modified: "2024-01-01"',
      'last-reviewed: "2024-01-01"',
      'review-interval: "90d"',
      '---',
      '',
      '# Test Note One',
      '',
      '## Overview',
      '',
      'This is a test note for integration testing.',
    ].join('\n')

    const outputPath = run(`${CLI} add --type note --tier slow`, {
      input: content,
    })

    expect(existsSync(outputPath)).toBe(true)
    const written = readFileSync(outputPath, 'utf-8')
    expect(written).toContain('Test Note One')
  })

  it('add creates a second note with relations', () => {
    const content = [
      '---',
      'id: test-note-two',
      'title: Test Note Two',
      'type: research',
      'tier: slow',
      'tags: [testing]',
      'summary: A related research note',
      'confidence: medium',
      'status: draft',
      'created: "2024-06-01"',
      'modified: "2024-06-01"',
      'last-reviewed: "2024-06-01"',
      'review-interval: "90d"',
      'related: [test-note-one]',
      '---',
      '',
      '# Test Note Two',
      '',
      '## Question',
      '',
      'How does integration testing work?',
      '',
      '## Findings',
      '',
      'It works by exercising the full CLI pipeline.',
    ].join('\n')

    const outputPath = run(`${CLI} add --type research --tier slow`, {
      input: content,
    })

    expect(existsSync(outputPath)).toBe(true)
  })

  it('index processes notes into the database', () => {
    const output = run(`${CLI} index --json`)
    const result = JSON.parse(output)

    expect(result.indexed).toBeGreaterThanOrEqual(2)
    expect(result.total).toBeGreaterThanOrEqual(2)
  })

  it('search returns results with correct shape (FTS)', () => {
    const output = run(`${CLI} search "integration testing" --json --limit 5`)
    const results = JSON.parse(output)

    expect(Array.isArray(results)).toBe(true)
    expect(results.length).toBeGreaterThan(0)

    const first = results[0]
    expect(first).toHaveProperty('score')
    expect(first).toHaveProperty('filePath')
    expect(first).toHaveProperty('noteId')
    expect(first).toHaveProperty('excerpt')
    expect(first).toHaveProperty('tier')
    expect(first).toHaveProperty('tags')
    expect(typeof first.score).toBe('number')
  })

  it('stale identifies notes needing review', () => {
    const output = run(`${CLI} stale --json`)
    const results = JSON.parse(output)

    expect(Array.isArray(results)).toBe(true)
    expect(results.length).toBeGreaterThan(0)

    const staleNote = results.find(
      (r: { noteId: string }) => r.noteId === 'test-note-one',
    )
    expect(staleNote).toBeDefined()
    expect(staleNote.daysOverdue).toBeGreaterThan(0)
  })

  it('graph shows relations for a note', () => {
    const output = run(`${CLI} graph test-note-two --json`)
    const result = JSON.parse(output)

    expect(result).toHaveProperty('root')
    expect(result).toHaveProperty('nodes')
    expect(result).toHaveProperty('edges')
    expect(result.root.id).toBe('test-note-two')
    expect(Array.isArray(result.nodes)).toBe(true)
    expect(Array.isArray(result.edges)).toBe(true)
  })

  it('template outputs valid YAML frontmatter', () => {
    const output = run(`${CLI} template note`)

    expect(output).toContain('---')
    expect(output).toContain('type: note')
    expect(output).toContain('tier: slow')
    expect(output).toContain('confidence: medium')
    expect(output).toContain('status: draft')

    const fmMatch = output.match(/^---\n([\s\S]*?)\n---/)
    expect(fmMatch).not.toBeNull()
  })

  it('status returns stats object with correct shape', () => {
    const output = run(`${CLI} status --json`)
    const result = JSON.parse(output)

    expect(result).toHaveProperty('totalNotes')
    expect(result).toHaveProperty('totalChunks')
    expect(result).toHaveProperty('byTier')
    expect(result).toHaveProperty('byType')
    expect(result).toHaveProperty('embeddingModel')
    expect(result).toHaveProperty('lastIndexed')
    expect(result).toHaveProperty('staleNotes')
    expect(typeof result.totalNotes).toBe('number')
    expect(result.totalNotes).toBeGreaterThanOrEqual(2)
  })
})
