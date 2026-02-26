import matter from 'gray-matter';
import type {
  ParsedNote,
  NoteFrontmatter,
  RawChunk,
  Relation,
  RelationType,
  NoteSource,
  CutType,
} from '../types.js';
import {
  VALID_CORE_NOTE_TYPES,
  VALID_NOTE_TIERS,
  VALID_NOTE_CONFIDENCES,
  VALID_NOTE_STATUSES,
} from '../types.js';
import { slugify } from '../utils.js';

const MAX_CHUNK_TOKENS = 512;
const FENCE_OPEN = /^```/;
const FENCE_CLOSE = /^```\s*$/;
const MIN_CHUNK_LENGTH = 20;

export function estimateTokens(text: string): number {
  if (text.length === 0) return 0;
  return Math.ceil(text.length / 4);
}

export function parseMarkdown(filePath: string, content: string): ParsedNote {
  const { data, content: body } = matter(content);

  const id = deriveId(filePath, data);
  const frontmatter = coerceFrontmatter(filePath, data);
  const chunks = chunkBody(body);
  const relations = extractRelations(id, data);

  return { id, filePath, frontmatter, content: body, chunks, relations };
}

function deriveId(filePath: string, data: Record<string, unknown>): string {
  if (typeof data.id === 'string' && data.id.length > 0) return data.id;
  if (typeof data.title === 'string' && data.title.length > 0) return slugify(data.title);
  const filename = filePath.split('/').pop() ?? filePath;
  return filename.replace(/\.md$/, '');
}

export function coerceFrontmatter(
  filePath: string,
  data: Record<string, unknown>
): NoteFrontmatter {
  const filename = (filePath.split('/').pop() ?? filePath).replace(/\.md$/, '');
  const hasModule = typeof data.module === 'string';

  // When a module is present, pass unknown types through instead of coercing to 'note'
  const type = hasModule && typeof data.type === 'string'
    ? (data.type as NoteFrontmatter['type'])
    : coerceEnum(data.type, VALID_CORE_NOTE_TYPES, 'note');

  return {
    id: typeof data.id === 'string' ? data.id : undefined,
    title: typeof data.title === 'string' ? data.title : filename,
    type,
    tier: coerceEnum(data.tier, VALID_NOTE_TIERS, 'slow'),
    category: coerceString(data.category),
    tags: coerceTags(data.tags),
    summary: coerceString(data.summary),
    confidence: coerceEnum(data.confidence, VALID_NOTE_CONFIDENCES, undefined),
    status: coerceEnum(data.status, VALID_NOTE_STATUSES, undefined),
    sources: coerceSources(data.sources),
    created: coerceDate(data.created),
    modified: coerceDate(data.modified),
    'last-reviewed': coerceDate(data['last-reviewed']),
    'review-interval': coerceReviewInterval(data['review-interval']),
    expires: coerceDate(data.expires),
    date: coerceDate(data.date),
    participants: coerceStringArray(data.participants),
    project: coerceString(data.project),
    outcome: coerceString(data.outcome),
    related: coerceStringArray(data.related),
    supersedes: coerceString(data.supersedes),
    parent: coerceString(data.parent),
    module: coerceString(data.module),
    'module-instance': coerceString(data['module-instance']),
    'content-dir': coerceString(data['content-dir']),
  };
}

function coerceString(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (value != null && typeof value !== 'object') return String(value);
  return undefined;
}

function coerceEnum<T extends string>(value: unknown, valid: T[], fallback: T): T;
function coerceEnum<T extends string>(
  value: unknown,
  valid: T[],
  fallback: undefined
): T | undefined;
function coerceEnum<T extends string>(
  value: unknown,
  valid: T[],
  fallback: T | undefined
): T | undefined {
  if (typeof value === 'string' && valid.includes(value as T)) return value as T;
  return fallback;
}

function coerceTags(value: unknown): string[] | undefined {
  if (Array.isArray(value)) {
    return value.filter((v): v is string => typeof v === 'string');
  }
  if (typeof value === 'string') {
    if (value.includes(',')) {
      return value
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    }
    return [value];
  }
  return undefined;
}

