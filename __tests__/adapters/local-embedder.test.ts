import { describe, it, expect } from 'vitest';

// --- LocalEmbedder (real model, long timeout) ---

describe('LocalEmbedder', { timeout: 120_000 }, () => {
  it('reports correct model and dimensions', async () => {
    const { LocalEmbedder } = await import('../../src/adapters/local-embedder.js');
    const embedder = new LocalEmbedder();
    expect(embedder.model).toBe('bge-small-en-v1.5');
    expect(embedder.dimensions).toBe(384);
  });

  it('embeds a single text into a 384-dim vector', async () => {
    const { LocalEmbedder } = await import('../../src/adapters/local-embedder.js');
    const embedder = new LocalEmbedder();
    const result = await embedder.embed(['hello world']);

    expect(result).toHaveLength(1);
    expect(result[0]).toHaveLength(384);
    expect(result[0]!.every((v) => typeof v === 'number')).toBe(true);
  });

  it('embeds multiple texts returning correct count', async () => {
    const { LocalEmbedder } = await import('../../src/adapters/local-embedder.js');
    const embedder = new LocalEmbedder();
    const result = await embedder.embed(['hello', 'world', 'test']);

    expect(result).toHaveLength(3);
    for (const vec of result) {
      expect(vec).toHaveLength(384);
    }
  });

  it('produces normalized vectors (L2 norm close to 1.0)', async () => {
    const { LocalEmbedder } = await import('../../src/adapters/local-embedder.js');
    const embedder = new LocalEmbedder();
    const result = await embedder.embed(['normalization test']);

    const vec = result[0]!;
    const norm = Math.sqrt(vec.reduce((sum, v) => sum + v * v, 0));
    expect(norm).toBeCloseTo(1.0, 2);
  });
});
