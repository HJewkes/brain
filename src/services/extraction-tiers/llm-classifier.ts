import type { ExtractedItem } from '../../types.js';
import type { ModuleRegistry } from '../../modules/registry.js';
import type { OllamaClient } from '../ollama.js';
import type { ModuleNoteType } from '../../modules/types.js';

export interface LlmClassifierResult {
  items: ExtractedItem[];
  remainder: string | null;
}

interface LlmRegion {
  type: string;
  title: string;
  startLine: number;
  endLine: number;
  confidence: number;
  fields?: Record<string, string>;
  columnMapping?: Record<string, string>;
}

const CONFIDENCE_THRESHOLD = 0.6;
const MAX_PROSE_CHARS = 3000;
const FRONT_CHARS = 2000;
const TAIL_CHARS = 1000;
const TABLE_SAMPLE_ROWS = 5;

export async function classifyWithLlm(
  content: string,
  filePath: string,
  registry: ModuleRegistry,
  client: OllamaClient
): Promise<LlmClassifierResult> {
  const noteTypes = registry.getAllNoteTypes();
  const prompt = buildPrompt(content, filePath, noteTypes);
  const systemPrompt = buildSystemPrompt(noteTypes);

  let raw: string;
  try {
    raw = await client.generate(prompt, systemPrompt);
  } catch {
    return { items: [], remainder: content };
  }

  const regions = parseResponse(raw);
  if (regions.length === 0) {
    return { items: [], remainder: content };
  }

  const lines = content.split('\n');
  const items: ExtractedItem[] = [];
  const coveredLines = new Set<number>();

  for (const region of regions) {
    if (region.confidence < CONFIDENCE_THRESHOLD) continue;

    if (region.columnMapping) {
      const tableItems = extractTableRows(lines, region);
      items.push(...tableItems);
      for (let i = region.startLine; i <= Math.min(region.endLine, lines.length); i++) {
        coveredLines.add(i);
      }
      continue;
    }

    const startIdx = Math.max(0, region.startLine - 1);
    const endIdx = Math.min(lines.length, region.endLine);
    const regionContent = lines.slice(startIdx, endIdx).join('\n');

    items.push({
      noteType: region.type,
      title: region.title,
      content: regionContent,
      fields: region.fields ?? {},
      sourceRegion: { startLine: region.startLine, endLine: region.endLine },
    });

    for (let i = region.startLine; i <= region.endLine; i++) {
      coveredLines.add(i);
    }
  }

  const remainderLines: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (!coveredLines.has(i + 1)) {
      remainderLines.push(lines[i]);
    }
  }
  const remainder = remainderLines.join('\n').trim() || null;

  return { items, remainder };
}

function buildSystemPrompt(
  noteTypes: Array<{ module: string; noteType: ModuleNoteType }>
): string {
  const typeDescriptions = noteTypes
    .map(({ noteType }) => {
      const schemaFields = noteType.schema
        ? Object.entries(noteType.schema.properties)
            .map(([k, v]) => `${k} (${v.type}${v.description ? ': ' + v.description : ''})`)
            .join(', ')
        : 'none';
      return `- "${noteType.name}": ${noteType.description}. Fields: [${schemaFields}]`;
    })
    .join('\n');

  return `You classify documents into note types. Available types:
${typeDescriptions}

Output a JSON array of regions found in the document. Each region:
{"type":"<note_type>","title":"<short title>","startLine":<1-based>,"endLine":<1-based>,"confidence":<0-1>,"fields":{"key":"value"}}

For tables, add "columnMapping":{"csv_header":"schema_field"} and the system will extract rows automatically.

Example output:
[{"type":"task","title":"Fix login bug","startLine":1,"endLine":5,"confidence":0.9,"fields":{"status":"open","priority":"high"}}]

Output ONLY the JSON array, no other text.`;
}

function buildPrompt(
  content: string,
  filePath: string,
  _noteTypes: Array<{ module: string; noteType: ModuleNoteType }>
): string {
  const prepared = prepareContent(content);
  return `File: ${filePath}

Content:
${prepared}

Classify the content regions above into note types. Return a JSON array.`;
}

