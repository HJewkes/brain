import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { BrainDB } from '../../src/services/brain-db.js';
import {
  extractMemoriesFromNote,
  parseReconciliationResponse,
} from '../../src/services/memory-extractor.js';
import type { OllamaClient } from '../../src/services/ollama.js';
import { makeChunk } from '../helpers.js';

function makeMockLLM(responses: string[]): OllamaClient {
  let callIndex = 0;
  return {
    model: 'test-model',
    generate: vi.fn(async () => {
      const response = responses[callIndex] ?? '';
      callIndex++;
      return response;
    }),
  };
}

function seedNote(db: BrainDB): void {
  db.upsertNote({
    id: 'note-1',
    filePath: '/tmp/note-1.md',
    title: 'Test Note',
    type: 'note',
    tier: 'slow',
    category: null,
    tags: null,
    summary: null,
    confidence: null,
    status: 'current',
    sources: null,
    createdAt: null,
    modifiedAt: null,
    lastReviewed: null,
    reviewInterval: null,
    expires: null,
    metadata: null,
  });
}

describe('extractMemoriesFromNote', () => {
  let db: BrainDB;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'brain-mem-test-'));
    db = new BrainDB(join(tmpDir, 'test.db'));
    db.setEmbeddingModel('test-model', 3);
    seedNote(db);
  });

  afterEach(() => {
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('extracts facts from note chunks and stores as memories', async () => {
    const chunk = makeChunk({
      id: 'chunk-1',
      noteId: 'note-1',
      content: 'TypeScript uses structural typing for type compatibility.',
    });
    db.upsertChunks('note-1', [chunk], [new Float32Array([1, 2, 3])]);

    const llm = makeMockLLM([
      'TypeScript uses structural typing for type compatibility\nStructural typing checks shape rather than name',
    ]);

    const result = await extractMemoriesFromNote(db, llm, 'note-1');

    expect(result.memoriesCreated).toBe(2);
    expect(result.facts).toHaveLength(2);

    const memories = db.getMemoriesForNote('note-1');
    expect(memories).toHaveLength(2);
    expect(memories[0].sourceNoteId).toBe('note-1');
    expect(memories[0].sourceChunkId).toBe('chunk-1');
    expect(memories[0].isLatest).toBe(true);
  });

  it('skips short chunks', async () => {
    const chunk = makeChunk({ id: 'chunk-1', noteId: 'note-1', content: 'Too short' });
    db.upsertChunks('note-1', [chunk], [new Float32Array([1, 2, 3])]);

    const llm = makeMockLLM([]);

    const result = await extractMemoriesFromNote(db, llm, 'note-1');
    expect(result.memoriesCreated).toBe(0);
    expect(llm.generate).not.toHaveBeenCalled();
  });

  it('handles empty LLM response', async () => {
    const chunk = makeChunk({
      id: 'chunk-1',
      noteId: 'note-1',
      content: 'This is a longer chunk with enough content to process.',
    });
    db.upsertChunks('note-1', [chunk], [new Float32Array([1, 2, 3])]);

    const llm = makeMockLLM(['']);

    const result = await extractMemoriesFromNote(db, llm, 'note-1');
    expect(result.memoriesCreated).toBe(0);
  });

  it('records history for each created memory', async () => {
    const chunk = makeChunk({
      id: 'chunk-1',
      noteId: 'note-1',
      content: 'Vitest is faster than Jest for ESM projects.',
    });
    db.upsertChunks('note-1', [chunk], [new Float32Array([1, 2, 3])]);

    const llm = makeMockLLM(['Vitest is faster than Jest for ESM projects']);

    const result = await extractMemoriesFromNote(db, llm, 'note-1');
    expect(result.memoriesCreated).toBe(1);

    const memories = db.getMemoriesForNote('note-1');
    const history = db.getMemoryHistory(memories[0].id);
    expect(history).toHaveLength(1);
    expect(history[0].event).toBe('add');
    expect(history[0].actor).toBe('extractor');
  });

  it('applies container tag', async () => {
    const chunk = makeChunk({
      id: 'chunk-1',
      noteId: 'note-1',
      content: 'Project-specific knowledge about the brain CLI tool.',
    });
    db.upsertChunks('note-1', [chunk], [new Float32Array([1, 2, 3])]);

    const llm = makeMockLLM(['Brain CLI is a knowledge management tool']);

    await extractMemoriesFromNote(db, llm, 'note-1', 'brain-project');

    const memories = db.getLatestMemories('brain-project');
    expect(memories).toHaveLength(1);
    expect(memories[0].containerTag).toBe('brain-project');
  });

  it('returns empty result for note with no chunks', async () => {
    const result = await extractMemoriesFromNote(db, makeMockLLM([]), 'note-1');
    expect(result.memoriesCreated).toBe(0);
    expect(result.facts).toHaveLength(0);
  });

  it('extracts facts from multiple chunks', async () => {
    const chunk1 = makeChunk({
      id: 'chunk-a',
      noteId: 'note-1',
      content: 'SQLite uses B-trees for indexing and storage.',
    });
    const chunk2 = makeChunk({
      id: 'chunk-b',
      noteId: 'note-1',
      content: 'Vector search uses cosine distance for similarity.',
    });
    db.upsertChunks(
      'note-1',
      [chunk1, chunk2],
      [new Float32Array([1, 2, 3]), new Float32Array([3, 2, 1])]
    );

    const llm = makeMockLLM([
      'SQLite uses B-trees for indexing',
      'Vector search uses cosine distance',
    ]);

    const result = await extractMemoriesFromNote(db, llm, 'note-1');

    expect(llm.generate).toHaveBeenCalledTimes(2);
    expect(result.facts).toHaveLength(2);
    expect(result.memoriesCreated).toBe(2);

    const memories = db.getMemoriesForNote('note-1');
    expect(memories).toHaveLength(2);
    const facts = memories.map((m) => m.memory);
    expect(facts).toContain('SQLite uses B-trees for indexing');
    expect(facts).toContain('Vector search uses cosine distance');
  });

  describe('reconciliation', () => {
    it('reconciles new facts against existing memories', async () => {
      const chunk = makeChunk({
        id: 'chunk-1',
        noteId: 'note-1',
        content: 'Brain uses SQLite for storage with vector search support.',
      });
      db.upsertChunks('note-1', [chunk], [new Float32Array([1, 2, 3])]);

      // First extraction: creates initial memories
      db.addMemory({
        id: 'existing-1',
        memory: 'Brain uses SQLite for storage',
        sourceNoteId: 'note-1',
        sourceChunkId: 'chunk-1',
        containerTag: 'default',
        isLatest: true,
        parentMemoryId: null,
        rootMemoryId: null,
        relationType: null,
        validAt: '2026-01-01T00:00:00Z',
        invalidAt: null,
        forgetAfter: null,
        isForgotten: false,
        isInference: false,
        createdAt: '2026-01-01T00:00:00Z',
      });

      // LLM returns: extraction response, then reconciliation response
      const llm = makeMockLLM([
        'Brain uses SQLite with vector search support',
        '{"actions":[{"type":"UPDATE","id":"existing-1","fact":"Brain uses SQLite with vector search support"},{"type":"ADD","fact":"Vector search is done via sqlite-vec"}]}',
      ]);

      const result = await extractMemoriesFromNote(db, llm, 'note-1');

      expect(result.memoriesUpdated).toBe(1);
      expect(result.memoriesCreated).toBe(1);

      // Old memory should be superseded
      const old = db.getMemory('existing-1')!;
      expect(old.isLatest).toBe(false);

      // New version should exist with parent chain
      const latest = db.getLatestMemories();
      const updated = latest.find((m) => m.parentMemoryId === 'existing-1');
      expect(updated).toBeDefined();
      expect(updated!.memory).toBe('Brain uses SQLite with vector search support');
      expect(updated!.rootMemoryId).toBe('existing-1');
      expect(updated!.relationType).toBe('updates');
    });

    it('handles DELETE action from reconciliation', async () => {
      const chunk = makeChunk({
        id: 'chunk-1',
        noteId: 'note-1',
        content: 'Updated content that no longer mentions the old fact.',
      });
      db.upsertChunks('note-1', [chunk], [new Float32Array([1, 2, 3])]);

      db.addMemory({
        id: 'to-delete',
        memory: 'Outdated information',
        sourceNoteId: 'note-1',
        sourceChunkId: null,
        containerTag: 'default',
        isLatest: true,
        parentMemoryId: null,
        rootMemoryId: null,
        relationType: null,
        validAt: '2026-01-01T00:00:00Z',
        invalidAt: null,
        forgetAfter: null,
        isForgotten: false,
        isInference: false,
        createdAt: '2026-01-01T00:00:00Z',
      });

      const llm = makeMockLLM([
        'Content has been updated with new information',
        '{"actions":[{"type":"DELETE","id":"to-delete"},{"type":"ADD","fact":"Content has been updated with new information"}]}',
      ]);

      const result = await extractMemoriesFromNote(db, llm, 'note-1');

      expect(result.memoriesDeleted).toBe(1);
      expect(result.memoriesCreated).toBe(1);

      const deleted = db.getMemory('to-delete')!;
      expect(deleted.isLatest).toBe(false);

      const history = db.getMemoryHistory('to-delete');
      expect(history.some((h) => h.event === 'delete')).toBe(true);
    });
  });
});

