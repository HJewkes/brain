import type { BrainDB } from './brain-db.js'
import type {
  Embedder,
  SearchOptions,
  SearchResult,
  NoteTier,
  NoteConfidence,
} from '../types.js'

const RRF_K = 60
const EXCERPT_MAX_LENGTH = 200
const OVERFETCH_MULTIPLIER = 3

interface FusionEntry {
  noteId: string
  bm25Rank: number | null
  vectorRank: number | null
  chunkId: string | null
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
  fusionWeights: { bm25: number; vector: number } = { bm25: 0.3, vector: 0.7 },
): Promise<SearchResult[]> {
  if (!query.trim()) return []

  const limit = options.limit
  const overfetchLimit = limit * OVERFETCH_MULTIPLIER

  const allowedNoteIds = db.getFilteredNoteIds({
    tier: options.tier,
    category: options.category,
    confidence: options.confidence,
    since: options.since,
    tags: options.tags,
  })

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

  const vectorResults = db.searchVector(queryVec, overfetchLimit)
  const filteredVector = allowedNoteIds
    ? vectorResults.filter((r) => allowedNoteIds.has(r.noteId))
    : vectorResults

  // Deduplicate vector results by noteId (keep best distance per note)
  const bestVectorByNote = new Map<string, { chunkId: string; noteId: string; distance: number }>()
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
      score += fusionWeights.bm25 * (1 / (RRF_K + entry.bm25Rank))
    }
    if (entry.vectorRank !== null) {
      score += fusionWeights.vector * (1 / (RRF_K + entry.vectorRank))
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
      ? db.getChunkContent(item.chunkId)
      : (db.getFirstChunkForNote(item.noteId)?.content ?? '')

    results.push({
      score: item.score,
      filePath: note.filePath,
      noteId: note.id,
      heading: db.getChunkHeading(item.chunkId, item.noteId),
      excerpt: truncateExcerpt(excerptContent),
      tier: note.tier as NoteTier,
      tags: parseTags(note.tags),
      confidence: note.confidence as NoteConfidence | null,
    })
  }

  return results
}
