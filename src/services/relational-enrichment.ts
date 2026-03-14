import type { BrainDB } from './brain-db.js';
import type { SearchResult } from '../types.js';

export interface RelatedNoteSummary {
  noteId: string;
  title: string;
  relationType: string;
  abstract: string | null;
}

export interface EnrichedSearchResult extends SearchResult {
  relatedNotes: RelatedNoteSummary[];
}

export interface EnrichmentOptions {
  maxRelated?: number;
  maxResults?: number;
}

const DEFAULT_MAX_RELATED = 5;
const DEFAULT_MAX_RESULTS = 3;

export function enrichSearchResults(
  db: BrainDB,
  results: SearchResult[],
  options?: EnrichmentOptions
): EnrichedSearchResult[] {
  const maxRelated = options?.maxRelated ?? DEFAULT_MAX_RELATED;
  const maxResults = options?.maxResults ?? DEFAULT_MAX_RESULTS;

  return results.map((result, index) => {
    if (index >= maxResults) {
      return { ...result, relatedNotes: [] };
    }
    const relatedNotes = getRelatedSummaries(db, result.noteId, maxRelated);
    return { ...result, relatedNotes };
  });
}

function getRelatedSummaries(
  db: BrainDB,
  noteId: string,
  maxRelated: number
): RelatedNoteSummary[] {
  const outgoing = db.getRelationsFrom(noteId);
  const incoming = db.getRelationsTo(noteId);

  const seen = new Set<string>();
  const relatedIds: Array<{ id: string; type: string }> = [];

  for (const rel of outgoing) {
    if (!seen.has(rel.targetId)) {
      seen.add(rel.targetId);
      relatedIds.push({ id: rel.targetId, type: rel.type });
    }
  }
  for (const rel of incoming) {
    if (!seen.has(rel.sourceId)) {
      seen.add(rel.sourceId);
      relatedIds.push({ id: rel.sourceId, type: rel.type });
    }
  }

  const limited = relatedIds.slice(0, maxRelated);
  if (limited.length === 0) return [];

  const noteIds = limited.map((r) => r.id);
  const notesById = db.getNotesByIds(noteIds);

  const summaries: RelatedNoteSummary[] = [];
  for (const { id, type } of limited) {
    const note = notesById.get(id);
    if (!note) continue;
    summaries.push({
      noteId: id,
      title: note.title,
      relationType: type,
      abstract: note.l0Abstract ?? note.summary ?? null,
    });
  }

  return summaries;
}
