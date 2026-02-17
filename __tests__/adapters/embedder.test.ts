import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { BrainConfig } from '../../src/types.js'

// --- LocalEmbedder (real model, long timeout) ---

describe('LocalEmbedder', { timeout: 120_000 }, () => {
  it('reports correct model and dimensions', async () => {
    const { LocalEmbedder } = await import(
      '../../src/adapters/local-embedder.js'
    )
    const embedder = new LocalEmbedder()
    expect(embedder.model).toBe('bge-small-en-v1.5')
    expect(embedder.dimensions).toBe(384)
  })

  it('embeds a single text into a 384-dim vector', async () => {
    const { LocalEmbedder } = await import(
      '../../src/adapters/local-embedder.js'
    )
    const embedder = new LocalEmbedder()
    const result = await embedder.embed(['hello world'])

    expect(result).toHaveLength(1)
    expect(result[0]).toHaveLength(384)
    expect(result[0]!.every((v) => typeof v === 'number')).toBe(true)
  })

  it('embeds multiple texts returning correct count', async () => {
    const { LocalEmbedder } = await import(
      '../../src/adapters/local-embedder.js'
    )
    const embedder = new LocalEmbedder()
    const result = await embedder.embed(['hello', 'world', 'test'])

    expect(result).toHaveLength(3)
    for (const vec of result) {
      expect(vec).toHaveLength(384)
    }
  })

  it('produces normalized vectors (L2 norm close to 1.0)', async () => {
    const { LocalEmbedder } = await import(
      '../../src/adapters/local-embedder.js'
    )
    const embedder = new LocalEmbedder()
    const result = await embedder.embed(['normalization test'])

    const vec = result[0]!
    const norm = Math.sqrt(vec.reduce((sum, v) => sum + v * v, 0))
    expect(norm).toBeCloseTo(1.0, 2)
  })
})

// --- OllamaEmbedder (mocked) ---

vi.mock('ollama', () => {
  const mockEmbed = vi.fn()
  class MockOllama {
    embed = mockEmbed
  }
  return { Ollama: MockOllama, mockEmbed }
})

async function getMockEmbed() {
  const mod = await import('ollama')
  return (mod as unknown as { mockEmbed: ReturnType<typeof vi.fn> }).mockEmbed
}

describe('OllamaEmbedder', () => {
  beforeEach(async () => {
    const mockEmbed = await getMockEmbed()
    mockEmbed.mockReset()
  })

  it('reports correct model and dimensions', async () => {
    const { OllamaEmbedder } = await import(
      '../../src/adapters/ollama-embedder.js'
    )
    const embedder = new OllamaEmbedder()
    expect(embedder.model).toBe('nomic-embed-text')
    expect(embedder.dimensions).toBe(768)
  })

  it('calls ollama.embed with prefixed input', async () => {
    const mockEmbed = await getMockEmbed()
    const fakeVec = Array.from({ length: 768 }, () => 0.1)
    mockEmbed.mockResolvedValueOnce({ embeddings: [fakeVec] })

    const { OllamaEmbedder } = await import(
      '../../src/adapters/ollama-embedder.js'
    )
    const embedder = new OllamaEmbedder()
    const result = await embedder.embed(['hello world'])

    expect(mockEmbed).toHaveBeenCalledWith({
      model: 'nomic-embed-text',
      input: ['search_document: hello world'],
    })
    expect(result).toEqual([fakeVec])
  })

  it('handles batch input correctly', async () => {
    const mockEmbed = await getMockEmbed()
    const fakeVec = Array.from({ length: 768 }, () => 0.1)
    mockEmbed.mockResolvedValueOnce({
      embeddings: [fakeVec, fakeVec, fakeVec],
    })

    const { OllamaEmbedder } = await import(
      '../../src/adapters/ollama-embedder.js'
    )
    const embedder = new OllamaEmbedder()
    const result = await embedder.embed(['a', 'b', 'c'])

    expect(mockEmbed).toHaveBeenCalledWith({
      model: 'nomic-embed-text',
      input: [
        'search_document: a',
        'search_document: b',
        'search_document: c',
      ],
    })
    expect(result).toHaveLength(3)
  })

  it('throws descriptive error when Ollama is not running', async () => {
    const mockEmbed = await getMockEmbed()
    mockEmbed.mockRejectedValueOnce(new Error('connect ECONNREFUSED'))

    const { OllamaEmbedder } = await import(
      '../../src/adapters/ollama-embedder.js'
    )
    const embedder = new OllamaEmbedder()

    await expect(embedder.embed(['test'])).rejects.toThrow(
      /Ollama embedding failed.*Is Ollama running/,
    )
  })
})

