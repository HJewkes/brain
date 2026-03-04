import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type {
  ActivityRecord,
  Chunk,
  Embedder,
  FeedRecord,
  InboxItem,
  MemoryEntry,
  NoteRecord,
  BrainConfig,
} from '../src/types.js';
import type { BrainDB } from '../src/services/brain-db.js';
import { createTask } from '../src/modules/pm/data/task-ops.js';
import type { CreateTaskInput } from '../src/modules/pm/data/task-ops.js';

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

export function makeMemoryEntry(overrides: Partial<MemoryEntry> = {}): MemoryEntry {
  return {
    id: overrides.id ?? `mem-${randomUUID().slice(0, 8)}`,
    memory: overrides.memory ?? 'Test memory fact',
    sourceNoteId: overrides.sourceNoteId ?? 'test-note',
    sourceChunkId: overrides.sourceChunkId ?? null,
    containerTag: overrides.containerTag ?? 'default',
    isLatest: overrides.isLatest ?? true,
    parentMemoryId: overrides.parentMemoryId ?? null,
    rootMemoryId: overrides.rootMemoryId ?? null,
    relationType: overrides.relationType ?? null,
    validAt: overrides.validAt ?? '2026-01-01T00:00:00Z',
    invalidAt: overrides.invalidAt ?? null,
    forgetAfter: overrides.forgetAfter ?? null,
    isForgotten: overrides.isForgotten ?? false,
    isInference: overrides.isInference ?? false,
    createdAt: overrides.createdAt ?? '2026-01-01T00:00:00Z',
  };
}

export function makeFeedRecord(overrides: Partial<FeedRecord> = {}): FeedRecord {
  return {
    id: overrides.id ?? `feed-${randomUUID().slice(0, 8)}`,
    url: overrides.url ?? `https://example.com/${randomUUID().slice(0, 8)}.xml`,
    name: overrides.name ?? 'Test Feed',
    containerTag: overrides.containerTag ?? 'default',
    filterPrompt: overrides.filterPrompt ?? null,
    lastPolled: overrides.lastPolled ?? null,
    createdAt: overrides.createdAt ?? '2026-01-01T00:00:00Z',
  };
}

export function makeInboxItem(overrides: Partial<InboxItem> = {}): InboxItem {
  return {
    id: overrides.id ?? `inbox-${randomUUID().slice(0, 8)}`,
    content: overrides.content ?? 'Test inbox content',
    title: overrides.title ?? null,
    source: overrides.source ?? 'cli',
    sourceUrl: overrides.sourceUrl ?? null,
    sourceMeta: overrides.sourceMeta ?? null,
    status: overrides.status ?? 'pending',
    createdAt: overrides.createdAt ?? '2026-01-01T00:00:00Z',
    processedAt: overrides.processedAt ?? null,
  };
}

export function createMockEmbedder(dimensions = 384): Embedder {
  function hashToVector(text: string): number[] {
    const vec = new Array<number>(dimensions).fill(0);
    for (let i = 0; i < text.length; i++) {
      const idx = i % dimensions;
      vec[idx] += text.charCodeAt(i) / 1000;
    }
    const magnitude = Math.sqrt(vec.reduce((sum, v) => sum + v * v, 0));
    if (magnitude > 0) {
      for (let i = 0; i < vec.length; i++) {
        vec[i] /= magnitude;
      }
    }
    return vec;
  }

  return {
    model: 'mock-embedder',
    dimensions,
    async embed(texts: string[]): Promise<number[][]> {
      return texts.map(hashToVector);
    },
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
    module: overrides.module ?? null,
    moduleInstance: overrides.moduleInstance ?? null,
    contentDir: overrides.contentDir ?? null,
  };
}

export function createTestTask(
  db: BrainDB,
  config: BrainConfig,
  embedder: Embedder,
  input: Omit<CreateTaskInput, 'description'> & { description?: string }
) {
  return createTask(db, config, embedder, {
    ...input,
    description:
      input.description ?? `Test task: ${input.name}. This is a test task for automated testing.`,
  });
}

export function makeActivity(overrides: Partial<ActivityRecord> = {}): ActivityRecord {
  return {
    id: overrides.id ?? `activity-${randomUUID().slice(0, 8)}`,
    noteIds: overrides.noteIds ?? null,
    module: overrides.module ?? null,
    moduleInstance: overrides.moduleInstance ?? null,
    activityType: overrides.activityType ?? null,
    actorType: overrides.actorType ?? null,
    actorId: overrides.actorId ?? null,
    sessionId: overrides.sessionId ?? null,
    metadata: overrides.metadata ?? null,
    outcome: overrides.outcome ?? null,
    startedAt: overrides.startedAt ?? null,
    completedAt: overrides.completedAt ?? null,
  };
}
