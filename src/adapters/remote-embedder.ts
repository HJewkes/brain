import type { Embedder } from '../types.js'

export class RemoteEmbedder implements Embedder {
  readonly model = 'nomic-embed-text'
  readonly dimensions = 768

  constructor(private url: string) {}

  async embed(texts: string[]): Promise<number[][]> {
    const prefixed = texts.map((t) => `search_document: ${t}`)
    const baseUrl = this.url.replace(/\/+$/, '')
    const response = await fetch(`${baseUrl}/api/embed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: this.model, input: prefixed }),
    })

    if (!response.ok) {
      throw new Error(
        `Remote embedding failed: ${response.status} ${response.statusText}`,
      )
    }

    const data = (await response.json()) as { embeddings: number[][] }
    return data.embeddings
  }
}
