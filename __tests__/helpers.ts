import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { Chunk, NoteRecord } from '../src/types.js';

export function tmpDbPath(prefix = 'brain-test'): string {
  return join(tmpdir(), `${prefix}-${randomUUID()}.db`);
}

export function makeChunk(overrides: Partial<Chunk> = {}): Chunk {
  return {
    id: overrides.id ?? `chunk-${randomUUID().slice(0, 8)}`,
    noteId: overrides.noteId ?? 'test-note',
    heading: overrides.heading ?? null,
    headingAncestry: overrides.headingAncestry ?? null,
    content: overrides.content ?? 'test content',
    tokenCount: overrides.tokenCount ?? 2,
    chunkType: overrides.chunkType ?? 'section',
    cutType: overrides.cutType ?? 'heading_boundary',
    position: overrides.position ?? 0,
  };
}

export function makeNote(overrides: Partial<NoteRecord> = {}): NoteRecord {
  return {
    id: overrides.id ?? `note-${randomUUID().slice(0, 8)}`,
    filePath: overrides.filePath ?? `/notes/${randomUUID().slice(0, 8)}.md`,
    title: overrides.title ?? 'Test Note',
    type: overrides.type ?? 'note',
    tier: overrides.tier ?? 'slow',
    category: overrides.category ?? null,
    tags: overrides.tags ?? null,
    summary: overrides.summary ?? null,
    confidence: overrides.confidence ?? null,
    status: overrides.status ?? 'current',
    sources: overrides.sources ?? null,
    createdAt: overrides.createdAt ?? null,
    modifiedAt: overrides.modifiedAt ?? null,
    lastReviewed: overrides.lastReviewed ?? null,
    reviewInterval: overrides.reviewInterval ?? null,
    expires: overrides.expires ?? null,
    metadata: overrides.metadata ?? null,
  };
}
