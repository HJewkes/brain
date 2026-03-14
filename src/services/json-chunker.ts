import type { RawChunk } from '../types.js';
import { estimateTokens } from './markdown-parser.js';

const MAX_CHUNK_CHARS = 4096;
const IDENTITY_FIELDS = ['id', 'name', 'title', 'displayName', 'key'] as const;

export function buildKeyPath(path: string, key: string): string {
  return path ? `${path}.${key}` : key;
}

export function detectIdentityField(obj: Record<string, unknown>): string | null {
  for (const field of IDENTITY_FIELDS) {
    const val = obj[field];
    if (typeof val === 'string' && val.length > 0) return val;
    if (typeof val === 'number') return String(val);
  }
  return null;
}

export function chunkJson(content: string, _filePath: string): RawChunk[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return [];
  }

  if (parsed === null || typeof parsed !== 'object') return [];

  const chunks: RawChunk[] = [];
  walkValue(parsed, '', chunks);
  return chunks;
}

function walkValue(value: unknown, path: string, chunks: RawChunk[]): void {
  if (Array.isArray(value)) {
    walkArray(value, path, chunks);
  } else if (value !== null && typeof value === 'object') {
    walkObject(value as Record<string, unknown>, path, chunks);
  }
}

function walkObject(obj: Record<string, unknown>, path: string, chunks: RawChunk[]): void {
  const keys = Object.keys(obj);

  for (const key of keys) {
    const keyPath = buildKeyPath(path, key);
    const val = obj[key];

    if (isLeafValue(val)) {
      emitChunk(keyPath, formatLeaf(key, val), chunks);
    } else {
      walkValue(val, keyPath, chunks);
    }
  }
}

function walkArray(arr: unknown[], path: string, chunks: RawChunk[]): void {
  for (let i = 0; i < arr.length; i++) {
    const element = arr[i];

    if (isLeafValue(element)) {
      const heading = `${path}[${i}]`;
      emitChunk(heading, JSON.stringify(element, null, 2), chunks);
      continue;
    }

    if (element !== null && typeof element === 'object' && !Array.isArray(element)) {
      const record = element as Record<string, unknown>;
      const identity = detectIdentityField(record);
      const heading = identity ? `${path} > ${identity}` : `${path}[${i}]`;
      const text = JSON.stringify(record, null, 2);

      if (text.length <= MAX_CHUNK_CHARS) {
        emitChunk(heading, text, chunks);
      } else {
        walkObject(record, heading, chunks);
      }
    } else {
      walkValue(element, `${path}[${i}]`, chunks);
    }
  }
}

function isLeafValue(val: unknown): boolean {
  return val === null || typeof val !== 'object';
}

function formatLeaf(key: string, val: unknown): string {
  return `${key}: ${JSON.stringify(val)}`;
}

function emitChunk(heading: string, text: string, chunks: RawChunk[]): void {
  if (text.length > MAX_CHUNK_CHARS) {
    splitLargeText(heading, text, chunks);
    return;
  }

  chunks.push({
    heading,
    headingAncestry: heading,
    text,
    tokenCount: estimateTokens(text),
    chunkType: 'section',
    cutType: 'semantic_split',
    contentType: 'code',
    position: chunks.length,
  });
}

function splitLargeText(heading: string, text: string, chunks: RawChunk[]): void {
  let offset = 0;
  let partIndex = 0;

  while (offset < text.length) {
    const slice = text.slice(offset, offset + MAX_CHUNK_CHARS);
    const partHeading = `${heading} (part ${partIndex + 1})`;

    chunks.push({
      heading: partHeading,
      headingAncestry: partHeading,
      text: slice,
      tokenCount: estimateTokens(slice),
      chunkType: 'section',
      cutType: 'token_limit',
      contentType: 'code',
      position: chunks.length,
    });

    offset += MAX_CHUNK_CHARS;
    partIndex++;
  }
}
