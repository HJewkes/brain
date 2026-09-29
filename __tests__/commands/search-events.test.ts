import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { BrainDB } from '../../src/services/brain-db.js';
import { createMockEmbedder, makeNote, makeChunk, createTestDb } from '../helpers.js';
import type { BrainConfig } from '../../src/types.js';
import { searchCommand } from '../../src/commands/search.js';
import { SEARCH_EVENT_TYPE } from '../../src/modules/sessions/search-event.js';
import {
  createSessionEventsTable,
  readSessionEvents,
} from '../modules/sessions/search-event-helpers.js';

let db: BrainDB;
const embedder = createMockEmbedder();
let config: BrainConfig;
let stdoutChunks: string[];

vi.mock('../../src/services/brain-service.js', () => ({
  withBrain: vi.fn(async (fn) =>
    fn({ db, embedder, config, modules: { getFilters: () => [] }, close: () => {} })
  ),
  withDb: vi.fn(async (fn) => fn({ db, config, close: () => {} })),
}));

async function run(...args: string[]): Promise<void> {
  await searchCommand.parseAsync(['node', 'search', ...args], { from: 'node' });
}

beforeEach(async () => {
  ({ db } = createTestDb());
  config = {
    notesDir: '/tmp/test-search-events',
    dbPath: ':memory:',
    embedder: 'local',
    fusionWeights: { bm25: 0.3, vector: 0.7 },
  };
  stdoutChunks = [];
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    stdoutChunks.push(String(chunk));
    return true;
  });
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  vi.stubEnv('BRAIN_PM_SESSION', 'sess-cli');

  db.setEmbeddingModel(embedder.model, embedder.dimensions);
  db.upsertNote(makeNote({ id: 'synthetic-note', title: 'Synthetic', filePath: '/tmp/syn.md' }));
  const chunk = makeChunk({ noteId: 'synthetic-note', content: 'TypeScript testing patterns' });
  const vectors = await embedder.embed([chunk.content]);
  db.upsertChunks('synthetic-note', [chunk], [new Float32Array(vectors[0])]);
});

afterEach(() => {
  db.close();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('brain search session events', () => {
  it('writes exactly one search event with query, result ids, and count', async () => {
    createSessionEventsTable(db);

    await run('TypeScript', '--tier', 'slow');

    const events = readSessionEvents(db, 'sess-cli');
    expect(events).toHaveLength(1);
    expect(events[0].event_type).toBe(SEARCH_EVENT_TYPE);
    const data = JSON.parse(events[0].data);
    expect(data.entry_point).toBe('cli');
    expect(data.query).toBe('TypeScript');
    expect(data.result_count).toBe(1);
    expect(data.results.map((r: { note_id: string }) => r.note_id)).toEqual(['synthetic-note']);
    expect(data.options.tier).toBe('slow');
    expect(typeof data.latency_ms).toBe('number');
  });

  it('still prints results when the event write fails', async () => {
    db.rawDb.exec('DROP TABLE IF EXISTS session_events');

    await run('TypeScript');

    expect(stdoutChunks.join('')).toContain('/tmp/syn.md');
  });
});
