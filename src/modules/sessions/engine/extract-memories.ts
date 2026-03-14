import { randomUUID } from 'node:crypto';
import type { BrainDB } from '../../../services/brain-db.js';
import type { OllamaClient } from '../../../services/ollama.js';
import type { Embedder, Chunk } from '../../../types.js';
import { extractMemoriesFromNote } from '../../../services/memory-extractor.js';
import { getSessionChunkContents } from './aggregate.js';

export interface SessionExtractionResult {
  memoriesCreated: number;
  memoriesUpdated: number;
  memoriesDeleted: number;
}

const EMPTY_RESULT: SessionExtractionResult = {
  memoriesCreated: 0,
  memoriesUpdated: 0,
  memoriesDeleted: 0,
};

export async function extractSessionMemories(
  db: BrainDB,
  llm: OllamaClient,
  embedder: Embedder,
  sessionId: string,
  noteId: string
): Promise<SessionExtractionResult> {
  const chunkContents = getSessionChunkContents(db, sessionId);
  if (chunkContents.length === 0) {
    return EMPTY_RESULT;
  }

  await injectSessionChunks(db, noteId, chunkContents, embedder);

  const containerTag = `session:${sessionId}`;
  const result = await extractMemoriesFromNote(db, llm, noteId, {
    containerTag,
    embedder,
  });

  return {
    memoriesCreated: result.memoriesCreated,
    memoriesUpdated: result.memoriesUpdated,
    memoriesDeleted: result.memoriesDeleted,
  };
}

async function injectSessionChunks(
  db: BrainDB,
  noteId: string,
  contents: string[],
  embedder: Embedder
): Promise<void> {
  const chunks = contents.map((content, i) => buildChunk(noteId, content, i));
  const embeddings = await embedChunks(embedder, contents);
  db.upsertChunks(noteId, chunks, embeddings);
}

function buildChunk(noteId: string, content: string, position: number): Chunk {
  return {
    id: `session-chunk-${randomUUID().slice(0, 8)}`,
    noteId,
    heading: null,
    headingAncestry: null,
    content,
    tokenCount: Math.ceil(content.length / 4),
    chunkType: 'section',
    cutType: 'heading_boundary',
    contentType: 'prose',
    position,
  };
}

async function embedChunks(embedder: Embedder, contents: string[]): Promise<Float32Array[]> {
  const embeddings = await embedder.embed(contents);
  return embeddings.map((e) => new Float32Array(e));
}

export function updateSessionMemoryCount(
  db: BrainDB,
  sessionId: string,
  memoriesExtracted: number
): void {
  const noteIds = db.getModuleNoteIds({ module: 'sessions', type: 'session' });
  const notes = db.getNotesByIds(noteIds);

  for (const [, note] of notes) {
    if (!note.metadata) continue;
    const meta = JSON.parse(note.metadata) as Record<string, unknown>;
    if (meta.session_id !== sessionId) continue;

    meta.memories_extracted = memoriesExtracted;
    meta.modified = new Date().toISOString().slice(0, 10);
    db.upsertNote({ ...note, metadata: JSON.stringify(meta) });
    return;
  }
}
