import { pipeline, type FeatureExtractionPipeline } from '@huggingface/transformers';
import type { Embedder } from '../types.js';

export class LocalEmbedder implements Embedder {
  readonly model = 'bge-small-en-v1.5';
  readonly dimensions = 384;
  private extractor: FeatureExtractionPipeline | null = null;

  async embed(texts: string[]): Promise<number[][]> {
    if (!this.extractor) {
      // @ts-expect-error TS2590: @huggingface/transformers union type too complex when @types/jsdom is present
      this.extractor = await pipeline('feature-extraction', 'Xenova/bge-small-en-v1.5', {
        dtype: 'q8',
      });
    }
    const output = await this.extractor(texts, {
      pooling: 'mean',
      normalize: true,
    });
    return output.tolist() as number[][];
  }

  async dispose(): Promise<void> {
    if (this.extractor) {
      await this.extractor.dispose();
      this.extractor = null;
    }
  }
}
