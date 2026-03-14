import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { BrainDB } from '../../../src/services/brain-db.js';
import { createMockEmbedder, createTestDb } from '../../helpers.js';
import type { BrainConfig } from '../../../src/types.js';
import {
  extractSessionMemories,
  updateSessionMemoryCount,
} from '../../../src/modules/sessions/engine/extract-memories.js';
import {
  createSession,
  getSessionBySessionId,
} from '../../../src/modules/sessions/data/session-ops.js';

let db: BrainDB;
let dbPath: string;
let notesDir: string;
let config: BrainConfig;
const embedder = createMockEmbedder();

function insertSessionChunk(
  database: BrainDB,
  sessionId: string,
  chunkIndex: number,
  content: string
): void {
  const rawDb = (
    database as unknown as {
      db: {
        prepare: (sql: string) => {
          run: (...args: unknown[]) => void;
        };
      };
    }
  ).db;

  rawDb
    .prepare(
      'INSERT INTO session_chunks (session_id, chunk_index, content, source, timestamp) VALUES (?, ?, ?, ?, ?)'
    )
    .run(sessionId, chunkIndex, content, 'compaction', new Date().toISOString());
}

function createMockOllama() {
  return {
    generate: vi.fn().mockResolvedValue(
      JSON.stringify([
        { fact: 'The project uses TypeScript for all source code', category: 'tools' },
        { fact: 'Tests are written using Vitest framework', category: 'tools' },
      ])
    ),
    embed: vi.fn(),
    chat: vi.fn(),
    hasModel: vi.fn(),
  };
}

function createSessionChunksTable(database: BrainDB): void {
  const rawDb = (
    database as unknown as {
      db: { exec: (sql: string) => void };
    }
  ).db;

  rawDb.exec(`
    CREATE TABLE IF NOT EXISTS session_chunks (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id  TEXT    NOT NULL,
      chunk_index INTEGER NOT NULL,
      content     TEXT    NOT NULL,
      source      TEXT    NOT NULL CHECK(source IN ('compaction', 'periodic', 'manual')),
      timestamp   TEXT    NOT NULL,
      UNIQUE(session_id, chunk_index)
    );
  `);
}

beforeEach(() => {
  ({ dbPath, db } = createTestDb());
  createSessionChunksTable(db);
  notesDir = join(tmpdir(), `session-commit-${randomUUID()}`);
  mkdirSync(notesDir, { recursive: true });
  config = {
    notesDir,
    dbPath,
    embedder: 'local',
    fusionWeights: { bm25: 0.3, vector: 0.7 },
  };
});

afterEach(() => {
  db.close();
  if (existsSync(notesDir)) {
    rmSync(notesDir, { recursive: true, force: true });
  }
});

describe('extractSessionMemories', () => {
  it('returns empty result when no session chunks exist', async () => {
    // Arrange
    const sessionId = 'no-chunks-session';
    const created = await createSession(db, config, embedder, {
      session_id: sessionId,
      project_dir: '/test',
      status: 'completed',
      started_at: '2026-03-13T10:00:00Z',
    });
    if (!created.ok) throw new Error('Failed to create session');

    const llm = createMockOllama();

    // Act
    const result = await extractSessionMemories(
      db,
      llm as never,
      embedder,
      sessionId,
      created.data.note_id
    );

    // Assert
    expect(result.memoriesCreated).toBe(0);
    expect(result.memoriesUpdated).toBe(0);
    expect(result.memoriesDeleted).toBe(0);
    expect(llm.generate).not.toHaveBeenCalled();
  });

  it('extracts memories from session chunks', async () => {
    // Arrange
    const sessionId = 'extract-session';
    const created = await createSession(db, config, embedder, {
      session_id: sessionId,
      project_dir: '/test',
      status: 'completed',
      started_at: '2026-03-13T10:00:00Z',
    });
    if (!created.ok) throw new Error('Failed to create session');

    insertSessionChunk(
      db,
      sessionId,
      0,
      'Implemented search feature using BM25 algorithm with TypeScript. Tests written with Vitest framework.'
    );

    const llm = createMockOllama();

    // Act
    const result = await extractSessionMemories(
      db,
      llm as never,
      embedder,
      sessionId,
      created.data.note_id
    );

    // Assert
    expect(result.memoriesCreated).toBe(2);
    expect(llm.generate).toHaveBeenCalled();

    const memories = db.getMemoriesForNote(created.data.note_id);
    expect(memories).toHaveLength(2);
    expect(memories[0].containerTag).toBe(`session:${sessionId}`);
  });

  it('injects session chunks as note chunks for extraction', async () => {
    // Arrange
    const sessionId = 'inject-chunks-session';
    const created = await createSession(db, config, embedder, {
      session_id: sessionId,
      project_dir: '/test',
      status: 'completed',
      started_at: '2026-03-13T10:00:00Z',
    });
    if (!created.ok) throw new Error('Failed to create session');

    insertSessionChunk(
      db,
      sessionId,
      0,
      'First micro-summary about refactoring the database layer.'
    );
    insertSessionChunk(db, sessionId, 1, 'Second micro-summary about adding new API endpoints.');

    const llm = createMockOllama();

    // Act
    await extractSessionMemories(db, llm as never, embedder, sessionId, created.data.note_id);

    // Assert: chunks were replaced with session content
    const chunks = db.getChunksForNote(created.data.note_id);
    expect(chunks).toHaveLength(2);
    expect(chunks[0].content).toContain('refactoring the database layer');
    expect(chunks[1].content).toContain('adding new API endpoints');
  });

  it('handles multiple chunks with separate LLM calls', async () => {
    // Arrange
    const sessionId = 'multi-chunk-session';
    const created = await createSession(db, config, embedder, {
      session_id: sessionId,
      project_dir: '/test',
      status: 'completed',
      started_at: '2026-03-13T10:00:00Z',
    });
    if (!created.ok) throw new Error('Failed to create session');

    insertSessionChunk(db, sessionId, 0, 'Worked on implementing the auth module with JWT tokens.');
    insertSessionChunk(db, sessionId, 1, 'Debugged performance issue in the query optimizer.');

    const llm = {
      generate: vi
        .fn()
        .mockResolvedValueOnce(
          JSON.stringify([{ fact: 'Auth module uses JWT tokens', category: 'tools' }])
        )
        .mockResolvedValueOnce(
          JSON.stringify([{ fact: 'Query optimizer had performance issues', category: 'cases' }])
        ),
      embed: vi.fn(),
      chat: vi.fn(),
      hasModel: vi.fn(),
    };

    // Act
    const result = await extractSessionMemories(
      db,
      llm as never,
      embedder,
      sessionId,
      created.data.note_id
    );

    // Assert
    expect(result.memoriesCreated).toBe(2);
    expect(llm.generate).toHaveBeenCalledTimes(2);
  });
});

describe('updateSessionMemoryCount', () => {
  it('updates memories_extracted in session metadata', async () => {
    // Arrange
    const sessionId = 'update-count-session';
    await createSession(db, config, embedder, {
      session_id: sessionId,
      project_dir: '/test',
      status: 'completed',
      started_at: '2026-03-13T10:00:00Z',
    });

    // Act
    updateSessionMemoryCount(db, sessionId, 5);

    // Assert
    const session = getSessionBySessionId(db, sessionId);
    expect(session).not.toBeNull();
    expect(session!.memories_extracted).toBe(5);
  });

  it('does nothing for nonexistent session', () => {
    // Act & Assert: should not throw
    updateSessionMemoryCount(db, 'nonexistent-session', 3);
  });
});