describe('parseReconciliationResponse', () => {
  it('parses valid JSON response', () => {
    const response = '{"actions":[{"type":"ADD","fact":"New fact"},{"type":"NONE"}]}';
    const actions = parseReconciliationResponse(response);
    expect(actions).toHaveLength(2);
    expect(actions[0]).toEqual({ type: 'ADD', fact: 'New fact' });
    expect(actions[1]).toEqual({ type: 'NONE' });
  });

  it('extracts JSON from surrounding text', () => {
    const response = 'Here is the result:\n{"actions":[{"type":"ADD","fact":"Extracted"}]}\nDone.';
    const actions = parseReconciliationResponse(response);
    expect(actions).toHaveLength(1);
  });

  it('returns empty array for invalid JSON', () => {
    expect(parseReconciliationResponse('not json')).toEqual([]);
  });

  it('returns empty array for missing actions field', () => {
    expect(parseReconciliationResponse('{"data":[]}')).toEqual([]);
  });

  it('filters out malformed actions', () => {
    const response =
      '{"actions":[{"type":"ADD"},{"type":"ADD","fact":"Valid"},{"type":"UPDATE"},{"type":"DELETE","id":"x"}]}';
    const actions = parseReconciliationResponse(response);
    expect(actions).toHaveLength(2);
    expect(actions[0]).toEqual({ type: 'ADD', fact: 'Valid' });
    expect(actions[1]).toEqual({ type: 'DELETE', id: 'x' });
  });
});
