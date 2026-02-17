import type { BrainConfig, Embedder } from '../types.js'
import { LocalEmbedder } from './local-embedder.js'
import { OllamaEmbedder } from './ollama-embedder.js'
import { RemoteEmbedder } from './remote-embedder.js'

export { LocalEmbedder } from './local-embedder.js'
export { OllamaEmbedder } from './ollama-embedder.js'
export { RemoteEmbedder } from './remote-embedder.js'

export function createEmbedder(config: BrainConfig): Embedder {
  switch (config.embedder) {
    case 'local':
      return new LocalEmbedder()
    case 'ollama':
      return new OllamaEmbedder(config.ollamaUrl)
    case 'remote':
      if (!config.ollamaUrl) {
        throw new Error(
          'ollamaUrl is required when using the remote embedder',
        )
      }
      return new RemoteEmbedder(config.ollamaUrl)
    default:
      throw new Error(`Unknown embedder backend: ${config.embedder as string}`)
  }
}
