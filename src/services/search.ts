import { existsSync } from 'node:fs';
import type { BrainDB } from './brain-db.js';
import { addFrontmatterField } from './indexing.js';
import { rerank } from './reranker.js';
import type {
  Embedder,
  FusionStrategy,
  MemorySearchResult,
  SearchOptions,
  SearchResult,
  NoteTier,
  NoteConfidence,
} from '../types.js';

const RRF_K = 60;
const EXCERPT_MAX_LENGTH = 200;
const OVERFETCH_MULTIPLIER = 3;

interface RRFEntry {
  noteId: string;
  bm25Rank: number | null;
  vectorRank: number | null;
  chunkId: string | null;
}

interface ScoreEntry {
  noteId: string;
  bm25Score: number | null;
  vectorDistance: number | null;
  chunkId: string | null;
}

function distanceToCosineSim(distance: number): number {
  return 1 - (distance * distance) / 2;
}

function truncateExcerpt(content: string): string {
  if (content.length <= EXCERPT_MAX_LENGTH) return content;
  return content.slice(0, EXCERPT_MAX_LENGTH);
}

async function embedQuery(embedder: Embedder, query: string): Promise<Float32Array> {
  const queryText = embedder.model.includes('nomic') ? `search_query: ${query}` : query;
  const [embedding] = await embedder.embed([queryText]);
  return new Float32Array(embedding);
}

function parseTags(tagsStr: string | null): string[] {
  if (!tagsStr) return [];
  return tagsStr
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
}

interface FTSHit {
  noteId: string;
  rank: number;
}
interface VectorHit {
  chunkId: string;
  noteId: string;
  distance: number;
}
type ScoredResult = { noteId: string; score: number; chunkId: string | null };

/**
 * Find the largest relative score gap between consecutive results and cut there,
 * but only if that gap exceeds the threshold.
 * Threshold is a fraction (e.g. 0.15 = need at least a 15% relative drop to cut).
 * Always keeps at least the first result.
 */
function applyDropoffFilter(results: ScoredResult[], threshold: number): ScoredResult[] {
  if (results.length <= 1) return results;

  let maxDrop = 0;
  let cutIndex = -1;

  for (let i = 1; i < results.length; i++) {
    const prev = results[i - 1].score;
    if (prev <= 0) continue;
    const drop = (prev - results[i].score) / prev;
    if (drop > maxDrop) {
      maxDrop = drop;
      cutIndex = i;
    }
  }

  if (cutIndex > 0 && maxDrop >= threshold) {
    return results.slice(0, cutIndex);
  }

  return results;
}

function fuseByRRF(
  ftsResults: FTSHit[],
  vectorByNote: Map<string, VectorHit>,
  weights: { bm25: number; vector: number }
): ScoredResult[] {
  const fusionMap = new Map<string, RRFEntry>();

  for (let i = 0; i < ftsResults.length; i++) {
    const { noteId } = ftsResults[i];
    fusionMap.set(noteId, {
      noteId,
      bm25Rank: i + 1,
      vectorRank: null,
      chunkId: null,
    });
  }

  let vectorRank = 1;
  for (const [noteId, vr] of vectorByNote) {
    const existing = fusionMap.get(noteId);
    if (existing) {
      existing.vectorRank = vectorRank;
      existing.chunkId = vr.chunkId;
    } else {
      fusionMap.set(noteId, {
        noteId,
        bm25Rank: null,
        vectorRank,
        chunkId: vr.chunkId,
      });
    }
    vectorRank++;
  }

  const scored: ScoredResult[] = [];
  for (const entry of fusionMap.values()) {
    let score = 0;
    if (entry.bm25Rank !== null) {
      score += weights.bm25 * (1 / (RRF_K + entry.bm25Rank));
    }
    if (entry.vectorRank !== null) {
      score += weights.vector * (1 / (RRF_K + entry.vectorRank));
    }
    scored.push({ noteId: entry.noteId, score, chunkId: entry.chunkId });
  }

  return scored;
}

function fuseByScore(
  ftsResults: FTSHit[],
  vectorByNote: Map<string, VectorHit>,
  weights: { bm25: number; vector: number }
): ScoredResult[] {
  const fusionMap = new Map<string, ScoreEntry>();

  for (const { noteId, rank } of ftsResults) {
    fusionMap.set(noteId, {
      noteId,
      bm25Score: rank,
      vectorDistance: null,
      chunkId: null,
    });
  }

  for (const [noteId, vr] of vectorByNote) {
    const existing = fusionMap.get(noteId);
    if (existing) {
      existing.vectorDistance = vr.distance;
      existing.chunkId = vr.chunkId;
    } else {
      fusionMap.set(noteId, {
        noteId,
        bm25Score: null,
        vectorDistance: vr.distance,
        chunkId: vr.chunkId,
      });
    }
  }

  // Min-max normalize BM25 scores (FTS5 rank: negative, lower = better)
  const bm25Scores = [...fusionMap.values()]
    .map((e) => e.bm25Score)
    .filter((s): s is number => s !== null);

  let bm25Best = 0;
  let bm25Worst = 0;
  let bm25Range = 0;
  if (bm25Scores.length > 0) {
    bm25Best = Math.min(...bm25Scores); // most negative = best match
    bm25Worst = Math.max(...bm25Scores); // least negative = worst match
    bm25Range = bm25Worst - bm25Best;
  }

  const scored: ScoredResult[] = [];
  for (const entry of fusionMap.values()) {
    let score = 0;

    if (entry.bm25Score !== null) {
      const normBm25 = bm25Range === 0 ? 1.0 : (bm25Worst - entry.bm25Score) / bm25Range;
      score += weights.bm25 * normBm25;
    }

    if (entry.vectorDistance !== null) {
      const cosineSim = distanceToCosineSim(entry.vectorDistance);
      score += weights.vector * Math.max(0, cosineSim);
    }

    scored.push({ noteId: entry.noteId, score, chunkId: entry.chunkId });
  }

  return scored;
}

