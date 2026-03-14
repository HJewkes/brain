import type { BrainDB } from './brain-db.js';
import type { Embedder, MatchSource } from '../types.js';

export type QueryIntent = 'factual' | 'conceptual' | 'comparison' | 'procedural';

interface SubQuery {
  text: string;
  strategy: 'bm25' | 'vector' | 'hybrid';
  weight: number;
}

export interface IntentClassification {
  intent: QueryIntent;
  confidence: number;
}

interface ScoredCandidate {
  noteId: string;
  score: number;
  chunkId: string | null;
  matchSource: MatchSource;
}

const COMPARISON_PATTERNS = [
  /\bvs\.?\b/i,
  /\bversus\b/i,
  /\bcompare[ds]?\b/i,
  /\bcomparison\b/i,
  /\bdifference[s]?\b/i,
  /\bbetter\b/i,
  /\bworse\b/i,
  /\btradeoff[s]?\b/i,
  /\btrade-off[s]?\b/i,
  /\bpros\s+and\s+cons\b/i,
  /\badvantage[s]?\b/i,
  /\bdisadvantage[s]?\b/i,
  /\bor\b.*\?$/i,
];

const PROCEDURAL_PATTERNS = [
  /^how\s+(do|to|can|should|would)\b/i,
  /\bstep[s]?\b/i,
  /\bguide\b/i,
  /\btutorial\b/i,
  /\bsetup\b/i,
  /\bset\s+up\b/i,
  /\binstall\b/i,
  /\bconfigure\b/i,
  /\bimplement\b/i,
  /\bcreate\b/i,
  /\bbuild\b/i,
  /\bmigrate\b/i,
];

const FACTUAL_PATTERNS = [
  /^what\s+(is|are|was|were)\b/i,
  /^who\s+(is|are|was|were|created|invented|founded|made|discovered)\b/i,
  /^when\s+(is|are|was|were|did)\b/i,
  /^where\s+(is|are|was|were)\b/i,
  /^which\b/i,
  /\bdefinition\b/i,
  /\bmeaning\b/i,
  /\bexplain\b/i,
];

export function classifyIntent(query: string): IntentClassification {
  const trimmed = query.trim();

  if (matchesAny(trimmed, COMPARISON_PATTERNS)) {
    return { intent: 'comparison', confidence: 0.8 };
  }

  if (matchesAny(trimmed, PROCEDURAL_PATTERNS)) {
    return { intent: 'procedural', confidence: 0.8 };
  }

  if (matchesAny(trimmed, FACTUAL_PATTERNS)) {
    return { intent: 'factual', confidence: 0.8 };
  }

  return { intent: 'conceptual', confidence: 0.5 };
}

function matchesAny(text: string, patterns: RegExp[]): boolean {
  return patterns.some((p) => p.test(text));
}

export function expandQuery(query: string, intent: QueryIntent): SubQuery[] {
  switch (intent) {
    case 'factual':
      return expandFactual(query);
    case 'conceptual':
      return expandConceptual(query);
    case 'comparison':
      return expandComparison(query);
    case 'procedural':
      return expandProcedural(query);
  }
}

function expandFactual(query: string): SubQuery[] {
  return [
    { text: query, strategy: 'bm25', weight: 0.7 },
    { text: query, strategy: 'vector', weight: 0.3 },
  ];
}

function expandConceptual(query: string): SubQuery[] {
  const coreTerms = extractCoreTerms(query);
  const subQueries: SubQuery[] = [
    { text: query, strategy: 'hybrid', weight: 0.5 },
    { text: query, strategy: 'vector', weight: 0.3 },
  ];

  if (coreTerms.length > 0) {
    subQueries.push({
      text: `${coreTerms.join(' ')} concepts principles`,
      strategy: 'vector',
      weight: 0.2,
    });
  }

  return subQueries;
}