// --- RemoteEmbedder (mocked fetch) ---

describe('RemoteEmbedder', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('reports correct model and dimensions', async () => {
    const { RemoteEmbedder } = await import(
      '../../src/adapters/remote-embedder.js'
    )
    const embedder = new RemoteEmbedder('http://remote:11434')
    expect(embedder.model).toBe('nomic-embed-text')
    expect(embedder.dimensions).toBe(768)
  })

  it('sends POST to url/api/embed with prefixed input', async () => {
    const fakeVec = Array.from({ length: 768 }, () => 0.2)
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ embeddings: [fakeVec] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )

    const { RemoteEmbedder } = await import(
      '../../src/adapters/remote-embedder.js'
    )
    const embedder = new RemoteEmbedder('http://remote:11434')
    const result = await embedder.embed(['hello'])

    expect(fetchSpy).toHaveBeenCalledWith('http://remote:11434/api/embed', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'nomic-embed-text',
        input: ['search_document: hello'],
      }),
      signal: expect.any(AbortSignal),
    })
    expect(result).toEqual([fakeVec])
  })

  it('strips trailing slashes from URL', async () => {
    const fakeVec = Array.from({ length: 768 }, () => 0.2)
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ embeddings: [fakeVec] }), {
        status: 200,
      }),
    )

    const { RemoteEmbedder } = await import(
      '../../src/adapters/remote-embedder.js'
    )
    const embedder = new RemoteEmbedder('http://remote:11434/')
    await embedder.embed(['test'])

    expect(fetchSpy).toHaveBeenCalledWith(
      'http://remote:11434/api/embed',
      expect.any(Object),
    )
  })

  it('throws on non-OK response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('Internal Server Error', { status: 500, statusText: 'Internal Server Error' }),
    )

    const { RemoteEmbedder } = await import(
      '../../src/adapters/remote-embedder.js'
    )
    const embedder = new RemoteEmbedder('http://remote:11434')

    await expect(embedder.embed(['test'])).rejects.toThrow(
      /Remote embedding failed: 500/,
    )
  })
})

// --- Factory function ---

describe('createEmbedder', () => {
  const baseConfig: BrainConfig = {
    notesDir: '/tmp/notes',
    dbPath: '/tmp/brain.db',
    embedder: 'local',
    fusionWeights: { bm25: 0.3, vector: 0.7 },
  }

  it('creates LocalEmbedder for local backend', async () => {
    const { createEmbedder } = await import('../../src/adapters/index.js')
    const { LocalEmbedder } = await import(
      '../../src/adapters/local-embedder.js'
    )
    const embedder = createEmbedder({ ...baseConfig, embedder: 'local' })
    expect(embedder).toBeInstanceOf(LocalEmbedder)
  })

  it('creates OllamaEmbedder for ollama backend', async () => {
    const { createEmbedder } = await import('../../src/adapters/index.js')
    const { OllamaEmbedder } = await import(
      '../../src/adapters/ollama-embedder.js'
    )
    const embedder = createEmbedder({ ...baseConfig, embedder: 'ollama' })
    expect(embedder).toBeInstanceOf(OllamaEmbedder)
  })

  it('creates RemoteEmbedder for remote backend with ollamaUrl', async () => {
    const { createEmbedder } = await import('../../src/adapters/index.js')
    const { RemoteEmbedder } = await import(
      '../../src/adapters/remote-embedder.js'
    )
    const embedder = createEmbedder({
      ...baseConfig,
      embedder: 'remote',
      ollamaUrl: 'http://remote:11434',
    })
    expect(embedder).toBeInstanceOf(RemoteEmbedder)
  })

  it('throws when remote backend has no ollamaUrl', async () => {
    const { createEmbedder } = await import('../../src/adapters/index.js')
    expect(() =>
      createEmbedder({ ...baseConfig, embedder: 'remote' }),
    ).toThrow(/ollamaUrl is required/)
  })
})
