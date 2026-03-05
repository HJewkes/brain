# Task 06: Tier 1 — Deterministic Extraction

## Architectural Context

This is the core of the new extraction pipeline. Tier 1 handles obvious cases without any LLM: CSV/tables where column headers match registered `tableColumnAliases`, markdown with existing frontmatter matching a registered type, and single-section documents with high embedding similarity to a registered `archetypeText`. It produces `ExtractedItem[]` for resolved items and returns remainder content for higher tiers.

The pipeline orchestrator (`extraction-pipeline.ts`) coordinates all three tiers and dispatches results to content handlers.

## File Ownership

**May modify:**
- `src/services/extraction-pipeline.ts` (new file)
- `src/services/extraction-tiers/deterministic.ts` (new file)
- `__tests__/services/extraction-tiers/deterministic.test.ts` (new file)

**Must not touch:**
- `src/commands/import.ts` (Task 7)
- `src/modules/pm/content-handler.ts` (Task 4)
- `src/services/content-classifier.ts` (Task 5)

**Read for context (do not modify):**
- `src/modules/registry.ts` — `matchColumnHeaders()`, `getArchetypeTexts()`, `getImportableNoteTypes()` (Task 2)
- `src/services/format-adapters/csv-adapter.ts` — `parseCsv()` for CSV parsing
- `src/services/content-archetypes.ts` — `getArchetypeEmbeddings()` (refactored by Task 5)
- `src/services/content-classifier.ts` — `classifySection()` for heading-based heuristics
- `src/services/markdown-parser.ts` — `splitIntoSections()` for section detection
- `src/types.ts` — `ExtractedItem`, `Embedder`
- `src/modules/types.ts` — `ContentHandler`

## Steps

### Step 1: Create the extraction pipeline orchestrator

Create `src/services/extraction-pipeline.ts`:

```typescript
import type { ExtractedItem, Embedder } from '../types.js';
import type { ModuleRegistry } from '../modules/registry.js';
import type { BrainDB } from './brain-db.js';
import type { BrainConfig } from '../types.js';
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
    // Tier 2 and 3 are added by Tasks 8 and 9
    // For now, treat remainder as unclassified (defaults to 'note' type)
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
  const byType = new Map<string, ExtractedItem[]>();
  for (const item of result.extracted) {
    const list = byType.get(item.noteType) ?? [];
    list.push(item);
    byType.set(item.noteType, list);
  }

  for (const [noteType, items] of byType) {
    const handler = handlers.find(
      h => 'noteTypes' in h.handler && (h.handler as any).noteTypes.includes(noteType)
    );
    if (handler && 'noteTypes' in handler.handler) {
      const ids = await (handler.handler as any).materialize(db, embedder, items, sourceNoteId);
      result.materializedNoteIds.push(...ids);
    }
    // Items without handlers are left in extracted[] for the caller to handle as plain notes
  }

  return result;
}
```

### Step 2: Create deterministic extraction tier

Create `src/services/extraction-tiers/deterministic.ts`:

