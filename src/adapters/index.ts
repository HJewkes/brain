import type { BrainConfig, Embedder, EmbedderBackend } from '../types.js';

interface EmbedderInfo {
  model: string;
  dimensions: number;
}

export function getEmbedderInfo(backend: EmbedderBackend): EmbedderInfo {
  switch (backend) {
    case 'local':
      return { model: 'bge-small-en-v1.5', dimensions: 384 };
    case 'ollama':
      return { model: 'nomic-embed-text', dimensions: 768 };
    case 'remote':
      return { model: 'nomic-embed-text', dimensions: 768 };
    default:
      throw new Error(`Unknown embedder backend: ${backend as string}`);
  }
}
import { LocalEmbedder } from './local-embedder.js';
import { OllamaEmbedder } from './ollama-embedder.js';
import { RemoteEmbedder } from './remote-embedder.js';

export { LocalEmbedder } from './local-embedder.js';
export { OllamaEmbedder } from './ollama-embedder.js';
export { RemoteEmbedder } from './remote-embedder.js';

export function createEmbedder(config: BrainConfig): Embedder {
  switch (config.embedder) {
    case 'local':
      return new LocalEmbedder();
    case 'ollama':
      return new OllamaEmbedder(config.ollamaUrl);
    case 'remote':
      if (!config.ollamaUrl) {
        throw new Error('ollamaUrl is required when using the remote embedder');
      }
      return new RemoteEmbedder(config.ollamaUrl);
    default:
      throw new Error(`Unknown embedder backend: ${config.embedder as string}`);
  }
}
