import type { ExtractedItem, Embedder } from '../../types.js';
import type { ModuleRegistry } from '../../modules/registry.js';
import { extname } from 'node:path';
import { parseCsv } from '../format-adapters/csv-adapter.js';
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

  // Strategy 1: CSV column matching
  if (ext === '.csv') {
    const csvResult = tryCsvMatch(content, registry);
    if (csvResult) return csvResult;
  }

  // Strategy 2: Existing frontmatter with type matching a registered note type
  if (ext === '.md' || ext === '.markdown') {
    const fmResult = tryFrontmatterMatch(content, registry);
    if (fmResult) return fmResult;
  }

  // Strategy 3: Markdown table column matching
  const tableResult = tryTableMatch(content, registry);
  if (tableResult) return tableResult;

  // Strategy 4: Embedding similarity for single-section docs
  const embeddingResult = await tryEmbeddingMatch(content, filePath, registry, embedder);
  if (embeddingResult) return embeddingResult;

  return { items: [], remainder: content };
}

function tryCsvMatch(content: string, registry: ModuleRegistry): DeterministicResult | null {
  const parsed = parseCsv(content);
  if (parsed.headers.length === 0 || parsed.rows.length === 0) return null;

  const match = registry.matchColumnHeaders(parsed.headers);
  if (!match) return null;

  const items: ExtractedItem[] = [];
  for (let i = 0; i < parsed.rows.length; i++) {
    const row = parsed.rows[i];
    const fields: Record<string, string> = {};

    for (let j = 0; j < parsed.headers.length && j < row.length; j++) {
      const headerLower = parsed.headers[j].toLowerCase().trim();
      const schemaField = match.columnMapping[headerLower];
      if (schemaField) {
        fields[schemaField] = row[j];
      } else {
        fields[headerLower] = row[j];
      }
    }

    const title = fields.name ?? fields.title ?? `Row ${i + 1}`;
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
      sourceRegion: { startLine: i + 2, endLine: i + 2 },
    });
  }

  return items.length > 0 ? { items, remainder: null } : null;
}

function tryFrontmatterMatch(
  content: string,
  registry: ModuleRegistry
): DeterministicResult | null {
  try {
    const { data, content: body } = matter(content);
    if (!data.type || typeof data.type !== 'string') return null;

    const noteType = registry.getNoteType(data.type);
    if (!noteType) return null;

    const title = (data.title as string) ?? 'Untitled';
    return {
      items: [
        {
          noteType: data.type,
          title,
          content: body.trim(),
          fields: extractFieldsFromFrontmatter(data),
        },
      ],
      remainder: null,
    };
  } catch {
    return null;
  }
}

function extractFieldsFromFrontmatter(data: Record<string, unknown>): Record<string, string> {
  const fields: Record<string, string> = {};
  const skip = new Set(['id', 'title', 'type', 'tier', 'module']);
  for (const [key, value] of Object.entries(data)) {
    if (skip.has(key)) continue;
    if (value instanceof Date) {
      fields[key] = value.toISOString().split('T')[0];
    } else if (
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean'
    ) {
      fields[key] = String(value);
    }
  }
  return fields;
}

function tryTableMatch(content: string, registry: ModuleRegistry): DeterministicResult | null {
  const lines = content.split('\n');
  const headerLine = lines.find((l) => /^\|.+\|/.test(l));
  if (!headerLine) return null;

  const headerIdx = lines.indexOf(headerLine);
  const sepIdx = headerIdx + 1;
  if (sepIdx >= lines.length || !/^\|[\s\-:|]+\|/.test(lines[sepIdx])) return null;

  const headers = headerLine
    .split('|')
    .map((h) => h.trim())
    .filter(Boolean);
  const match = registry.matchColumnHeaders(headers);
  if (!match) return null;

  const items: ExtractedItem[] = [];
  for (let i = sepIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    if (!/^\|.+\|/.test(line)) continue;
    const cells = line
      .split('|')
      .map((c) => c.trim())
      .filter(Boolean);

    const fields: Record<string, string> = {};
    for (let j = 0; j < headers.length && j < cells.length; j++) {
      const headerLower = headers[j].toLowerCase().trim();
      const schemaField = match.columnMapping[headerLower];
      if (schemaField) {
        fields[schemaField] = cells[j];
      } else {
        fields[headerLower] = cells[j];
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

  let body: string;
  try {
    const parsed = matter(content);
    body = parsed.content.trim();
  } catch {
    body = content.trim();
  }

  if (body.length < 50 || body.length > 10000) return null;

  const typeNames = Array.from(archetypeTexts.keys());
  const texts = typeNames.map((t) => archetypeTexts.get(t)!);
  const allVectors = await embedder.embed([body, ...texts]);
  const docVec = allVectors[0];

  let bestType = '';
  let bestScore = 0.85;

  for (let i = 0; i < typeNames.length; i++) {
    const score = cosineSimilarity(docVec, allVectors[i + 1]);
    if (score > bestScore) {
      bestScore = score;
      bestType = typeNames[i];
    }
  }

  if (!bestType) return null;

  const title =
    filePath
      .split('/')
      .pop()
      ?.replace(/\.[^.]+$/, '') ?? 'Untitled';
  return {
    items: [
      {
        noteType: bestType,
        title,
        content: body,
        fields: {},
      },
    ],
    remainder: null,
  };
}

export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}