function expandComparison(query: string): SubQuery[] {
  const parts = splitComparisonTerms(query);
  const partWeight = 0.6 / parts.length;
  const subQueries: SubQuery[] = [{ text: query, strategy: 'hybrid', weight: 0.4 }];

  for (const part of parts) {
    subQueries.push({ text: part, strategy: 'hybrid', weight: partWeight });
  }

  return subQueries;
}

function expandProcedural(query: string): SubQuery[] {
  return [
    { text: query, strategy: 'vector', weight: 0.5 },
    { text: query, strategy: 'bm25', weight: 0.3 },
    { text: `${query} guide tutorial`, strategy: 'vector', weight: 0.2 },
  ];
}

function extractCoreTerms(query: string): string[] {
  const stopWords = new Set([
    'a',
    'an',
    'the',
    'is',
    'are',
    'was',
    'were',
    'be',
    'been',
    'being',
    'have',
    'has',
    'had',
    'do',
    'does',
    'did',
    'will',
    'would',
    'could',
    'should',
    'may',
    'might',
    'can',
    'shall',
    'to',
    'of',
    'in',
    'for',
    'on',
    'with',
    'at',
    'by',
    'from',
    'about',
    'into',
    'through',
    'during',
    'before',
    'after',
    'above',
    'below',
    'between',
    'and',
    'but',
    'or',
    'nor',
    'not',
    'so',
    'yet',
    'both',
    'either',
    'neither',
    'each',
    'every',
    'all',
    'any',
    'few',
    'more',
    'most',
    'other',
    'some',
    'such',
    'no',
    'only',
    'own',
    'same',
    'than',
    'too',
    'very',
    'just',
    'because',
    'as',
    'until',
    'while',
    'what',
    'which',
    'who',
    'whom',
    'this',
    'that',
    'these',
    'those',
    'how',
    'why',
    'when',
    'where',
    'i',
    'me',
    'my',
    'it',
    'its',
  ]);

  return query
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 2 && !stopWords.has(w));
}

