import type { ContentHandler } from '../types.js';
import type { BrainDB } from '../../services/brain-db.js';
import type { Embedder, ExtractedItem } from '../../types.js';

export class SessionContentHandler implements ContentHandler {
  noteTypes: string[] = ['session'];

  canHandle(noteType: string, _content: string): boolean {
    return noteType === 'session';
  }

  async materialize(
    _db: BrainDB,
    _embedder: Embedder,
    _items: ExtractedItem[],
    _sourceNoteId: string
  ): Promise<string[]> {
    // Sessions are created directly by ingest/hooks, not via extraction pipeline
    return [];
  }
}
