import { randomUUID } from 'node:crypto';
import type { BrainDB } from '../../services/brain-db.js';
import type { SearchResult } from '../../types.js';
import { insertSessionEvent } from './hooks/capture-event.js';

export const SEARCH_EVENT_TYPE = 'search:query';
export const SEARCH_EVENT_MAX_RESULTS = 20;
const MAX_QUERY_CHARS = 500;

export type SearchEntryPoint = 'cli' | 'mcp';

export interface SearchEventInput {
  entryPoint: SearchEntryPoint;
  query: string;
  options: Record<string, unknown>;
  results: Array<Pick<SearchResult, 'noteId' | 'filePath' | 'score' | 'matchSource'>>;
  latencyMs: number;
}

/** Records one search in the current brain session; never throws, no-op without BRAIN_PM_SESSION. */
export function recordSearchEvent(db: BrainDB, input: SearchEventInput): void {
  const sessionId = process.env.BRAIN_PM_SESSION;
  if (!sessionId) return;

  try {
    insertSessionEvent(db, {
      session_id: sessionId,
      event_type: SEARCH_EVENT_TYPE,
      category: 'search',
      data: buildSearchEventData(input),
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`brain: failed to record search event: ${message}\n`);
  }
}

function buildSearchEventData(input: SearchEventInput): Record<string, unknown> {
  return {
    search_id: randomUUID(),
    entry_point: input.entryPoint,
    agent_id: process.env.BRAIN_AGENT_ID ?? null,
    query: input.query.slice(0, MAX_QUERY_CHARS),
    options: input.options,
    result_count: input.results.length,
    results: input.results.slice(0, SEARCH_EVENT_MAX_RESULTS).map((r, i) => ({
      rank: i + 1,
      note_id: r.noteId,
      file_path: r.filePath,
      score: r.score,
      match_source: r.matchSource,
    })),
    latency_ms: Math.round(input.latencyMs),
  };
}