export function prepareContent(content: string): string {
  const lines = content.split('\n');

  if (isTable(lines)) {
    return prepareTableContent(lines);
  }

  if (content.length <= MAX_PROSE_CHARS) {
    return content;
  }

  const front = content.slice(0, FRONT_CHARS);
  const tail = content.slice(-TAIL_CHARS);
  const truncatedCount = lines.length - front.split('\n').length - tail.split('\n').length;
  return `${front}\n[...${truncatedCount} lines truncated...]\n${tail}`;
}

function isTable(lines: string[]): boolean {
  const pipedLines = lines.filter((l) => /^\|.+\|/.test(l.trim()));
  return pipedLines.length >= 3;
}

function prepareTableContent(lines: string[]): string {
  const headerIdx = lines.findIndex((l) => /^\|.+\|/.test(l.trim()));
  if (headerIdx === -1) return lines.join('\n');

  const sepIdx = headerIdx + 1;
  if (sepIdx >= lines.length || !/^\|[\s\-:|]+\|/.test(lines[sepIdx])) {
    return lines.join('\n');
  }

  const dataStart = sepIdx + 1;
  const dataLines = lines.slice(dataStart).filter((l) => /^\|.+\|/.test(l.trim()));
  const sampleCount = Math.min(TABLE_SAMPLE_ROWS, dataLines.length);
  const sample = dataLines.slice(0, sampleCount);

  const result = [lines[headerIdx], lines[sepIdx], ...sample];
  if (dataLines.length > sampleCount) {
    result.push(`[...${dataLines.length - sampleCount} more rows...]`);
  }
  return result.join('\n');
}

function parseResponse(raw: string): LlmRegion[] {
  const jsonMatch = raw.match(/\[[\s\S]*\]/);
  if (!jsonMatch) return [];

  try {
    const parsed = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(parsed)) return [];

    return parsed.filter(
      (r: unknown): r is LlmRegion =>
        typeof r === 'object' &&
        r !== null &&
        typeof (r as LlmRegion).type === 'string' &&
        typeof (r as LlmRegion).title === 'string' &&
        typeof (r as LlmRegion).startLine === 'number' &&
        typeof (r as LlmRegion).endLine === 'number' &&
        typeof (r as LlmRegion).confidence === 'number'
    );
  } catch {
    return [];
  }
}

function extractTableRows(lines: string[], region: LlmRegion): ExtractedItem[] {
  const mapping = region.columnMapping!;
  const startIdx = Math.max(0, region.startLine - 1);
  const endIdx = Math.min(lines.length, region.endLine);
  const tableLines = lines.slice(startIdx, endIdx);

  const headerLine = tableLines.find((l) => /^\|.+\|/.test(l.trim()));
  if (!headerLine) return [];

  const headers = headerLine
    .split('|')
    .map((h) => h.trim())
    .filter(Boolean);

  const headerIdx = tableLines.indexOf(headerLine);
  const sepIdx = headerIdx + 1;
  if (sepIdx >= tableLines.length || !/^\|[\s\-:|]+\|/.test(tableLines[sepIdx])) return [];

  const items: ExtractedItem[] = [];
  for (let i = sepIdx + 1; i < tableLines.length; i++) {
    const line = tableLines[i];
    if (!/^\|.+\|/.test(line)) continue;

    const cells = line
      .split('|')
      .map((c) => c.trim())
      .filter(Boolean);

    const fields: Record<string, string> = {};
    for (let j = 0; j < headers.length && j < cells.length; j++) {
      const headerLower = headers[j].toLowerCase().trim();
      const schemaField = mapping[headerLower];
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
      noteType: region.type,
      title,
      content: Object.entries(fields)
        .filter(([k]) => k !== 'description')
        .map(([k, v]) => `**${k}:** ${v}`)
        .join('\n'),
      fields,
      sourceRegion: { startLine: startIdx + i + 1, endLine: startIdx + i + 1 },
    });
  }

  return items;
}
