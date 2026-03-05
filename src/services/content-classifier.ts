import { createHash } from 'node:crypto';
import type { Embedder } from '../types.js';
import type { OllamaClient } from './ollama.js';
import { getArchetypeEmbeddings } from './content-archetypes.js';

export interface ClassifiedSection {
  content: string;
  contentClass: string;
  confidence: number;
  method: 'deterministic' | 'llm' | 'embedding';
  heading: string | null;
}

export interface NoteTypeSchema {
  name: string;
  fields: string[];
}

export interface TableClassification {
  decompose: boolean;
  noteType: string;
  schemaMapping?: Record<string, string>;
  suggestedTitle?: string;
  reason: string;
}

const TASK_TABLE_COLUMNS = ['status', 'priority', 'assignee', 'due', 'estimate', 'owner'];

const BUG_PATTERNS = [
  /steps?\s+to\s+reproduce/i,
  /expected\s+behavio/i,
  /actual\s+behavio/i,
  /severity/i,
  /bug\s*bash/i,
];

const ARCH_HEADINGS = /\b(architecture|system\s+design|data\s+flow|component|infrastructure)\b/i;
const ARCH_CONTENT = /\b(scalab|microservice|endpoint|pipeline|queue|layer|deploy)/i;

const REQ_HEADINGS = /\b(requirements?|prd|user\s+stor|acceptance\s+criteria)\b/i;
const REQ_CONTENT = /\b(must|shall|should)\b/i;

const MEETING_PATTERNS = [/attendees?:/i, /agenda:/i, /action\s+items?:/i, /discussed:/i];

function extractTableHeaders(text: string): string[] | null {
  const lines = text.split('\n');
  const headerLine = lines.find((l) => /^\|.+\|/.test(l));
  if (!headerLine) return null;
  const sepIdx = lines.indexOf(headerLine) + 1;
  if (sepIdx >= lines.length || !/^\|[\s-:|]+\|/.test(lines[sepIdx])) return null;
  return headerLine
    .split('|')
    .map((c) => c.trim().toLowerCase())
    .filter(Boolean);
}

function countTableRows(text: string): number {
  return text.split('\n').filter((l) => /^\|.+\|/.test(l)).length - 2;
}

export function classifySection(text: string, heading: string | null): ClassifiedSection {
  const base = { content: text, heading, method: 'deterministic' as const };

  // Task-list: table with task columns
  const headers = extractTableHeaders(text);
  if (headers) {
    const taskHits = headers.filter((h) => TASK_TABLE_COLUMNS.includes(h)).length;
    if (taskHits >= 2) {
      return { ...base, contentClass: 'task', confidence: 0.9 };
    }
  }

  // Task-list: checkbox lists
  const checkboxCount = (text.match(/^[-*]\s+\[[ x]\]/gm) || []).length;
  if (checkboxCount >= 2) {
    return { ...base, contentClass: 'task', confidence: 0.8 };
  }

  // Bug-report → task
  const bugHits = BUG_PATTERNS.filter((p) => p.test(text)).length;
  const headingBugHit = heading && /bug/i.test(heading) ? 1 : 0;
  if (bugHits + headingBugHit >= 2) {
    return { ...base, contentClass: 'task', confidence: 0.85 };
  }

  // Architecture → research
  const archHeading = heading && ARCH_HEADINGS.test(heading);
  const archContent = ARCH_CONTENT.test(text) && (text.match(/```/g) || []).length >= 2;
  if (archHeading || archContent) {
    return { ...base, contentClass: 'research', confidence: archHeading ? 0.9 : 0.75 };
  }

  // Requirements → guide
  const reqHeading = heading && REQ_HEADINGS.test(heading);
  const reqBullets = REQ_CONTENT.test(text) && /^[-*]\s+/m.test(text);
  if (reqHeading || (reqBullets && (text.match(REQ_CONTENT) || []).length >= 3)) {
    return { ...base, contentClass: 'guide', confidence: reqHeading ? 0.9 : 0.7 };
  }

  // Meeting notes → meeting
  const meetHits = MEETING_PATTERNS.filter((p) => p.test(text)).length;
  if (meetHits >= 2) {
    return { ...base, contentClass: 'meeting', confidence: 0.85 };
  }

  // Reference: large non-task table → note
  if (headers && headers.length >= 3 && countTableRows(text) >= 10) {
    return { ...base, contentClass: 'note', confidence: 0.7 };
  }

  return { ...base, contentClass: 'note', confidence: 0.5 };
}

// LLM table classification

const classificationCache = new Map<string, TableClassification>();

function tableSignature(headers: string[], sampleRows: string[][]): string {
  const key = JSON.stringify({ h: [...headers].sort(), r: sampleRows.slice(0, 3) });
  return createHash('sha256').update(key).digest('hex').slice(0, 16);
}

export async function classifyTableWithLlm(
  client: OllamaClient,
  headers: string[],
  sampleRows: string[][],
  registeredTypes: NoteTypeSchema[]
): Promise<TableClassification> {
  const sig = tableSignature(headers, sampleRows);
  const cached = classificationCache.get(sig);
  if (cached) return cached;

  const typesDesc =
    registeredTypes.length > 0
      ? `Registered note types:\n${registeredTypes.map((t) => `- ${t.name}: fields [${t.fields.join(', ')}]`).join('\n')}`
      : 'No specific note types registered.';

  const rowsPreview = sampleRows
    .slice(0, 5)
    .map((r) => r.join(' | '))
    .join('\n');

  const system =
    'You classify tables for a knowledge base. Respond with valid JSON only, no markdown fences. Schema: { "decompose": boolean, "noteType": string, "schemaMapping"?: { column: field }, "suggestedTitle"?: string, "reason": string }';

  const prompt = `Table headers: ${headers.join(', ')}\nSample rows:\n${rowsPreview}\n\n${typesDesc}\n\nShould this table be decomposed into individual notes (rows are independent actionable items) or kept as a single reference note (rows are related and only meaningful together)? If decomposed, map columns to note type fields.`;

  const response = await client.generate(prompt, system);
  const result = JSON.parse(response) as TableClassification;
  classificationCache.set(sig, result);
  return result;
}

export function clearClassificationCache(): void {
  classificationCache.clear();
}

// Embedding-based classification

function cosineSimilarity(a: Float32Array | number[], b: Float32Array | number[]): number {
  let dot = 0,
    normA = 0,
    normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

export async function classifySectionWithEmbedding(
  text: string,
  heading: string | null,
  embedder: Embedder,
  archetypeTexts?: Map<string, string>
): Promise<ClassifiedSection> {
  const archetypes = await getArchetypeEmbeddings(embedder, archetypeTexts);
  const [embedding] = await embedder.embed([text]);
  const vec = new Float32Array(embedding);

  let bestClass = 'note';
  let bestScore = 0.6; // minimum threshold

  for (const [cls, archVec] of archetypes) {
    const score = cosineSimilarity(vec, archVec);
    if (score > bestScore) {
      bestScore = score;
      bestClass = cls;
    }
  }

  return {
    content: text,
    contentClass: bestClass,
    confidence: bestClass === 'note' ? 0.5 : bestScore,
    method: 'embedding',
    heading,
  };
}
