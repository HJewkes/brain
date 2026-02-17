import { Ollama } from 'ollama'
import type { Embedder } from '../types.js'

export class OllamaEmbedder implements Embedder {
  readonly model = 'nomic-embed-text'
  readonly dimensions = 768
  private client: Ollama

  constructor(url?: string) {
    this.client = url ? new Ollama({ host: url }) : new Ollama()
  }

  async embed(texts: string[]): Promise<number[][]> {
    const prefixed = texts.map((t) => `search_document: ${t}`)
    try {
      const response = await this.client.embed({
        model: this.model,
        input: prefixed,
      })
      return response.embeddings
    } catch (error) {
      const message =
        error instanceof Error ? error.message : String(error)
      throw new Error(
        `Ollama embedding failed: ${message}. Is Ollama running?`,
      )
    }
  }
}
