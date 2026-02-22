import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { BrainDB } from '../../../src/services/brain-db.js';
import { unlinkSync } from 'node:fs';
import type { MemoryEntry } from '../../../src/types.js';
import { tmpDbPath } from '../../helpers.js';

describe('MemoryRepo', () => {
  let db: BrainDB;
  let dbPath: string;

  const makeMemory = (overrides: Partial<MemoryEntry> = {}): MemoryEntry => ({
    id: 'mem-1',
    memory: 'TypeScript uses structural typing',
    sourceNoteId: 'test-note',
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
    ...overrides,
  });

  beforeEach(() => {
    dbPath = tmpDbPath();
    db = new BrainDB(dbPath);

    db.upsertNote({
      id: 'test-note',
      filePath: '/tmp/test.md',
      title: 'Test',
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
    try {
      unlinkSync(dbPath);
    } catch {
      // ignore
    }
  });

  describe('memory CRUD', () => {
    it('adds and retrieves a memory', () => {
      db.addMemory(makeMemory());
      const mem = db.getMemory('mem-1');
      expect(mem).not.toBeNull();
      expect(mem!.memory).toBe('TypeScript uses structural typing');
      expect(mem!.isLatest).toBe(true);
      expect(mem!.isForgotten).toBe(false);
    });

    it('gets memories for a note', () => {
      db.addMemory(makeMemory({ id: 'mem-1' }));
      db.addMemory(makeMemory({ id: 'mem-2', memory: 'Second fact' }));
      const memories = db.getMemoriesForNote('test-note');
      expect(memories).toHaveLength(2);
    });

    it('gets latest memories filtered by container', () => {
      db.addMemory(makeMemory({ id: 'mem-1', containerTag: 'project-a' }));
      db.addMemory(makeMemory({ id: 'mem-2', containerTag: 'project-b' }));
      expect(db.getLatestMemories('project-a')).toHaveLength(1);
      expect(db.getLatestMemories()).toHaveLength(2);
    });

    it('marks memory as superseded', () => {
      db.addMemory(makeMemory());
      db.markMemorySuperseded('mem-1');
      const mem = db.getMemory('mem-1')!;
      expect(mem.isLatest).toBe(false);
    });

    it('tracks version chain', () => {
      db.addMemory(makeMemory({ id: 'root' }));
      db.markMemorySuperseded('root');
      db.addMemory(makeMemory({
        id: 'v2',
        memory: 'Updated fact',
        parentMemoryId: 'root',
        rootMemoryId: 'root',
        relationType: 'updates',
      }));
      const chain = db.getMemoryVersionChain('root');
      expect(chain).toHaveLength(2);
      expect(chain[0].id).toBe('root');
      expect(chain[1].id).toBe('v2');
    });

    it('deletes memories for a note including vectors and history', () => {
      db.ensureVectorTable(384);
      db.addMemory(makeMemory());
      db.upsertMemoryVector('mem-1', new Float32Array(384));
      db.addMemoryHistory({
        memoryId: 'mem-1',
        event: 'add',
        oldMemory: null,
        newMemory: 'TypeScript uses structural typing',
        actor: 'extractor',
        createdAt: '2026-01-01T00:00:00Z',
      });

      db.deleteMemoriesForNote('test-note');

      expect(db.getMemoriesForNote('test-note')).toHaveLength(0);
      expect(db.getMemory('mem-1')).toBeNull();
      expect(db.getMemoryHistory('mem-1')).toHaveLength(0);
      expect(db.searchMemoryVectors(new Float32Array(384), 10)).toHaveLength(0);
    });

    it('counts active memories', () => {
      db.addMemory(makeMemory({ id: 'mem-1' }));
      db.addMemory(makeMemory({ id: 'mem-2', isForgotten: true }));
      expect(db.getMemoryCount()).toBe(1);
    });

    it('records and retrieves history', () => {
      db.addMemory(makeMemory());
      db.addMemoryHistory({
        memoryId: 'mem-1',
        event: 'add',
        oldMemory: null,
        newMemory: 'TypeScript uses structural typing',
        actor: 'extractor',
        createdAt: '2026-01-01T00:00:00Z',
      });
      const history = db.getMemoryHistory('mem-1');
      expect(history).toHaveLength(1);
      expect(history[0].event).toBe('add');
      expect(history[0].newMemory).toBe('TypeScript uses structural typing');
    });

    it('forgets expired memories', () => {
      const past = '2020-01-01T00:00:00Z';
      db.addMemory(makeMemory({ id: 'expiring', forgetAfter: past }));
      db.addMemory(makeMemory({ id: 'permanent' }));

      const forgotten = db.forgetExpiredMemories();
      expect(forgotten).toBe(1);

      const mem = db.getMemory('expiring')!;
      expect(mem.isForgotten).toBe(true);
      expect(db.getMemoryCount()).toBe(1);
    });

    it('does not forget future-dated memories', () => {
      const future = '2099-01-01T00:00:00Z';
      db.addMemory(makeMemory({ id: 'future', forgetAfter: future }));

      const forgotten = db.forgetExpiredMemories();
      expect(forgotten).toBe(0);
      expect(db.getMemory('future')!.isForgotten).toBe(false);
    });

    it('queries memories since a date', () => {
      db.addMemory(makeMemory({ id: 'old', createdAt: '2025-01-01T00:00:00Z' }));
      db.addMemory(makeMemory({ id: 'recent', createdAt: '2026-02-01T00:00:00Z' }));

      const since = db.getMemoriesSince('2026-01-01T00:00:00Z');
      expect(since).toHaveLength(1);
      expect(since[0].id).toBe('recent');
    });

    it('queries memories since a date filtered by container', () => {
      db.addMemory(makeMemory({ id: 'm1', createdAt: '2026-02-01T00:00:00Z', containerTag: 'a' }));
      db.addMemory(makeMemory({ id: 'm2', createdAt: '2026-02-01T00:00:00Z', containerTag: 'b' }));

      const filtered = db.getMemoriesSince('2026-01-01T00:00:00Z', 'a');
      expect(filtered).toHaveLength(1);
      expect(filtered[0].containerTag).toBe('a');
    });

    it('upsertMemoryVector + searchMemoryVectors round-trip', () => {
      db.ensureVectorTable(384);
      db.addMemory(makeMemory({ id: 'mv-1' }));
      db.addMemory(makeMemory({ id: 'mv-2' }));

      const vec1 = new Float32Array(384);
      vec1[0] = 1.0;
      const vec2 = new Float32Array(384);
      vec2[1] = 1.0;

      db.upsertMemoryVector('mv-1', vec1);
      db.upsertMemoryVector('mv-2', vec2);

      const results = db.searchMemoryVectors(vec1, 5);
      expect(results.length).toBe(2);
      expect(results[0].memoryId).toBe('mv-1');
      expect(results[0].distance).toBeLessThan(results[1].distance);
    });

    it('upsertMemoryVector replaces existing vector', () => {
      db.ensureVectorTable(384);
      db.addMemory(makeMemory({ id: 'mv-replace' }));

      const vec1 = new Float32Array(384);
      vec1[0] = 1.0;
      db.upsertMemoryVector('mv-replace', vec1);

      const vec2 = new Float32Array(384);
      vec2[1] = 1.0;
      db.upsertMemoryVector('mv-replace', vec2);

      const results = db.searchMemoryVectors(vec2, 5);
      expect(results).toHaveLength(1);
      expect(results[0].memoryId).toBe('mv-replace');
    });

    it('getMemoriesByIds returns batch of memories', () => {
      db.addMemory(makeMemory({ id: 'batch-1', memory: 'Fact one' }));
      db.addMemory(makeMemory({ id: 'batch-2', memory: 'Fact two' }));
      db.addMemory(makeMemory({ id: 'batch-3', memory: 'Fact three' }));

      const result = db.getMemoriesByIds(['batch-1', 'batch-3']);
      expect(result.size).toBe(2);
      expect(result.get('batch-1')?.memory).toBe('Fact one');
      expect(result.get('batch-3')?.memory).toBe('Fact three');
      expect(result.has('batch-2')).toBe(false);
    });

    it('getMemoriesByIds returns empty map for empty input', () => {
      const result = db.getMemoriesByIds([]);
      expect(result.size).toBe(0);
    });

    it('getMemoriesByIds ignores non-existent ids', () => {
      db.addMemory(makeMemory({ id: 'exists' }));
      const result = db.getMemoriesByIds(['exists', 'does-not-exist']);
      expect(result.size).toBe(1);
      expect(result.has('exists')).toBe(true);
    });
  });
});
