import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { checkOllamaHealth, createOllamaClient } from '../../src/services/ollama.js';

describe('checkOllamaHealth', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns running=true and model list when Ollama responds', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        models: [{ name: 'qwen2.5:3b' }, { name: 'nomic-embed-text:latest' }],
      }),
    });

    const result = await checkOllamaHealth('http://localhost:11434');
    expect(result.running).toBe(true);
    expect(result.models).toEqual(['qwen2.5:3b', 'nomic-embed-text:latest']);
  });

  it('returns running=false when fetch throws', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new TypeError('fetch failed'));

    const result = await checkOllamaHealth('http://localhost:11434');
    expect(result.running).toBe(false);
    expect(result.models).toEqual([]);
  });

  it('returns running=false when response is not ok', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
    });

    const result = await checkOllamaHealth('http://localhost:11434');
    expect(result.running).toBe(false);
    expect(result.models).toEqual([]);
  });

  it('returns empty model list when models key is absent', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({}),
    });

    const result = await checkOllamaHealth('http://localhost:11434');
    expect(result.running).toBe(true);
    expect(result.models).toEqual([]);
  });

  it('uses default URL when none provided', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ models: [] }),
    });

    await checkOllamaHealth();
    expect(fetch).toHaveBeenCalledWith(
      'http://localhost:11434/api/tags',
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
  });
});

describe('OllamaClient.generate error handling', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('wraps connection refused with actionable message', async () => {
    const err = new TypeError('fetch failed');
    (err as NodeJS.ErrnoException).cause = { code: 'ECONNREFUSED' };
    (fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(err);

    const client = createOllamaClient('http://localhost:11434');
    await expect(client.generate('test')).rejects.toThrow(/not running/i);
  });

  it('wraps timeout with actionable message', async () => {
    const err = new DOMException('signal timed out', 'TimeoutError');
    (fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(err);

    const client = createOllamaClient('http://localhost:11434');
    await expect(client.generate('test')).rejects.toThrow(/timed out/i);
  });

  it('wraps 404 with model-not-found message', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      status: 404,
      text: async () => 'model not found',
    });

    const client = createOllamaClient('http://localhost:11434', 'bad-model');
    await expect(client.generate('test')).rejects.toThrow(/not found/i);
  });

  it('wraps non-404 HTTP error with status code', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: async () => 'internal server error',
    });

    const client = createOllamaClient('http://localhost:11434');
    await expect(client.generate('test')).rejects.toThrow(/500/);
  });
});
