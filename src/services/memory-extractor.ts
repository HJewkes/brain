import { randomUUID } from 'node:crypto';
import type { OllamaClient } from './ollama.js';
import type { BrainDB } from './brain-db.js';
import type { Chunk, ExtractedFact, MemoryEntry } from '../types.js';

const EXTRACTION_SYSTEM = `You are a fact extraction engine. Given a text, extract discrete, self-contained facts.
Each fact should be a single sentence that stands alone without context.
Output one fact per line. Do not number them. Do not add commentary.
If the text contains no extractable facts, output nothing.
Focus on: decisions, preferences, patterns, technical facts, relationships, and conclusions.
Skip: filler text, questions, TODOs, and speculative statements.`;

export interface ExtractionResult {
  noteId: string;
  facts: ExtractedFact[];
  memoriesCreated: number;
}

export async function extractMemoriesFromNote(
  db: BrainDB,
  llm: OllamaClient,
  noteId: string,
  containerTag: string = 'default'
): Promise<ExtractionResult> {
  const chunks = db.getChunksForNote(noteId);
  if (chunks.length === 0) {
    return { noteId, facts: [], memoriesCreated: 0 };
  }

  const allFacts: ExtractedFact[] = [];

  for (const chunk of chunks) {
    const facts = await extractFactsFromChunk(llm, chunk);
    allFacts.push(...facts);
  }

  let memoriesCreated = 0;
  const now = new Date().toISOString();

  for (const fact of allFacts) {
    const id = randomUUID();
    const entry: MemoryEntry = {
      id,
      memory: fact.fact,
      sourceNoteId: noteId,
      sourceChunkId: fact.sourceChunkId,
      containerTag,
      isLatest: true,
      parentMemoryId: null,
      rootMemoryId: null,
      relationType: null,
      validAt: now,
      invalidAt: null,
      forgetAfter: null,
      isForgotten: false,
      isInference: false,
      createdAt: now,
    };

    db.addMemory(entry);
    db.addMemoryHistory({
      memoryId: id,
      event: 'add',
      oldMemory: null,
      newMemory: fact.fact,
      actor: 'extractor',
      createdAt: now,
    });
    memoriesCreated++;
  }

  return { noteId, facts: allFacts, memoriesCreated };
}

async function extractFactsFromChunk(
  llm: OllamaClient,
  chunk: Chunk
): Promise<ExtractedFact[]> {
  const text = chunk.content;
  if (text.trim().length < 20) return [];

  const response = await llm.generate(text, EXTRACTION_SYSTEM);

  if (!response.trim()) return [];

  const lines = response
    .split('\n')
    .map((l) => l.replace(/^[-*•]\s*/, '').trim())
    .filter((l) => l.length > 10);

  return lines.map((fact) => ({
    fact,
    sourceChunkId: chunk.id,
  }));
}
