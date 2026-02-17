import { Command } from '@commander-js/extra-typings'
import { readFileSync, writeFileSync } from 'node:fs'
import { basename, join, relative } from 'node:path'
import { loadConfig } from '../services/config.js'
import { BrainDB } from '../services/brain-db.js'
import { createEmbedder } from '../adapters/index.js'
import { scanForChanges } from '../services/file-scanner.js'
import { parseMarkdown } from '../services/markdown-parser.js'
import type { Chunk, NoteRecord } from '../types.js'

export const indexCommand = new Command('index')
  .description('Index new and modified notes')
  .option('--force', 'force full re-index (clears all chunks/vectors)')
  .option('--quiet', 'suppress output')
  .option('--json', 'output result as JSON')
  .action(async (opts) => {
    const config = loadConfig()
    const db = new BrainDB(config.dbPath)
    const embedder = createEmbedder(config)

    try {
      if (!opts.force) {
        db.checkModelMatch(embedder.model)
      }

      if (opts.force) {
        const allNotes = db.getAllNotes()
        for (const note of allNotes) {
          db.deleteChunksForNote(note.id)
        }
      }

      db.setEmbeddingModel(embedder.model, embedder.dimensions)

      const knownFiles = opts.force ? new Map() : db.getAllFiles()
      const changes = await scanForChanges(config.notesDir, knownFiles)

      const isSkipped = (filePath: string): boolean =>
        filePath.includes('/_templates/') || basename(filePath) === '_index.md'

      let indexed = 0
      let deleted = 0

      const toProcess = [...changes.new, ...changes.modified].filter(
        (f) => !isSkipped(f.path),
      )
      for (const file of toProcess) {
        const content = readFileSync(file.path, 'utf-8')
        const parsed = parseMarkdown(file.path, content)

        const noteRecord = frontmatterToRecord(parsed)
        db.upsertNote(noteRecord)
        db.upsertNoteFTS(
          parsed.id,
          parsed.frontmatter.title,
          parsed.frontmatter.summary ?? '',
          parsed.content,
        )

        const chunks = rawChunksToChunks(parsed.id, parsed.chunks)
        if (chunks.length > 0) {
          const texts = chunks.map((c) => c.content)
          const embeddings = await embedder.embed(texts)
          const vectors = embeddings.map((e) => new Float32Array(e))
          db.upsertChunks(parsed.id, chunks, vectors)
        }

        if (parsed.relations.length > 0) {
          db.upsertRelations(parsed.id, parsed.relations)
        }

        db.upsertFile({
          path: file.path,
          hash: file.hash,
          mtime: file.mtime,
          indexedAt: Date.now(),
        })

        indexed++
      }

      for (const filePath of changes.deleted.filter((p) => !isSkipped(p))) {
        const allNotes = db.getAllNotes()
        const note = allNotes.find((n) => n.filePath === filePath)
        if (note) {
          db.deleteNote(note.id)
        }
        db.deleteFile(filePath)
        deleted++
      }

      generateIndex(db, config.notesDir)

      const summary = {
        indexed,
        deleted,
        unchanged: changes.unchanged,
        total: db.getAllNotes().length,
      }

      if (opts.json) {
        process.stdout.write(JSON.stringify(summary) + '\n')
      } else if (!opts.quiet) {
        process.stderr.write(
          `Indexed ${indexed} file(s), deleted ${deleted}, unchanged ${changes.unchanged}\n`,
        )
        process.stderr.write(`Total notes: ${summary.total}\n`)
      }
    } finally {
      db.close()
    }
  })

function frontmatterToRecord(
  parsed: ReturnType<typeof parseMarkdown>,
): NoteRecord {
  const fm = parsed.frontmatter
  return {
    id: parsed.id,
    filePath: parsed.filePath,
    title: fm.title,
    type: fm.type,
    tier: fm.tier,
    category: fm.category ?? null,
    tags: fm.tags ? fm.tags.join(',') : null,
    summary: fm.summary ?? null,
    confidence: fm.confidence ?? null,
    status: fm.status ?? 'current',
    sources: fm.sources ? JSON.stringify(fm.sources) : null,
    createdAt: fm.created ?? null,
    modifiedAt: fm.modified ?? null,
    lastReviewed: fm['last-reviewed'] ?? null,
    reviewInterval: fm['review-interval'] ?? null,
    expires: fm.expires ?? null,
    metadata: null,
  }
}

function rawChunksToChunks(
  noteId: string,
  rawChunks: Array<{ heading: string | null; text: string; tokenCount: number }>,
): Chunk[] {
  return rawChunks.map((rc, i) => ({
    id: `${noteId}::chunk-${i}`,
    noteId,
    heading: rc.heading,
    content: rc.text,
    tokenCount: rc.tokenCount,
    chunkType: 'section' as const,
  }))
}

function generateIndex(db: BrainDB, notesDir: string): void {
  const notes = db.getAllNotes()
  if (notes.length === 0) return

  const byCategory = new Map<string, NoteRecord[]>()
  for (const note of notes) {
    const cat = note.category ?? 'uncategorized'
    const list = byCategory.get(cat) ?? []
    list.push(note)
    byCategory.set(cat, list)
  }

  const lines: string[] = ['# Index', '']
  const sortedCategories = [...byCategory.keys()].sort()

  for (const cat of sortedCategories) {
    const catNotes = byCategory.get(cat)!
    lines.push(`## ${cat}`, '')
    for (const note of catNotes) {
      const relPath = relative(notesDir, note.filePath)
      const summary = note.summary ? ` — ${note.summary}` : ''
      lines.push(`- [${note.title}](${relPath})${summary}`)
    }
    lines.push('')
  }

  writeFileSync(join(notesDir, '_index.md'), lines.join('\n'), 'utf-8')
}
