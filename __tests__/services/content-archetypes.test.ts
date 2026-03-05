import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  ARCHETYPE_TEXTS,
  getArchetypeEmbeddings,
  clearArchetypeCache,
} from '../../src/services/content-archetypes.js';
import type { Embedder } from '../../src/types.js';

describe('ARCHETYPE_TEXTS', () => {
  it('contains string-keyed archetype entries', () => {
    const keys = Object.keys(ARCHETYPE_TEXTS);
    expect(keys).toContain('task');
    expect(keys).toContain('research');
    expect(keys).toContain('guide');
    expect(keys).toContain('meeting');
    expect(keys).toContain('note');
    expect(keys).toHaveLength(5);
  });
});

describe('getArchetypeEmbeddings', () => {
  beforeEach(() => clearArchetypeCache());

  it('computes embeddings and caches them', async () => {
    const mockVecs = Array.from({ length: 5 }, () => [1, 0, 0]);
    const embedder: Embedder = {
      embed: vi.fn().mockResolvedValue(mockVecs),
      model: 'test',
      dimensions: 3,
    };

    const first = await getArchetypeEmbeddings(embedder);
    const second = await getArchetypeEmbeddings(embedder);

    expect(first).toBe(second);
    expect(embedder.embed).toHaveBeenCalledTimes(1);
  });

  it('returns correct size and keys', async () => {
    const mockVecs = Array.from({ length: 5 }, () => [1, 0, 0]);
    const embedder: Embedder = {
      embed: vi.fn().mockResolvedValue(mockVecs),
      model: 'test',
      dimensions: 3,
    };

    const result = await getArchetypeEmbeddings(embedder);
    expect(result.size).toBe(5);
    expect(result.has('task')).toBe(true);
  });

  it('stores embeddings as Float32Array', async () => {
    const mockVecs = Array.from({ length: 5 }, () => [1, 0, 0]);
    const embedder: Embedder = {
      embed: vi.fn().mockResolvedValue(mockVecs),
      model: 'test',
      dimensions: 3,
    };

    const result = await getArchetypeEmbeddings(embedder);
    for (const vec of result.values()) {
      expect(vec).toBeInstanceOf(Float32Array);
    }
  });

  it('accepts custom archetype texts', async () => {
    const customTexts = new Map([
      ['custom-type', 'Custom archetype description'],
      ['another-type', 'Another archetype description'],
    ]);
    const mockVecs = Array.from({ length: 2 }, () => [1, 0, 0]);
    const embedder: Embedder = {
      embed: vi.fn().mockResolvedValue(mockVecs),
      model: 'test',
      dimensions: 3,
    };

    const result = await getArchetypeEmbeddings(embedder, customTexts);
    expect(result.size).toBe(2);
    expect(result.has('custom-type')).toBe(true);
    expect(result.has('another-type')).toBe(true);
  });
});
