import type { ExtractedFact, MemoryCategory } from '../types.js';

const NARRATIVE_CATEGORIES: MemoryCategory[] = ['events', 'cases'];

const BULLET_PATTERN = /^[\s]*[-*\u2022]\s+/;
const NUMBERED_PATTERN = /^[\s]*\d+[.)]\s+/;

export function isCompoundMemory(content: string): boolean {
  const lines = content.split('\n').filter((l) => l.trim().length > 0);
  if (lines.length > 1 && lines.every((l) => BULLET_PATTERN.test(l) || NUMBERED_PATTERN.test(l))) {
    return true;
  }

  if (hasSemicolonSeparatedFacts(content)) return true;
  if (hasConjunctionSeparatedFacts(content)) return true;

  return false;
}

function hasSemicolonSeparatedFacts(content: string): boolean {
  const parts = content.split(';').map((p) => p.trim());
  return parts.length >= 2 && parts.every((p) => p.length > 10);
}

function hasConjunctionSeparatedFacts(content: string): boolean {
  const conjunctionPatterns = [/,\s+and\s+/i, /\.\s+Also[, ]/i, /\.\s+Additionally[, ]/i];

  for (const pattern of conjunctionPatterns) {
    if (pattern.test(content)) {
      const parts = splitByPattern(content, pattern);
      if (parts.length >= 2 && parts.every((p) => p.trim().length > 10)) {
        return true;
      }
    }
  }
  return false;
}

function splitByPattern(content: string, pattern: RegExp): string[] {
  return content
    .split(pattern)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

export function splitCompound(content: string): string[] {
  const lines = content.split('\n').filter((l) => l.trim().length > 0);
  if (lines.length > 1 && lines.every((l) => BULLET_PATTERN.test(l) || NUMBERED_PATTERN.test(l))) {
    return lines
      .map((l) => l.replace(BULLET_PATTERN, '').replace(NUMBERED_PATTERN, '').trim())
      .filter((l) => l.length > 0);
  }

  if (hasSemicolonSeparatedFacts(content)) {
    return content
      .split(';')
      .map((p) => p.trim())
      .filter((p) => p.length > 10);
  }

  const conjunctionPatterns: Array<{ pattern: RegExp; restore: string }> = [
    { pattern: /,\s+and\s+/i, restore: '' },
    { pattern: /\.\s+Also[, ]/i, restore: '' },
    { pattern: /\.\s+Additionally[, ]/i, restore: '' },
  ];

  for (const { pattern } of conjunctionPatterns) {
    if (pattern.test(content)) {
      const parts = content
        .split(pattern)
        .map((p) => p.trim())
        .filter((p) => p.length > 10);
      if (parts.length >= 2) return parts;
    }
  }

  return [content];
}

function isNarrativeCategory(category: MemoryCategory | null): boolean {
  return category !== null && NARRATIVE_CATEGORIES.includes(category);
}

export function splitMemoryFacets(memories: ExtractedFact[]): ExtractedFact[] {
  const result: ExtractedFact[] = [];

  for (const memory of memories) {
    if (isNarrativeCategory(memory.category)) {
      result.push(memory);
      continue;
    }

    if (!isCompoundMemory(memory.fact)) {
      result.push(memory);
      continue;
    }

    const parts = splitCompound(memory.fact);
    for (const part of parts) {
      result.push({
        fact: part,
        sourceChunkId: memory.sourceChunkId,
        category: memory.category,
      });
    }
  }

  return result;
}
