import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createBrainMcpServer } from '../../src/server/mcp.js';
import type { BrainServiceClass } from '../../src/services/brain-service.js';
import type { BrainDB } from '../../src/services/brain-db.js';
import { SEARCH_EVENT_TYPE } from '../../src/modules/sessions/search-event.js';
import { createTestDb } from '../helpers.js';
import {
  createSessionEventsTable,
  readSessionEvents,
} from '../modules/sessions/search-event-helpers.js';

let db: BrainDB;
let client: Client;
let cleanup: () => Promise<void>;

function makeService(): BrainServiceClass {
  return {
    isOpen: true,
    config: { dbPath: '/tmp/test.db', notesDir: '/tmp/notes', embedder: 'local' },
    db,
    search: vi.fn().mockResolvedValue([
      {
        noteId: 'note-a',
        heading: 'A',
        filePath: '/notes/a.md',
        score: 0.9,
        excerpt: '',
        tier: 'slow',
        matchSource: 'both',
      },
      {
        noteId: 'note-b',
        heading: 'B',
        filePath: '/notes/b.md',
        score: 0.4,
        excerpt: '',
        tier: 'fast',
        matchSource: 'bm25',
      },
    ]),
  } as unknown as BrainServiceClass;
}

async function callSearch(): Promise<{ isError?: boolean; content: Array<{ text: string }> }> {
  return (await client.callTool({
    name: 'brain_search',
    arguments: { query: 'synthetic query', limit: 5 },
  })) as { isError?: boolean; content: Array<{ text: string }> };
}

beforeEach(async () => {
  ({ db } = createTestDb());
  vi.stubEnv('BRAIN_PM_SESSION', 'sess-mcp');
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  const server = createBrainMcpServer(makeService());
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: 'test-client', version: '1.0.0' });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  cleanup = async () => {
    await client.close();
    await server.close();
  };
});

afterEach(async () => {
  await cleanup();
  db.close();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('brain_search session events', () => {
  it('writes exactly one search event with query, result ids, and count', async () => {
    createSessionEventsTable(db);

    await callSearch();

    const events = readSessionEvents(db, 'sess-mcp');
    expect(events).toHaveLength(1);
    expect(events[0].event_type).toBe(SEARCH_EVENT_TYPE);
    const data = JSON.parse(events[0].data);
    expect(data.entry_point).toBe('mcp');
    expect(data.query).toBe('synthetic query');
    expect(data.options).toEqual({ limit: 5 });
    expect(data.result_count).toBe(2);
    expect(data.results.map((r: { note_id: string }) => r.note_id)).toEqual(['note-a', 'note-b']);
  });

  it('still returns results when the event write fails', async () => {
    db.rawDb.exec('DROP TABLE IF EXISTS session_events');

    const result = await callSearch();

    expect(result.isError).toBeFalsy();
    expect(JSON.parse(result.content[0].text)).toHaveLength(2);
  });
});
