import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { BrainDB } from '../../src/services/brain-db.js';
import { extractMemoriesFromNote } from '../../src/services/memory-extractor.js';
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

describe('extractMemoriesFromNote', () => {
  let db: BrainDB;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'brain-mem-test-'));
    db = new BrainDB(join(tmpDir, 'test.db'));
    db.setEmbeddingModel('test-model', 3);

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
  });

  afterEach(() => {
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('extracts facts from note chunks and stores as memories', async () => {
    const chunk = makeChunk({ id: 'chunk-1', noteId: 'note-1', content: 'TypeScript uses structural typing for type compatibility.' });
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
    const chunk = makeChunk({ id: 'chunk-1', noteId: 'note-1', content: 'This is a longer chunk with enough content to process.' });
    db.upsertChunks('note-1', [chunk], [new Float32Array([1, 2, 3])]);

    const llm = makeMockLLM(['']);

    const result = await extractMemoriesFromNote(db, llm, 'note-1');
    expect(result.memoriesCreated).toBe(0);
  });

  it('records history for each created memory', async () => {
    const chunk = makeChunk({ id: 'chunk-1', noteId: 'note-1', content: 'Vitest is faster than Jest for ESM projects.' });
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
    const chunk = makeChunk({ id: 'chunk-1', noteId: 'note-1', content: 'Project-specific knowledge about the brain CLI tool.' });
    db.upsertChunks('note-1', [chunk], [new Float32Array([1, 2, 3])]);

    const llm = makeMockLLM(['Brain CLI is a knowledge management tool']);

    await extractMemoriesFromNote(db, llm, 'note-1', 'brain-project');

    const memories = db.getLatestMemories('brain-project');
    expect(memories).toHaveLength(1);
    expect(memories[0].containerTag).toBe('brain-project');
  });

  it('returns empty result for note with no chunks', async () => {
    const result = await extractMemoriesFromNote(
      db,
      makeMockLLM([]),
      'note-1'
    );
    expect(result.memoriesCreated).toBe(0);
    expect(result.facts).toHaveLength(0);
  });
});