function splitComparisonTerms(query: string): string[] {
  const separators = /\b(?:vs\.?|versus|compared?\s+to|or)\b/i;
  const parts = query
    .split(separators)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  return parts.length >= 2 ? parts : [query];
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

async function embedQuery(embedder: Embedder, query: string): Promise<Float32Array> {
  const queryText = embedder.model.includes('nomic') ? `search_query: ${query}` : query;
  const [embedding] = await embedder.embed([queryText]);
  return new Float32Array(embedding);
}

function distanceToCosineSim(distance: number): number {
  return 1 - (distance * distance) / 2;
}

async function executeSubQuery(
  db: BrainDB,
  embedder: Embedder,
  subQuery: SubQuery,
  limit: number,
  allowedNoteIds: Set<string> | null
): Promise<ScoredCandidate[]> {
  switch (subQuery.strategy) {
    case 'bm25':
      return executeBM25(db, subQuery, limit, allowedNoteIds);
    case 'vector':
      return executeVector(db, embedder, subQuery, limit, allowedNoteIds);
    case 'hybrid':
      return executeHybrid(db, embedder, subQuery, limit, allowedNoteIds);
  }
}

function executeBM25(
  db: BrainDB,
  subQuery: SubQuery,
  limit: number,
  allowedNoteIds: Set<string> | null
): ScoredCandidate[] {
  let hits: FTSHit[] = db.searchFTS(subQuery.text, limit);
  if (allowedNoteIds) {
    hits = hits.filter((h) => allowedNoteIds.has(h.noteId));
  }
  return normalizeBM25Hits(hits, subQuery.weight);
}

async function executeVector(
  db: BrainDB,
  embedder: Embedder,
  subQuery: SubQuery,
  limit: number,
  allowedNoteIds: Set<string> | null
): Promise<ScoredCandidate[]> {
  const queryVec = await embedQuery(embedder, subQuery.text);
  let hits: VectorHit[] = db.searchVector(queryVec, limit);
  if (allowedNoteIds) {
    hits = hits.filter((h) => allowedNoteIds.has(h.noteId));
  }
  return normalizeVectorHits(deduplicateVectorHits(hits), subQuery.weight);
}

async function executeHybrid(
  db: BrainDB,
  embedder: Embedder,
  subQuery: SubQuery,
  limit: number,
  allowedNoteIds: Set<string> | null
): Promise<ScoredCandidate[]> {
  const bm25Results = executeBM25(db, { ...subQuery, weight: 0.3 }, limit, allowedNoteIds);
  const vectorResults = await executeVector(
    db,
    embedder,
    { ...subQuery, weight: 0.7 },
    limit,
    allowedNoteIds
  );
  return mergeAndWeight([...bm25Results, ...vectorResults], subQuery.weight);
}

function normalizeBM25Hits(hits: FTSHit[], weight: number): ScoredCandidate[] {
  if (hits.length === 0) return [];

  const scores = hits.map((h) => h.rank);
  const best = Math.min(...scores);
  const worst = Math.max(...scores);
  const range = worst - best;

  return hits.map((h) => ({
    noteId: h.noteId,
    score: (range === 0 ? 1.0 : (worst - h.rank) / range) * weight,
    chunkId: null,
    matchSource: 'bm25' as MatchSource,
  }));
}

function normalizeVectorHits(hits: Map<string, VectorHit>, weight: number): ScoredCandidate[] {
  const results: ScoredCandidate[] = [];
  for (const [, hit] of hits) {
    const cosineSim = distanceToCosineSim(hit.distance);
    results.push({
      noteId: hit.noteId,
      score: Math.max(0, cosineSim) * weight,
      chunkId: hit.chunkId,
      matchSource: 'vector' as MatchSource,
    });
  }
  return results;
}

function deduplicateVectorHits(hits: VectorHit[]): Map<string, VectorHit> {
  const best = new Map<string, VectorHit>();
  for (const hit of hits) {
    const existing = best.get(hit.noteId);
    if (!existing || hit.distance < existing.distance) {
      best.set(hit.noteId, hit);
    }
  }
  return best;
}

function mergeAndWeight(candidates: ScoredCandidate[], outerWeight: number): ScoredCandidate[] {
  const merged = new Map<string, ScoredCandidate>();
  for (const c of candidates) {
    const existing = merged.get(c.noteId);
    if (existing) {
      existing.score += c.score;
      if (existing.matchSource !== c.matchSource) {
        existing.matchSource = 'both';
      }
    } else {
      merged.set(c.noteId, { ...c });
    }
  }

  const results = [...merged.values()];
  const maxScore = Math.max(...results.map((r) => r.score), 1);
  for (const r of results) {
    r.score = (r.score / maxScore) * outerWeight;
  }
  return results;
}

export async function intentSearch(
  db: BrainDB,
  embedder: Embedder,
  query: string,
  limit: number,
  allowedNoteIds: Set<string> | null
): Promise<{ results: ScoredCandidate[]; intent: IntentClassification }> {
  const intent = classifyIntent(query);
  const subQueries = expandQuery(query, intent.intent);

  const allCandidates: ScoredCandidate[] = [];
  for (const sq of subQueries) {
    const results = await executeSubQuery(db, embedder, sq, limit * 3, allowedNoteIds);
    allCandidates.push(...results);
  }

  const merged = deduplicateCandidates(allCandidates);
  merged.sort((a, b) => b.score - a.score);

  return { results: merged.slice(0, limit), intent };
}

function deduplicateCandidates(candidates: ScoredCandidate[]): ScoredCandidate[] {
  const merged = new Map<string, ScoredCandidate>();
  for (const c of candidates) {
    const existing = merged.get(c.noteId);
    if (existing) {
      existing.score += c.score;
      if (c.chunkId && !existing.chunkId) {
        existing.chunkId = c.chunkId;
      }
      if (existing.matchSource !== c.matchSource) {
        existing.matchSource = 'both';
      }
    } else {
      merged.set(c.noteId, { ...c });
    }
  }
  return [...merged.values()];
}
