import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { BrainDB } from '../../../src/services/brain-db.js';
import type { SessionEvent } from '../../../src/modules/sessions/types.js';
import {
  recordSearchEvent,
  SEARCH_EVENT_TYPE,
  SEARCH_EVENT_MAX_RESULTS,
} from '../../../src/modules/sessions/search-event.js';
import { createTestDb } from '../../helpers.js';
import { createSessionEventsTable, readSessionEvents } from './search-event-helpers.js';

let db: BrainDB;

function makeResults(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    noteId: `note-${i}`,
    filePath: `/notes/note-${i}.md`,
    score: 1 - i / 100,
    matchSource: 'both' as const,
  }));
}

beforeEach(() => {
  ({ db } = createTestDb());
  createSessionEventsTable(db);
  vi.stubEnv('BRAIN_PM_SESSION', 'sess-synthetic');
});

afterEach(() => {
  db.close();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('recordSearchEvent', () => {
  it('stores query, full count, and ranked results capped at the maximum', () => {
    recordSearchEvent(db, {
      entryPoint: 'cli',
      query: 'typescript patterns',
      options: { limit: 30 },
      results: makeResults(25),
      latencyMs: 12.4,
    });

    const events = readSessionEvents(db, 'sess-synthetic');
    expect(events).toHaveLength(1);
    expect(events[0].event_type).toBe(SEARCH_EVENT_TYPE);
    const data = JSON.parse(events[0].data);
    expect(data.query).toBe('typescript patterns');
    expect(data.result_count).toBe(25);
    expect(data.results).toHaveLength(SEARCH_EVENT_MAX_RESULTS);
    expect(data.results[0]).toEqual({
      rank: 1,
      note_id: 'note-0',
      file_path: '/notes/note-0.md',
      score: 1,
      match_source: 'both',
    });
    expect(data.latency_ms).toBe(12);
    expect(data.entry_point).toBe('cli');
    expect(data.options).toEqual({ limit: 30 });
  });

  it('records repeated identical searches as separate events', () => {
    const input = {
      entryPoint: 'mcp' as const,
      query: 'same',
      options: {},
      results: makeResults(1),
      latencyMs: 1,
    };
    recordSearchEvent(db, input);
    recordSearchEvent(db, input);

    expect(readSessionEvents(db, 'sess-synthetic')).toHaveLength(2);
  });

  it('records nothing outside a brain session', () => {
    vi.stubEnv('BRAIN_PM_SESSION', '');

    recordSearchEvent(db, {
      entryPoint: 'cli',
      query: 'q',
      options: {},
      results: [],
      latencyMs: 1,
    });

    const rows = db.rawDb.prepare('SELECT * FROM session_events').all() as SessionEvent[];
    expect(rows).toHaveLength(0);
  });

  it('logs and swallows a failing write', () => {
    db.rawDb.exec('DROP TABLE session_events');
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    expect(() =>
      recordSearchEvent(db, {
        entryPoint: 'cli',
        query: 'q',
        options: {},
        results: [],
        latencyMs: 1,
      })
    ).not.toThrow();
    expect(stderr.mock.calls.map((c) => String(c[0])).join('')).toContain(
      'failed to record search event'
    );
  });
});
