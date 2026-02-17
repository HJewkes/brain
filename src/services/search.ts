import type Database from 'better-sqlite3'
import type { BrainDB } from './brain-db.js'
import type {
  Embedder,
  SearchOptions,
  SearchResult,
  NoteTier,
  NoteConfidence,
} from '../types.js'

const RRF_K = 60
const DEFAULT_BM25_WEIGHT = 0.3
const DEFAULT_VECTOR_WEIGHT = 0.7
const EXCERPT_MAX_LENGTH = 200
const OVERFETCH_MULTIPLIER = 3

interface VectorResult {
  chunkId: string
  noteId: string
  distance: number
}

interface FusionEntry {
  noteId: string
  bm25Rank: number | null
  vectorRank: number | null
  chunkId: string | null
}

function getInternalDb(brainDb: BrainDB): Database.Database {
  return (brainDb as unknown as { db: Database.Database }).db
}

function searchVector(
  rawDb: Database.Database,
  queryEmbedding: Float32Array,
  limit: number,
): VectorResult[] {
  try {
    const rows = rawDb
      .prepare(
        `SELECT
          cv.chunk_id as chunkId,
          c.note_id as noteId,
          cv.distance
        FROM chunk_vectors cv
        JOIN chunks c ON c.id = cv.chunk_id
        WHERE embedding MATCH ?
          AND k = ?
        ORDER BY distance`,
      )
      .all(Buffer.from(queryEmbedding.buffer), limit) as VectorResult[]
    return rows
  } catch {
    return []
  }
}

function buildFilteredNoteIds(
  rawDb: Database.Database,
  options: SearchOptions,
): Set<string> | null {
  const conditions: string[] = []
  const params: unknown[] = []

  if (options.tier) {
    conditions.push('tier = ?')
    params.push(options.tier)
  }

  if (options.category) {
    conditions.push('category = ?')
    params.push(options.category)
  }

  if (options.confidence) {
    conditions.push('confidence = ?')
    params.push(options.confidence)
  }

  if (options.since) {
    conditions.push('modified_at >= ?')
    params.push(options.since)
  }

  if (options.tags && options.tags.length > 0) {
    const tagConditions = options.tags.map(() => 'tags LIKE ?')
    conditions.push(`(${tagConditions.join(' AND ')})`)
    for (const tag of options.tags) {
      params.push(`%${tag}%`)
    }
  }

  if (conditions.length === 0) return null

  const sql = `SELECT id FROM notes WHERE ${conditions.join(' AND ')}`
  const rows = rawDb.prepare(sql).all(...params) as { id: string }[]
  return new Set(rows.map((r) => r.id))
}

function getFirstChunkContent(rawDb: Database.Database, noteId: string): string {
  const row = rawDb
    .prepare('SELECT content FROM chunks WHERE note_id = ? ORDER BY rowid LIMIT 1')
    .get(noteId) as { content: string } | undefined
  return row?.content ?? ''
}

function getChunkContent(rawDb: Database.Database, chunkId: string): string {
  const row = rawDb
    .prepare('SELECT content FROM chunks WHERE id = ?')
    .get(chunkId) as { content: string } | undefined
  return row?.content ?? ''
}

function truncateExcerpt(content: string): string {
  if (content.length <= EXCERPT_MAX_LENGTH) return content
  return content.slice(0, EXCERPT_MAX_LENGTH)
}

function parseTags(tagsStr: string | null): string[] {
  if (!tagsStr) return []
  return tagsStr.split(',').map((t) => t.trim()).filter(Boolean)
}

