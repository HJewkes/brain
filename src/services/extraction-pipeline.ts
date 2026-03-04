import type { ExtractedItem, Embedder, BrainConfig } from '../types.js';
import type { ModuleRegistry } from '../modules/registry.js';
import type { BrainDB } from './brain-db.js';
import type { ContentHandler } from '../modules/types.js';
import { extractDeterministic } from './extraction-tiers/deterministic.js';

export interface ExtractionResult {
  items: ExtractedItem[];
  remainder: string | null;
  tier: 'deterministic' | 'llm' | 'queued';
  queued?: { path: string; reason: string };
}

export interface PipelineResult {
  extracted: ExtractedItem[];
  materializedNoteIds: string[];
  queuedFiles: Array<{ path: string; reason: string }>;
}

export async function runExtractionPipeline(
  content: string,
  filePath: string,
  registry: ModuleRegistry,
  embedder: Embedder,
  db: BrainDB,
  config: BrainConfig,
  sourceNoteId: string,
  opts?: { maxTier?: 1 | 2 | 3 }
): Promise<PipelineResult> {
  const maxTier = opts?.maxTier ?? 3;
  const result: PipelineResult = { extracted: [], materializedNoteIds: [], queuedFiles: [] };

  // Tier 1: Deterministic
  const tier1 = await extractDeterministic(content, filePath, registry, embedder);
  result.extracted.push(...tier1.items);

  if (tier1.remainder && maxTier >= 2) {
    // Tier 2 (LLM classification) and Tier 3 (queued review) are stubs for Tasks 8/9
    if (tier1.remainder.trim().length > 20) {
      result.extracted.push({
        noteType: 'note',
        title: filePath.split('/').pop()?.replace(/\.[^.]+$/, '') ?? 'Imported',
        content: tier1.remainder,
        fields: {},
      });
    }
  }

  // Dispatch to content handlers
  const handlers = registry.getContentHandlers();
  const byType = groupByNoteType(result.extracted);

  for (const [noteType, items] of Array.from(byType)) {
    const handler = findHandler(handlers, noteType);
    if (handler) {
      const ids = await handler.materialize(db, embedder, items, sourceNoteId);
      result.materializedNoteIds.push(...ids);
    }
  }

  return result;
}

function groupByNoteType(items: ExtractedItem[]): Map<string, ExtractedItem[]> {
  const byType = new Map<string, ExtractedItem[]>();
  for (const item of items) {
    const list = byType.get(item.noteType) ?? [];
    list.push(item);
    byType.set(item.noteType, list);
  }
  return byType;
}

function findHandler(
  handlers: Array<{ module: string; handler: ContentHandler }>,
  noteType: string
): ContentHandler | null {
  for (const { handler } of handlers) {
    if (handler.noteTypes.includes(noteType)) {
      return handler;
    }
  }
  return null;
}