export async function search(
  db: BrainDB,
  embedder: Embedder,
  query: string,
  options: SearchOptions,
  fusionWeights: { bm25: number; vector: number } = { bm25: 0.3, vector: 0.7 }
): Promise<SearchResult[]> {
  if (!query.trim()) return [];

  const limit = options.limit;
  const overfetchLimit = limit * OVERFETCH_MULTIPLIER;

  const allowedNoteIds = db.getFilteredNoteIds({
    tier: options.tier,
    category: options.category,
    confidence: options.confidence,
    since: options.since,
    tags: options.tags,
  });

  // Step 1: BM25 search via FTS5
  const ftsResults = db.searchFTS(query, overfetchLimit);
  const filteredFts = allowedNoteIds
    ? ftsResults.filter((r) => allowedNoteIds.has(r.noteId))
    : ftsResults;

  // Step 2: Vector search
  const queryVec = await embedQuery(embedder, query);
  const vectorResults = db.searchVector(queryVec, overfetchLimit);
  const filteredVector = allowedNoteIds
    ? vectorResults.filter((r) => allowedNoteIds.has(r.noteId))
    : vectorResults;

  // Deduplicate vector results by noteId (keep best distance per note)
  const bestVectorByNote = new Map<string, { chunkId: string; noteId: string; distance: number }>();
  for (const vr of filteredVector) {
    const existing = bestVectorByNote.get(vr.noteId);
    if (!existing || vr.distance < existing.distance) {
      bestVectorByNote.set(vr.noteId, vr);
    }
  }

  // Step 3: Fusion
  const strategy: FusionStrategy = options.fusionStrategy ?? 'score';
  const scored =
    strategy === 'score'
      ? fuseByScore(filteredFts, bestVectorByNote, fusionWeights)
      : fuseByRRF(filteredFts, bestVectorByNote, fusionWeights);

  scored.sort((a, b) => b.score - a.score);
  const filtered =
    options.minScore != null ? scored.filter((s) => s.score >= options.minScore!) : scored;
  const afterDropoff = options.dropoff != null ? applyDropoffFilter(filtered, options.dropoff) : filtered;
  const topResults = afterDropoff.slice(0, limit);

  // Step 4: Build SearchResult objects
  const results = buildSearchResults(db, topResults);

  // Step 5: Record access events for returned results
  for (const result of results) {
    db.recordAccess(result.noteId, 'search_hit');
  }

  // Step 6: Optional cross-encoder reranking
  if (options.rerank && results.length > 1) {
    return rerank(query, results, limit);
  }

  return results;
}

function buildSearchResults(
  db: BrainDB,
  topResults: ScoredResult[]
): SearchResult[] {
  const noteIds = topResults.map((r) => r.noteId);
  const notesById = db.getNotesByIds(noteIds);
  const results: SearchResult[] = [];

  for (const item of topResults) {
    const note = notesById.get(item.noteId);
    if (!note) continue;

    const excerptContent = item.chunkId
      ? db.getChunkContent(item.chunkId)
      : (db.getFirstChunkForNote(item.noteId)?.content ?? '');

    results.push({
      score: item.score,
      filePath: note.filePath,
      noteId: note.id,
      heading: db.getChunkHeading(item.chunkId, item.noteId),
      excerpt: truncateExcerpt(excerptContent),
      tier: note.tier as NoteTier,
      tags: parseTags(note.tags),
      confidence: note.confidence as NoteConfidence | null,
    });
  }

  return results;
}

export async function searchMemories(
  db: BrainDB,
  embedder: Embedder,
  query: string,
  limit: number = 10,
  containerTag?: string
): Promise<MemorySearchResult[]> {
  if (!query.trim()) return [];

  const queryVec = await embedQuery(embedder, query);
  const vectorResults = db.searchMemoryVectors(queryVec, limit * 3);
  if (vectorResults.length === 0) return [];

  const memoryIds = vectorResults.map((vr) => vr.memoryId);
  const memoriesById = db.getMemoriesByIds(memoryIds);

  const results: MemorySearchResult[] = [];
  for (const vr of vectorResults) {
    const memory = memoriesById.get(vr.memoryId);
    if (!memory) continue;
    if (!memory.isLatest || memory.isForgotten) continue;
    if (containerTag && memory.containerTag !== containerTag) continue;

    const cosineSim = distanceToCosineSim(vr.distance);
    results.push({
      score: Math.max(0, cosineSim),
      memory: memory.memory,
      memoryId: memory.id,
      sourceNoteId: memory.sourceNoteId,
      containerTag: memory.containerTag,
      createdAt: memory.createdAt,
    });
  }

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, limit);
}

const DEFAULT_PROMOTION_THRESHOLD = 10;

export function checkAndPromote(
  db: BrainDB,
  noteId: string,
  threshold: number = DEFAULT_PROMOTION_THRESHOLD
): boolean {
  const note = db.getNoteById(noteId);
  if (!note || note.tier !== 'fast') return false;

  const count = db.getAccessCount(noteId);
  if (count < threshold) return false;

  const promoted = { ...note, tier: 'slow' as const, reviewInterval: null };
  db.upsertNote(promoted);

  if (existsSync(note.filePath)) {
    addFrontmatterField(note.filePath, 'tier', 'slow');
  }

  return true;
}