export async function search(
  db: BrainDB,
  embedder: Embedder,
  query: string,
  options: SearchOptions,
): Promise<SearchResult[]> {
  if (!query.trim()) return []

  const rawDb = getInternalDb(db)
  const limit = options.limit
  const overfetchLimit = limit * OVERFETCH_MULTIPLIER

  const allowedNoteIds = buildFilteredNoteIds(rawDb, options)

  // Step 1: BM25 search via FTS5
  const ftsResults = db.searchFTS(query, overfetchLimit)
  const filteredFts = allowedNoteIds
    ? ftsResults.filter((r) => allowedNoteIds.has(r.noteId))
    : ftsResults

  // Step 2: Vector search
  const queryText = embedder.model.includes('nomic')
    ? `search_query: ${query}`
    : query
  const [queryEmbedding] = await embedder.embed([queryText])
  const queryVec = new Float32Array(queryEmbedding)

  const vectorResults = searchVector(rawDb, queryVec, overfetchLimit)
  const filteredVector = allowedNoteIds
    ? vectorResults.filter((r) => allowedNoteIds.has(r.noteId))
    : vectorResults

  // Deduplicate vector results by noteId (keep best distance per note)
  const bestVectorByNote = new Map<string, VectorResult>()
  for (const vr of filteredVector) {
    const existing = bestVectorByNote.get(vr.noteId)
    if (!existing || vr.distance < existing.distance) {
      bestVectorByNote.set(vr.noteId, vr)
    }
  }

  // Step 3: RRF fusion
  const fusionMap = new Map<string, FusionEntry>()

  for (let i = 0; i < filteredFts.length; i++) {
    const { noteId } = filteredFts[i]
    fusionMap.set(noteId, {
      noteId,
      bm25Rank: i + 1,
      vectorRank: null,
      chunkId: null,
    })
  }

  let vectorRank = 1
  for (const [noteId, vr] of bestVectorByNote) {
    const existing = fusionMap.get(noteId)
    if (existing) {
      existing.vectorRank = vectorRank
      existing.chunkId = vr.chunkId
    } else {
      fusionMap.set(noteId, {
        noteId,
        bm25Rank: null,
        vectorRank,
        chunkId: vr.chunkId,
      })
    }
    vectorRank++
  }

  // Compute RRF scores
  const scored: { noteId: string; score: number; chunkId: string | null }[] = []
  for (const entry of fusionMap.values()) {
    let score = 0
    if (entry.bm25Rank !== null) {
      score += DEFAULT_BM25_WEIGHT * (1 / (RRF_K + entry.bm25Rank))
    }
    if (entry.vectorRank !== null) {
      score += DEFAULT_VECTOR_WEIGHT * (1 / (RRF_K + entry.vectorRank))
    }
    scored.push({ noteId: entry.noteId, score, chunkId: entry.chunkId })
  }

  scored.sort((a, b) => b.score - a.score)
  const topResults = scored.slice(0, limit)

  // Step 4: Build SearchResult objects
  const results: SearchResult[] = []
  for (const item of topResults) {
    const note = db.getNoteById(item.noteId)
    if (!note) continue

    const excerptContent = item.chunkId
      ? getChunkContent(rawDb, item.chunkId)
      : getFirstChunkContent(rawDb, item.noteId)

    results.push({
      score: item.score,
      filePath: note.filePath,
      noteId: note.id,
      heading: getChunkHeading(rawDb, item.chunkId, item.noteId),
      excerpt: truncateExcerpt(excerptContent),
      tier: note.tier as NoteTier,
      tags: parseTags(note.tags),
      confidence: note.confidence as NoteConfidence | null,
    })
  }

  return results
}

function getChunkHeading(
  rawDb: Database.Database,
  chunkId: string | null,
  noteId: string,
): string | null {
  if (chunkId) {
    const row = rawDb
      .prepare('SELECT heading FROM chunks WHERE id = ?')
      .get(chunkId) as { heading: string | null } | undefined
    if (row?.heading) return row.heading
  }
  const row = rawDb
    .prepare('SELECT heading FROM chunks WHERE note_id = ? ORDER BY rowid LIMIT 1')
    .get(noteId) as { heading: string | null } | undefined
  return row?.heading ?? null
}
