import type { ExtractedItem, Embedder, BrainConfig } from '../types.js';
import type { ModuleRegistry } from '../modules/registry.js';
import type { BrainDB } from './brain-db.js';
import type { ContentHandler } from '../modules/types.js';
import type { OllamaClient } from './ollama.js';
import { extractDeterministic } from './extraction-tiers/deterministic.js';
import { classifyWithLlm } from './extraction-tiers/llm-classifier.js';
import { writeQueueFile } from './extraction-tiers/agent-queue.js';

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
  opts?: { maxTier?: 1 | 2 | 3; ollamaClient?: OllamaClient }
): Promise<PipelineResult> {
  const maxTier = opts?.maxTier ?? 3;
  const result: PipelineResult = { extracted: [], materializedNoteIds: [], queuedFiles: [] };

  // Tier 1: Deterministic
  const tier1 = await extractDeterministic(content, filePath, registry, embedder);
  result.extracted.push(...tier1.items);

  let tier2Remainder: string | null = tier1.remainder;
  const tier2Items: ExtractedItem[] = [];

  if (tier1.remainder && maxTier >= 2) {
    const ollamaClient = opts?.ollamaClient;
    if (ollamaClient) {
      const tier2 = await classifyWithLlm(tier1.remainder, filePath, registry, ollamaClient);
      result.extracted.push(...tier2.items);
      tier2Items.push(...tier2.items);
      tier2Remainder = tier2.remainder;
    } else if (tier1.remainder.trim().length > 20) {
      // No Ollama available — fallback to generic note
      result.extracted.push({
        noteType: 'note',
        title:
          filePath
            .split('/')
            .pop()
            ?.replace(/\.[^.]+$/, '') ?? 'Imported',
        content: tier1.remainder,
        fields: {},
      });
      tier2Remainder = null;
    }
  }

  // Tier 3: Queue for agent/human review when there is unclassified remainder
  if (tier2Remainder && tier2Remainder.trim().length > 20 && maxTier >= 3) {
    const lineCount = content.split('\n').length;
    const ext = filePath.split('.').pop()?.toLowerCase() ?? 'txt';
    const format = detectFormat(ext);
    const queueResult = writeQueueFile(
      config.notesDir,
      {
        sourcePath: filePath,
        format,
        lineCount,
        tier1Items: tier1.items,
        tier2Items,
        lowConfidenceRegions: [],
        remainderContent: tier2Remainder,
      },
      registry
    );
    result.queuedFiles.push({ path: queueResult.queuePath, reason: queueResult.reason });
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

const FORMAT_MAP: Record<string, string> = {
  md: 'markdown',
  txt: 'text',
  csv: 'csv',
  tsv: 'tsv',
  json: 'json',
  yaml: 'yaml',
  yml: 'yaml',
};

function detectFormat(ext: string): string {
  return FORMAT_MAP[ext] ?? ext;
}