function coerceDate(value: unknown): string | undefined {
  if (value instanceof Date) {
    return isNaN(value.getTime()) ? undefined : value.toISOString();
  }
  if (typeof value === 'string') return value;
  return undefined;
}

function coerceSources(value: unknown): NoteSource[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const valid: NoteSource[] = [];
  for (const entry of value) {
    if (
      typeof entry === 'object' &&
      entry !== null &&
      typeof (entry as Record<string, unknown>).url === 'string'
    ) {
      valid.push({
        url: (entry as Record<string, unknown>).url as string,
        accessed:
          typeof (entry as Record<string, unknown>).accessed === 'string'
            ? ((entry as Record<string, unknown>).accessed as string)
            : '',
        type:
          typeof (entry as Record<string, unknown>).type === 'string'
            ? ((entry as Record<string, unknown>).type as string)
            : '',
      });
    }
  }
  return valid.length > 0 ? valid : undefined;
}

function coerceReviewInterval(value: unknown): string | undefined {
  if (typeof value === 'string' && /^\d+[dwm]$/.test(value)) return value;
  return undefined;
}

function coerceStringArray(value: unknown): string[] | undefined {
  if (Array.isArray(value)) {
    const filtered = value.filter((v): v is string => typeof v === 'string');
    return filtered.length > 0 ? filtered : undefined;
  }
  return undefined;
}

interface Section {
  heading: string | null;
  headingLevel: number;
  headingAncestry: string | null;
  lines: string[];
}

function buildAncestry(stack: Array<{ level: number; text: string }>): string | null {
  if (stack.length === 0) return null;
  return stack.map((h) => `${'#'.repeat(h.level)} ${h.text}`).join('\n');
}

