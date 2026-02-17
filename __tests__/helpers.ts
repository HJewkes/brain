import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { NoteRecord } from '../src/types.js'

export function tmpDbPath(prefix = 'brain-test'): string {
  return join(tmpdir(), `${prefix}-${randomUUID()}.db`)
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
  }
}