```typescript
import type { ExtractedItem, Embedder } from '../../types.js';
import type { ModuleRegistry } from '../../modules/registry.js';
import { extname } from 'node:path';
import matter from 'gray-matter';

export interface DeterministicResult {
  items: ExtractedItem[];
  remainder: string | null;
}

export async function extractDeterministic(
  content: string,
  filePath: string,
  registry: ModuleRegistry,
  embedder: Embedder
): Promise<DeterministicResult> {
  const ext = extname(filePath).toLowerCase();

  // Strategy 1: Existing frontmatter with type matching a registered note type
  if (ext === '.md' || ext === '.markdown') {
    const fmResult = tryFrontmatterMatch(content, registry);
    if (fmResult) return fmResult;
  }

  // Strategy 2: Table/CSV column matching
  const tableResult = tryTableMatch(content, registry);
  if (tableResult) return tableResult;

  // Strategy 3: Embedding similarity for single-section docs
  const embeddingResult = await tryEmbeddingMatch(content, filePath, registry, embedder);
  if (embeddingResult) return embeddingResult;

  // No match — return everything as remainder
  return { items: [], remainder: content };
}

function tryFrontmatterMatch(content: string, registry: ModuleRegistry): DeterministicResult | null {
  try {
    const { data, content: body } = matter(content);
    if (!data.type || typeof data.type !== 'string') return null;

    const noteType = registry.getNoteType(data.type);
    if (!noteType) return null;

    const title = (data.title as string) ?? 'Untitled';
    return {
      items: [{
        noteType: data.type,
        title,
        content: body.trim(),
        fields: extractFieldsFromFrontmatter(data),
      }],
      remainder: null,
    };
  } catch {
    return null;
  }
}

function extractFieldsFromFrontmatter(data: Record<string, unknown>): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const [key, value] of Object.entries(data)) {
    if (['id', 'title', 'type', 'tier', 'module'].includes(key)) continue;
    if (typeof value === 'string' || typeof value === 'number') {
      fields[key] = String(value);
    }
  }
  return fields;
}

function tryTableMatch(content: string, registry: ModuleRegistry): DeterministicResult | null {
  // Extract table headers from markdown pipe table
  const lines = content.split('\n');
  const headerLine = lines.find(l => /^\|.+\|/.test(l));
  if (!headerLine) return null;

  const headerIdx = lines.indexOf(headerLine);
  const sepIdx = headerIdx + 1;
  if (sepIdx >= lines.length || !/^\|[\s-:|]+\|/.test(lines[sepIdx])) return null;

  const headers = headerLine.split('|').map(h => h.trim()).filter(Boolean);
  const match = registry.matchColumnHeaders(headers);
  if (!match) return null;

  // Extract all data rows
  const items: ExtractedItem[] = [];
  for (let i = sepIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    if (!/^\|.+\|/.test(line)) continue;
    const cells = line.split('|').map(c => c.trim()).filter(Boolean);

    const fields: Record<string, string> = {};
    for (let j = 0; j < headers.length && j < cells.length; j++) {
      const schemaField = match.columnMapping[headers[j].toLowerCase().trim()];
      if (schemaField) {
        fields[schemaField] = cells[j];
      } else {
        fields[headers[j].toLowerCase().trim()] = cells[j];
      }
    }

    const title = fields.name ?? fields.title ?? `Row ${i - sepIdx}`;
    delete fields.name;
    delete fields.title;

    items.push({
      noteType: match.noteType,
      title,
      content: Object.entries(fields)
        .filter(([k]) => k !== 'description')
        .map(([k, v]) => `**${k}:** ${v}`)
        .join('\n'),
      fields,
      sourceRegion: { startLine: i + 1, endLine: i + 1 },
    });
  }

  return items.length > 0 ? { items, remainder: null } : null;
}

async function tryEmbeddingMatch(
  content: string,
  filePath: string,
  registry: ModuleRegistry,
  embedder: Embedder
): Promise<DeterministicResult | null> {
  const archetypeTexts = registry.getArchetypeTexts();
  if (archetypeTexts.size === 0) return null;

  // Only for single-section, reasonably short docs
  const { content: body } = matter(content);
  const trimmed = body.trim();
  if (trimmed.length < 50 || trimmed.length > 10000) return null;

  const { getArchetypeEmbeddings } = await import('../content-archetypes.js');
  const archetypes = await getArchetypeEmbeddings(embedder, archetypeTexts);
  const [docVec] = await embedder.embed([trimmed]);

  let bestType = '';
  let bestScore = 0.85; // threshold

  for (const [typeName, archVec] of archetypes) {
    const score = cosineSimilarity(new Float32Array(docVec), archVec);
    if (score > bestScore) {
      bestScore = score;
      bestType = typeName;
    }
  }

  if (!bestType) return null;

  const title = filePath.split('/').pop()?.replace(/\.[^.]+$/, '') ?? 'Untitled';
  return {
    items: [{
      noteType: bestType,
      title,
      content: trimmed,
      fields: {},
    }],
    remainder: null,
  };
}

function cosineSimilarity(a: Float32Array | number[], b: Float32Array | number[]): number {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
```

### Step 3: Write tests

Create `__tests__/services/extraction-tiers/deterministic.test.ts`:

Test cases:
- CSV with task columns → ExtractedItem[] with noteType 'task' and mapped fields
- Markdown with frontmatter `type: meeting` → single ExtractedItem with noteType 'meeting'
- Markdown table with status/priority columns → task items
- CSV with no matching columns → empty items, full remainder
- Empty content → empty items, null remainder

### Step 4: Run tests

Run: `npm test -- __tests__/services/extraction-tiers/deterministic.test.ts`
Expected: PASS

### Step 5: Commit

```bash
git add src/services/extraction-pipeline.ts src/services/extraction-tiers/deterministic.ts __tests__/services/extraction-tiers/deterministic.test.ts
git commit -m "feat: add Tier 1 deterministic extraction pipeline"
```

## Success Criteria

- [ ] Tests pass: `npm test -- __tests__/services/extraction-tiers/deterministic.test.ts`
- [ ] Types check: `npm run typecheck`
- [ ] CSV with task columns extracts items with `noteType: 'task'` and correct field mapping
- [ ] Markdown with frontmatter type passthrough works
- [ ] Embedding similarity matches single-section docs at ≥ 0.85 threshold
- [ ] Unmatched content returns as remainder

## Anti-patterns

- Do NOT modify files outside the ownership list above
- Do NOT modify CLAUDE.md or any persistent configuration files
- Do NOT implement Tier 2 or Tier 3 in this task — just leave placeholder comments
- Do NOT parse CSV directly — use the existing `parseCsv()` from format adapters for CSV files, and the pipe-table parsing for markdown tables