function splitIntoSections(body: string): Section[] {
  const lines = body.split('\n');
  const sections: Section[] = [];
  const headingStack: Array<{ level: number; text: string }> = [];
  let current: Section = { heading: null, headingLevel: 0, headingAncestry: null, lines: [] };

  for (const line of lines) {
    const match = line.match(/^(#{1,3})\s+(.+)$/);
    if (match) {
      sections.push(current);
      const level = match[1].length;
      const text = match[2];

      // Pop stack to parent level
      while (headingStack.length > 0 && headingStack[headingStack.length - 1].level >= level) {
        headingStack.pop();
      }
      headingStack.push({ level, text });

      current = {
        heading: text,
        headingLevel: level,
        headingAncestry: buildAncestry(headingStack),
        lines: [],
      };
    } else {
      current.lines.push(line);
    }
  }
  sections.push(current);

  return sections;
}

function prependAncestry(ancestry: string | null, text: string): string {
  if (!ancestry) return text;
  return `${ancestry}\n\n${text}`;
}

function chunkBody(body: string): RawChunk[] {
  const sections = splitIntoSections(body);
  const chunks: RawChunk[] = [];
  let position = 0;

  for (const section of sections) {
    const text = section.lines.join('\n').trim();
    if (text.length < MIN_CHUNK_LENGTH) continue;

    const contentWithAncestry = prependAncestry(section.headingAncestry, text);
    const tokens = estimateTokens(contentWithAncestry);
    if (tokens <= MAX_CHUNK_TOKENS) {
      chunks.push({
        heading: section.heading,
        headingAncestry: section.headingAncestry,
        text: contentWithAncestry,
        tokenCount: tokens,
        chunkType: 'section',
        cutType: 'heading_boundary',
        position: position++,
      });
    } else {
      const subChunks = splitOversizedSection(
        section.heading,
        section.headingAncestry,
        text,
        position
      );
      position += subChunks.length;
      chunks.push(...subChunks);
    }
  }

  return chunks;
}

function splitOversizedSection(
  heading: string | null,
  headingAncestry: string | null,
  text: string,
  startPosition: number
): RawChunk[] {
  const paragraphs = splitParagraphsProtectingFences(text);
  const chunks: RawChunk[] = [];
  let buffer = '';
  let overlapPrefix = '';
  let pos = startPosition;

  const ancestryPrefix = headingAncestry ? headingAncestry + '\n\n' : '';
  const ancestryTokens = estimateTokens(ancestryPrefix);
  const chunkBudget = MAX_CHUNK_TOKENS - ancestryTokens;

  for (const para of paragraphs) {
    const budgetForContent =
      overlapPrefix.length > 0 ? chunkBudget - estimateTokens(overlapPrefix + '\n\n') : chunkBudget;
    const bufferWithPara = buffer.length > 0 ? buffer + '\n\n' + para : para;
    if (estimateTokens(bufferWithPara) > budgetForContent && buffer.length > 0) {
      const rawText = overlapPrefix.length > 0 ? overlapPrefix + '\n\n' + buffer : buffer;
      const chunkText = ancestryPrefix + rawText.trim();
      const tokenCount = estimateTokens(chunkText);
      const cutType: CutType = para.startsWith('```') ? 'code_fence' : 'paragraph_end';
      chunks.push({
        heading,
        headingAncestry,
        text: chunkText,
        tokenCount,
        chunkType: 'paragraph',
        cutType,
        position: pos++,
      });
      overlapPrefix = extractOverlap(buffer);
      buffer = para;
    } else {
      buffer = buffer.length > 0 ? buffer + '\n\n' + para : para;
    }
  }

  if (buffer.length > 0) {
    const rawText = overlapPrefix.length > 0 ? overlapPrefix + '\n\n' + buffer : buffer;
    const chunkText = ancestryPrefix + rawText.trim();
    const tokenCount = estimateTokens(chunkText);
    chunks.push({
      heading,
      headingAncestry,
      text: chunkText,
      tokenCount,
      chunkType: 'paragraph',
      cutType: 'paragraph_end',
      position: pos++,
    });
  }

  return chunks;
}

function extractOverlap(text: string): string {
  const targetTokens = Math.ceil(estimateTokens(text) * 0.1);
  const targetChars = targetTokens * 4;
  if (text.length <= targetChars) return text;
  return text.slice(-targetChars);
}

function splitParagraphsProtectingFences(text: string): string[] {
  const lines = text.split('\n');
  const paragraphs: string[] = [];
  let current: string[] = [];
  let inFence = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (!inFence && FENCE_OPEN.test(line)) {
      // If there's accumulated non-fence text, flush it first
      if (current.length > 0) {
        const joined = current.join('\n').trim();
        if (joined.length > 0) paragraphs.push(joined);
        current = [];
      }
      inFence = true;
      current.push(line);
      continue;
    }

    if (inFence) {
      current.push(line);
      // Close fence: a line that is just ``` (possibly with trailing whitespace)
      // but not the opening line itself
      if (FENCE_CLOSE.test(line) && current.length > 1) {
        const joined = current.join('\n').trim();
        if (joined.length > 0) paragraphs.push(joined);
        current = [];
        inFence = false;
      }
      continue;
    }

    // Outside fence: split on blank lines
    if (line.trim() === '') {
      if (current.length > 0) {
        const joined = current.join('\n').trim();
        if (joined.length > 0) paragraphs.push(joined);
        current = [];
      }
    } else {
      current.push(line);
    }
  }

  const joined = current.join('\n').trim();
  if (joined.length > 0) paragraphs.push(joined);

  return paragraphs;
}

function extractRelations(sourceId: string, data: Record<string, unknown>): Relation[] {
  const relations: Relation[] = [];

  if (Array.isArray(data.related)) {
    for (const target of data.related) {
      if (typeof target === 'string') {
        relations.push({
          sourceId,
          targetId: target,
          type: 'related-to' as RelationType,
        });
      }
    }
  }

  if (typeof data.supersedes === 'string') {
    relations.push({
      sourceId,
      targetId: data.supersedes,
      type: 'supersedes' as RelationType,
    });
  }

  if (typeof data.parent === 'string') {
    relations.push({
      sourceId,
      targetId: data.parent,
      type: 'parent' as RelationType,
    });
  }

  return relations;
}
