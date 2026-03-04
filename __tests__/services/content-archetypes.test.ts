import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  ARCHETYPE_TEXTS,
  getArchetypeEmbeddings,
  clearArchetypeCache,
} from '../../src/services/content-archetypes.js';
import type { Embedder } from '../../src/types.js';

describe('ARCHETYPE_TEXTS', () => {
  it('contains all 6 non-general content classes', () => {
    const keys = Object.keys(ARCHETYPE_TEXTS);
    expect(keys).toContain('task-list');
    expect(keys).toContain('bug-report');
    expect(keys).toContain('architecture');
    expect(keys).toContain('requirements');
    expect(keys).toContain('meeting-notes');
    expect(keys).toContain('reference');
    expect(keys).toHaveLength(6);
  });
});

describe('getArchetypeEmbeddings', () => {
  beforeEach(() => clearArchetypeCache());

  it('computes embeddings and caches them', async () => {
    const mockVecs = Array.from({ length: 6 }, () => [1, 0, 0]);
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
    const mockVecs = Array.from({ length: 6 }, () => [1, 0, 0]);
    const embedder: Embedder = {
      embed: vi.fn().mockResolvedValue(mockVecs),
      model: 'test',
      dimensions: 3,
    };

    const result = await getArchetypeEmbeddings(embedder);
    expect(result.size).toBe(6);
    expect(result.has('task-list')).toBe(true);
  });

  it('stores embeddings as Float32Array', async () => {
    const mockVecs = Array.from({ length: 6 }, () => [1, 0, 0]);
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
});
